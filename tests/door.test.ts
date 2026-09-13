import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DOOR_FRAME, DOOR_LEAF, doorOpenAngleDegrees, isDoorOpening, newDoorOpening, openingSchema } from '../src/shared/wall-types.js';
import { layoutSchema, newWall } from '../src/shared/layout.js';

test('door leaf and frame match the scenic standard', () => {
  assert.deepEqual(DOOR_LEAF, { width: 800, height: 2000, thickness: 40 });
  assert.deepEqual(DOOR_FRAME, { face: 25, depth: 50 });
});

test('door open percent maps to a 90° swing', () => {
  assert.equal(doorOpenAngleDegrees(0), 0);
  assert.equal(doorOpenAngleDegrees(50), 45);
  assert.equal(doorOpenAngleDegrees(100), 90);
  assert.equal(doorOpenAngleDegrees(-10), 0);
  assert.equal(doorOpenAngleDegrees(140), 90);
});

test('door openings carry hinge side and walls store open percent', () => {
  const left = newDoorOpening(randomUUID(), 'left');
  const right = newDoorOpening(randomUUID(), 'right');
  assert.equal(isDoorOpening(left), true);
  assert.equal(left.hinge, 'left');
  assert.equal(right.hinge, 'right');
  assert.deepEqual(openingSchema.parse(left), left);
  const wall = layoutSchema.parse({
    schemaVersion: 1,
    walls: [{ ...newWall(randomUUID(), 4000, 3000), doorOpenPercent: 35 }],
    braces: [],
  }).walls[0];
  assert.equal(wall?.doorOpenPercent, 35);
});
