/**
 * Repeatable stage-canvas measurements for before/after comparison on one machine.
 *
 *   flock /tmp/stageharbour-e2e.lock node --import tsx scripts/measure-stage.ts measure --out docs/measurements/x.json [--label name]
 *     [--skip-build] [--runs 5] [--orbit-seconds 6] [--only bundle,attribution,packages,first-frame,orbit]
 *   node --import tsx scripts/measure-stage.ts compare before.json after.json
 *
 * The browser part starts tests/helpers/browser-server.ts on port 4173 (shared with the e2e suite,
 * hence the lock) and instruments WebGL draw calls inside the element marked
 * data-testid="stage-view", so it measures whichever renderer the Raumsicht uses.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { testAdministrator } from '../tests/helpers/database.js';
import { layoutSchema, newBrace, newWall, type Layout } from '../src/shared/layout.js';
import { AUDIENCE_FLOOR_ID, newPlatform, newStair } from '../src/shared/levels.js';
import { newPlaceholder } from '../src/shared/placeholders.js';

const BASE_URL = 'http://127.0.0.1:4173';
const VIEWPORT = { width: 1280, height: 800 };
const ALL_SECTIONS = ['bundle', 'attribution', 'packages', 'first-frame', 'orbit'] as const;
type Section = typeof ALL_SECTIONS[number];

type ChunkSize = { file: string; name: string; kind: 'js' | 'css' | 'other'; bytes: number; gzipBytes: number; initial: boolean };
type BundleResult = {
  chunks: ChunkSize[];
  totals: { files: number; bytes: number; gzipBytes: number; jsBytes: number; jsGzipBytes: number; cssBytes: number; cssGzipBytes: number };
  initial: { files: string[]; bytes: number; gzipBytes: number };
};
type PackageShare = { name: string; bytes: number; share: number };
type AttributionResult = {
  method: string;
  jsBytes: number;
  pascal: { bytes: number; share: number; estimatedGzipBytes: number; packages: PackageShare[] };
  three: { bytes: number; share: number; files: PackageShare[] };
  app: { bytes: number; share: number };
  topPackages: PackageShare[];
  chunks: { file: string; bytes: number; pascalShare: number; topSources: PackageShare[] }[];
};
type PackagesResult = {
  npmLsAll: number | null;
  npmLsProduction: number | null;
  lockfile: { entries: number; production: number; dev: number; optional: number; installed: number };
  pascalOnly: { all: number; production: number; installed: number; names: string[]; paths: string[] };
};
type FirstFrameRun = { firstDrawMs: number; settledMs: number; steadyDrawCalls: number; chunkFiles: string[]; chunkTransferBytes: number; chunkDecodedBytes: number };
type FirstFrameResult = { scene: string; objects: number; runs: FirstFrameRun[]; medianFirstDrawMs: number; medianSettledMs: number };
type OrbitResult = {
  scene: string; objects: Record<string, number>;
  firstDrawMs: number; settledMs: number;
  seconds: number; frames: number;
  frameTimeMs: { median: number; p95: number; mean: number; max: number };
  drawCallsPerFrame: { median: number; max: number };
};
type Measurement = {
  label: string; measuredAt: string;
  git: { commit: string; branch: string; dirty: boolean };
  environment: Record<string, string | number | boolean>;
  bundle?: BundleResult; attribution?: AttributionResult; packages?: PackagesResult;
  firstFrame?: FirstFrameResult; orbit?: OrbitResult;
};

function git(args: string[]) {
  return spawnSync('git', args, { encoding: 'utf8' }).stdout.trim();
}

function median(values: number[]) {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function percentile(values: number[], p: number) {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p / 100 * sorted.length) - 1)]!;
}

const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

function run(command: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: { ...process.env, ...env } });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`);
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => entry.isDirectory() ? listFiles(join(dir, entry.name)) : Promise.resolve([join(dir, entry.name)])));
  return nested.flat();
}

const logicalName = (file: string) => file.replace(/^assets\//, '').replace(/-[A-Za-z0-9_-]{8}(\.[a-z0-9]+)$/, '$1');

async function measureBundle(webRoot: string): Promise<BundleResult> {
  const html = await readFile(join(webRoot, 'index.html'), 'utf8');
  const initialFiles = new Set([...html.matchAll(/(?:src|href)="\/?([^"]+\.(?:js|css))"/g)].map(match => match[1]!.replace(/^.*?(assets\/)/, '$1')));
  const files = (await listFiles(join(webRoot, 'assets'))).sort();
  const chunks: ChunkSize[] = [];
  for (const path of files) {
    const content = await readFile(path);
    const file = relative(webRoot, path);
    const kind = file.endsWith('.js') ? 'js' : file.endsWith('.css') ? 'css' : 'other';
    chunks.push({ file, name: logicalName(file), kind, bytes: content.length, gzipBytes: gzipSync(content).length, initial: initialFiles.has(file) });
  }
  chunks.sort((a, b) => b.bytes - a.bytes);
  const sum = (items: ChunkSize[], key: 'bytes' | 'gzipBytes') => items.reduce((total, item) => total + item[key], 0);
  const js = chunks.filter(chunk => chunk.kind === 'js'), css = chunks.filter(chunk => chunk.kind === 'css');
  const initial = chunks.filter(chunk => chunk.initial);
  return {
    chunks,
    totals: {
      files: chunks.length, bytes: sum(chunks, 'bytes'), gzipBytes: sum(chunks, 'gzipBytes'),
      jsBytes: sum(js, 'bytes'), jsGzipBytes: sum(js, 'gzipBytes'), cssBytes: sum(css, 'bytes'), cssGzipBytes: sum(css, 'gzipBytes'),
    },
    initial: { files: initial.map(chunk => chunk.file), bytes: sum(initial, 'bytes'), gzipBytes: sum(initial, 'gzipBytes') },
  };
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_VALUE = new Int16Array(128).fill(-1);
for (let index = 0; index < BASE64.length; index++) BASE64_VALUE[BASE64.charCodeAt(index)] = index;

/** Calls `segment` for every generated segment of a source map v3 `mappings` string. */
function decodeMappings(mappings: string, segment: (line: number, column: number, source: number) => void) {
  let line = 0, column = 0, source = 0, index = 0;
  const fields: number[] = [];
  while (index < mappings.length) {
    const char = mappings.charCodeAt(index);
    if (char === 59) { line++; column = 0; index++; continue; }
    if (char === 44) { index++; continue; }
    fields.length = 0;
    while (index < mappings.length) {
      const next = mappings.charCodeAt(index);
      if (next === 44 || next === 59) break;
      let value = 0, shift = 0, digit: number;
      do {
        digit = BASE64_VALUE[mappings.charCodeAt(index++)]!;
        value += (digit & 31) << shift;
        shift += 5;
      } while (digit & 32);
      fields.push(value & 1 ? -(value >>> 1) : value >>> 1);
    }
    column += fields[0] ?? 0;
    if (fields.length >= 4) {
      source += fields[1]!;
      segment(line, column, source);
    } else segment(line, column, -1);
  }
}

