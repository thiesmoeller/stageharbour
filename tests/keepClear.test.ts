import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  EXAMPLE_KEEP_CLEAR_DEPTH, EXAMPLE_KEEP_CLEAR_REASON, EXAMPLE_KEEP_CLEAR_WIDTH,
  KEEP_CLEAR_CONTACT_TOLERANCE_MM, keepClearWarnings, keepClearZoneSchema, keepClearZonesSchema,
  newKeepClearZone,
} from '../src/shared/keepClear.js';
import { newBrace, newWall } from '../src/shared/layout.js';
import { AUDIENCE_FLOOR_ID, newPlatform, newStair } from '../src/shared/levels.js';

test('a keep-clear zone is a labelled polygon with a reason and a supporting surface', () => {
  const id = randomUUID();
  const zone = keepClearZoneSchema.parse({
    id, label: 'Notausgang Ost', reason: 'Notausgang', supportingSurfaceId: AUDIENCE_FLOOR_ID,
    polygon: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 1000 }, { x: 0, y: 1000 }],
  });
  assert.equal(zone.label, 'Notausgang Ost');
  assert.equal(zone.reason, 'Notausgang');
  assert.equal(zone.supportingSurfaceId, AUDIENCE_FLOOR_ID);
  assert.deepEqual(zone.polygon[2], { x: 2000, y: 1000 });
  const example = newKeepClearZone(id, AUDIENCE_FLOOR_ID, 4000, 3000);
  assert.equal(example.reason, EXAMPLE_KEEP_CLEAR_REASON);
  assert.equal(EXAMPLE_KEEP_CLEAR_WIDTH, 2000);
  assert.equal(EXAMPLE_KEEP_CLEAR_DEPTH, 1000);
  assert.deepEqual(example.polygon[0], { x: 3000, y: 2500 });
  assert.deepEqual(example.polygon[2], { x: 5000, y: 3500 });
  assert.equal(KEEP_CLEAR_CONTACT_TOLERANCE_MM, 1);
  assert(!keepClearZoneSchema.safeParse({ ...zone, polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }).success);
  assert(!keepClearZoneSchema.safeParse({ ...zone, reason: '  ' }).success);
  assert(!keepClearZonesSchema.safeParse([zone, zone]).success);
});

const exitZone = {
  id: randomUUID(), label: 'Notausgang Ost', reason: 'Notausgang', supportingSurfaceId: AUDIENCE_FLOOR_ID,
  polygon: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 1000 }, { x: 0, y: 1000 }],
};
const venue = { schemaVersion: 1 as const, width: 8000, depth: 6000, keepClearZones: [exitZone] };

test('a rotated wall overlapping a keep-clear zone is named in the warning', () => {
  const wall = { ...newWall(randomUUID(), 2000, 500), rotation: 45, label: 'Bühnenwand' };
  const warnings = keepClearWarnings(venue, { walls: [wall], braces: [] });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.kind, 'keep-clear-overlap');
  assert.equal(warnings[0]?.zoneId, exitZone.id);
  assert.equal(warnings[0]?.objectId, wall.id);
  assert.equal(warnings[0]?.objectKind, 'wall');
  assert.match(warnings[0]?.message ?? '', /Notausgang Ost/);
  assert.match(warnings[0]?.message ?? '', /Bühnenwand/);
});

test('a brace overlapping a keep-clear zone is named in the warning', () => {
  const brace = { ...newBrace(randomUUID(), 1000, 500), label: 'Hintere Stütze' };
  const warnings = keepClearWarnings(venue, { walls: [], braces: [brace] });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.objectKind, 'brace');
  assert.match(warnings[0]?.message ?? '', /Notausgang Ost/);
  assert.match(warnings[0]?.message ?? '', /Hintere Stütze/);
});

test('an object on a different supporting surface does not warn even when the plan footprints overlap', () => {
  const platform = newPlatform(randomUUID(), 1000, 500);
  const wall = { ...newWall(randomUUID(), 1000, 500), supportingSurfaceId: platform.id, label: 'Auf dem Podest' };
  const warnings = keepClearWarnings(venue, { walls: [wall], braces: [] });
  assert.deepEqual(warnings, []);
});

test('boundary contact within KEEP_CLEAR_CONTACT_TOLERANCE_MM warns; a 2 mm gap does not', () => {
  assert.equal(KEEP_CLEAR_CONTACT_TOLERANCE_MM, 1);
  // Zone top edge is y = 1000. A 28 mm-thick wall centred at y = 1014 has its south face on that edge.
  const touching = { ...newWall(randomUUID(), 1000, 1014), label: 'Kante' };
  const withinTolerance = { ...newWall(randomUUID(), 1000, 1015), label: 'Ein Millimeter' };
  const clear = { ...newWall(randomUUID(), 1000, 1016), label: 'Zwei Millimeter' };
  assert.equal(keepClearWarnings(venue, { walls: [touching], braces: [] }).length, 1);
  assert.equal(keepClearWarnings(venue, { walls: [withinTolerance], braces: [] }).length, 1);
  assert.deepEqual(keepClearWarnings(venue, { walls: [clear], braces: [] }), []);
});

test('a movable platform or stair overlapping a floor keep-clear zone warns; a stair on unrelated surfaces does not', () => {
  const platform = { ...newPlatform(randomUUID(), 1000, 500), label: 'Fahrbares Podest' };
  const stair = { ...newStair(randomUUID(), AUDIENCE_FLOOR_ID, platform.id, 1000, 500), label: 'Bühnentreppe' };
  const other = newPlatform(randomUUID(), 7000, 5000);
  const elsewhere = { ...newStair(randomUUID(), other.id, randomUUID(), 7000, 5000), label: 'Andere Treppe' };
  const overlapping = keepClearWarnings(venue, { walls: [], braces: [], platforms: [platform], stairs: [stair] });
  assert.equal(overlapping.some(item => item.objectId === platform.id), true);
  assert.equal(overlapping.some(item => item.objectId === stair.id), true);
  assert.match(overlapping.find(item => item.objectId === platform.id)?.message ?? '', /Fahrbares Podest/);
  const isolated = keepClearWarnings(venue, { walls: [], braces: [], stairs: [elsewhere] });
  assert.deepEqual(isolated, []);
});
