import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  applyPushPull, classifyLocalFace, growCentered, localNormalFromWorld, resolvePushPullFace,
} from '../src/shared/pushPull.js';
import { newWall } from '../src/shared/layout.js';
import { newPlatform } from '../src/shared/levels.js';
import { newOverheadBox } from '../src/shared/overhead.js';
import { newPlaceholder } from '../src/shared/placeholders.js';

test('world face normals map into local box axes including plan rotation and X-mirror', () => {
  assert.equal(classifyLocalFace({ x: 0, y: 1, z: 0 }), 'py');
  assert.equal(classifyLocalFace({ x: 0, y: -1, z: 0 }), 'ny');
  // Unrotated: world +Z is local +Z (thickness / depth).
  assert.deepEqual(localNormalFromWorld({ x: 0, y: 0, z: 1 }, 0, false), { x: 0, y: 0, z: 1 });
  assert.equal(classifyLocalFace(localNormalFromWorld({ x: 0, y: 0, z: 1 }, 0, false)), 'pz');
  // 90° plan rotation: world +X becomes local +Z.
  const turned = localNormalFromWorld({ x: 1, y: 0, z: 0 }, 90, false);
  assert.equal(classifyLocalFace(turned), 'pz');
  // Mirror flips world X before un-rotating.
  const mirrored = localNormalFromWorld({ x: -1, y: 0, z: 0 }, 0, true);
  assert.equal(classifyLocalFace(mirrored), 'px');
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
