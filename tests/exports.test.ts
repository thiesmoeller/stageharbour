import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CONNECTION_COMPATIBILITY_NOTICE } from '../src/shared/assembly.js';
import { freezeSnapshot } from '../src/shared/export.js';
import { newKeepClearZone } from '../src/shared/keepClear.js';
import { newCableRoutingCorridor, newConnectionPoint } from '../src/shared/infrastructure.js';
import { newBrace, newWall, type Scene } from '../src/shared/layout.js';
import { AUDIENCE_FLOOR_ID, newPlatform, newStair } from '../src/shared/levels.js';
import { newOverheadBox } from '../src/shared/overhead.js';
import { newWallType } from '../src/shared/wall-types.js';
import { renderConstructionPlan } from '../src/server/exports/pdf.js';
import { renderOffThread } from '../src/server/exports/render.js';

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
function sampleSnapshot() {
  const wall = newWall(randomUUID(), 2000, 3000);
  return freezeSnapshot({
    id: randomUUID(), name: 'Erste Szene', productionName: 'Beispielproduktion', venueName: 'Beispielsaal',
    revision: 1, venueVersionId: randomUUID(), venue: { schemaVersion: 1, width: 8000, depth: 6000 },
    lease: null, layout: { schemaVersion: 1, walls: [wall], braces: [] },
  }, { id: randomUUID(), name: 'Fassung Probe', issuedAt: new Date('2026-09-07T12:00:00.000Z') });
}

test('a 1200 mm wall at 1:50 is 24 mm on the A4 page', async () => {
  const pdf = await renderConstructionPlan(sampleSnapshot());
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.match(pdf.toString('latin1'), /\/MediaBox \[0 0 595\.28 841\.89\]/);
  const text = shownText(pdf);
  assert(text.includes('Fassung Probe'), text);
  assert(text.includes('07.09.2026'));
  assert(text.includes('Maßstab 1:50'));
  assert(text.includes('Publikum'));
  assert(pathLengthsMm(pdf).some(length => Math.abs(length - 24) < 0.05), pathLengthsMm(pdf).slice(0, 12).join(','));
});

test('an irregular venue outline is drawn at 1:50 from millimetre vertices', async () => {
  const snapshot = sampleSnapshot();
  snapshot.venue = {
    ...snapshot.venue,
    outline: [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 1500, y: 2000 }],
  };
  const pdf = await renderConstructionPlan(snapshot);
  assert(pathLengthsMm(pdf).some(length => Math.abs(length - 60) < 0.05), pathLengthsMm(pdf).slice(0, 16).join(','));
});

test('construction plan PDF generation runs off the API thread', async () => {
  const pdf = await renderOffThread(sampleSnapshot());
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert(pathLengthsMm(pdf).some(length => Math.abs(length - 24) < 0.05));
});

function doorScene(): Scene {
  const type = { ...newWallType(randomUUID()), name: 'Türwand', openings: [{ id: randomUUID(), left: 200, sill: 0, width: 800, height: 2000 }] };
  const wall = { ...newWall(randomUUID(), 2000, 3000), typeId: type.id, label: type.name };
  return {
    id: randomUUID(), name: 'Erste Szene', productionName: 'Beispielproduktion', venueName: 'Beispielsaal',
    revision: 1, venueVersionId: randomUUID(), venue: { schemaVersion: 1, width: 8000, depth: 6000 },
    lease: null, layout: { schemaVersion: 1, wallTypes: [type], walls: [wall], braces: [] },
  };
}

test('freeze stores known opening millimetres that later type edits cannot change', () => {
  const scene = doorScene();
  const snapshot = freezeSnapshot(scene, { id: randomUUID(), name: 'Fassung Probe', issuedAt: new Date('2026-09-07T12:00:00.000Z') });
  assert.equal(snapshot.resolvedWalls[0]?.openings[0]?.width, 800);
  assert.equal(snapshot.resolvedWalls[0]?.openings[0]?.height, 2000);
  assert.equal(snapshot.resolvedWalls[0]?.openings[0]?.left, 200);
  assert.equal(snapshot.resolvedWalls[0]?.openings[0]?.sill, 0);
  scene.layout.wallTypes![0]!.openings[0]!.width = 400;
  scene.layout.walls[0]!.width = 900;
  assert.equal(snapshot.layout.wallTypes?.[0]?.openings[0]?.width, 800);
  assert.equal(snapshot.resolvedWalls[0]?.openings[0]?.width, 800);
});