/** The lockfile path of the package a source belongs to, for example node_modules/a/node_modules/b. */
function sourceOwner(source: string) {
  const normalized = source.replaceAll('\\', '/');
  const at = normalized.indexOf('node_modules/');
  if (at !== -1) {
    const parts = normalized.slice(at).split('/');
    const path: string[] = [];
    for (let index = 0; index < parts.length; index++) {
      if (parts[index] !== 'node_modules') continue;
      const scope = parts[index + 1] ?? '';
      const name = scope.startsWith('@') ? `${scope}/${parts[index + 2] ?? ''}` : scope;
      path.push(`node_modules/${name}`);
      index += scope.startsWith('@') ? 2 : 1;
    }
    return path.join('/');
  }
  const app = /(?:^|\/)src\/(client|shared)\//.exec(normalized);
  if (app) return `app:src/${app[1]}`;
  return '(bundler runtime)';
}

function threeFile(source: string) {
  const normalized = source.replaceAll('\\', '/');
  const at = normalized.lastIndexOf('node_modules/three/');
  if (at === -1) return undefined;
  const rest = normalized.slice(at + 'node_modules/three/'.length);
  return rest.startsWith('examples/') ? 'three/examples/jsm' : `three/${rest}`;
}

async function measureAttribution(pascalOnly: Set<string>): Promise<AttributionResult> {
  const outDir = await mkdtemp(join(os.tmpdir(), 'stage-measure-'));
  try {
    run(resolve('node_modules/.bin/vite'), ['build', '--sourcemap', 'hidden', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'warn']);
    const maps = (await listFiles(outDir)).filter(path => path.endsWith('.js.map'));
    const byOwner = new Map<string, number>(), byThreeFile = new Map<string, number>();
    const chunks: AttributionResult['chunks'] = [];
    let total = 0;
    for (const mapPath of maps) {
      const map = JSON.parse(await readFile(mapPath, 'utf8')) as { sources: string[]; mappings: string };
      const code = await readFile(mapPath.slice(0, -'.map'.length), 'utf8');
      const lineLengths = code.split('\n').map(line => line.length);
      const owners = map.sources.map(sourceOwner), threeFiles = map.sources.map(threeFile);
      const segments: [number, number, number][] = [];
      decodeMappings(map.mappings, (line, column, source) => segments.push([line, column, source]));
      const local = new Map<string, number>();
      const add = (owner: string, three: string | undefined, length: number) => {
        if (length <= 0) return;
        local.set(owner, (local.get(owner) ?? 0) + length);
        byOwner.set(owner, (byOwner.get(owner) ?? 0) + length);
        if (three) byThreeFile.set(three, (byThreeFile.get(three) ?? 0) + length);
        total += length;
      };
      for (let index = 0; index < segments.length; index++) {
        const [line, column, source] = segments[index]!;
        const next = segments[index + 1];
        const end = next && next[0] === line ? next[1] : lineLengths[line] ?? column;
        add(source >= 0 ? owners[source]! : '(unmapped)', source >= 0 ? threeFiles[source] : undefined, end - column);
      }
      const chunkBytes = [...local.values()].reduce((a, b) => a + b, 0);
      const pascalBytes = [...local].filter(([owner]) => isPascal(owner, pascalOnly)).reduce((a, [, bytes]) => a + bytes, 0);
      chunks.push({
        file: relative(outDir, mapPath.slice(0, -'.map'.length)),
        bytes: chunkBytes,
        pascalShare: round(chunkBytes ? pascalBytes / chunkBytes : 0, 3),
        topSources: [...local].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, bytes]) => ({ name: ownerLabel(name), bytes, share: round(bytes / chunkBytes, 3) })),
      });
    }
    const shares = (entries: Iterable<[string, number]>) => [...entries].sort((a, b) => b[1] - a[1]).map(([name, bytes]) => ({ name: ownerLabel(name), bytes, share: round(bytes / total, 4) }));
    const pascalPackages = shares([...byOwner].filter(([owner]) => isPascal(owner, pascalOnly)));
    const pascalBytes = pascalPackages.reduce((sum, item) => sum + item.bytes, 0);
    const appBytes = [...byOwner].filter(([owner]) => owner.startsWith('app:')).reduce((sum, [, bytes]) => sum + bytes, 0);
    const threeBytes = byOwner.get('node_modules/three') ?? 0;
    const jsGzip = (await Promise.all(maps.map(async path => gzipSync(await readFile(path.slice(0, -'.map'.length))).length))).reduce((a, b) => a + b, 0);
    chunks.sort((a, b) => b.bytes - a.bytes);
    return {
      method: 'vite build --sourcemap hidden; minified characters per generated source-map segment, grouped by the installed package path of the original source; gzip share estimated proportionally',
      jsBytes: total,
      pascal: { bytes: pascalBytes, share: round(pascalBytes / total, 4), estimatedGzipBytes: Math.round(jsGzip * pascalBytes / total), packages: pascalPackages },
      three: { bytes: threeBytes, share: round(threeBytes / total, 4), files: shares(byThreeFile) },
      app: { bytes: appBytes, share: round(appBytes / total, 4) },
      topPackages: shares(byOwner).slice(0, 25),
      chunks,
    };
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}

