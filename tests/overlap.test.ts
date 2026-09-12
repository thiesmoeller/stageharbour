import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newWall, type Layout } from '../src/shared/layout.js';
import { newPlatform } from '../src/shared/levels.js';
import {
  objectOverlapWarnings, placementOverlaps, polygonIntersectionArea, polygonPenetration,
  polygonsInteriorOverlap, platformFootprint, wallFootprint,
} from '../src/shared/overlap.js';

test('edge-flush walls do not count as interior overlap', () => {
  const left = wallCornersOf(newWall(randomUUID(), 0, 0));
  const right = wallCornersOf({ ...newWall(randomUUID(), 1200, 0) }); // centres 1200 apart, width 1200 → ends touch
  assert.equal(polygonsInteriorOverlap(left, right), false);
  assert.ok(polygonPenetration(left, right) <= 1);
});

test('crossing walls count as interior overlap', () => {
  const a = wallCornersOf(newWall(randomUUID(), 0, 0));
  const b = wallCornersOf({ ...newWall(randomUUID(), 0, 0), rotation: 90 });
  assert.equal(polygonsInteriorOverlap(a, b), true);
  assert.ok(polygonIntersectionArea(a, b) > 400);
});

test('angled tip on a wall face is contact, not an overlap warning', () => {
  const horizontal = wallCornersOf(newWall(randomUUID(), 2000, 3000));
  const frontY = 3000 - 14;
  const angled = placeTip(28, 2000, frontY);
  assert.equal(polygonsInteriorOverlap(horizontal, wallCornersOf(angled)), false);
  assert.ok(polygonPenetration(horizontal, wallCornersOf(angled)) > 10);
  assert.ok(polygonIntersectionArea(horizontal, wallCornersOf(angled)) < 400);
  assert.equal(
    objectOverlapWarnings({ schemaVersion: 1, walls: [newWall(randomUUID(), 2000, 3000), angled], braces: [] }).length,
    0,
  );
});

test('a wall driven through another still counts as overlap', () => {
  const horizontal = wallCornersOf(newWall(randomUUID(), 2000, 3000));
  const through = placeTip(28, 2000, 3000); // tip on centreline → full panel bite
  assert.equal(polygonsInteriorOverlap(horizontal, wallCornersOf(through)), true);
});

test('placementOverlaps rejects a wall dropped on top of another', () => {
  const a = newWall(randomUUID(), 0, 0);
  const layout: Layout = { schemaVersion: 1, walls: [a], braces: [] };
  const b = { ...newWall(randomUUID(), 50, 0) };
  assert.equal(placementOverlaps(layout, wallFootprint(b)), true);
  assert.equal(placementOverlaps(layout, wallFootprint({ ...b, x: 5000 })), false);
});

test('walls may sit on a platform; platforms only collide with other platforms', () => {
  const platform = newPlatform(randomUUID(), 2000, 1000);
  const wall = newWall(randomUUID(), 2000, 1000);
  const layout: Layout = { schemaVersion: 1, walls: [wall], braces: [], platforms: [platform] };
  assert.equal(placementOverlaps(layout, wallFootprint(wall)), false);
  assert.equal(objectOverlapWarnings(layout).length, 0);
  const other = { ...newPlatform(randomUUID(), 2000, 1000), label: 'Zweites Podest' };
  assert.equal(placementOverlaps(layout, platformFootprint(other)), true);
  assert.match(objectOverlapWarnings({ ...layout, platforms: [platform, other] })[0]!.message, /Zweites Podest/);
});

test('objectOverlapWarnings names both objects', () => {
  const a = newWall(randomUUID(), 0, 0);
  const b = { ...newWall(randomUUID(), 0, 0), rotation: 90, label: 'Kreuz' };
  const warnings = objectOverlapWarnings({ schemaVersion: 1, walls: [a, b], braces: [] });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!.message, /Kreuz/);
});

function placeTip(angleDeg: number, tipX: number, tipY: number) {
  const rad = angleDeg * Math.PI / 180;
  const width = 1200;
  const localX = width / 2;
  return {
    ...newWall(randomUUID(), 0, 0),
    rotation: angleDeg,
    x: tipX - localX * Math.cos(rad),
    y: tipY - localX * Math.sin(rad),
  };
}

function wallCornersOf(wall: ReturnType<typeof newWall> & { rotation?: number }) {
  const angle = (wall.rotation ?? 0) * Math.PI / 180;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x = 0, y = 0]) => {
    const dx = x * wall.width / 2, dy = y * wall.thickness / 2;
    return { x: wall.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: wall.y + dx * Math.sin(angle) + dy * Math.cos(angle) };
  });
}