test('an 800 mm opening at 1:50 is 16 mm on the A4 page', async () => {
  const pdf = await renderConstructionPlan(freezeSnapshot(doorScene(), {
    id: randomUUID(), name: 'Fassung Probe', issuedAt: new Date('2026-09-07T12:00:00.000Z'),
  }));
  const lengths = pathLengthsMm(pdf);
  assert(lengths.some(length => Math.abs(length - 24) < 0.05), lengths.slice(0, 16).join(','));
  assert(lengths.some(length => Math.abs(length - 16) < 0.05), lengths.slice(0, 16).join(','));
});
test('a 2500 mm cable corridor and labelled pin are 50 mm and named on the A4 page', async () => {
  const pin = { ...newConnectionPoint(randomUUID(), 'power', 0, 0), label: 'Lichtstrom' };
  const corridor = newCableRoutingCorridor(randomUUID(), [{ x: 0, y: 0 }, { x: 2500, y: 0 }]);
  const snapshot = freezeSnapshot({
    id: randomUUID(), name: 'Erste Szene', productionName: 'Beispielproduktion', venueName: 'Beispielsaal',
    revision: 1, venueVersionId: randomUUID(),
    venue: { schemaVersion: 1, width: 8000, depth: 6000, connectionPoints: [pin], cableRoutingCorridors: [corridor] },
    lease: null, layout: { schemaVersion: 1, walls: [], braces: [] },
  }, { id: randomUUID(), name: 'Fassung Probe', issuedAt: new Date('2026-09-07T12:00:00.000Z') });
  const pdf = await renderConstructionPlan(snapshot);
  const lengths = pathLengthsMm(pdf);
  assert(lengths.some(length => Math.abs(length - 50) < 0.05), lengths.slice(0, 20).join(','));
  const text = shownText(pdf);
  assert(text.includes('Lichtstrom'), text);
  assert(!/Ampere|Watt|Kabelmeter/.test(text), text);
});

test('a frozen 600 x 800 mm brace footprint is 12 mm by 16 mm on the A4 page', async () => {
  const brace = newBrace(randomUUID(), 2000, 3000);
  const snapshot = freezeSnapshot({
    id: randomUUID(), name: 'Stützprobe', productionName: 'Beispielproduktion', venueName: 'Beispielsaal',
    revision: 1, venueVersionId: randomUUID(), venue: { schemaVersion: 1, width: 8000, depth: 6000 },
    lease: null, layout: { schemaVersion: 1, walls: [], braces: [brace] },
  }, { id: randomUUID(), name: 'Fassung Stütze', issuedAt: new Date('2026-09-07T12:00:00.000Z') });
  assert.deepEqual(snapshot.resolvedBraces[0], {
    id: brace.id, label: 'Stütze', height: 1800,
    corners: [{ x: 1700, y: 2600 }, { x: 2300, y: 2600 }, { x: 2300, y: 3400 }, { x: 1700, y: 3400 }],
  });
  const pdf = await renderConstructionPlan(snapshot);
  const lengths = pathLengthsMm(pdf);
  assert(lengths.some(length => Math.abs(length - 12) < 0.05), lengths.slice(0, 16).join(','));
  assert(lengths.some(length => Math.abs(length - 16) < 0.05), lengths.slice(0, 16).join(','));
  const text = shownText(pdf);
  assert(text.includes('600 x 800 mm'), text);
  assert(text.includes('1800 mm'), text);
  assert(!/Stabilit/.test(text), text);
});

