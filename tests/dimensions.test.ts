import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { dimensionFigure, dimensionFromPlacement, resolveDimension } from '../src/shared/dimensions.js';
import { newWall, wallCorners, type Layout, type VenueGeometry } from '../src/shared/layout.js';
import { resolveWall } from '../src/shared/wall-types.js';

const venue: VenueGeometry = { schemaVersion: 1, width: 8000, depth: 6000 };

test('a play dimension follows both points and drops when one leaves the scene', () => {
  const wall = newWall(randomUUID(), 2000, 3000);
  const layout: Layout = { schemaVersion: 1, walls: [wall], braces: [] };
  const corners = wallCorners(resolveWall(wall, []));
  const dimension = {
    id: randomUUID(), orientation: 'horizontal' as const, offset: 4500,
    a: { kind: 'outline' as const, index: 0 },
    b: { kind: 'wall' as const, scope: 'scene' as const, wallId: wall.id, corner: 0 as const },
  };
  const first = resolveDimension(dimension, venue, layout);
  assert.equal(first?.valueMm, Math.abs(corners[0]!.x - 0));
  const moved = { ...wall, x: wall.x + 800 };
  const next = resolveDimension(dimension, venue, { ...layout, walls: [moved] });
  assert.equal(next?.valueMm, Math.abs(wallCorners(resolveWall(moved, []))[0]!.x));
  assert.equal(next?.valueMm, (first?.valueMm ?? 0) + 800);
  assert.equal(resolveDimension(dimension, venue, { ...layout, walls: [] }), undefined);
});

test('pulling off a slanted edge measures along it and offsets the dimension line', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 3000, y: 1000 };
  const placed = dimensionFromPlacement(a, b, { x: 1400, y: 1800 });
  assert.equal(placed.orientation, 'aligned');
  assert.ok(placed.offset > 200);
  const figure = dimensionFigure({ id: 'preview', ...placed, a, b, valueMm: 0 });
  assert.ok(Math.hypot(figure.line.x2 - figure.line.x1, figure.line.y2 - figure.line.y1) > 2500);
  assert.equal(dimensionFromPlacement(a, { x: 3000, y: 0 }, { x: 1500, y: 900 }).orientation, 'horizontal');
  assert.equal(dimensionFromPlacement(a, { x: 3000, y: 0 }, { x: 4200, y: 40 }).orientation, 'vertical');
});
