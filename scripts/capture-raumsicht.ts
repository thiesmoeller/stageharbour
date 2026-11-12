/**
 * Screenshots of representative Bühnenbilder in the Raumsicht, for before/after comparison of the
 * renderer on one machine.
 *
 *   npm run build
 *   flock /tmp/stageharbour-e2e.lock node --import tsx scripts/capture-raumsicht.ts --out docs/measurements/raumsicht-port/after
 *
 * Starts tests/helpers/browser-server.ts on port 4173 (shared with the e2e suite, hence the lock),
 * builds the scenes through the API and saves one image per shot at a fixed viewport and fixed
 * camera presets. Textures and catalogue models come from their public hosts, so the machine needs
 * network access; a shot taken without it shows the fallback colours instead.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, type Locator, type Page } from '@playwright/test';
import { testAdministrator } from '../tests/helpers/database.js';
import { cubeGlb } from '../tests/helpers/model.js';
import { layoutSchema, newBrace, newWall, venueGeometrySchema, type Layout, type VenueGeometry } from '../src/shared/layout.js';
import { AUDIENCE_FLOOR_ID, newPlatform, newStair } from '../src/shared/levels.js';
import { newPlaceholder } from '../src/shared/placeholders.js';
import { newTruss } from '../src/shared/truss.js';
import { newCurtain } from '../src/shared/curtains.js';
import { newLightingFixture } from '../src/shared/hangPlan.js';
import { newOverheadBox } from '../src/shared/overhead.js';
import { newKeepClearZone } from '../src/shared/keepClear.js';

const BASE_URL = 'http://127.0.0.1:4173';
const VIEWPORT = { width: 1280, height: 800 };
const SETTLE_MS = 2500;
const CACTUS = {
  name: 'Cactus',
  definition: {
    kind: 'model', width: 340, height: 390, depth: 270,
    source: {
      kind: 'catalog', catalogId: 'cactus',
      url: 'https://byrpxoiotywskoojsrzd.supabase.co/storage/v1/object/public/items/system/cactus/model.glb',
      offset: [-0.0039, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
    },
  },
} as const;

const wood = { kind: 'library', ref: 'library:wood-finewood27', scaleMm: 1000, rotationDeg: 0 } as const;

type Shot = { file: string; title: string; note?: string };
const shots: Shot[] = [];
const problems: string[] = [];

async function healthy() {
  try { return (await fetch(`${BASE_URL}/api/health`)).ok; } catch { return false; }
}

async function startServer(): Promise<ChildProcess> {
  if (await healthy()) throw new Error(`${BASE_URL} already answers. Another server holds port 4173; run under flock /tmp/stageharbour-e2e.lock.`);
  if (!existsSync('dist/web/index.html')) throw new Error('dist/web is missing; run npm run build first.');
  const server = spawn('node', ['--import', 'tsx', 'tests/helpers/browser-server.ts'], { stdio: ['ignore', 'inherit', 'inherit'] });
  const started = Date.now();
  while (!(await healthy())) {
    if (server.exitCode !== null) throw new Error(`browser server exited with ${server.exitCode}`);
    if (Date.now() - started > 60_000) throw new Error('browser server did not become healthy');
    await new Promise(done => setTimeout(done, 250));
  }
  return server;
}

async function stopServer(server: ChildProcess) {
  if (server.exitCode !== null) return;
  const exited = new Promise(done => server.once('exit', done));
  server.kill('SIGTERM');
  await Promise.race([exited, new Promise(done => setTimeout(done, 10_000))]);
  if (server.exitCode === null) server.kill('SIGKILL');
}

async function signIn(page: Page) {
  await page.goto(`${BASE_URL}/`);
  await page.getByLabel('E-Mail-Adresse').fill(testAdministrator.email);
  await page.getByLabel('Passwort', { exact: true }).fill(testAdministrator.password);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await page.getByRole('heading', { name: 'Beispiel-Theatergruppe' }).waitFor({ timeout: 30_000 });
}

/** Runs a same-origin JSON request in the signed-in page. */
async function api<T>(page: Page, method: string, path: string, body?: unknown): Promise<T> {
  const result = await page.evaluate(async ({ method, path, body }) => {
    const me = await (await fetch('/api/me')).json() as { workspace: { id: string } };
    const response = await fetch(`/api/workspaces/${me.workspace.id}${path}`, {
      method, credentials: 'same-origin',
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    return { status: response.status, text: await response.text() };
  }, { method, path, body });
  if (result.status >= 300) throw new Error(`${method} ${path} failed: ${result.status} ${result.text.slice(0, 600)}`);
  return (result.text ? JSON.parse(result.text) : undefined) as T;
}

async function uploadModel(page: Page, bytes: Buffer) {
  const result = await page.evaluate(async base64 => {
    const me = await (await fetch('/api/me')).json() as { workspace: { id: string } };
    const body = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const response = await fetch(`/api/workspaces/${me.workspace.id}/assets/files`, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'model/gltf-binary' }, body,
    });
    return { status: response.status, text: await response.text() };
  }, bytes.toString('base64'));
  if (result.status !== 201) throw new Error(`model upload failed: ${result.status} ${result.text}`);
  return (JSON.parse(result.text) as { fileId: string }).fileId;
}