test('a frozen 4000 mm platform edge is 80 mm on the A4 page and later venue edits cannot change the snapshot', async () => {
  const platform = newPlatform(randomUUID(), 4000, 4750);
  const stair = newStair(randomUUID(), AUDIENCE_FLOOR_ID, platform.id, 4000, 2500);
  const scene: Scene = {
    id: randomUUID(), name: 'Ebenenprobe', productionName: 'Beispielproduktion', venueName: 'Beispielsaal',
    revision: 1, venueVersionId: randomUUID(),
    venue: { schemaVersion: 1, width: 8000, depth: 6000, platforms: [platform], stairs: [stair] },
    lease: null, layout: { schemaVersion: 1, walls: [], braces: [] },
  };
  const snapshot = freezeSnapshot(scene, { id: randomUUID(), name: 'Fassung Ebenen', issuedAt: new Date('2026-09-07T12:00:00.000Z') });
  assert.equal(snapshot.venue.platforms?.[0]?.elevation, 400);
  assert.equal(snapshot.venue.stairs?.[0]?.width, 1200);
  scene.venue.platforms![0]!.elevation = 900;
  assert.equal(snapshot.venue.platforms?.[0]?.elevation, 400);
  const pdf = await renderConstructionPlan(snapshot);
  const lengths = pathLengthsMm(pdf);
  assert(lengths.some(length => Math.abs(length - 80) < 0.05), lengths.slice(0, 20).join(','));
  const text = shownText(pdf);
  assert(text.includes('400 mm'), text);
  assert(text.includes('Treppe'), text);
});
test('freeze keeps assembly labels, connections and rigging notes after later source edits', () => {
  const panelId = randomUUID();
  const left = { ...newWall(randomUUID(), 1000, 2000), assemblyNumber: 1, panelId };
  const right = { ...newWall(randomUUID(), 5000, 2000), assemblyNumber: 2 };
  const connection = { id: randomUUID(), a: left.id, b: right.id };
  const scene: Scene = {
    id: randomUUID(), name: 'Montageszene', productionName: 'Beispielproduktion', venueName: 'Beispielsaal',
    revision: 1, venueVersionId: randomUUID(), venue: { schemaVersion: 1, width: 8000, depth: 6000 },
    lease: null, layout: {
      schemaVersion: 1, walls: [left, right], braces: [], connections: [connection],
      riggingNotes: 'Stifte an Position 1 belassen.',
    },
  };
  const snapshot = freezeSnapshot(scene, {
    id: randomUUID(), name: 'Montagefassung', issuedAt: new Date('2026-09-07T12:00:00.000Z'),
  }, { [panelId]: 'W12' });
  assert.equal(snapshot.resolvedWalls[0]?.assemblyNumber, 1);
  assert.equal(snapshot.resolvedWalls[0]?.panelLabel, 'W12');
  assert.equal(snapshot.layout.walls[0]?.assemblyNumber, 1);
  assert.deepEqual(snapshot.layout.connections, [connection]);
  assert.equal(snapshot.layout.riggingNotes, 'Stifte an Position 1 belassen.');
  scene.layout.walls[0]!.assemblyNumber = 9;
  scene.layout.walls[0]!.x = 9000;
  scene.layout.riggingNotes = 'Geändert';
  scene.layout.connections = [];
  assert.equal(snapshot.resolvedWalls[0]?.assemblyNumber, 1);
  assert.equal(snapshot.resolvedWalls[0]?.panelLabel, 'W12');
  assert.equal(snapshot.layout.walls[0]?.x, 1000);
  assert.equal(snapshot.layout.riggingNotes, 'Stifte an Position 1 belassen.');
  assert.deepEqual(snapshot.layout.connections, [connection]);
});

test('construction plan PDF shows assigned position, inventory label, notes and manual verification', async () => {
  const panelId = randomUUID();
  const wall = { ...newWall(randomUUID(), 2000, 3000), assemblyNumber: 3, panelId };
  const snapshot = freezeSnapshot({
    id: randomUUID(), name: 'Erste Szene', productionName: 'Beispielproduktion', venueName: 'Beispielsaal',
    revision: 1, venueVersionId: randomUUID(), venue: { schemaVersion: 1, width: 8000, depth: 6000 },
    lease: null, layout: {
      schemaVersion: 1, walls: [wall], braces: [], connections: [],
      riggingNotes: 'Stifte an Position 3 belassen.',
    },
  }, { id: randomUUID(), name: 'Fassung Probe', issuedAt: new Date('2026-09-07T12:00:00.000Z') }, { [panelId]: 'W12' });
  const text = shownText(await renderConstructionPlan(snapshot));
  assert(text.includes('Position 3 · Platte W12'), text);
  assert(text.includes('Vorderseite'), text);
  assert(text.includes('Rückseite'), text);
  assert(text.includes('Stifte an Position 3 belassen.'), text);
  assert(text.includes(CONNECTION_COMPATIBILITY_NOTICE), text);
});

