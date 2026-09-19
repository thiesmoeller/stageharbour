import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  applyPushPull, classifyLocalFace, growCentered, localNormalFromWorld, resolvePushPullFace,
} from '../src/shared/pushPull.js';
import { newWall } from '../src/shared/layout.js';
import { AUDIENCE_FLOOR_ID, newPlatform, newStair, stairSteps, supportingSurfaces } from '../src/shared/levels.js';
import { newOverheadBox } from '../src/shared/overhead.js';
import { newPlaceholder } from '../src/shared/placeholders.js';

test('world face normals map into local box axes including plan rotation and X-mirror', () => {
  assert.equal(classifyLocalFace({ x: 0, y: 1, z: 0 }), 'py');
  assert.equal(classifyLocalFace({ x: 0, y: -1, z: 0 }), 'ny');
  // Unrotated: world +Z is local +Z (thickness / depth).
  assert.deepEqual(localNormalFromWorld({ x: 0, y: 0, z: 1 }, 0, false), { x: 0, y: 0, z: 1 });
  assert.equal(classifyLocalFace(localNormalFromWorld({ x: 0, y: 0, z: 1 }, 0, false)), 'pz');
  // Mesh uses rotationY = -planRotation: at 90°, local +X (width) lands on world +Z.
  assert.equal(classifyLocalFace(localNormalFromWorld({ x: 0, y: 0, z: 1 }, 90, false)), 'px');
  // World +X at 90° is local −Z (thickness−).
  assert.equal(classifyLocalFace(localNormalFromWorld({ x: 1, y: 0, z: 0 }, 90, false)), 'nz');
  // Mirror flips displayed X; un-mirror before un-rotating.
  assert.equal(classifyLocalFace(localNormalFromWorld({ x: -1, y: 0, z: 0 }, 0, true)), 'px');
  assert.equal(classifyLocalFace(localNormalFromWorld({ x: 0, y: 0, z: 1 }, 90, true)), 'px');
});

test('push-pull grows a rotated podium side face along its local width axis', () => {
  const platform = {
    ...newPlatform(randomUUID(), 4000, 3000),
    outline: [
      { x: 4000, y: 1000 }, { x: 4000, y: 5000 }, { x: 1500, y: 5000 }, { x: 1500, y: 1000 },
    ],
  };
  // 90° outline: local +X is plan +Y. Pulling px grows max Y with min Y fixed.
  const venue = { schemaVersion: 1 as const, width: 8000, depth: 6000, platforms: [platform] };
  const worldHit = localNormalFromWorld({ x: 0, y: 0, z: 1 }, 90, true);
  assert.equal(classifyLocalFace(worldHit), 'px');
  const wider = applyPushPull(venue, { kind: 'platform', id: platform.id, face: 'px' }, 200);
  const ys = wider.platforms![0]!.outline.map(point => point.y);
  const xs = wider.platforms![0]!.outline.map(point => point.x);
  assert.ok(Math.abs(Math.min(...ys) - 1000) < 1e-6);
  assert.ok(Math.abs(Math.max(...ys) - 5200) < 1e-6);
  assert.ok(Math.abs(Math.min(...xs) - 1500) < 1e-6);
  assert.ok(Math.abs(Math.max(...xs) - 4000) < 1e-6);
});

test('growing a face keeps the opposite face fixed in millimetres', () => {
  assert.deepEqual(growCentered(1200, 4000, 200, 1), { size: 1400, center: 4100 });
  assert.deepEqual(growCentered(1200, 4000, 200, -1), { size: 1400, center: 3900 });
  assert.deepEqual(growCentered(28, 0, -10, 1), { size: 18, center: -5 });
});

test('push-pull on a rotated venue wall grows height, width and thickness from the dragged face', () => {
  const wall = { ...newWall(randomUUID(), 4000, 3000), rotation: 90, width: 1200, height: 2400, thickness: 28 };
  const venue = { schemaVersion: 1 as const, width: 8000, depth: 6000, walls: [wall] };
  const taller = applyPushPull(venue, resolvePushPullFace({ kind: 'wall', id: wall.id, face: 'py' })!, 100);
  assert.equal(taller.walls![0]!.height, 2500);
  assert.equal(taller.walls![0]!.x, wall.x);
  assert.equal(taller.walls![0]!.y, wall.y);
  // Local +X is width; at 90° that shifts plan Y.
  const wider = applyPushPull(venue, resolvePushPullFace({ kind: 'wall', id: wall.id, face: 'px' })!, 200);
  assert.equal(wider.walls![0]!.width, 1400);
  assert.equal(wider.walls![0]!.y, 3100);
  assert.equal(wider.walls![0]!.x, 4000);
  const thicker = applyPushPull(venue, resolvePushPullFace({ kind: 'wall', id: wall.id, face: 'pz' })!, 12);
  assert.equal(thicker.walls![0]!.thickness, 40);
  assert.equal(thicker.walls![0]!.x, 3994);
});

