import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { freezePackage } from '../src/shared/package.js';
import { EXAMPLE_PLAIN, type InventoryPanel } from '../src/shared/inventory.js';
import { newKeepClearZone } from '../src/shared/keepClear.js';
import { AUDIENCE_FLOOR_ID, newPlatform } from '../src/shared/levels.js';
import { newOverheadBox } from '../src/shared/overhead.js';
import { newBrace, newWall, type Scene } from '../src/shared/layout.js';
import { newWallType } from '../src/shared/wall-types.js';
import { renderPackage } from '../src/server/exports/packagePdf.js';
import { renderOffThread } from '../src/server/exports/render.js';

function panel(overrides: Partial<InventoryPanel> & Pick<InventoryPanel, 'type'>): InventoryPanel {
  const type = overrides.type;
  return { id: randomUUID(), label: 'W12', typeId: type.id, available: true, note: null, ...overrides, type };
}

function baseScene(name: string, extra: Partial<Scene> = {}): Scene {
  return {
    id: randomUUID(), name, productionName: 'Beispielproduktion', venueName: 'Beispielsaal',
    revision: 1, productionId: extra.productionId ?? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    venueId: randomUUID(), venueVersionId: randomUUID(),
    venue: extra.venue ?? { schemaVersion: 1, width: 8000, depth: 6000 },
    lease: null, layout: extra.layout ?? { schemaVersion: 1, walls: [], braces: [] },
    ...extra,
  };
}

function pathLengthsMm(pdf: Buffer) {
  const ptPerMm = 72 / 25.4;
  const lengths: number[] = [];
  for (const block of pdf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    const content = block[1] ?? '';
    let x = 0, y = 0;
    for (const token of content.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(m|l)/g)) {
      const nx = Number(token[1]), ny = Number(token[2]);
      if (token[3] === 'l') lengths.push(Math.hypot(nx - x, ny - y) / ptPerMm);
      x = nx; y = ny;
    }
  }
  return lengths;
}
function shownText(pdf: Buffer) {
  return [...pdf.toString('latin1').matchAll(/<([0-9a-fA-F]+)>/g)]
    .map(match => Buffer.from(match[1] ?? '', 'hex').toString('latin1')).join('');
}

test('two scenes sharing one panel count 1 physical and 2 appearances; later edits leave the frozen lists', async () => {
  const type = { ...newWallType(randomUUID()), ...EXAMPLE_PLAIN, name: 'Beispiel-Glattwand' };
  const shared = panel({ label: 'W12', type });
  const broken = panel({ label: 'W03', type, available: false, note: 'Reparatur' });
  const productionId = randomUUID();
  const platform = newPlatform(randomUUID(), 4000, 4750);
  const box = newOverheadBox(randomUUID(), 4000, 4750);
  box.label = 'Lüftung';
  const zone = { ...newKeepClearZone(randomUUID(), AUDIENCE_FLOOR_ID, 1000, 500), label: 'Notausgang Ost' };
  const assignedA = { ...newWall(randomUUID(), 4000, 4750), panelId: shared.id, label: 'Bühnenwand', supportingSurfaceId: platform.id };
  const assignedB = { ...newWall(randomUUID(), 2000, 3000), panelId: shared.id, label: 'Wiederholte Wand' };
  const openWall = { ...newWall(randomUUID(), 5000, 2000), label: 'Offene Wand' };
  const brokenWall = { ...newWall(randomUUID(), 1000, 500), panelId: broken.id, label: 'Kaputte Wand' };
  const brace = newBrace(randomUUID(), 2000, 4000);
  const sceneA = baseScene('Szene A', {
    productionId,
    venue: { schemaVersion: 1, width: 8000, depth: 6000, platforms: [platform], overheadBoxes: [box], ceilingHeight: 2500, keepClearZones: [zone] },
    layout: { schemaVersion: 1, walls: [assignedA], braces: [brace] },
  });
  const sceneB = baseScene('Szene B', {
    productionId,
    venue: { schemaVersion: 1, width: 8000, depth: 6000, keepClearZones: [zone] },
    layout: { schemaVersion: 1, walls: [assignedB, openWall, brokenWall], braces: [] },
  });
  const revisionId = randomUUID();
  const pkg = freezePackage([sceneA, sceneB], {
    id: revisionId, name: 'Paket Probe', issuedAt: new Date('2026-09-07T12:00:00.000Z'),
  }, [shared, broken]);
  const sharedStock = pkg.stock.panels.find(item => item.panelId === shared.id);
  assert.equal(sharedStock?.appearances, 2);
  assert.equal(sharedStock?.label, 'W12');
  assert.equal(pkg.stock.physicalPanels, 2);
  assert.equal(pkg.stock.appearances, 3);
  assert.equal(pkg.stock.unassigned.some(item => item.wallLabel === 'Offene Wand' && item.sceneName === 'Szene B'), true);
  assert.equal(pkg.stock.unavailable.some(item => item.panelLabel === 'W03' && item.sceneName === 'Szene B'), true);
  assert.equal(pkg.scenes[0]?.warnings.some(item => item.kind === 'overhead'), true);
  assert.equal(pkg.scenes[0]?.warnings.some(item => item.kind === 'ceiling'), true);
  assert.equal(pkg.scenes[1]?.unresolvedWarnings.some(item => /Notausgang Ost/.test(item.message)), true);
  assert.equal(pkg.sceneLists[0]?.braces[0]?.label, 'Stütze');
  assert.equal(pkg.revisionId, revisionId);
  assert.equal(pkg.scenes[0]?.revisionId, revisionId);
  sceneA.layout.walls[0]!.panelId = undefined;
  sceneA.layout.braces = [];
  sceneB.layout.walls = [];
  shared.available = false;
  shared.label = 'Geändert';
  sceneA.venue.overheadBoxes = [];
  sceneA.venue.ceilingHeight = 8000;
  sceneB.venue.keepClearZones = [];
  assert.equal(pkg.stock.panels.find(item => item.panelId === shared.id)?.appearances, 2);
  assert.equal(pkg.stock.panels.find(item => item.panelId === shared.id)?.label, 'W12');
  assert.equal(pkg.stock.unassigned.some(item => item.wallLabel === 'Offene Wand'), true);
  assert.equal(pkg.stock.unavailable.some(item => item.panelLabel === 'W03'), true);
  assert.equal(pkg.scenes[0]?.warnings.some(item => item.kind === 'overhead'), true);
  assert.equal(pkg.scenes[0]?.layout.braces[0]?.label, 'Stütze');
  assert.equal(pkg.scenes[1]?.unresolvedWarnings.some(item => /Notausgang Ost/.test(item.message)), true);
});

