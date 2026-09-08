import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newWall, type Layout } from '../src/shared/layout.js';
import { objectOverlapWarnings, placementOverlaps, polygonsInteriorOverlap, wallFootprint } from '../src/shared/overlap.js';

test('edge-flush walls do not count as interior overlap', () => {
  const left = wallCornersOf(newWall(randomUUID(), 0, 0));
  const right = wallCornersOf({ ...newWall(randomUUID(), 1200, 0) }); // centres 1200 apart, width 1200 → ends touch
  // Actually width 1200 each, left extends to x=600, right centre 1200 extends to x=600 — flush at x=600
  assert.equal(polygonsInteriorOverlap(left, right), false);
});

test('crossing walls count as interior overlap', () => {
  const a = wallCornersOf(newWall(randomUUID(), 0, 0));
  const b = wallCornersOf({ ...newWall(randomUUID(), 0, 0), rotation: 90 });
  assert.equal(polygonsInteriorOverlap(a, b), true);
});

test('placementOverlaps rejects a wall dropped on top of another', () => {
  const a = newWall(randomUUID(), 0, 0);
  const layout: Layout = { schemaVersion: 1, walls: [a], braces: [] };
  const b = { ...newWall(randomUUID(), 50, 0) };
  assert.equal(placementOverlaps(layout, wallFootprint(b)), true);
  assert.equal(placementOverlaps(layout, wallFootprint({ ...b, x: 5000 })), false);
});

test('objectOverlapWarnings names both objects', () => {
  const a = newWall(randomUUID(), 0, 0);
  const b = { ...newWall(randomUUID(), 0, 0), rotation: 90, label: 'Kreuz' };
  const warnings = objectOverlapWarnings({ schemaVersion: 1, walls: [a, b], braces: [] });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!.message, /Kreuz/);
});

function wallCornersOf(wall: ReturnType<typeof newWall> & { rotation?: number }) {
  const angle = (wall.rotation ?? 0) * Math.PI / 180;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x = 0, y = 0]) => {
    const dx = x * wall.width / 2, dy = y * wall.thickness / 2;
    return { x: wall.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: wall.y + dx * Math.sin(angle) + dy * Math.cos(angle) };
  });
}
