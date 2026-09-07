import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { freezeSnapshot } from '../src/shared/export.js';
import { newBrace, newWall, type Scene } from '../src/shared/layout.js';
import { AUDIENCE_FLOOR_ID, newPlatform, newStair } from '../src/shared/levels.js';
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