test('freeze stores overhead warnings that later venue edits cannot change', async () => {
  const platform = newPlatform(randomUUID(), 4000, 4750);
  const box = newOverheadBox(randomUUID(), 4000, 4750);
  box.label = 'Lüftung';
  const wall = { ...newWall(randomUUID(), 4000, 4750), supportingSurfaceId: platform.id };
  const scene: Scene = {
    id: randomUUID(), name: 'Deckenprobe', productionName: 'Beispielproduktion', venueName: 'Beispielsaal',
    revision: 1, venueVersionId: randomUUID(),
    venue: { schemaVersion: 1, width: 8000, depth: 6000, platforms: [platform], overheadBoxes: [box], ceilingHeight: 2500 },
    lease: null, layout: { schemaVersion: 1, walls: [wall], braces: [] },
  };
  const snapshot = freezeSnapshot(scene, { id: randomUUID(), name: 'Fassung Überbauung', issuedAt: new Date('2026-09-07T12:00:00.000Z') });
  assert.equal(snapshot.warnings.some(item => item.kind === 'overhead'), true);
  assert.equal(snapshot.warnings.some(item => item.kind === 'ceiling'), true);
  scene.venue.overheadBoxes = [];
  scene.venue.ceilingHeight = 8000;
  scene.layout.walls[0]!.supportingSurfaceId = AUDIENCE_FLOOR_ID;
  assert.equal(snapshot.venue.overheadBoxes?.[0]?.label, 'Lüftung');
  assert.equal(snapshot.warnings.some(item => item.kind === 'overhead'), true);
  const pdf = await renderConstructionPlan(snapshot);
  const lengths = pathLengthsMm(pdf);
  assert(lengths.some(length => Math.abs(length - 80) < 0.05), lengths.slice(0, 24).join(','));
  const text = shownText(pdf);
  assert(text.includes('Lüftung'), text);
  assert(text.includes('kein statischer Nachweis'), text);
  assert(text.includes('Geometrische Hinweise'), text);
  assert(!/zertifiz|standsicher|freigegeben/i.test(text), text);
});

test('freeze stores unresolved keep-clear warnings that later layout edits cannot change', () => {
  const zone = { ...newKeepClearZone(randomUUID(), AUDIENCE_FLOOR_ID, 1000, 500), label: 'Notausgang Ost' };
  const wall = { ...newWall(randomUUID(), 1000, 500), label: 'Bühnenwand' };
  const scene: Scene = {
    id: randomUUID(), name: 'Freihalteprobe', productionName: 'Beispielproduktion', venueName: 'Beispielsaal',
    revision: 1, venueVersionId: randomUUID(),
    venue: { schemaVersion: 1, width: 8000, depth: 6000, keepClearZones: [zone] },
    lease: null, layout: { schemaVersion: 1, walls: [wall], braces: [] },
  };
  const snapshot = freezeSnapshot(scene, { id: randomUUID(), name: 'Fassung Frei', issuedAt: new Date('2026-09-07T12:00:00.000Z') });
  assert.equal(snapshot.unresolvedWarnings.length, 1);
  assert.match(snapshot.unresolvedWarnings[0]?.message ?? '', /Notausgang Ost/);
  assert.match(snapshot.unresolvedWarnings[0]?.message ?? '', /Bühnenwand/);
  scene.layout.walls[0]!.x = 7000;
  scene.layout.walls[0]!.y = 5000;
  assert.equal(snapshot.unresolvedWarnings.length, 1);
  assert.equal(snapshot.layout.walls[0]?.x, 1000);
});

test('a frozen centreline is labelled on the PDF and later venue edits cannot change the snapshot', async () => {
  const stageCentreline = { x: 4000, y: 3000, rotation: 90 };
  const scene: Scene = {
    id: randomUUID(), name: 'Mittellinienprobe', productionName: 'Beispielproduktion', venueName: 'Beispielsaal',
    revision: 1, venueVersionId: randomUUID(),
    venue: { schemaVersion: 1, width: 8000, depth: 6000, stageCentreline },
    lease: null, layout: { schemaVersion: 1, walls: [], braces: [] },
  };
  const snapshot = freezeSnapshot(scene, { id: randomUUID(), name: 'Fassung Mitte', issuedAt: new Date('2026-09-07T12:00:00.000Z') });
  assert.deepEqual(snapshot.venue.stageCentreline, stageCentreline);
  scene.venue.stageCentreline = { x: 100, y: 100, rotation: 0 };
  assert.deepEqual(snapshot.venue.stageCentreline, stageCentreline);
  const text = shownText(await renderConstructionPlan(snapshot));
  assert(text.includes('Mittellinie'), text);
});
