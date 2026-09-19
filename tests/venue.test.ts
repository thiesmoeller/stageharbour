import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { venueGeometrySchema } from '../src/shared/layout.js';
import {
  calibrationSchema, insertOutlineVertex, measuredOutline, millimetresPerUnit, OUTLINE_VERTEX_INSERT_MM,
  planToUnderlaySource, underlaySourceToPlan, venueOutlineSchema,
} from '../src/shared/venue.js';
import { defaultPlanDisplay } from '../src/shared/planDisplay.js';

test('two-point calibration with a known distance yields a reproducible millimetre scale', () => {
  const calibration = calibrationSchema.parse({
    pointA: { x: 0, y: 0 }, pointB: { x: 30, y: 40 }, distanceMm: 5000,
  });
  assert.equal(millimetresPerUnit(calibration), 100);
  const again = calibrationSchema.parse({
    pointA: { x: 10, y: -20 }, pointB: { x: 40, y: 20 }, distanceMm: 5000,
  });
  assert.equal(millimetresPerUnit(again), 100);
});

test('rejects coincident points and a non-positive known distance', () => {
  assert(!calibrationSchema.safeParse({
    pointA: { x: 12, y: 8 }, pointB: { x: 12, y: 8 }, distanceMm: 4000,
  }).success);
  assert(!calibrationSchema.safeParse({
    pointA: { x: 0, y: 0 }, pointB: { x: 100, y: 0 }, distanceMm: 0,
  }).success);
  assert(!calibrationSchema.safeParse({
    pointA: { x: 0, y: 0 }, pointB: { x: 100, y: 0 }, distanceMm: -1000,
  }).success);
});

test('accepts an irregular outline and derives millimetre bounds from it', () => {
  const outline = [
    { x: 0, y: 0 }, { x: 8000, y: 500 }, { x: 7500, y: 6000 }, { x: 400, y: 5800 },
  ];
  assert.deepEqual(venueOutlineSchema.parse(outline), outline);
  const venue = venueGeometrySchema.parse({
    schemaVersion: 1, width: 8000, depth: 6000, outline,
    trace: {
      fileId: randomUUID(), page: 1, rotationDeg: 15,
      calibration: { pointA: { x: 0, y: 0 }, pointB: { x: 30, y: 40 }, distanceMm: 5000 },
    },
  });
  assert.deepEqual(measuredOutline(venue), outline);
  assert.equal(venue.trace?.rotationDeg, 15);
});

test('rejects degenerate outlines and synthesizes a rectangle when none is stored', () => {
  assert(!venueOutlineSchema.safeParse([{ x: 0, y: 0 }, { x: 1000, y: 0 }]).success);
  assert(!venueOutlineSchema.safeParse([{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 2000, y: 0 }]).success);
  assert(!venueOutlineSchema.safeParse([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1000, y: 800 }]).success);
  assert(!venueGeometrySchema.safeParse({
    schemaVersion: 1, width: 8000, depth: 6000, outline: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
  }).success);
  assert.deepEqual(measuredOutline({ width: 8000, depth: 6000 }), [
    { x: 0, y: 0 }, { x: 8000, y: 0 }, { x: 8000, y: 6000 }, { x: 0, y: 6000 },
  ]);
});

test('a click near an outline edge inserts a vertex on that edge, not at the end', () => {
  const outline = [{ x: 0, y: 0 }, { x: 8000, y: 0 }, { x: 8000, y: 6000 }, { x: 0, y: 6000 }];
  const inserted = insertOutlineVertex(outline, { x: 4000, y: 80 });
  assert.deepEqual(inserted, [
    { x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 8000, y: 0 }, { x: 8000, y: 6000 }, { x: 0, y: 6000 },
  ]);
  const left = insertOutlineVertex(outline, { x: -50, y: 3000 });
  assert.deepEqual(left, [
    { x: 0, y: 0 }, { x: 8000, y: 0 }, { x: 8000, y: 6000 }, { x: 0, y: 6000 }, { x: 0, y: 3000 },
  ]);
  assert.equal(insertOutlineVertex(outline, { x: 4000, y: OUTLINE_VERTEX_INSERT_MM + 50 }), undefined);
  assert.equal(insertOutlineVertex(outline, { x: 0, y: 0 }), undefined);
});

test('underlay source and plan coordinates round-trip through scale and rotation', () => {
  const overlay = { pixelWidth: 200, pixelHeight: 100 };
  const unit = 50;
  const rotationDeg = 90;
  const source = { x: 40, y: 20 };
  const plan = underlaySourceToPlan(source, overlay, unit, rotationDeg);
  const back = planToUnderlaySource(plan, overlay, unit, rotationDeg);
  assert.deepEqual(back, source);
  const unrotated = underlaySourceToPlan(source, overlay, unit, 0);
  assert.equal(unrotated.x, 40 * unit);
  assert.equal(unrotated.y, (100 - 20) * unit);
});

test('plan display defaults show underlay, names, dimensions and texts', () => {
  assert.deepEqual(defaultPlanDisplay, {
    showUnderlay: true, showObjectNames: true, showDimensions: true, showTexts: true,
  });
});