function isPascal(owner: string, pascalOnly: Set<string>) {
  return owner.startsWith('node_modules/@pascal-app/') || pascalOnly.has(owner);
}

const ownerLabel = (owner: string) => owner.replace(/^node_modules\//, '').replaceAll('/node_modules/', ' > ');

type LockEntry = {
  name?: string; dev?: boolean; optional?: boolean; link?: boolean; resolved?: string;
  dependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>; peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};

function packageNameOf(path: string, entry: LockEntry) {
  if (entry.name) return entry.name;
  const at = path.lastIndexOf('node_modules/');
  return path.slice(at + 'node_modules/'.length);
}

function lockfileGraph(packages: Record<string, LockEntry>) {
  const resolveDependency = (from: string, name: string) => {
    let base = from;
    for (;;) {
      const candidate = `${base ? `${base}/` : ''}node_modules/${name}`;
      const entry = packages[candidate];
      if (entry) return entry.link && entry.resolved ? entry.resolved : candidate;
      if (!base) return undefined;
      const at = base.lastIndexOf('/node_modules/');
      base = at === -1 ? '' : base.slice(0, at);
    }
  };
  const reach = (roots: string[]) => {
    const seen = new Set<string>();
    const queue = roots.flatMap(name => resolveDependency('', name) ?? []);
    while (queue.length) {
      const path = queue.pop()!;
      if (seen.has(path)) continue;
      seen.add(path);
      const entry = packages[path];
      if (!entry) continue;
      const requiredPeers = Object.keys(entry.peerDependencies ?? {}).filter(name => !entry.peerDependenciesMeta?.[name]?.optional);
      const names = [...Object.keys({ ...entry.dependencies, ...entry.optionalDependencies }), ...requiredPeers];
      for (const name of names) {
        const target = resolveDependency(path, name);
        if (target && !seen.has(target)) queue.push(target);
      }
    }
    return seen;
  };
  return { reach };
}

async function measurePackages(): Promise<PackagesResult> {
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8')) as { packages: Record<string, LockEntry> };
  const entries = Object.entries(lock.packages).filter(([path]) => path !== '');
  const root = lock.packages['']!;
  const roots = Object.keys({ ...root.dependencies, ...root.devDependencies, ...root.optionalDependencies });
  const { reach } = lockfileGraph(lock.packages);
  const all = reach(roots);
  const withoutPascal = reach(roots.filter(name => !name.startsWith('@pascal-app/')));
  const pascalOnly = [...all].filter(path => !withoutPascal.has(path));
  const npmLs = (extra: string[]) => {
    const result = spawnSync('npm', ['ls', '--all', '--parseable', ...extra], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    // A symlinked node_modules makes npm print some paths through the link and some through its
    // target, so paths are compared from their first node_modules segment.
    const paths = new Set(result.stdout.split('\n').filter(line => line.includes('node_modules/')).map(line => line.replace(/^.*?node_modules\//, 'node_modules/')));
    return paths.size || null;
  };
  return {
    npmLsAll: npmLs([]),
    npmLsProduction: npmLs(['--omit=dev']),
    lockfile: {
      entries: entries.length,
      production: entries.filter(([, entry]) => !entry.dev).length,
      dev: entries.filter(([, entry]) => entry.dev).length,
      optional: entries.filter(([, entry]) => entry.optional).length,
      installed: entries.filter(([path]) => existsSync(path)).length,
    },
    pascalOnly: {
      all: pascalOnly.length,
      production: pascalOnly.filter(path => !lock.packages[path]?.dev).length,
      installed: pascalOnly.filter(path => existsSync(path)).length,
      names: [...new Set(pascalOnly.map(path => packageNameOf(path, lock.packages[path]!)))].sort(),
      paths: pascalOnly.sort(),
    },
  };
}

const PROBE_SCRIPT = `(() => {
  const state = { frames: [], firstDraw: null, draws: 0, mark: null };
  window.__stageProbe = state;
  const inside = new WeakSet();
  const counts = canvas => {
    if (inside.has(canvas)) return true;
    if (typeof canvas.closest === 'function' && canvas.closest('[data-testid="stage-view"]')) { inside.add(canvas); return true; }
    return false;
  };
  const wrap = proto => {
    if (!proto) return;
    for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements']) {
      const original = proto[name];
      if (typeof original !== 'function') continue;
      proto[name] = function (...args) {
        if (counts(this.canvas)) {
          state.draws++;
          if (state.firstDraw === null) state.firstDraw = performance.now();
        }
        return original.apply(this, args);
      };
    }
  };
  wrap(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
  wrap(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
  const tick = now => {
    if (state.draws > 0) { state.frames.push([now, state.draws]); state.draws = 0; }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();`;

type ProbeState = { frames: [number, number][]; firstDraw: number | null; mark: number | null };
declare global { interface Window { __stageProbe: ProbeState } }

async function startServer(): Promise<ChildProcess> {
  if (await healthy()) throw new Error(`${BASE_URL} already answers. Another server holds port 4173; run under flock /tmp/stageharbour-e2e.lock.`);
  if (!existsSync('dist/web/index.html')) throw new Error('dist/web is missing; run npm run build first or omit --skip-build.');
  const server = spawn('node', ['--import', 'tsx', 'tests/helpers/browser-server.ts'], { stdio: ['ignore', 'inherit', 'inherit'] });
  const started = Date.now();
  while (!(await healthy())) {
    if (server.exitCode !== null) throw new Error(`browser server exited with ${server.exitCode}`);
    if (Date.now() - started > 60_000) throw new Error('browser server did not become healthy');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return server;
}

async function healthy() {
  try { return (await fetch(`${BASE_URL}/api/health`)).ok; } catch { return false; }
}

async function stopServer(server: ChildProcess) {
  if (server.exitCode !== null) return;
  const exited = new Promise(resolve => server.once('exit', resolve));
  server.kill('SIGTERM');
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 10_000))]);
  if (server.exitCode === null) server.kill('SIGKILL');
}

async function signIn(page: Page) {
  await page.goto(`${BASE_URL}/`);
  await page.getByLabel('E-Mail-Adresse').fill(testAdministrator.email);
  await page.getByLabel('Passwort', { exact: true }).fill(testAdministrator.password);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await page.getByRole('heading', { name: 'Beispiel-Theatergruppe' }).waitFor({ timeout: 30_000 });
}

/** Creates a production through the UI and replaces its Bühnenbild layout through the API. */
async function createScene(page: Page, names: { production: string; venue: string; scene: string }, size: { width: number; depth: number }, layout: Layout) {
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
  const parsed = layoutSchema.parse(layout);
  const status = await page.evaluate(async ({ sceneId, layout }) => {
    const me = await (await fetch('/api/me')).json() as { workspace: { id: string } };
    const base = `/api/workspaces/${me.workspace.id}/scenes/${sceneId}`;
    const scene = await (await fetch(base)).json() as { revision: number };
    await fetch(`${base}/lease`, { method: 'POST' });
    const saved = await fetch(`${base}/layout`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ revision: scene.revision, layout }) });
    const result = { status: saved.status, body: await saved.text() };
    await fetch(`${base}/lease/release`, { method: 'POST' });
    return result;
  }, { sceneId, layout: parsed });
  if (status.status !== 200) throw new Error(`saving the measurement layout failed: ${status.status} ${status.body}`);
  return sceneId;
}