test('a package PDF lists parts, warnings and the frozen revision on every page, with 1200 mm still 24 mm at 1:50 A4', async () => {
  const type = { ...newWallType(randomUUID()), ...EXAMPLE_PLAIN, name: 'Beispiel-Glattwand' };
  const shared = panel({ label: 'W12', type });
  const broken = panel({ label: 'W03', type, available: false });
  const productionId = randomUUID();
  const assignedA = { ...newWall(randomUUID(), 2000, 3000), panelId: shared.id, assemblyNumber: 1, label: 'Bühnenwand' };
  const assignedB = { ...newWall(randomUUID(), 2000, 3000), panelId: shared.id, assemblyNumber: 1, label: 'Wiederholte Wand' };
  const openWall = { ...newWall(randomUUID(), 5000, 2000), label: 'Offene Wand' };
  const brokenWall = { ...newWall(randomUUID(), 4000, 2000), panelId: broken.id, label: 'Kaputte Wand' };
  const pkg = freezePackage([
    baseScene('Szene A', { productionId, layout: { schemaVersion: 1, walls: [assignedA], braces: [] } }),
    baseScene('Szene B', { productionId, layout: { schemaVersion: 1, walls: [assignedB, openWall, brokenWall], braces: [] } }),
  ], { id: randomUUID(), name: 'Paket Probe', issuedAt: new Date('2026-09-07T12:00:00.000Z') }, [shared, broken]);
  const pdf = await renderPackage(pkg);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.match(pdf.toString('latin1'), /\/MediaBox \[ ?0 0 595\.28 841\.89 ?\]/);
  const text = shownText(pdf);
  assert(text.includes('Konstruktionspaket'), text);
  assert(text.includes('Stückliste'), text);
  assert(text.includes('Paket Probe'), text);
  assert(text.includes(pkg.revisionId), text);
  assert(text.includes('07.09.2026'), text);
  assert(text.includes('2 physische Platten'), text);
  assert(text.includes('3 Einsätze'), text);
  assert(text.includes('W12'), text);
  assert(text.includes('2 Einsätze'), text);
  assert(text.includes('Offene Wand'), text);
  assert(text.includes('W03'), text);
  assert(text.includes('Maßstab 1:50'), text);
  assert(pathLengthsMm(pdf).some(length => Math.abs(length - 24) < 0.05), pathLengthsMm(pdf).slice(0, 16).join(','));
  const forked = await renderOffThread(pkg);
  assert.equal(forked.subarray(0, 5).toString(), '%PDF-');
  assert(shownText(forked).includes('Stückliste'));
});
