import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { validateGlb } from '../src/server/assets/glb.js';
import { stageElements } from '../src/client/editor/stageElements.js';
import { modelDimensionsFromReference } from '../src/shared/assets.js';
import { newWall } from '../src/shared/layout.js';
import { placeholderCorners as propCorners } from '../src/shared/placeholders.js';
import { cubeGlb } from './helpers/model.js';

test('GLB uploads validate framing and require embedded resources', () => {
  assert.doesNotThrow(() => validateGlb(cubeGlb()));
  assert.throws(() => validateGlb(cubeGlb('https://example.com/model.bin')));
  assert.throws(() => validateGlb(cubeGlb().subarray(0, 30)));
  const invalid = cubeGlb(); invalid.writeUInt32LE(0xffffffff, 12);
  assert.throws(() => validateGlb(invalid));
});

test('one known millimetre length scales a GLB bounding box uniformly', () => {
  const dims = modelDimensionsFromReference({ x: 2, y: 1, z: 0.5 }, 'height', 900);
  assert.deepEqual(dims, { width: 1800, height: 900, depth: 450 });
  assert.throws(() => modelDimensionsFromReference({ x: 0, y: 1, z: 1 }, 'width', 1000));
});
test('Raumsicht elements retain physical panel dimensions, IDs and freely rotated model footprints', () => {
  const wall = {
    ...newWall(randomUUID(), 2500, 3000),
    rotation: 37,
    surfaces: { front: { full: { kind: 'library' as const, ref: 'library:color-white' } } },
  };
  const prop = { id: randomUUID(), assetId: randomUUID(), label: 'Tisch', x: 4000, y: 3000, kind: 'box' as const, rotation: 90, width: 2000, depth: 1000, height: 800 };
  const layout = { schemaVersion: 1 as const, walls: [wall], braces: [], placeholders: [prop] };
  const before = structuredClone(layout), projected = stageElements(layout);
  assert.equal(projected.length, 2);
  assert.deepEqual(projected[0], { id: wall.id, scope: 'scene', element: { kind: 'wall', value: wall } });
  assert.equal(projected[0]?.element.value, wall, 'the saved element is passed through, not copied');
  assert.deepEqual(projected[1], { id: prop.id, scope: 'scene', element: { kind: 'placeholder', value: prop } });
  assert.deepEqual(layout, before);
  const corners = propCorners(prop);
  assert.equal(Math.max(...corners.map(p => p.x)) - Math.min(...corners.map(p => p.x)), 1000);
  assert.equal(Math.max(...corners.map(p => p.y)) - Math.min(...corners.map(p => p.y)), 2000);
});

test('Raumsicht elements include permanent venue chairs once, separate from scene placeholders', () => {
  const venueChair = { id: randomUUID(), label: 'Parkett 1', x: 1200, y: 800, kind: 'chair' as const, rotation: 0, width: 450, depth: 450, height: 900 };
  const sceneTable = { id: randomUUID(), label: 'Probetisch', x: 4000, y: 3000, kind: 'table' as const, rotation: 0, width: 1200, depth: 800, height: 750 };
  const venue = { schemaVersion: 1 as const, width: 8000, depth: 6000, placeholders: [venueChair] };
  const layout = { schemaVersion: 1 as const, walls: [], braces: [], placeholders: [sceneTable] };
  const projected = stageElements(layout, venue);
  const placeholders = projected.filter(node => node.element.kind === 'placeholder');
  assert.equal(placeholders.length, 2);
  assert.deepEqual(projected.map(node => node.id), [venueChair.id, sceneTable.id], 'permanent venue elements come first');
  const venueNode = placeholders.find(node => node.element.value.id === venueChair.id);
  const sceneNode = placeholders.find(node => node.element.value.id === sceneTable.id);
  assert.equal(venueNode?.scope, 'venue');
  assert.equal(sceneNode?.scope, 'scene');
});

test('Raumsicht elements show scene cable runs beside venue corridors', () => {
  const run = {
    id: randomUUID(), label: 'FOH', purpose: 'power' as const, cableType: 'Schuko', quantity: 1, slackMm: 0,
    start: { label: 'A', x: 0, y: 0 }, end: { label: 'B', x: 4000, y: 0 },
    path: [{ x: 0, y: 0 }, { x: 2000, y: 500 }, { x: 4000, y: 0 }],
  };
  const corridor = {
    id: randomUUID(), label: 'Korridor',
    path: [{ x: 100, y: 100 }, { x: 3000, y: 100 }],
  };
  const projected = stageElements(
    { schemaVersion: 1 as const, walls: [], braces: [], cableRuns: [run] },
    { schemaVersion: 1 as const, width: 8000, depth: 6000, cableRoutingCorridors: [corridor] },
  );
  const cable = projected.find(item => item.element.kind === 'cableRun');
  const venueCorridor = projected.find(item => item.element.kind === 'corridor');
  assert.equal(cable?.scope, 'scene');
  assert.deepEqual(cable?.element, { kind: 'cableRun', value: run });
  assert.equal(venueCorridor?.scope, 'venue');
  assert.equal(venueCorridor?.element.kind, 'corridor');
});