function emptyLayout(): Layout {
  return layoutSchema.parse({ walls: [], braces: [] });
}

function smallLayout(): Layout {
  const platform = { ...newPlatform(randomUUID(), 2500, 4000), style: 'stageDeck' as const };
  return {
    ...emptyLayout(),
    walls: [newWall(randomUUID(), 4000, 3000), { ...newWall(randomUUID(), 5300, 3000) }],
    braces: [newBrace(randomUUID(), 4000, 3300)],
    placeholders: [{ ...newPlaceholder('table', randomUUID(), 1000, 1000) }],
    platforms: [platform],
    stairs: [newStair(randomUUID(), AUDIENCE_FLOOR_ID, platform.id, 5200, 4500)],
  };
}

function denseLayout() {
  const platforms = Array.from({ length: 40 }, (_, index) => {
    const column = index % 8, row = Math.floor(index / 8);
    const x = 2000 + column * 2100, y = 1000 + row * 1100;
    return {
      id: randomUUID(), label: `Bühnenelement ${index + 1}`, elevation: 400, style: 'stageDeck' as const,
      outline: [{ x: x - 1000, y: y - 500 }, { x: x + 1000, y: y - 500 }, { x: x + 1000, y: y + 500 }, { x: x - 1000, y: y + 500 }],
    };
  });
  const placeholders = Array.from({ length: 250 }, (_, index) => newPlaceholder('chair', randomUUID(), 2500 + (index % 25) * 550, 8000 + Math.floor(index / 25) * 700));
  const walls = Array.from({ length: 10 }, (_, index) => newWall(randomUUID(), 2000 + index * 1300, 6800));
  const layout: Layout = { ...emptyLayout(), walls, platforms, placeholders };
  return { layout, objects: { chairs: placeholders.length, stageDeckPlatforms: platforms.length, walls: walls.length } };
}

