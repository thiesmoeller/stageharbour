import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { venueGeometrySchema } from '../src/shared/layout.js';
import { nearFirstVertex, commitDrawnKeepClear } from '../src/shared/keepClear.js';
import { nearestTrussForHang, newTruss, projectOntoTruss, trussFromSegment, trussCorners } from '../src/shared/truss.js';
import { placeholderSchema, newPlaceholder } from '../src/shared/placeholders.js';
import { overheadClearance } from '../src/shared/overhead.js';
import { AUDIENCE_FLOOR_ID } from '../src/shared/levels.js';

test('nearFirstVertex closes a drawn Freihaltezone', () => {
  const points = [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 1000 }];
  assert.equal(nearFirstVertex(points, { x: 50, y: 40 }), true);
  assert.equal(nearFirstVertex(points, { x: 900, y: 900 }), false);
  const zone = commitDrawnKeepClear(randomUUID(), points);
  assert.ok(zone);
  assert.equal(zone!.polygon.length, 3);
  assert.equal(zone!.label, 'Notausgang');
});

test('truss schema and segment construction', () => {
  const truss = trussFromSegment(randomUUID(), { x: 0, y: 1000 }, { x: 6000, y: 1000 });
  assert.ok(truss);
  assert.equal(truss!.length, 6000);
  assert.equal(Math.round(truss!.rotation), 0);
  assert.equal(trussCorners(truss!).length, 4);
  const parsed = venueGeometrySchema.safeParse({
    schemaVersion: 1, width: 8000, depth: 6000,
    trusses: [truss],
  });
  assert.equal(parsed.success, true, parsed.success ? '' : JSON.stringify(parsed.error.issues));
});

test('projectOntoTruss places hang offset along the chord', () => {
  const truss = newTruss(randomUUID(), 4000, 3000, { length: 6000, rotation: 0 });
  const mid = projectOntoTruss(truss, { x: 4000, y: 3050 });
  assert.equal(mid.offsetMm, 0);
  assert.ok(mid.distanceMm < 60);
  const right = projectOntoTruss(truss, { x: 5500, y: 3000 });
  assert.equal(right.offsetMm, 1500);
  const beyond = projectOntoTruss(truss, { x: 9000, y: 3000 });
  assert.equal(beyond.offsetMm, 3000);
  const hit = nearestTrussForHang([truss], { x: 4500, y: 3100 });
  assert.ok(hit);
  assert.equal(hit!.truss.id, truss.id);
  assert.equal(hit!.offsetMm, 500);
  const far = nearestTrussForHang([truss], { x: 4500, y: 5000 });
  assert.ok(far);
  assert.equal(far!.offsetMm, 500);
  assert.equal(nearestTrussForHang([truss], { x: 4500, y: 5000 }, 200), undefined);
});

test('chair seatedFigure is optional on placeholders', () => {
  const chair = { ...newPlaceholder('chair', randomUUID(), 1000, 1000), seatedFigure: true };
  assert.equal(placeholderSchema.safeParse(chair).success, true);
  assert.equal(placeholderSchema.safeParse(newPlaceholder('table', randomUUID(), 0, 0)).success, true);
});

test('overhead clearance warns against trusses', () => {
  const truss = newTruss(randomUUID(), 4000, 3000, { length: 4000, bottomHeight: 2000 });
  const warnings = overheadClearance(
    { walls: [{ id: randomUUID(), label: 'Wand', x: 4000, y: 3000, rotation: 0, width: 1200, height: 2400, thickness: 40, supportingSurfaceId: AUDIENCE_FLOOR_ID }], braces: [] },
    { width: 8000, depth: 6000, trusses: [truss] },
  );
  assert.ok(warnings.some(item => item.message.includes('Traverse')));
});
