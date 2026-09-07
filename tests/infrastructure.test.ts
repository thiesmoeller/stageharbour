import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  cableRoutingCorridorSchema, connectionPointSchema, newCableRoutingCorridor, newConnectionPoint,
} from '../src/shared/infrastructure.js';
import { freezeSnapshot } from '../src/shared/export.js';
import { venueGeometrySchema } from '../src/shared/layout.js';

test('labelled power and audio pins keep known millimetre positions and optional notes', () => {
  const power = connectionPointSchema.parse({
    id: randomUUID(), kind: 'power', label: 'Lichtstrom', x: 2500, y: 1800, notes: '16A an der Bühnenkante',
  });
  assert.equal(power.kind, 'power');
  assert.equal(power.x, 2500);
  assert.equal(power.y, 1800);
  assert.equal(power.notes, '16A an der Bühnenkante');
  const audio = connectionPointSchema.parse(newConnectionPoint(randomUUID(), 'audio', 4100, 600));
  assert.equal(audio.kind, 'audio');
  assert.equal(audio.label, 'Audio');
  assert.equal(audio.x, 4100);
  assert.equal(audio.y, 600);
  assert.equal(audio.notes, undefined);
});

test('drawable corridors keep known millimetre vertices and optional notes', () => {
  const path = [{ x: 0, y: 1200 }, { x: 4000, y: 1200 }, { x: 4000, y: 2800 }];
  const corridor = cableRoutingCorridorSchema.parse({
    id: randomUUID(), label: 'Seitenbühne', path, notes: 'am Boden entlang',
  });
  assert.deepEqual(corridor.path, path);
  assert.equal(corridor.notes, 'am Boden entlang');
  const drawn = cableRoutingCorridorSchema.parse(newCableRoutingCorridor(randomUUID(), [
    { x: 200, y: 200 }, { x: 200, y: 5000 },
  ]));
  assert.equal(drawn.label, 'Kabelkorridor');
  assert.deepEqual(drawn.path, [{ x: 200, y: 200 }, { x: 200, y: 5000 }]);
});

test('rejects unlabelled pins, unknown kinds, degenerate corridors and duplicate IDs', () => {
  const id = randomUUID();
  assert(!connectionPointSchema.safeParse({
    id, kind: 'power', label: '  ', x: 0, y: 0,
  }).success);
  assert(!connectionPointSchema.safeParse({
    id, kind: 'network', label: 'Netz', x: 0, y: 0,
  }).success);
  assert(!connectionPointSchema.safeParse({
    id, kind: 'power', label: 'Strom', x: Infinity, y: 0,
  }).success);
  assert(!cableRoutingCorridorSchema.safeParse({
    id, label: 'Weg', path: [{ x: 0, y: 0 }],
  }).success);
  assert(!cableRoutingCorridorSchema.safeParse({
    id, label: 'Weg', path: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
  }).success);
  assert(!venueGeometrySchema.safeParse({
    schemaVersion: 1, width: 8000, depth: 6000,
    connectionPoints: [
      { id, kind: 'power', label: 'A', x: 0, y: 0 },
      { id, kind: 'audio', label: 'B', x: 10, y: 10 },
    ],
  }).success);
  assert(!venueGeometrySchema.safeParse({
    schemaVersion: 1, width: 8000, depth: 6000,
    cableRoutingCorridors: [
      { id, label: 'A', path: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
      { id, label: 'B', path: [{ x: 0, y: 100 }, { x: 100, y: 100 }] },
    ],
  }).success);
});

test('venue geometry stores pins and corridors without requiring electrical inventory fields', () => {
  const pin = newConnectionPoint(randomUUID(), 'power', 2500, 1800);
  const corridor = newCableRoutingCorridor(randomUUID(), [{ x: 0, y: 1200 }, { x: 4000, y: 1200 }]);
  const venue = venueGeometrySchema.parse({
    schemaVersion: 1, width: 8000, depth: 6000, connectionPoints: [pin], cableRoutingCorridors: [corridor],
  });
  assert.deepEqual(venue.connectionPoints, [pin]);
  assert.deepEqual(venue.cableRoutingCorridors, [corridor]);
  assert.equal('panelId' in pin, false);
  assert.equal('loadA' in pin, false);
  assert.equal('lengthMm' in corridor, false);
});

test('freeze copies venue pins so later edits cannot change the snapshot', () => {
  const pin = newConnectionPoint(randomUUID(), 'power', 2500, 1800);
  const corridor = newCableRoutingCorridor(randomUUID(), [{ x: 0, y: 1200 }, { x: 4000, y: 1200 }]);
  const scene = {
    id: randomUUID(), name: 'Erste Szene', productionName: 'Beispielproduktion', venueName: 'Beispielsaal',
    revision: 1, venueVersionId: randomUUID(),
    venue: { schemaVersion: 1 as const, width: 8000, depth: 6000, connectionPoints: [pin], cableRoutingCorridors: [corridor] },
    lease: null, layout: { schemaVersion: 1 as const, walls: [], braces: [] },
  };
  const snapshot = freezeSnapshot(scene, { id: randomUUID(), name: 'Fassung Probe', issuedAt: new Date('2026-09-07T12:00:00.000Z') });
  scene.venue.connectionPoints[0]!.x = 1;
  scene.venue.cableRoutingCorridors[0]!.path[1]!.x = 1;
  assert.equal(snapshot.venue.connectionPoints?.[0]?.x, 2500);
  assert.equal(snapshot.venue.cableRoutingCorridors?.[0]?.path[1]?.x, 4000);
});