async function openScene(context: BrowserContext, sceneId: string, sceneName: string) {
  const page = await context.newPage();
  await page.addInitScript(PROBE_SCRIPT);
  await page.goto(`${BASE_URL}/#/szenen/${encodeURIComponent(sceneId)}`);
  await page.getByRole('heading', { name: sceneName }).waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Raumansicht', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Grundriss', exact: true }).click();
  await page.locator('[data-testid="stage-view"]').waitFor({ state: 'detached' });
  return page;
}

/** Clicks Raumansicht and waits until the draw-call count per frame has stopped growing. */
async function openStageAndSettle(page: Page): Promise<FirstFrameRun> {
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === 'Raumansicht');
    if (!button) throw new Error('Raumansicht button missing');
    window.__stageProbe.frames.length = 0;
    window.__stageProbe.firstDraw = null;
    window.__stageProbe.mark = performance.now();
    button.click();
  });
  await page.waitForFunction(() => window.__stageProbe.firstDraw !== null, undefined, { timeout: 120_000, polling: 50 });
  let previous = -1, stableSince = Date.now();
  const started = Date.now();
  for (;;) {
    await page.waitForTimeout(500);
    const max = await page.evaluate(() => Math.max(0, ...window.__stageProbe.frames.map(frame => frame[1])));
    if (max !== previous) { previous = max; stableSince = Date.now(); }
    if (Date.now() - stableSince >= 3000 || Date.now() - started > 90_000) break;
  }
  return page.evaluate(() => {
    const probe = window.__stageProbe, mark = probe.mark!;
    const steady = Math.max(...probe.frames.map(frame => frame[1]));
    const settledFrame = probe.frames.find(frame => frame[1] >= steady * 0.9);
    const chunks = (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
      .filter(entry => entry.startTime >= mark && /\/assets\/.+\.js$/.test(new URL(entry.name).pathname));
    return {
      firstDrawMs: probe.firstDraw! - mark,
      settledMs: (settledFrame?.[0] ?? probe.firstDraw!) - mark,
      steadyDrawCalls: steady,
      chunkFiles: chunks.map(entry => new URL(entry.name).pathname.replace(/^\/assets\//, '')),
      chunkTransferBytes: chunks.reduce((sum, entry) => sum + entry.encodedBodySize, 0),
      chunkDecodedBytes: chunks.reduce((sum, entry) => sum + entry.decodedBodySize, 0),
    };
  });
}

async function orbit(page: Page, seconds: number) {
  const canvas = page.locator('[data-testid="stage-view"] canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('stage canvas has no box');
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2, radius = Math.min(box.width, box.height) * 0.3;
  await page.mouse.move(cx + radius, cy);
  await page.mouse.down({ button: 'middle' });
  const start = await page.evaluate(() => { window.__stageProbe.frames.length = 0; return performance.now(); });
  const until = Date.now() + seconds * 1000;
  let angle = 0;
  while (Date.now() < until) {
    angle += 0.08;
    await page.mouse.move(cx + radius * Math.cos(angle), cy + radius * 0.35 * Math.sin(angle));
    await page.waitForTimeout(16);
  }
  const end = await page.evaluate(() => performance.now());
  await page.mouse.up({ button: 'middle' });
  const frames = await page.evaluate(({ start, end }) => window.__stageProbe.frames.filter(frame => frame[0] >= start && frame[0] <= end), { start, end });
  const deltas = frames.slice(1).map((frame, index) => frame[0] - frames[index]![0]);
  const draws = frames.map(frame => frame[1]);
  return {
    seconds: round((end - start) / 1000, 2), frames: frames.length,
    frameTimeMs: {
      median: round(median(deltas)), p95: round(percentile(deltas, 95)),
      mean: round(deltas.reduce((a, b) => a + b, 0) / Math.max(1, deltas.length)), max: round(Math.max(...deltas)),
    },
    drawCallsPerFrame: { median: median(draws), max: Math.max(...draws) },
  };
}

async function webglInfo(page: Page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return { webgl2: false, renderer: 'none', vendor: 'none' };
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const result = {
      webgl2: true,
      renderer: String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
      vendor: String(info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)),
    };
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return result;
  });
}

