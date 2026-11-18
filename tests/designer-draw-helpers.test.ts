import assert from 'node:assert/strict';
import test from 'node:test';
import {
  axisFromArrowKey, drawingPlaneLockLabel, drawingPlaneNormal, isPolygonSideCount, planeAxes,
  regularPolygonPoints, squareLockedExtents,
} from '../src/client/designer/modelling/drawHelpers.js';
import { length, sub } from '../src/shared/parts/math.js';

test('regularPolygonPoints builds a closed-looking n-gon on the floor', () => {
  const points = regularPolygonPoints({ x: 100, y: 0, z: 50 }, 200, 6, { x: 0, y: 1, z: 0 });
  assert.equal(points.length, 6);
  for (const point of points) {
    assert.equal(point.y, 0);
    assert.ok(Math.abs(length(sub(point, { x: 100, y: 0, z: 50 })) - 200) < 1e-6);
  }
  assert.deepEqual(points[0], { x: 300, y: 0, z: 50 });
});

test('regularPolygonPoints clamps side count to 3…64', () => {
  assert.equal(regularPolygonPoints({ x: 0, y: 0, z: 0 }, 10, 2, { x: 0, y: 1, z: 0 }).length, 3);
  assert.equal(regularPolygonPoints({ x: 0, y: 0, z: 0 }, 10, 200, { x: 0, y: 1, z: 0 }).length, 64);
});

test('planeAxes picks a stable in-plane u for axis-aligned normals', () => {
  assert.deepEqual(planeAxes({ x: 0, y: 1, z: 0 }), { x: 1, y: 0, z: 0 });
  assert.deepEqual(planeAxes({ x: 1, y: 0, z: 0 }), { x: 0, y: 0, z: 1 });
});

test('squareLockedExtents locks on Shift or near-equal sides', () => {
  assert.deepEqual(squareLockedExtents(1200, 600, { shift: true, tolerance: 10 }), {
    along: 1200, across: 1200, square: true,
  });
  assert.deepEqual(squareLockedExtents(800, -795, { shift: false, tolerance: 10 }), {
    along: 800, across: -800, square: true,
  });
  assert.deepEqual(squareLockedExtents(1200, 600, { shift: false, tolerance: 10 }), {
    along: 1200, across: 600, square: false,
  });
});

test('isPolygonSideCount accepts regular n-gon side counts', () => {
  assert.equal(isPolygonSideCount(6), true);
  assert.equal(isPolygonSideCount(3), true);
  assert.equal(isPolygonSideCount(64), true);
  assert.equal(isPolygonSideCount(2), false);
  assert.equal(isPolygonSideCount(6.5), false);
  assert.equal(isPolygonSideCount(100), false);
});

test('arrow keys lock drawing planes so a rectangle can stand up', () => {
  assert.equal(axisFromArrowKey('ArrowRight'), 'x');
  assert.equal(axisFromArrowKey('ArrowLeft'), 'z');
  assert.equal(axisFromArrowKey('ArrowUp'), 'y');
  assert.equal(axisFromArrowKey('a'), undefined);
  assert.deepEqual(drawingPlaneNormal('x'), { x: 1, y: 0, z: 0 });
  assert.deepEqual(drawingPlaneNormal('y'), { x: 0, y: 1, z: 0 });
  assert.deepEqual(drawingPlaneNormal('z'), { x: 0, y: 0, z: 1 });
  assert.match(drawingPlaneLockLabel('x'), /senkrecht/);
  assert.match(drawingPlaneLockLabel('y'), /waagrecht/);
});