async function createAssets(page: Page) {
  await api(page, 'POST', '/inventory/lease');
  try {
    const cactus = await api<{ id: string }>(page, 'POST', '/assets', CACTUS);
    const fileId = await uploadModel(page, cubeGlb());
    const cube = await api<{ id: string }>(page, 'POST', '/assets', {
      name: 'Würfel', definition: { kind: 'model', width: 700, height: 700, depth: 700, source: { kind: 'upload', fileId } },
    });
    const type = { id: randomUUID(), name: 'Bestandstür', width: 1200, height: 2400, thickness: 28, openings: [{ id: randomUUID(), left: 200, sill: 0, width: 800, height: 2000, hinge: 'left' }] };
    const panel = await api<{ id: string }>(page, 'POST', '/inventory/panels', { label: 'P-01', type });
    await api(page, 'PATCH', `/inventory/panels/${panel.id}`, {
      finish: {
        description: 'Holz unten, weiß oben',
        surfaces: { front: { splitMm: 1200, lower: { ...wood, rotationDeg: 90 }, upper: { kind: 'paint', ral: '9010' } }, back: { full: { kind: 'paint', ral: '5010' } } },
      },
    });
    return { cactus: cactus.id, cube: cube.id };
  } finally {
    await api(page, 'POST', '/inventory/lease/release');
  }
}

