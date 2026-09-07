import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { venueGeometrySchema } from '../src/shared/layout.js';
import {
  calibrationSchema, measuredOutline, millimetresPerUnit, venueOutlineSchema,
} from '../src/shared/venue.js';

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
      fileId: randomUUID(), page: 1,
      calibration: { pointA: { x: 0, y: 0 }, pointB: { x: 30, y: 40 }, distanceMm: 5000 },
    },
  });
  assert.deepEqual(measuredOutline(venue), outline);
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
