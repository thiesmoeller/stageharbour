import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { validateGlb } from '../src/server/assets/glb.js';
import { pascalScene } from '../src/client/editor/pascalScene.js';
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
test('Pascal projection retains physical panel dimensions, IDs and freely rotated model footprints', () => {
  const wall = { ...newWall(randomUUID(), 2500, 3000), rotation: 37, finish: 'library:color-white' };
  const prop = { id: randomUUID(), assetId: randomUUID(), label: 'Tisch', x: 4000, y: 3000, kind: 'box' as const, rotation: 90, width: 2000, depth: 1000, height: 800 };
  const layout = { schemaVersion: 1 as const, walls: [wall], braces: [], placeholders: [prop] };
  const before = structuredClone(layout), projected = pascalScene(layout);
  assert.equal(projected.rootNodeIds.length, 2);
  assert.deepEqual(Object.values(projected.nodes)[0]?.element, { kind: 'wall', value: wall });
  assert.equal(Object.values(projected.nodes)[0]?.type, 'stage-object');
  assert.deepEqual(layout, before);
  const corners = propCorners(prop);
  assert.equal(Math.max(...corners.map(p => p.x)) - Math.min(...corners.map(p => p.x)), 1000);
  assert.equal(Math.max(...corners.map(p => p.y)) - Math.min(...corners.map(p => p.y)), 2000);
});

test('Pascal projection includes permanent venue chairs once, separate from scene placeholders', () => {
  const venueChair = { id: randomUUID(), label: 'Parkett 1', x: 1200, y: 800, kind: 'chair' as const, rotation: 0, width: 450, depth: 450, height: 900 };
  const sceneTable = { id: randomUUID(), label: 'Probetisch', x: 4000, y: 3000, kind: 'table' as const, rotation: 0, width: 1200, depth: 800, height: 750 };
  const venue = { schemaVersion: 1 as const, width: 8000, depth: 6000, placeholders: [venueChair] };
  const layout = { schemaVersion: 1 as const, walls: [], braces: [], placeholders: [sceneTable] };
  const projected = pascalScene(layout, venue);
  const placeholders = Object.values(projected.nodes).filter(node => node.element.kind === 'placeholder');
  assert.equal(placeholders.length, 2);
  const venueNode = placeholders.find(node => node.element.value.id === venueChair.id);
  const sceneNode = placeholders.find(node => node.element.value.id === sceneTable.id);
  assert.equal(venueNode?.scope, 'venue');
  assert.equal(sceneNode?.scope, 'scene');
});