async function measureBrowser(sections: Set<Section>, runs: number, orbitSeconds: number, environment: Measurement['environment']) {
  const server = await startServer();
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch();
    environment.chromium = browser.version();
    environment.headless = true;
    environment.viewport = `${VIEWPORT.width}x${VIEWPORT.height} @1x`;
    const setup = await browser.newContext({ viewport: VIEWPORT });
    const page = await setup.newPage();
    await signIn(page);
    Object.assign(environment, Object.fromEntries(Object.entries(await webglInfo(page)).map(([key, value]) => [`webgl.${key}`, value])));
    const storageState = await setup.storageState();
    const result: Pick<Measurement, 'firstFrame' | 'orbit'> = {};
    if (sections.has('first-frame')) {
      const layout = smallLayout();
      const names = { production: 'Messprobe', venue: 'Messbühne', scene: 'Erstes Bild' };
      const sceneId = await createScene(page, names, { width: 8000, depth: 6000 }, layout);
      const measured: FirstFrameRun[] = [];
      for (let index = 0; index < runs; index++) {
        const context = await browser.newContext({ viewport: VIEWPORT, storageState });
        const runPage = await openScene(context, sceneId, names.scene);
        measured.push(await openStageAndSettle(runPage));
        console.log(`[measure] first frame run ${index + 1}: ${round(measured.at(-1)!.firstDrawMs)} ms (settled ${round(measured.at(-1)!.settledMs)} ms)`);
        await context.close();
      }
      result.firstFrame = {
        scene: 'Messprobe: 8 × 6 m venue, 2 walls, 1 brace, 1 table, 1 stage-deck platform, 1 stair (stage-view.spec.ts object kinds)',
        objects: 6,
        runs: measured.map(item => ({ ...item, firstDrawMs: round(item.firstDrawMs), settledMs: round(item.settledMs) })),
        medianFirstDrawMs: round(median(measured.map(item => item.firstDrawMs))),
        medianSettledMs: round(median(measured.map(item => item.settledMs))),
      };
    }
    if (sections.has('orbit')) {
      const { layout, objects } = denseLayout();
      const names = { production: 'Dichteprobe', venue: 'Große Halle', scene: 'Volles Haus' };
      const sceneId = await createScene(page, names, { width: 20000, depth: 16000 }, layout);
      const context = await browser.newContext({ viewport: VIEWPORT, storageState });
      const runPage = await openScene(context, sceneId, names.scene);
      const opened = await openStageAndSettle(runPage);
      const measured = await orbit(runPage, orbitSeconds);
      console.log(`[measure] dense orbit: median ${measured.frameTimeMs.median} ms, p95 ${measured.frameTimeMs.p95} ms over ${measured.frames} frames`);
      await context.close();
      result.orbit = {
        scene: 'Dichteprobe: 20 × 16 m venue, 250 chairs (schema maximum per Bühnenbild), 40 stage-deck platforms 2 × 1 m at 400 mm with legs, 10 walls',
        objects, firstDrawMs: round(opened.firstDrawMs), settledMs: round(opened.settledMs), ...measured,
      };
    }
    await setup.close();
    return result;
  } finally {
    await browser?.close();
    await stopServer(server);
  }
}

