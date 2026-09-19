import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { venueGeometrySchema } from '../src/shared/layout.js';
import {
  curtainCorners, curtainFromSegment, curtainLeafSpans, curtainWavyPoints, newCurtain,
} from '../src/shared/curtains.js';

test('curtain schema and segment construction', () => {
  const curtain = curtainFromSegment(randomUUID(), { x: 0, y: 2000 }, { x: 8000, y: 2000 });
  assert.ok(curtain);
  assert.equal(curtain!.length, 8000);
  assert.equal(Math.round(curtain!.rotation), 0);
  assert.equal(curtainCorners(curtain!).length, 4);
  const parsed = venueGeometrySchema.safeParse({
    schemaVersion: 1, width: 10000, depth: 8000,
    curtains: [curtain],
  });
  assert.equal(parsed.success, true, parsed.success ? '' : JSON.stringify(parsed.error.issues));
});

test('traveler opening splits leaf spans', () => {
  const closed = newCurtain(randomUUID(), 0, 0, { length: 10000, openPercent: 0, opening: 'traveler' });
  const open = newCurtain(randomUUID(), 0, 0, { length: 10000, openPercent: 100, opening: 'traveler' });
  const closedSpans = curtainLeafSpans(closed);
  const openSpans = curtainLeafSpans(open);
  assert.equal(closedSpans.length, 1);
  assert.equal(closedSpans[0]!.end - closedSpans[0]!.start, 10000);
  const openCover = openSpans.reduce((sum, span) => sum + (span.end - span.start), 0);
  assert.ok(openCover < 2000);
  assert.equal(openSpans.length, 2);
  assert.ok(openSpans[0]!.end < 0 && openSpans[1]!.start > 0);
});

test('stackLeft gathers fabric to stage left of track', () => {
  const curtain = newCurtain(randomUUID(), 0, 0, { length: 6000, openPercent: 80, opening: 'stackLeft' });
  const [span] = curtainLeafSpans(curtain);
  assert.ok(span);
  assert.equal(span!.start, -3000);
  assert.ok(span!.end < 0);
});

test('wavy plan path has USITT-style amplitude', () => {
  const curtain = newCurtain(randomUUID(), 1000, 2000, { length: 4000, openPercent: 0 });
  const paths = curtainWavyPoints(curtain);
  assert.ok(paths.length >= 1);
  const points = paths.flat();
  assert.ok(points.length >= 8);
  const deviations = points.map(p => Math.abs((p.y - 2000)));
  assert.ok(Math.max(...deviations) > 20);
  assert.ok(Math.max(...deviations) <= 60);
});
