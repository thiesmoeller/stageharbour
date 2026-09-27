import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CONNECTION_COMPATIBILITY_NOTICE } from '../src/shared/assembly.js';
import { constructionSnapshotSchema, freezeSnapshot, planTiles } from '../src/shared/export.js';
import { elevationFaces } from '../src/shared/elevations.js';
import { formGroup } from '../src/shared/groups.js';
import { newKeepClearZone } from '../src/shared/keepClear.js';
import { newCableRoutingCorridor, newConnectionPoint } from '../src/shared/infrastructure.js';
import { newBrace, newWall, type Scene } from '../src/shared/layout.js';
import { newPlaceholder } from '../src/shared/placeholders.js';
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
    revision: 1, productionId: randomUUID(), venueId: randomUUID(), venueVersionId: randomUUID(), venue: { schemaVersion: 1, width: 8000, depth: 6000 },
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

test('off-thread PDF failures reject without throwing from the IPC handler', async () => {
  await assert.rejects(
    () => renderOffThread({ schemaVersion: 1 } as never),
    (error: unknown) => error instanceof Error && error.message.length > 0,
  );
});

function doorScene(): Scene {
  const type = { ...newWallType(randomUUID()), name: 'Türwand', openings: [{ id: randomUUID(), left: 200, sill: 0, width: 800, height: 2000 }] };
  const wall = { ...newWall(randomUUID(), 2000, 3000), typeId: type.id, label: type.name };
  return {
    id: randomUUID(), name: 'Erste Szene', productionName: 'Beispielproduktion', venueName: 'Beispielsaal',
    revision: 1, productionId: randomUUID(), venueId: randomUUID(), venueVersionId: randomUUID(), venue: { schemaVersion: 1, width: 8000, depth: 6000 },
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
    revision: 1, productionId: randomUUID(), venueId: randomUUID(), venueVersionId: randomUUID(),
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

test('a frozen 40×40 timber brace footprint and height are frozen on the A4 page', async () => {
  const brace = newBrace(randomUUID(), 2000, 3000);
  const snapshot = freezeSnapshot({
    id: randomUUID(), name: 'Stützprobe', productionName: 'Beispielproduktion', venueName: 'Beispielsaal',
    revision: 1, productionId: randomUUID(), venueId: randomUUID(), venueVersionId: randomUUID(), venue: { schemaVersion: 1, width: 8000, depth: 6000 },
    lease: null, layout: { schemaVersion: 1, walls: [], braces: [brace] },
  }, { id: randomUUID(), name: 'Fassung Stütze', issuedAt: new Date('2026-09-07T12:00:00.000Z') });
  assert.deepEqual(snapshot.resolvedBraces[0], {
    id: brace.id, label: 'Stütze', height: 1200,
    corners: [{ x: 1980, y: 2750 }, { x: 2020, y: 2750 }, { x: 2020, y: 3250 }, { x: 1980, y: 3250 }],
  });
  const pdf = await renderConstructionPlan(snapshot);
  const lengths = pathLengthsMm(pdf);
  assert(lengths.some(length => Math.abs(length - 0.8) < 0.05 || Math.abs(length - 10) < 0.05), lengths.slice(0, 16).join(','));
  const text = shownText(pdf);
  assert(text.includes('40 x 500 mm') || text.includes('40 × 500'), text);
  assert(text.includes('1200 mm'), text);
  assert(!/Stabilit/.test(text), text);
});

test('a frozen 4000 mm platform edge is 80 mm on the A4 page and later venue edits cannot change the snapshot', async () => {
  const platform = newPlatform(randomUUID(), 4000, 4750);
  const stair = newStair(randomUUID(), AUDIENCE_FLOOR_ID, platform.id, 4000, 2500);
  const scene: Scene = {
    id: randomUUID(), name: 'Ebenenprobe', productionName: 'Beispielproduktion', venueName: 'Beispielsaal',
    revision: 1, productionId: randomUUID(), venueId: randomUUID(), venueVersionId: randomUUID(),
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
    revision: 1, productionId: randomUUID(), venueId: randomUUID(), venueVersionId: randomUUID(), venue: { schemaVersion: 1, width: 8000, depth: 6000 },
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
    revision: 1, productionId: randomUUID(), venueId: randomUUID(), venueVersionId: randomUUID(), venue: { schemaVersion: 1, width: 8000, depth: 6000 },
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
    revision: 1, productionId: randomUUID(), venueId: randomUUID(), venueVersionId: randomUUID(),
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

test('frozen construction plans include permanent venue chairs alongside scene placeholders', () => {
  const chair = { ...newPlaceholder('chair', randomUUID(), 1200, 800), label: 'Parkett 12' };
  const table = { ...newPlaceholder('table', randomUUID(), 2000, 3000), label: 'Probetisch' };
  const scene: Scene = {
    id: randomUUID(), name: 'Stuhlprobe', productionName: 'Beispielproduktion', venueName: 'Beispielsaal',
    revision: 1, productionId: randomUUID(), venueId: randomUUID(), venueVersionId: randomUUID(),
    venue: { schemaVersion: 1, width: 8000, depth: 6000, placeholders: [chair] },
    lease: null, layout: { schemaVersion: 1, walls: [], braces: [], placeholders: [table] },
  };
  const snapshot = freezeSnapshot(scene, { id: randomUUID(), name: 'Fassung Stühle', issuedAt: new Date('2026-09-07T12:00:00.000Z') });
  assert.equal(snapshot.resolvedPlaceholders.length, 2);
  assert.equal(snapshot.resolvedPlaceholders.some(item => item.label === 'Parkett 12'), true);
  assert.equal(snapshot.resolvedPlaceholders.some(item => item.label === 'Probetisch'), true);
});

test('a frozen 1200 x 800 mm table is 24 mm by 16 mm on the A4 page and later edits cannot change it', async () => {
  const table = { ...newPlaceholder('table', randomUUID(), 2000, 3000), label: 'Probetisch' };
  const scene: Scene = {
    id: randomUUID(), name: 'Platzhalterprobe', productionName: 'Beispielproduktion', venueName: 'Beispielsaal',
    revision: 1, productionId: randomUUID(), venueId: randomUUID(), venueVersionId: randomUUID(), venue: { schemaVersion: 1, width: 8000, depth: 6000 },
    lease: null, layout: { schemaVersion: 1, walls: [], braces: [], placeholders: [table] },
  };
  const snapshot = freezeSnapshot(scene, { id: randomUUID(), name: 'Fassung Tisch', issuedAt: new Date('2026-09-07T12:00:00.000Z') });
  assert.equal(snapshot.resolvedPlaceholders[0]?.label, 'Probetisch');
  assert.deepEqual(snapshot.resolvedPlaceholders[0]?.corners, [
    { x: 1400, y: 2600 }, { x: 2600, y: 2600 }, { x: 2600, y: 3400 }, { x: 1400, y: 3400 },
  ]);
  scene.layout.placeholders![0]!.x = 7000;
  scene.layout.placeholders![0]!.width = 1800;
  assert.equal(snapshot.layout.placeholders?.[0]?.x, 2000);
  assert.equal(snapshot.resolvedPlaceholders[0]?.corners[0]?.x, 1400);
  const pdf = await renderConstructionPlan(snapshot);
  const lengths = pathLengthsMm(pdf);
  assert(lengths.some(length => Math.abs(length - 24) < 0.05), lengths.slice(0, 20).join(','));
  assert(lengths.some(length => Math.abs(length - 16) < 0.05), lengths.slice(0, 20).join(','));
  const text = shownText(pdf);
  assert(text.includes('Probetisch'), text);
  assert(text.includes('1200 x 800 mm'), text);
});

test('freeze stores unresolved keep-clear warnings that later layout edits cannot change', () => {
  const zone = { ...newKeepClearZone(randomUUID(), AUDIENCE_FLOOR_ID, 1000, 500), label: 'Notausgang Ost' };
  const wall = { ...newWall(randomUUID(), 1000, 500), label: 'Bühnenwand' };
  const scene: Scene = {
    id: randomUUID(), name: 'Freihalteprobe', productionName: 'Beispielproduktion', venueName: 'Beispielsaal',
    revision: 1, productionId: randomUUID(), venueId: randomUUID(), venueVersionId: randomUUID(),
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
    revision: 1, productionId: randomUUID(), venueId: randomUUID(), venueVersionId: randomUUID(),
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

function pageBlocks(pdf: Buffer) {
  return [...pdf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(block => {
    const content = block[1] ?? '';
    const text = [...content.matchAll(/<([0-9a-fA-F]+)>/g)]
      .map(match => Buffer.from(match[1] ?? '', 'hex').toString('latin1')).join('');
    const lengths: number[] = [];
    const ptPerMm = 72 / 25.4;
    let x = 0, y = 0;
    for (const token of content.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(m|l)/g)) {
      const nx = Number(token[1]), ny = Number(token[2]);
      if (token[3] === 'l') lengths.push(Math.hypot(nx - x, ny - y) / ptPerMm);
      x = nx; y = ny;
    }
    return { text, lengths };
  }).filter(page => page.text.includes('Blatt'));
}

test('stored 1:50 snapshots without paper or elevation groups still parse as A4', () => {
  const frozen = sampleSnapshot();
  const { paper: _paper, elevationGroupIds: _ids, ...legacy } = frozen;
  const parsed = constructionSnapshotSchema.parse(legacy);
  assert.equal(parsed.paper, 'A4');
  assert.equal(parsed.scale, 50);
  assert.deepEqual(parsed.elevationGroupIds, []);
  assert.deepEqual(parsed.warnings, frozen.warnings);
  assert.deepEqual(parsed.unresolvedWarnings, frozen.unresolvedWarnings);
});

test('a 1200 mm wall is 48 mm at 1:25 and 12 mm at 1:100, and 24 mm on A3 at 1:50', async () => {
  const scene: Scene = {
    id: randomUUID(), name: 'Erste Szene', productionName: 'Beispielproduktion', venueName: 'Beispielsaal',
    revision: 1, productionId: randomUUID(), venueId: randomUUID(), venueVersionId: randomUUID(), venue: { schemaVersion: 1, width: 8000, depth: 6000 },
    lease: null, layout: { schemaVersion: 1, walls: [newWall(randomUUID(), 2000, 3000)], braces: [] },
  };
  const issued = { id: randomUUID(), name: 'Fassung Probe', issuedAt: new Date('2026-09-07T12:00:00.000Z') };
  const detail = await renderConstructionPlan(freezeSnapshot(scene, { ...issued, scale: 25 }));
  assert(pathLengthsMm(detail).some(length => Math.abs(length - 48) < 0.05), pathLengthsMm(detail).slice(0, 12).join(','));
  const overview = await renderConstructionPlan(freezeSnapshot(scene, { ...issued, scale: 100 }));
  assert(pathLengthsMm(overview).some(length => Math.abs(length - 12) < 0.05), pathLengthsMm(overview).slice(0, 12).join(','));
  const a3 = freezeSnapshot(scene, { ...issued, paper: 'A3' });
  assert.equal(a3.paper, 'A3');
  assert.equal(a3.scale, 50);
  const a3Pdf = await renderConstructionPlan(a3);
  assert.match(a3Pdf.toString('latin1'), /\/MediaBox \[0 0 841\.89 1190\.55\]/);
  assert(pathLengthsMm(a3Pdf).some(length => Math.abs(length - 24) < 0.05), pathLengthsMm(a3Pdf).slice(0, 12).join(','));
});

test('a 20000 mm venue at 1:50 tiles across three A4 pages with overlap and registration marks', async () => {
  const left = newWall(randomUUID(), 2000, 3000);
  const crossing = newWall(randomUUID(), 8500, 3000);
  const right = newWall(randomUUID(), 18000, 3000);
  const snapshot = freezeSnapshot({
    id: randomUUID(), name: 'Große Szene', productionName: 'Beispielproduktion', venueName: 'Beispielsaal',
    revision: 1, productionId: randomUUID(), venueId: randomUUID(), venueVersionId: randomUUID(), venue: { schemaVersion: 1, width: 20000, depth: 6000 },
    lease: null, layout: { schemaVersion: 1, walls: [left, crossing, right], braces: [] },
  }, { id: randomUUID(), name: 'Kachelfassung', issuedAt: new Date('2026-09-07T12:00:00.000Z') });
  const tiles = planTiles(snapshot.venue, snapshot.paper, snapshot.scale);
  assert.equal(tiles.length, 3);
  assert.deepEqual(tiles.map(tile => tile.modelX), [0, 8000, 16000]);
  const pdf = await renderConstructionPlan(snapshot);
  const pages = pageBlocks(pdf);
  assert.equal(pages.length, 3);
  assert(pages.every(page => page.lengths.some(length => Math.abs(length - 5) < 0.05)), 'expected 5 mm registration ticks');
  assert(pages.every(page => page.text.includes('Kachelfassung')), pages[0]?.text);
  assert(pages.every(page => page.text.includes('07.09.2026')));
  assert(pages.every(page => page.text.includes('Maßstab 1:50')));
  assert(pages.every(page => page.text.includes('Publikum')));
  assert(pages.every(page => page.text.includes('Überlappung 20 mm')));
  assert(pages[0]?.text.includes('Blatt 1 von 3'), pages[0]?.text);
  assert(pages[1]?.text.includes('Blatt 2 von 3'), pages[1]?.text);
  assert(pages[2]?.text.includes('Blatt 3 von 3'), pages[2]?.text);
  assert(pages[0]?.lengths.some(length => Math.abs(length - 24) < 0.05), 'left wall on Blatt 1');
  assert(pages[1]?.lengths.some(length => Math.abs(length - 24) < 0.05), 'crossing wall on Blatt 2');
  assert(pages[2]?.lengths.some(length => Math.abs(length - 24) < 0.05), 'right wall on Blatt 3');
  assert(pages[0]?.lengths.some(length => Math.abs(length - 24) < 0.05) && pages[1]?.lengths.some(length => Math.abs(length - 24) < 0.05), 'crossing wall retained on both overlapping tiles');
  assert.equal((pages[2]?.lengths ?? []).filter(length => Math.abs(length - 24) < 0.05).length > 0, true);
  const again = await renderConstructionPlan(snapshot);
  assert.equal(pageBlocks(again).length, 3);
  assert.deepEqual(pageBlocks(again).map(page => page.lengths.filter(length => Math.abs(length - 24) < 0.05).length),
    pages.map(page => page.lengths.filter(length => Math.abs(length - 24) < 0.05).length));
});

function angledGroupScene() {
  const type = {
    ...newWallType(randomUUID()), name: 'Türwand',
    openings: [{ id: randomUUID(), left: 200, sill: 0, width: 800, height: 2000 }],
  };
  const front = { ...newWall(randomUUID(), 2000, 3000), typeId: type.id, label: 'Frontwand' };
  const side = { ...newWall(randomUUID(), 2600, 3600), rotation: 90, label: 'Seitenwand' };
  const groupId = randomUUID();
  const layout = formGroup(
    { schemaVersion: 1 as const, wallTypes: [type], walls: [front, side], braces: [] },
    [{ kind: 'wall' as const, id: front.id }, { kind: 'wall' as const, id: side.id }],
    groupId,
  );
  const scene: Scene = {
    id: randomUUID(), name: 'Ansichtsprobe', productionName: 'Beispielproduktion', venueName: 'Beispielsaal',
    revision: 1, productionId: randomUUID(), venueId: randomUUID(), venueVersionId: randomUUID(), venue: { schemaVersion: 1, width: 8000, depth: 6000 },
    lease: null, layout,
  };
  return { scene, groupId, front, side, type };
}

test('a 90° group freezes two labelled elevation faces at known millimetres, not one flattened width', () => {
  const { scene, groupId, front, type } = angledGroupScene();
  const snapshot = freezeSnapshot(scene, {
    id: randomUUID(), name: 'Fassung Ansichten', issuedAt: new Date('2026-09-07T12:00:00.000Z'),
    elevationGroupIds: [groupId],
  });
  assert.deepEqual(snapshot.elevationGroupIds, [groupId]);
  scene.layout.groups = [];
  scene.layout.walls[0]!.x = 9000;
  assert.deepEqual(snapshot.elevationGroupIds, [groupId]);
  assert.equal(snapshot.layout.groups?.[0]?.id, groupId);
  assert.equal(snapshot.layout.walls[0]?.x, 2000);
  const faces = elevationFaces(snapshot);
  assert.equal(faces.length, 2);
  const byFacing = new Map(faces.map(face => [face.facingDegrees, face]));
  const frontFace = byFacing.get(0);
  const sideFace = byFacing.get(90);
  assert.equal(frontFace?.width, 1200);
  assert.equal(frontFace?.height, 2400);
  assert.equal(sideFace?.width, 1200);
  assert.equal(sideFace?.height, 2400);
  assert.equal(faces.some(face => face.width === 2400), false);
  assert.equal(frontFace?.panels.some(panel => panel.wallId === front.id), true);
  assert.deepEqual(frontFace?.panels.find(panel => panel.wallId === front.id)?.openings[0], {
    id: type.openings[0]!.id, left: 200, sill: 0, width: 800, height: 2000,
  });
  assert.equal(sideFace?.panels.every(panel => panel.openings.length === 0), true);
});

test('Bogen elevation openings keep the arch profile through freeze', () => {
  const type = {
    ...newWallType(randomUUID()), name: 'Bogen', thickness: 250,
    openings: [{ id: randomUUID(), left: 200, sill: 0, width: 800, height: 2000, profile: 'arch' as const }],
  };
  const wall = { ...newWall(randomUUID(), 2000, 3000), typeId: type.id, label: 'Bogenwand' };
  const neighbour = { ...newWall(randomUUID(), 3200, 3000), label: 'Nachbar' };
  const groupId = randomUUID();
  const layout = formGroup(
    { schemaVersion: 1 as const, wallTypes: [type], walls: [wall, neighbour], braces: [] },
    [{ kind: 'wall' as const, id: wall.id }, { kind: 'wall' as const, id: neighbour.id }],
    groupId,
  );
  const scene: Scene = {
    id: randomUUID(), name: 'Bogenansicht', productionName: 'Beispielproduktion', venueName: 'Beispielsaal',
    revision: 1, productionId: randomUUID(), venueId: randomUUID(), venueVersionId: randomUUID(),
    venue: { schemaVersion: 1, width: 8000, depth: 6000 }, lease: null, layout,
  };
  const snapshot = freezeSnapshot(scene, {
    id: randomUUID(), name: 'Bogenfassung', issuedAt: new Date('2026-09-07T12:00:00.000Z'),
    elevationGroupIds: [groupId],
  });
  assert.equal(snapshot.resolvedWalls.find(item => item.id === wall.id)?.openings[0]?.profile, 'arch');
  const face = elevationFaces(snapshot).find(item => item.panels.some(panel => panel.wallId === wall.id));
  assert.equal(face?.panels.find(panel => panel.wallId === wall.id)?.openings[0]?.profile, 'arch');
});

test('selected elevation group ids persist on the snapshot and legacy snapshots omit them', () => {
  const { scene, groupId } = angledGroupScene();
  const snapshot = freezeSnapshot(scene, {
    id: randomUUID(), name: 'Fassung Ansichten', issuedAt: new Date('2026-09-07T12:00:00.000Z'),
    elevationGroupIds: [groupId],
  });
  assert.deepEqual(constructionSnapshotSchema.parse(snapshot).elevationGroupIds, [groupId]);
  const { elevationGroupIds: _ids, ...without } = snapshot;
  assert.deepEqual(constructionSnapshotSchema.parse(without).elevationGroupIds, []);
});

test('a 90° group elevation at 1:50 draws 24 mm widths and 48 mm heights on extra pages, not one flattened 48 mm width', async () => {
  const { scene, groupId } = angledGroupScene();
  const snapshot = freezeSnapshot(scene, {
    id: randomUUID(), name: 'Fassung Ansichten', issuedAt: new Date('2026-09-07T12:00:00.000Z'),
    elevationGroupIds: [groupId],
  });
  const pdf = await renderConstructionPlan(snapshot);
  const pages = pageBlocks(pdf);
  const overhead = pages.filter(page => page.text.includes('Konstruktionsplan') && !page.text.includes('Frontansicht'));
  const elevations = pages.filter(page => page.text.includes('Frontansicht'));
  assert.equal(overhead.length, 1, pages.map(page => page.text.slice(0, 80)).join(' | '));
  assert.equal(elevations.length, 1, 'one elevation page for the selected group');
  assert(overhead[0]?.lengths.some(length => Math.abs(length - 24) < 0.05), 'overhead 1200 mm wall stays 24 mm');
  assert(overhead[0]?.text.includes('Maßstab 1:50'), overhead[0]?.text);
  const elevationText = elevations[0]?.text ?? '';
  assert(elevationText.includes('Ansicht 0°'), elevationText);
  assert(elevationText.includes('Ansicht 90°'), elevationText);
  assert(elevationText.includes('2400 mm'), elevationText);
  assert(elevationText.includes('800 mm'), elevationText);
  assert(elevationText.includes('2000 mm'), elevationText);
  assert.equal((elevations[0]?.lengths ?? []).filter(length => Math.abs(length - 24) < 0.05).length >= 2, true, 'two 24 mm face widths');
  assert.equal((elevations[0]?.lengths ?? []).filter(length => Math.abs(length - 48) < 0.05).length >= 2, true, 'two 48 mm panel heights');
  assert((elevations[0]?.lengths ?? []).some(length => Math.abs(length - 16) < 0.05), '800 mm opening is 16 mm');
  assert((elevations[0]?.lengths ?? []).some(length => Math.abs(length - 40) < 0.05), '2000 mm opening is 40 mm');
});

test('export layers omit soft goods and still report matching page counts', async () => {
  const { constructionPageBreakdown, renderConstructionPlan } = await import('../src/server/exports/pdf.js');
  const curtainId = randomUUID();
  const wall = newWall(randomUUID(), 2000, 3000);
  const snapshot = freezeSnapshot({
    id: randomUUID(), name: 'Ebenenprobe', productionName: 'Beispielproduktion', venueName: 'Beispielsaal',
    revision: 1, productionId: randomUUID(), venueId: randomUUID(), venueVersionId: randomUUID(),
    venue: {
      schemaVersion: 1, width: 8000, depth: 6000,
      curtains: [{
        id: curtainId, label: 'Hauptvorhang', x: 4000, y: 5000, rotation: 0,
        length: 6000, height: 4000, bottomClearance: 0, openPercent: 0, opening: 'traveler',
      }],
    },
    lease: null, layout: { schemaVersion: 1, walls: [wall], braces: [] },
  }, {
    id: randomUUID(), name: 'Ohne Softgoods', issuedAt: new Date('2026-09-07T12:00:00.000Z'),
    layers: { softGoods: false, dimensions: false },
  });
  assert.equal(snapshot.layers.softGoods, false);
  const breakdown = constructionPageBreakdown(snapshot);
  assert.equal(breakdown.planPages, 1);
  assert.equal(breakdown.pageCount, breakdown.planPages + breakdown.elevationPages + breakdown.notesPages);
  const text = shownText(await renderConstructionPlan(snapshot));
  assert(!text.includes('Hauptvorhang'), text);
  assert(text.includes('Hinweise'), text);
});