async function measure(values: { out: string; label: string; skipBuild: boolean; runs: number; orbitSeconds: number; only?: string }) {
  const sections = new Set<Section>((values.only ? values.only.split(',') : ALL_SECTIONS).map(item => {
    if (!(ALL_SECTIONS as readonly string[]).includes(item)) throw new Error(`unknown section ${item}`);
    return item as Section;
  }));
  const cpus = os.cpus();
  const result: Measurement = {
    label: values.label,
    measuredAt: new Date().toISOString(),
    git: { commit: git(['rev-parse', 'HEAD']), branch: git(['rev-parse', '--abbrev-ref', 'HEAD']), dirty: git(['status', '--porcelain']).length > 0 },
    environment: {
      os: `${os.type()} ${os.release()}`, cpuModel: cpus[0]?.model ?? 'unknown', cpuCount: cpus.length,
      memoryGiB: round(os.totalmem() / 1024 ** 3), node: process.version,
    },
  };
  if (!values.skipBuild && (sections.has('bundle') || sections.has('first-frame') || sections.has('orbit'))) run('npm', ['run', 'build']);
  if (sections.has('bundle')) result.bundle = await measureBundle(resolve('dist/web'));
  if (sections.has('packages') || sections.has('attribution')) {
    const packages = await measurePackages();
    if (sections.has('packages')) result.packages = packages;
    if (sections.has('attribution')) result.attribution = await measureAttribution(new Set(packages.pascalOnly.paths));
  }
  if (sections.has('first-frame') || sections.has('orbit')) Object.assign(result, await measureBrowser(sections, values.runs, values.orbitSeconds, result.environment));
  await mkdir(dirname(resolve(values.out)), { recursive: true });
  await writeFile(values.out, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`[measure] wrote ${values.out}`);
  console.log(summaryTable([result]));
}

const kib = (bytes: number | undefined) => bytes === undefined ? '–' : `${round(bytes / 1024)} KiB`;
const ms = (value: number | undefined) => value === undefined ? '–' : `${round(value)} ms`;
const count = (value: number | null | undefined) => value === undefined || value === null ? '–' : String(value);