test('push-pull raises a podium and extrudes overhead / chair faces with opposite face fixed', () => {
  const platform = newPlatform(randomUUID(), 4000, 3000);
  platform.elevation = 400;
  const box = { ...newOverheadBox(randomUUID(), 2000, 2000), rotation: 90 };
  const chair = newPlaceholder('chair', randomUUID(), 1000, 1000);
  const venue = {
    schemaVersion: 1 as const, width: 8000, depth: 6000,
    platforms: [platform], overheadBoxes: [box], placeholders: [chair],
  };
  const raised = applyPushPull(venue, resolvePushPullFace({ kind: 'platform', id: platform.id, face: 'py' })!, 50);
  assert.equal(raised.platforms![0]!.elevation, 450);
  const duct = applyPushPull(venue, resolvePushPullFace({ kind: 'overhead', id: box.id, face: 'py' })!, 100);
  assert.equal(duct.overheadBoxes![0]!.thickness, box.thickness + 100);
  assert.equal(duct.overheadBoxes![0]!.bottomHeight, box.bottomHeight);
  const lowered = applyPushPull(venue, resolvePushPullFace({ kind: 'overhead', id: box.id, face: 'ny' })!, 100);
  assert.equal(lowered.overheadBoxes![0]!.bottomHeight, box.bottomHeight - 100);
  assert.equal(lowered.overheadBoxes![0]!.thickness, box.thickness + 100);
  const seat = applyPushPull(venue, resolvePushPullFace({ kind: 'placeholder', id: chair.id, face: 'py' })!, 50);
  assert.equal(seat.placeholders![0]!.height, chair.height + 50);
});

test('push-pull grows podium footprint from a side face while keeping the opposite face fixed', () => {
  const platform = newPlatform(randomUUID(), 4000, 3000);
  // Default outline: x 2000..6000 (width 4000), y 1750..4250 (depth 2500).
  const venue = { schemaVersion: 1 as const, width: 8000, depth: 6000, platforms: [platform] };
  assert.ok(resolvePushPullFace({ kind: 'platform', id: platform.id, face: 'px' }));
  const wider = applyPushPull(venue, { kind: 'platform', id: platform.id, face: 'px' }, 200);
  const outline = wider.platforms![0]!.outline;
  const xs = outline.map(point => point.x);
  const ys = outline.map(point => point.y);
  assert.equal(Math.min(...xs), 2000); // -X face fixed
  assert.equal(Math.max(...xs), 6200); // +X face moved out
  assert.equal(Math.min(...ys), 1750);
  assert.equal(Math.max(...ys), 4250);
  assert.equal(wider.platforms![0]!.elevation, platform.elevation);

  const deeper = applyPushPull(venue, { kind: 'platform', id: platform.id, face: 'nz' }, 100);
  const deepYs = deeper.platforms![0]!.outline.map(point => point.y);
  assert.equal(Math.max(...deepYs), 4250); // +Y face fixed
  assert.equal(Math.min(...deepYs), 1650); // -Y face moved out
});

test('pulling a stair up raises its upper podium and adds DIN ~16 cm steps', () => {
  const platform = newPlatform(randomUUID(), 4000, 4000);
  platform.elevation = 320; // 320 / 160 = 2 steps
  const stair = newStair(randomUUID(), AUDIENCE_FLOOR_ID, platform.id, 4000, 2500);
  const venue = { schemaVersion: 1 as const, width: 8000, depth: 6000, platforms: [platform], stairs: [stair] };
  const before = stairSteps(stair, supportingSurfaces(venue));
  assert.equal(before.length, 2);

  const raised = applyPushPull(venue, { kind: 'stair', id: stair.id, face: 'py' }, 160);
  assert.equal(raised.platforms![0]!.elevation, 480);
  assert.equal(raised.stairs![0]!.riserHeight, 160);
  const after = stairSteps(raised.stairs![0]!, supportingSurfaces(raised));
  assert.equal(after.length, 3);
});

test('Bühnenelement push-pull snaps plan size to 0.5 m module grid', () => {
  const platform = {
    ...newPlatform(randomUUID(), 3000, 2000),
    style: 'stageDeck' as const,
    elevation: 400,
    outline: [
      { x: 2000, y: 1500 }, { x: 4000, y: 1500 }, { x: 4000, y: 2500 }, { x: 2000, y: 2500 },
    ],
  };
  const venue = { schemaVersion: 1 as const, width: 10000, depth: 8000, platforms: [platform] };
  // 2×1 m deck; small pull should not move off the grid until past the midpoint.
  const tiny = applyPushPull(venue, { kind: 'platform', id: platform.id, face: 'px' }, 100);
  const tinyXs = tiny.platforms![0]!.outline.map(point => point.x);
  assert.equal(Math.max(...tinyXs) - Math.min(...tinyXs), 2000);
  const wider = applyPushPull(venue, { kind: 'platform', id: platform.id, face: 'px' }, 300);
  const widerXs = wider.platforms![0]!.outline.map(point => point.x);
  const widerYs = wider.platforms![0]!.outline.map(point => point.y);
  assert.equal(Math.max(...widerXs) - Math.min(...widerXs), 2500);
  assert.equal(Math.min(...widerXs), 2000);
  assert.equal(Math.max(...widerYs) - Math.min(...widerYs), 1000);
});
