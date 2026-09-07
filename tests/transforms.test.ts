import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newWall } from '../src/shared/layout.js';
import { stageModel, wallSolid } from '../src/shared/transforms.js';

function assertVec(actual: { x: number; y: number; z: number }, expected: { x: number; y: number; z: number }) {
  assert(Math.abs(actual.x - expected.x) < 1e-8, `x ${actual.x} != ${expected.x}`);
  assert(Math.abs(actual.y - expected.y) < 1e-8, `y ${actual.y} != ${expected.y}`);
  assert(Math.abs(actual.z - expected.z) < 1e-8, `z ${actual.z} != ${expected.z}`);
}

test('a 90° wall maps known millimetre corners onto Y-up 3D positions with front facing audience-right', () => {
  const wall = { ...newWall(randomUUID(), 2000, 3000), rotation: 90 };
  const solid = wallSolid(wall);
  assert.deepEqual(solid.size, { x: 1200, y: 2400, z: 28 });
  assertVec(solid.center, { x: 2000, y: 1200, z: 3000 });
  assert(Math.abs(solid.rotationY - (-Math.PI / 2)) < 1e-8);
  assertVec(solid.frontNormal, { x: 1, y: 0, z: 0 });
  assertVec(solid.corners[0]!, { x: 2014, y: 0, z: 2400 });
  assertVec(solid.corners[1]!, { x: 2014, y: 0, z: 3600 });
  assertVec(solid.corners[2]!, { x: 1986, y: 0, z: 3600 });
  assertVec(solid.corners[3]!, { x: 1986, y: 0, z: 2400 });
  assertVec(solid.corners[4]!, { x: 2014, y: 2400, z: 2400 });
  assertVec(solid.corners[5]!, { x: 2014, y: 2400, z: 3600 });
  assertVec(solid.corners[6]!, { x: 1986, y: 2400, z: 3600 });
  assertVec(solid.corners[7]!, { x: 1986, y: 2400, z: 2400 });
});

test('unrotated plywood faces the audience; audience camera looks into the venue from in front of the downstage edge', () => {
  const wall = newWall(randomUUID(), 2000, 3000);
  const solid = wallSolid(wall);
  assertVec(solid.frontNormal, { x: 0, y: 0, z: -1 });
  assertVec(solid.corners[0]!, { x: 1400, y: 0, z: 2986 });
  const model = stageModel({ schemaVersion: 1, walls: [wall] }, { width: 8000, depth: 6000 });
  assert.equal(model.floor.width, 8000);
  assert.equal(model.floor.depth, 6000);
  assert.equal(model.walls.length, 1);
  assertVec(model.audience.position, { x: 4000, y: 1600, z: -2000 });
  assertVec(model.audience.target, { x: 4000, y: 1200, z: 3000 });
  assertVec(model.orbitTarget, { x: 4000, y: 0, z: 3000 });
});
