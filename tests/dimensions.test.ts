import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  dimensionFigure, dimensionFromPlacement, dimensionSnapPoints, nearestSnap, resolveAnchor, resolveDimension,
} from '../src/shared/dimensions.js';
import { newWall, wallCorners, type Layout, type VenueGeometry } from '../src/shared/layout.js';
import { resolveWall } from '../src/shared/wall-types.js';

const venue: VenueGeometry = { schemaVersion: 1, width: 8000, depth: 6000 };
const emptyLayout: Layout = { schemaVersion: 1, walls: [], braces: [] };

test('Maß snaps to midpoints of venue outline, wall and Podest edges', () => {
  const wall = newWall(randomUUID(), 2000, 3000);
  const platform = {
    id: randomUUID(), label: 'Podest', elevation: 400,
    outline: [{ x: 1000, y: 1000 }, { x: 3000, y: 1000 }, { x: 3000, y: 2000 }, { x: 1000, y: 2000 }],
  };
  const withVenue: VenueGeometry = { ...venue, walls: [wall], platforms: [platform] };
  const snaps = dimensionSnapPoints(withVenue, emptyLayout);

  const leftMid = nearestSnap(snaps, { x: 0, y: 3000 }, 50);
  assert.deepEqual(leftMid?.point, { x: 0, y: 3000 });
  assert.deepEqual(leftMid?.anchor, { kind: 'outlineEdge', edge: 3, t: 0.5 });
  assert.deepEqual(resolveAnchor(leftMid!.anchor, { ...withVenue, depth: 7000 }, emptyLayout), { x: 0, y: 3500 });

  const corners = wallCorners(resolveWall(wall, []));
  const wallFrontMid = { x: (corners[0]!.x + corners[1]!.x) / 2, y: (corners[0]!.y + corners[1]!.y) / 2 };
  const wallHit = nearestSnap(snaps, wallFrontMid, 50);
  assert.deepEqual(wallHit?.point, wallFrontMid);
  assert.deepEqual(wallHit?.anchor, { kind: 'wallEdge', scope: 'venue', wallId: wall.id, edge: 0, t: 0.5 });
  const movedWall = { ...wall, x: wall.x + 500 };
  assert.deepEqual(
    resolveAnchor(wallHit!.anchor, { ...withVenue, walls: [movedWall] }, emptyLayout),
    { x: wallFrontMid.x + 500, y: wallFrontMid.y },
  );

  const platformFrontMid = { x: 2000, y: 1000 };
  const platformHit = nearestSnap(snaps, platformFrontMid, 50);
  assert.deepEqual(platformHit?.point, platformFrontMid);
  assert.deepEqual(platformHit?.anchor, { kind: 'platformEdge', scope: 'venue', platformId: platform.id, edge: 0, t: 0.5 });
  assert.deepEqual(
    resolveAnchor(platformHit!.anchor, {
      ...withVenue,
      platforms: [{ ...platform, outline: platform.outline.map(point => ({ ...point, y: point.y + 200 })) }],
    }, emptyLayout),
    { x: 2000, y: 1200 },
  );
});

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
