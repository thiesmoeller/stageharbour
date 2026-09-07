import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newBrace, newWall } from '../src/shared/layout.js';
import { AUDIENCE_FLOOR_ID, newPlatform, newStair } from '../src/shared/levels.js';
import { newWallType } from '../src/shared/wall-types.js';
import { braceSolid } from '../src/shared/braceTransforms.js';
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
  const model = stageModel({ schemaVersion: 1, walls: [wall], braces: [] }, { width: 8000, depth: 6000 });
  assert.equal(model.floor.width, 8000);
  assert.equal(model.floor.depth, 6000);
  assert.equal(model.walls.length, 1);
  assert.equal(model.braces.length, 0);
  assertVec(model.audience.position, { x: 4000, y: 1600, z: -2000 });
  assertVec(model.audience.target, { x: 4000, y: 1200, z: 3000 });
  assertVec(model.orbitTarget, { x: 4000, y: 0, z: 3000 });
});

test('stage model carries known opening millimetres from the wall type', () => {
  const type = { ...newWallType(randomUUID()), openings: [{ id: randomUUID(), left: 200, sill: 0, width: 800, height: 2000 }] };
  const wall = { ...newWall(randomUUID(), 2000, 3000), typeId: type.id, width: 1, height: 1, thickness: 1 };
  const solid = stageModel({ schemaVersion: 1, wallTypes: [type], walls: [wall], braces: [] }, { width: 8000, depth: 6000 }).walls[0]!;
  assert.deepEqual(solid.size, { x: 1200, y: 2400, z: 28 });
  assert.equal(solid.openings[0]?.width, 800);
  assert.equal(solid.openings[0]?.height, 2000);
  assert.equal(solid.openings[0]?.left, 200);
  assert.equal(solid.openings[0]?.sill, 0);
});
test('a known millimetre brace footprint maps to a triangular 3D solid independently of Three.js', () => {
  const brace = newBrace(randomUUID(), 2000, 3000);
  const solid = braceSolid(brace);
  assert.deepEqual(solid.size, { x: 600, y: 1800, z: 800 });
  assertVec(solid.center, { x: 2000, y: 900, z: 3000 });
  assert(Math.abs(solid.rotationY) < 1e-8);
  assertVec(solid.footprint[0]!, { x: 1700, y: 0, z: 2600 });
  assertVec(solid.footprint[1]!, { x: 2300, y: 0, z: 2600 });
  assertVec(solid.footprint[2]!, { x: 2300, y: 0, z: 3400 });
  assertVec(solid.footprint[3]!, { x: 1700, y: 0, z: 3400 });
  assertVec(solid.ridge[0]!, { x: 1700, y: 1800, z: 2600 });
  assertVec(solid.ridge[1]!, { x: 2300, y: 1800, z: 2600 });
  const rotated = braceSolid({ ...brace, rotation: 90 });
  assert(Math.abs(rotated.rotationY - (-Math.PI / 2)) < 1e-8);
  assertVec(rotated.footprint[0]!, { x: 2400, y: 0, z: 2700 });
  const model = stageModel({ schemaVersion: 1, walls: [], braces: [brace] }, { width: 8000, depth: 6000 });
  assert.equal(model.braces.length, 1);
  assert.equal(model.braces[0]!.id, brace.id);
});

test('a wall on a 400 mm platform sits 400 mm above the audience floor; missing surface stays at 0', () => {
  const platform = newPlatform(randomUUID(), 4000, 4750);
  platform.elevation = 400;
  const raised = { ...newWall(randomUUID(), 4000, 5000), supportingSurfaceId: platform.id };
  const floating = newWall(randomUUID(), 4000, 5000);
  delete (floating as { supportingSurfaceId?: string }).supportingSurfaceId;
  const venue = { schemaVersion: 1 as const, width: 8000, depth: 6000, platforms: [platform] };
  const model = stageModel({ schemaVersion: 1, walls: [raised, floating], braces: [] }, venue);
  assertVec(model.walls[0]!.center, { x: 4000, y: 1600, z: 5000 });
  assertVec(model.walls[0]!.corners[0]!, { x: 3400, y: 400, z: 4986 });
  assertVec(model.walls[1]!.center, { x: 4000, y: 1200, z: 5000 });
  assertVec(model.walls[1]!.corners[0]!, { x: 3400, y: 0, z: 4986 });
  assert.equal(model.platforms[0]?.elevation, 400);
  const stair = newStair(randomUUID(), AUDIENCE_FLOOR_ID, platform.id, 4000, 2500);
  const withStairs = stageModel({ schemaVersion: 1, walls: [], braces: [], stairs: [stair] }, venue);
  assert.equal(withStairs.stairs[0]?.rise, 400);
  assert.equal(withStairs.stairs[0]?.steps.length, 2);
  assert.equal(withStairs.stairs[0]?.steps[0]?.height, 200);
});
