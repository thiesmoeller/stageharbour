import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  EXAMPLE_CEILING_HEIGHT, EXAMPLE_OVERHEAD_BOTTOM_HEIGHT, EXAMPLE_OVERHEAD_LENGTH,
  EXAMPLE_OVERHEAD_THICKNESS, EXAMPLE_OVERHEAD_WIDTH, newOverheadBox, overheadBoxCorners,
  overheadBoxSchema, overheadClearance,
} from '../src/shared/overhead.js';
import { venueGeometrySchema, newWall, newBrace } from '../src/shared/layout.js';
import { AUDIENCE_FLOOR_ID, EXAMPLE_PLATFORM_ELEVATION, newPlatform } from '../src/shared/levels.js';

const venueBase = { schemaVersion: 1 as const, width: 8000, depth: 6000 };
const platformOutline = [
  { x: 0, y: 3500 }, { x: 8000, y: 3500 }, { x: 8000, y: 6000 }, { x: 0, y: 6000 },
];

test('an overhead box stores position, plan dimensions, bottom height and thickness', () => {
  const box = overheadBoxSchema.parse({
    id: randomUUID(), label: 'Lüftung',
    x: 4000, y: 3000, length: 4000, width: 800, bottomHeight: 2600, thickness: 400,
  });
  assert.equal(box.x, 4000);
  assert.equal(box.y, 3000);
  assert.equal(box.length, 4000);
  assert.equal(box.width, 800);
  assert.equal(box.bottomHeight, 2600);
  assert.equal(box.thickness, 400);
  assert.deepEqual(overheadBoxCorners(box), [
    { x: 2000, y: 2600 }, { x: 6000, y: 2600 }, { x: 6000, y: 3400 }, { x: 2000, y: 3400 },
  ]);
});

test('example overhead millimetres are labelled placeholders, not a measured venue', () => {
  const box = newOverheadBox(randomUUID(), 4000, 3000);
  assert.equal(box.label, 'Überbauung');
  assert.equal(box.length, EXAMPLE_OVERHEAD_LENGTH);
  assert.equal(box.width, EXAMPLE_OVERHEAD_WIDTH);
  assert.equal(box.bottomHeight, EXAMPLE_OVERHEAD_BOTTOM_HEIGHT);
  assert.equal(box.thickness, EXAMPLE_OVERHEAD_THICKNESS);
  assert.equal(EXAMPLE_OVERHEAD_LENGTH, 4000);
  assert.equal(EXAMPLE_OVERHEAD_WIDTH, 800);
  assert.equal(EXAMPLE_OVERHEAD_BOTTOM_HEIGHT, 2600);
  assert.equal(EXAMPLE_OVERHEAD_THICKNESS, 400);
  assert.equal(EXAMPLE_CEILING_HEIGHT, 4000);
});

test('rejects invalid box dimensions, duplicate IDs and a non-positive ceiling', () => {
  const box = newOverheadBox(randomUUID(), 0, 0);
  assert(!overheadBoxSchema.safeParse({ ...box, length: 0 }).success);
  assert(!overheadBoxSchema.safeParse({ ...box, width: 0 }).success);
  assert(!overheadBoxSchema.safeParse({ ...box, bottomHeight: 0 }).success);
  assert(!overheadBoxSchema.safeParse({ ...box, thickness: 0 }).success);
  assert(!overheadBoxSchema.safeParse({ ...box, x: Infinity }).success);
  assert(!overheadBoxSchema.safeParse({ ...box, label: '  ' }).success);
  assert(!venueGeometrySchema.safeParse({
    ...venueBase, overheadBoxes: [box, { ...box, label: 'Zweiter Kasten' }],
  }).success);
  assert(!venueGeometrySchema.safeParse({ ...venueBase, ceilingHeight: 0 }).success);
  assert(venueGeometrySchema.safeParse({
    ...venueBase, ceilingHeight: EXAMPLE_CEILING_HEIGHT, overheadBoxes: [box, newOverheadBox(randomUUID(), 1000, 1000)],
  }).success);
});

test('a 2400 mm wall on the audience floor under a high duct is clear; the same wall on a 400 mm platform warns', () => {
  const platform = { id: randomUUID(), label: 'Bühne', elevation: EXAMPLE_PLATFORM_ELEVATION, outline: platformOutline };
  const box = overheadBoxSchema.parse({
    id: randomUUID(), label: 'Lüftung',
    x: 4000, y: 5000, length: 4000, width: 800, bottomHeight: 2600, thickness: 400,
  });
  const venue = { ...venueBase, platforms: [platform], overheadBoxes: [box] };
  const onFloor = { ...newWall(randomUUID(), 4000, 5000), supportingSurfaceId: AUDIENCE_FLOOR_ID };
  assert.deepEqual(overheadClearance({ walls: [onFloor], braces: [] }, venue), []);
  const onStage = { ...onFloor, supportingSurfaceId: platform.id };
  const warnings = overheadClearance({ walls: [onStage], braces: [] }, venue);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.kind, 'overhead');
  assert.equal(warnings[0]?.objectId, onStage.id);
  assert.equal(warnings[0]?.obstructionId, box.id);
  assert.match(warnings[0]?.message ?? '', /Lüftung/);
  assert.match(warnings[0]?.message ?? '', /kein statischer Nachweis/);
  assert(!/zertifiz|standsicher|freigegeben/i.test(warnings[0]?.message ?? ''));
});

test('a ceiling limit uses the wall’s local supporting-surface elevation', () => {
  const platform = { id: randomUUID(), label: 'Bühne', elevation: EXAMPLE_PLATFORM_ELEVATION, outline: platformOutline };
  const venue = { ...venueBase, platforms: [platform], ceilingHeight: 2500 };
  const onFloor = { ...newWall(randomUUID(), 4000, 2000), supportingSurfaceId: AUDIENCE_FLOOR_ID };
  assert.deepEqual(overheadClearance({ walls: [onFloor], braces: [] }, venue), []);
  const onStage = { ...newWall(randomUUID(), 4000, 5000), supportingSurfaceId: platform.id };
  const warnings = overheadClearance({ walls: [onStage], braces: [] }, venue);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.kind, 'ceiling');
  assert.equal(warnings[0]?.objectId, onStage.id);
  assert.match(warnings[0]?.message ?? '', /2500 mm/);
  assert.match(warnings[0]?.message ?? '', /kein statischer Nachweis/);
  assert(!/zertifiz|standsicher|freigegeben/i.test(warnings[0]?.message ?? ''));
});

test('a wall beside a duct does not warn; a brace uses the same local height', () => {
  const platform = newPlatform(randomUUID(), 4000, 4750);
  const box = newOverheadBox(randomUUID(), 4000, 5000);
  const venue = { ...venueBase, platforms: [platform], overheadBoxes: [box] };
  const beside = { ...newWall(randomUUID(), 4000, 1000), supportingSurfaceId: AUDIENCE_FLOOR_ID };
  assert.deepEqual(overheadClearance({ walls: [beside], braces: [] }, venue), []);
  const braceOnStage = { ...newBrace(randomUUID(), 4000, 5000), height: 2300, supportingSurfaceId: platform.id };
  const warnings = overheadClearance({ walls: [], braces: [braceOnStage] }, venue);
  assert.equal(warnings.some(item => item.kind === 'overhead' && item.objectId === braceOnStage.id), true);
});