function summaryRows(item: Measurement): [string, string][] {
  const largest = item.bundle?.chunks.find(chunk => chunk.kind === 'js');
  return [
    ['JS total (minified / gzip)', item.bundle ? `${kib(item.bundle.totals.jsBytes)} / ${kib(item.bundle.totals.jsGzipBytes)}` : '–'],
    ['CSS total (minified / gzip)', item.bundle ? `${kib(item.bundle.totals.cssBytes)} / ${kib(item.bundle.totals.cssGzipBytes)}` : '–'],
    ['Initial load (index.html entry + preloads, gzip)', item.bundle ? kib(item.bundle.initial.gzipBytes) : '–'],
    ['Largest JS chunk (minified / gzip)', largest ? `${largest.name}: ${kib(largest.bytes)} / ${kib(largest.gzipBytes)}` : '–'],
    ['JS attributable to @pascal-app/* and Pascal-only deps', item.attribution ? `${kib(item.attribution.pascal.bytes)} (${round(item.attribution.pascal.share * 100)} %), ≈ ${kib(item.attribution.pascal.estimatedGzipBytes)} gzip` : '–'],
    ['JS from three (all entry points)', item.attribution ? `${kib(item.attribution.three.bytes)} (${round(item.attribution.three.share * 100)} %)` : '–'],
    ['…of which three.webgpu.js + three.tsl.js', item.attribution ? kib(item.attribution.three.files.filter(file => /three\.(webgpu|tsl)\.js$/.test(file.name)).reduce((sum, file) => sum + file.bytes, 0)) : '–'],
    ['JS fetched when opening the Raumsicht (median run, transfer)', item.firstFrame ? kib(median(item.firstFrame.runs.map(run => run.chunkTransferBytes))) : '–'],
    ['Raumsicht open → first WebGL draw (median of runs)', item.firstFrame ? `${ms(item.firstFrame.medianFirstDrawMs)} (n=${item.firstFrame.runs.length})` : '–'],
    ['Raumsicht open → scene drawn (median of runs)', item.firstFrame ? ms(item.firstFrame.medianSettledMs) : '–'],
    ['Dense layout: open → first draw / scene drawn', item.orbit ? `${ms(item.orbit.firstDrawMs)} / ${ms(item.orbit.settledMs)}` : '–'],
    ['Dense layout orbit frame time median / p95', item.orbit ? `${ms(item.orbit.frameTimeMs.median)} / ${ms(item.orbit.frameTimeMs.p95)} (${item.orbit.frames} frames in ${item.orbit.seconds} s)` : '–'],
    ['Dense layout draw calls per frame (median)', item.orbit ? String(item.orbit.drawCallsPerFrame.median) : '–'],
    ['Installed packages (npm ls --all --parseable, unique paths; without dev)', item.packages ? `${count(item.packages.npmLsAll)}; ${count(item.packages.npmLsProduction)}` : '–'],
    ['Lockfile packages (all / non-dev / installed on this machine)', item.packages ? `${item.packages.lockfile.entries} / ${item.packages.lockfile.production} / ${item.packages.lockfile.installed}` : '–'],
    ['Lockfile packages only reachable through @pascal-app/* (all / installed)', item.packages ? `${item.packages.pascalOnly.all} / ${item.packages.pascalOnly.installed}` : '–'],
  ];
}

function summaryTable(items: Measurement[]) {
  const rows = items.map(summaryRows);
  const header = `| Metric | ${items.map(item => `${item.label} (${item.git.commit.slice(0, 7)})`).join(' | ')} |`;
  const divider = `|---|${items.map(() => '---').join('|')}|`;
  const body = rows[0]!.map(([metric], index) => `| ${metric} | ${rows.map(row => row[index]![1]).join(' | ')} |`);
  return [header, divider, ...body].join('\n');
}

async function compare(paths: string[]) {
  const items = await Promise.all(paths.map(async path => JSON.parse(await readFile(path, 'utf8')) as Measurement));
  console.log(summaryTable(items));
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string' }, label: { type: 'string', default: 'measurement' },
    'skip-build': { type: 'boolean', default: false },
    runs: { type: 'string', default: '5' }, 'orbit-seconds': { type: 'string', default: '6' },
    only: { type: 'string' },
  },
});
const [command = 'measure', ...rest] = positionals;
if (command === 'compare') {
  if (rest.length < 2) throw new Error('compare needs at least two measurement files');
  await compare(rest);
} else if (command === 'measure') {
  if (!values.out) throw new Error('--out <file.json> is required');
  await measure({
    out: values.out, label: values.label, skipBuild: values['skip-build'],
    runs: Number(values.runs), orbitSeconds: Number(values['orbit-seconds']), only: values.only,
  });
} else throw new Error(`unknown command ${command}`);