/** Creates a production through the UI, then replaces venue and layout through the API. */
async function createScene(
  page: Page,
  names: { production: string; venue: string; scene: string },
  size: { width: number; depth: number },
  build: (venue: VenueGeometry) => { venue?: VenueGeometry; layout: Layout },
) {
  await page.goto(`${BASE_URL}/#/produktionen`);
  await page.getByRole('button', { name: 'Neue Produktion' }).click();
  await page.getByRole('textbox', { name: 'Produktion' }).fill(names.production);
  const venueSelect = page.getByLabel('Vorhandene Spielstätte');
  if (await venueSelect.count()) await venueSelect.selectOption({ value: '' });
  await page.getByRole('textbox', { name: 'Spielstätte' }).fill(names.venue);
  await page.getByRole('spinbutton', { name: 'Spielstättenbreite (mm)' }).fill(String(size.width));
  await page.getByRole('spinbutton', { name: 'Spielstättentiefe (mm)' }).fill(String(size.depth));
  await page.getByRole('textbox', { name: 'Bühnenbild' }).fill(names.scene);
  await page.getByRole('button', { name: 'Produktion anlegen' }).click();
  await page.getByRole('heading', { name: names.scene }).waitFor({ timeout: 30_000 });
  await page.waitForURL(/#\/szenen\//);
  const sceneId = decodeURIComponent(new URL(page.url()).hash.replace('#/szenen/', ''));
  const base = `/scenes/${sceneId}`;
  const scene = await api<{ revision: number; venue: VenueGeometry }>(page, 'GET', base);
  const built = build(scene.venue);
  await api(page, 'POST', `${base}/lease`);
  try {
    let revision = scene.revision;
    if (built.venue) {
      const saved = await api<{ revision: number }>(page, 'PUT', `${base}/venue`, { venue: venueGeometrySchema.encode(venueGeometrySchema.parse(built.venue)) });
      revision = saved.revision;
    }
    await api(page, 'PUT', `${base}/layout`, { revision, layout: layoutSchema.parse(built.layout) });
  } finally {
    await api(page, 'POST', `${base}/lease/release`);
  }
  return { sceneId, name: names.scene };
}

function emptyLayout(): Layout {
  return layoutSchema.parse({ schemaVersion: 1, walls: [], braces: [] });
}

/** Walls only, seen face-on: paint, library finishes at several tile sizes and grain directions, bands, door, arch. */
function wallLayout(): Layout {
  const door = { id: randomUUID(), name: 'Türelement', width: 1200, height: 2400, thickness: 28, openings: [{ id: randomUUID(), left: 200, sill: 0, width: 800, height: 2000, hinge: 'left' as const }] };
  const arch = { id: randomUUID(), name: 'Bogenelement', width: 1200, height: 2400, thickness: 28, openings: [{ id: randomUUID(), left: 200, sill: 0, width: 800, height: 2000, profile: 'arch' as const }] };
  const at = (index: number) => 1000 + index * 1400;
  return {
    ...emptyLayout(),
    wallTypes: [door, arch],
    walls: [
      { ...newWall(randomUUID(), at(0), 3000), label: 'Sperrholz' },
      { ...newWall(randomUUID(), at(1), 3000), label: 'RAL', surfaces: { front: { full: { kind: 'paint', ral: '3020' } }, back: { full: { kind: 'paint', ral: '5010' } } } },
      { ...newWall(randomUUID(), at(2), 3000), label: 'Holz', surfaces: { front: { full: wood }, back: { full: wood }, edge: wood } },
      { ...newWall(randomUUID(), at(3), 3000), label: 'Holz quer 500', surfaces: { front: { full: { ...wood, scaleMm: 500, rotationDeg: 90 } } } },
      { ...newWall(randomUUID(), at(4), 3000), label: 'Streifen', surfaces: { front: { splitMm: 1200, lower: { ...wood, rotationDeg: 90 }, upper: { kind: 'paint', ral: '9010' } } } },
      { ...newWall(randomUUID(), at(5), 3000), label: 'Ziegel', surfaces: { front: { full: { kind: 'library', ref: 'library:flooring-weatheredbrick', scaleMm: 1000, rotationDeg: 0 } } } },
      { ...newWall(randomUUID(), at(6), 3000), label: 'Tür', typeId: door.id, doorOpenPercent: 60 },
      { ...newWall(randomUUID(), at(7), 3000), label: 'Bogen', typeId: arch.id, surfaces: { front: { full: { kind: 'paint', ral: '1003' } } } },
    ],
    braces: [
      { ...newBrace(randomUUID(), at(0), 3300), ballast: { mode: 'heavy' } },
      { ...newBrace(randomUUID(), at(4), 3300), ballast: { mode: 'single', side: 'left' } },
    ],
  };
}

function rectangle(x: number, y: number, width: number, depth: number) {
  return [{ x, y }, { x: x + width, y }, { x: x + width, y: y + depth }, { x, y: y + depth }];
}

/** Platforms of each build style with stairs, standard placeholders, a catalogue model and an uploaded model. */
function platformLayout(assets: { cactus: string; cube: string }): Layout {
  const floating = { ...newPlatform(randomUUID(), 0, 0), label: 'Schwebend', outline: rectangle(600, 3000, 2400, 1800), elevation: 400, style: 'floating' as const };
  const solid = { ...newPlatform(randomUUID(), 0, 0), label: 'Massiv', outline: rectangle(3400, 3000, 2400, 1800), elevation: 600, style: 'solid' as const, surfaces: { top: wood, sides: { kind: 'paint' as const, ral: '7016' } } };
  const deck = { ...newPlatform(randomUUID(), 0, 0), label: 'Bühnenelement', outline: rectangle(6200, 3000, 3000, 2000), elevation: 800, style: 'stageDeck' as const };
  const corner = { ...newPlatform(randomUUID(), 0, 0), label: 'Winkel', outline: [{ x: 600, y: 5400 }, { x: 3000, y: 5400 }, { x: 3000, y: 6200 }, { x: 1600, y: 6200 }, { x: 1600, y: 7200 }, { x: 600, y: 7200 }], elevation: 300 };
  return {
    ...emptyLayout(),
    platforms: [floating, solid, deck, corner],
    stairs: [{ ...newStair(randomUUID(), AUDIENCE_FLOOR_ID, deck.id, 7700, 2000), rotation: 0 }],
    placeholders: [
      newPlaceholder('table', randomUUID(), 1500, 1500),
      { ...newPlaceholder('chair', randomUUID(), 2600, 1500), seatedFigure: true },
      newPlaceholder('chair', randomUUID(), 3300, 1500),
      newPlaceholder('person', randomUUID(), 4200, 1500),
      newPlaceholder('speaker', randomUUID(), 5100, 1500),
      newPlaceholder('box', randomUUID(), 6000, 1500),
      { ...newPlaceholder('box', randomUUID(), 4600, 3900), label: 'Kiste auf Podest', supportingSurfaceId: solid.id },
      { ...newPlaceholder('box', randomUUID(), 5200, 6300), label: 'Cactus', width: 1020, height: 1170, depth: 810, assetId: assets.cactus },
      { ...newPlaceholder('box', randomUUID(), 7000, 6300), label: 'Würfel', width: 700, height: 700, depth: 700, assetId: assets.cube },
    ],
  };
}

/** A furnished venue: trusses with hung fixtures and a light look, curtains, overhead box, permanent wall with door, chairs. */
function theatreScene(base: VenueGeometry): { venue: VenueGeometry; layout: Layout } {
  const hang = (offsetMm: number) => ({ id: randomUUID(), offsetMm });
  const front = { ...newTruss(randomUUID(), 6000, 2600, { length: 8000, bottomHeight: 4500 }), label: 'Fronttraverse', hangPoints: [hang(-3000), hang(-1000), hang(1000), hang(3000)] };
  const back = { ...newTruss(randomUUID(), 6000, 6800, { length: 8000, bottomHeight: 4500 }), label: 'Rücktraverse', hangPoints: [hang(-2000), hang(2000)] };
  const fixtures = [
    newLightingFixture(randomUUID(), front.id, front.hangPoints[0]!.id, 'fresnel', { label: 'F1' }),
    newLightingFixture(randomUUID(), front.id, front.hangPoints[1]!.id, 'flood', { label: 'F2' }),
    newLightingFixture(randomUUID(), front.id, front.hangPoints[2]!.id, 'wash', { label: 'F3' }),
    newLightingFixture(randomUUID(), front.id, front.hangPoints[3]!.id, 'fresnel', { label: 'F4' }),
    newLightingFixture(randomUUID(), back.id, back.hangPoints[0]!.id, 'fresnel', { label: 'G1' }),
    newLightingFixture(randomUUID(), back.id, back.hangPoints[1]!.id, 'fresnel', { label: 'G2' }),
  ];
  const doorWall = {
    ...newWall(randomUUID(), 11500, 5000), label: 'Seitenwand', rotation: 90, width: 5000, height: 3200, thickness: 200,
    openings: [{ id: randomUUID(), left: 1500, sill: 0, width: 900, height: 2100, hinge: 'right' as const }], doorOpenPercent: 70,
    surfaces: { front: { full: { kind: 'paint' as const, ral: '7035' } }, back: { full: { kind: 'paint' as const, ral: '7035' } } },
  };
  const chairs = [0, 1].flatMap(row => Array.from({ length: 8 }, (_, column) => ({
    ...newPlaceholder('chair', randomUUID(), 2500 + column * 1000, 700 + row * 900),
    rotation: 180, ...(column % 3 === 0 ? { seatedFigure: true } : {}),
  })));
  const venue: VenueGeometry = {
    ...base,
    ceilingHeight: 6000,
    floorFinish: 'library:wood-woodplank19',
    walls: [doorWall],
    trusses: [front, back],
    hangPlan: { fixtures },
    curtains: [
      { ...newCurtain(randomUUID(), 6000, 8600, { length: 10000, height: 5000, openPercent: 35 }), label: 'Hauptvorhang' },
      { ...newCurtain(randomUUID(), 700, 5600, { length: 3000, height: 5000, rotation: 90, opening: 'stackLeft' }), label: 'Gasse' },
    ],
    overheadBoxes: [{ ...newOverheadBox(randomUUID(), 9500, 1500), label: 'Lüftungskanal' }],
    keepClearZones: [newKeepClearZone(randomUUID(), AUDIENCE_FLOOR_ID, 10500, 1200)],
    connectionPoints: [{ id: randomUUID(), kind: 'power', label: 'Strom links', x: 400, y: 3000 }],
    cableRoutingCorridors: [{ id: randomUUID(), label: 'Kabelweg', path: [{ x: 400, y: 3000 }, { x: 400, y: 7800 }, { x: 5000, y: 7800 }] }],
    placeholders: chairs,
  };
  const deck = { ...newPlatform(randomUUID(), 0, 0), label: 'Spielpodest', outline: rectangle(4000, 4200, 4000, 2000), elevation: 600, style: 'stageDeck' as const };
  const look = {
    id: randomUUID(), name: 'Warm und kalt',
    fixtures: Object.fromEntries(fixtures.map((fixture, index) => [fixture.id, {
      intensity: index === 2 ? 60 : 100,
      color: ['#ffd19a', '#ffe0b3', '#c1d8ff', '#ffd19a', '#957bff', '#6e8cff'][index]!,
    }])),
  };
  const layout: Layout = {
    ...emptyLayout(),
    walls: [
      { ...newWall(randomUUID(), 4400, 6600), label: 'Holzwand', width: 2400, surfaces: { front: { full: wood } } },
      { ...newWall(randomUUID(), 7200, 6600), label: 'Rote Wand', width: 2400, surfaces: { front: { full: { kind: 'paint', ral: '3020' } } } },
    ],
    braces: [newBrace(randomUUID(), 4400, 6900), newBrace(randomUUID(), 7200, 6900)],
    platforms: [deck],
    stairs: [newStair(randomUUID(), AUDIENCE_FLOOR_ID, deck.id, 6000, 3200)],
    placeholders: [
      { ...newPlaceholder('table', randomUUID(), 5200, 5200), supportingSurfaceId: deck.id },
      { ...newPlaceholder('person', randomUUID(), 6800, 5200), supportingSurfaceId: deck.id },
      newPlaceholder('speaker', randomUUID(), 2600, 4200),
      newPlaceholder('speaker', randomUUID(), 9400, 4200),
    ],
    lightLooks: [look],
    activeLightLookId: look.id,
  };
  return { venue, layout };
}

const stage = (page: Page) => page.locator('[data-testid="stage-view"]');

async function openScene(page: Page, scene: { sceneId: string; name: string }) {
  await page.goto(`${BASE_URL}/#/produktionen`);
  await page.goto(`${BASE_URL}/#/szenen/${encodeURIComponent(scene.sceneId)}`);
  await page.reload();
  await page.getByRole('heading', { name: scene.name }).waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Raumansicht', exact: true }).click();
  await stage(page).locator('canvas').first().waitFor({ timeout: 60_000 });
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(SETTLE_MS);
}

async function shoot(page: Page, out: string, file: string, title: string, target: Locator = stage(page), note?: string) {
  await settle(page);
  const errors = await page.locator('.model-error').count();
  if (errors) problems.push(`${file}: ${errors} model placeholder(s) shown`);
  await target.screenshot({ path: join(out, file), animations: 'disabled' });
  shots.push({ file, title, ...(note ? { note } : {}) });
  console.log(`saved ${file}`);
}

async function view(page: Page, label: 'Umlaufansicht' | 'Publikumssicht' | 'Von oben' | 'Von vorne' | 'Von der Seite') {
  await stage(page).getByRole('button', { name: label, exact: true }).click();
}

async function theme(page: Page, id: 'studio' | 'paper' | 'sunset') {
  await page.getByRole('button', { name: 'Anzeige', exact: true }).click();
  await page.getByLabel('Umgebung').selectOption(id);
  await page.getByRole('button', { name: 'Anzeige', exact: true }).click();
}

/** Returns false when the control no longer exists, so the script keeps working if the setting is removed. */
async function highQuality(page: Page, on: boolean) {
  await page.getByRole('button', { name: 'Anzeige', exact: true }).click();
  const box = page.getByLabel('Hohe Renderqualität');
  const present = await box.count() > 0 && await box.isEnabled();
  if (present) await box.setChecked(on);
  await page.getByRole('button', { name: 'Anzeige', exact: true }).click();
  return present;
}

async function attempt(name: string, action: () => Promise<void>) {
  try { await action(); } catch (error) {
    problems.push(`${name}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    console.error(`skipped ${name}:`, error);
  }
}

async function main() {
  const { values } = parseArgs({ options: { out: { type: 'string' }, headed: { type: 'boolean', default: false } } });
  if (!values.out) throw new Error('usage: capture-raumsicht.ts --out <directory>');
  const out = resolve(values.out);
  await mkdir(out, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({ headless: !values.headed });
  try {
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on('pageerror', error => consoleErrors.push(error.message));
    await signIn(page);
    const assets = await createAssets(page);
    const walls = await createScene(page, { production: 'Wandprobe', venue: 'Wandsaal', scene: 'Wände' }, { width: 12000, depth: 6000 }, () => ({ layout: wallLayout() }));
    const platforms = await createScene(page, { production: 'Podestprobe', venue: 'Podestsaal', scene: 'Podeste' }, { width: 10000, depth: 8000 }, () => ({ layout: platformLayout(assets) }));
    const theatre = await createScene(page, { production: 'Theaterprobe', venue: 'Großer Saal', scene: 'Erster Akt' }, { width: 12000, depth: 9000 }, theatreScene);

    await attempt('walls', async () => {
      await openScene(page, walls);
      await shoot(page, out, '01-walls-orbit-studio.png', 'Wände: Sperrholz, RAL, Holz, Holz quer 500 mm, Streifen, Ziegel, Tür offen, Bogen · Umlaufansicht · Studio');
      await view(page, 'Von vorne');
      await shoot(page, out, '02-walls-front.png', 'Dieselben Wände von vorne (Parallelprojektion): Kachelmaß und Faserrichtung');
      await view(page, 'Von oben');
      await shoot(page, out, '03-walls-top.png', 'Dieselben Wände von oben');
      await view(page, 'Umlaufansicht');
      await theme(page, 'paper');
      await shoot(page, out, '04-walls-orbit-paper.png', 'Wände · Umgebung Warm');
      await theme(page, 'sunset');
      await shoot(page, out, '05-walls-orbit-sunset.png', 'Wände · Umgebung Abend');
      await theme(page, 'studio');
      if (await highQuality(page, true)) {
        await shoot(page, out, '06-walls-orbit-high-quality.png', 'Wände · Hohe Renderqualität an');
        await highQuality(page, false);
      }
      await stage(page).locator('.renderer-toggle').click();
      await shoot(page, out, '07-walls-orbit-simple.png', 'Wände · Einfache Darstellung');
      await stage(page).locator('.renderer-toggle').click();
    });

    await attempt('wall selection', async () => {
      await openScene(page, walls);
      await view(page, 'Von vorne');
      await settle(page);
      const canvas = stage(page).locator('canvas').first();
      const box = (await canvas.boundingBox())!;
      // Wall 3 of 8 ("Holz") sits left of the centre in the front view.
      await page.mouse.click(box.x + box.width * 0.5 - box.width * 0.07, box.y + box.height * 0.5);
      await view(page, 'Umlaufansicht');
      await shoot(page, out, '08-walls-orbit-selected.png', 'Wand „Holz“ durch Klick in der Raumsicht ausgewählt (Auswahlrahmen)');
      const fit = page.getByRole('button', { name: 'Auswahl einpassen', exact: true });
      if (await fit.isEnabled()) {
        await fit.click();
        await shoot(page, out, '08b-wall-selected-close.png', 'Auswahl eingepasst: Holzwand aus der Nähe');
      } else problems.push('wall selection: clicking the canvas did not select a wall');
    });

    await attempt('platforms', async () => {
      await openScene(page, platforms);
      await shoot(page, out, '09-platforms-orbit.png', 'Podeste schwebend, massiv (Holz/RAL), Bühnenelement, Winkel; Treppe; Platzhalter; Katalogmodell Cactus; hochgeladener Würfel');
      await view(page, 'Von oben');
      await shoot(page, out, '10-platforms-top.png', 'Podeste und Platzhalter von oben');
      await view(page, 'Von der Seite');
      await shoot(page, out, '11-platforms-side.png', 'Podeste und Platzhalter von der Seite');
    });

    await attempt('theatre', async () => {
      await openScene(page, theatre);
      await shoot(page, out, '12-theatre-orbit.png', 'Spielstätte mit Traversen, Scheinwerfern, Vorhängen, Lüftungskanal, Seitenwand mit Tür, Bestuhlung, Holzboden · Konstruktionslicht');
      await view(page, 'Publikumssicht');
      await shoot(page, out, '13-theatre-audience.png', 'Publikumssicht · Konstruktionslicht');
      await view(page, 'Umlaufansicht');
      await stage(page).getByRole('button', { name: 'Lichtpult', exact: true }).click();
      await page.getByTestId('light-board').waitFor({ timeout: 15_000 });
      await shoot(page, out, '14-theatre-orbit-lit.png', 'Lichtpult offen: Scheinwerfer mit Look „Warm und kalt“, Schatten');
      await view(page, 'Publikumssicht');
      await shoot(page, out, '15-theatre-audience-lit.png', 'Publikumssicht mit Scheinwerferlicht');
      await view(page, 'Von oben');
      await shoot(page, out, '16-theatre-top-lit.png', 'Von oben mit Scheinwerferlicht');
    });

    await attempt('venue editor', async () => {
      await openScene(page, theatre);
      const file = page.locator('.editor-menubar > details').filter({ has: page.locator('summary', { hasText: /^Datei$/ }) });
      if (await file.count() && await file.getAttribute('open') === null) await file.locator('summary').click();
      await page.getByRole('button', { name: 'Spielstätte bearbeiten', exact: true }).click();
      await page.getByRole('img', { name: 'Umriss der Spielstätte', exact: true }).waitFor({ timeout: 30_000 });
      await page.getByRole('button', { name: 'Raumansicht', exact: true }).click();
      await stage(page).locator('canvas').first().waitFor({ timeout: 60_000 });
      await shoot(page, out, '17-venue-editor-orbit.png', 'Spielstätten-Editor · Raumansicht');
      await page.getByRole('button', { name: '2D + 3D', exact: true }).click();
      await shoot(page, out, '18-venue-editor-split.png', 'Spielstätten-Editor · 2D + 3D', page.locator('.venue-editor-views'));
    });

    await attempt('library panels', async () => {
      await openScene(page, walls);
      await page.getByRole('button', { name: 'Bibliothek', exact: true }).click();
      const library = page.getByRole('region', { name: 'Objektbibliothek' });
      await library.waitFor({ timeout: 15_000 });
      await library.getByRole('button', { name: /Katalog$/ }).click();
      await library.getByLabel(/Katalog durchsuchen$/).fill('sofa');
      await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('.asset-grid img')].slice(0, 4).every(image => image.complete), undefined, { timeout: 30_000 }).catch(() => {});
      await shoot(page, out, '19-model-catalogue.png', 'Bibliothek · Modellkatalog mit Vorschaubildern (Suche „sofa“)', library.locator('.asset-grid'));
      await library.getByRole('button', { name: 'Plattenbestand', exact: true }).click();
      const faces = library.locator('.panel-faces').first();
      await faces.waitFor({ timeout: 15_000 });
      await shoot(page, out, '20-wall-type-preview.png', 'Bibliothek · Plattenbestand: Wandtyp-Vorschau mit Oberflächen (Holz unten quer, RAL 9010 oben)', faces);
    });

    await attempt('surface editor', async () => {
      await openScene(page, walls);
      await view(page, 'Von vorne');
      await settle(page);
      const canvas = stage(page).locator('canvas').first();
      const box = (await canvas.boundingBox())!;
      await page.mouse.click(box.x + box.width * 0.5 + box.width * 0.045, box.y + box.height * 0.5);
      const properties = page.getByRole('button', { name: 'Eigenschaften', exact: true });
      if (await properties.getAttribute('aria-expanded') !== 'true') await properties.click();
      const editor = page.getByTestId('surface-editor');
      await editor.waitFor({ timeout: 15_000 });
      await editor.scrollIntoViewIfNeeded();
      await shoot(page, out, '21-surface-editor.png', 'Eigenschaften · Oberflächen der Streifenwand (Materialauswahl)', page.locator('.dock-pane:visible'));
    });

    if (consoleErrors.length) problems.push(...consoleErrors.map(message => `page error: ${message}`));
    await writeFile(join(out, 'index.json'), `${JSON.stringify({ viewport: VIEWPORT, capturedAt: new Date().toISOString(), chromium: browser.version(), shots, problems }, null, 2)}\n`);
    if (problems.length) console.warn(`problems:\n${problems.join('\n')}`);
  } finally {
    await browser.close();
    await stopServer(server);
  }
}

await main();
