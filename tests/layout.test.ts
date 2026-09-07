import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execute, history, redo, undo } from '../src/shared/history.js';
import { layoutSchema, newWall, wallCorners, type Layout } from '../src/shared/layout.js';

test('wall defaults, centre coordinates and rotation use millimetres consistently', () => {
  const wall = newWall(randomUUID(), 2000, 3000);
  assert.equal(wall.height, 2400); assert.equal(wall.thickness, 28);
  assert.deepEqual(wallCorners(wall)[0], { x: 1400, y: 2986 });
  const rotated = wallCorners({ ...wall, rotation: 90 })[0]!;
  assert(Math.abs(rotated.x - 2014) < 1e-8);
  assert(Math.abs(rotated.y - 2400) < 1e-8);
});
test('creation, combined transforms and deletion undo independently; a new edit clears redo', () => {
  const wall = newWall(randomUUID(), 1000, 1000);
  const empty: Layout = { schemaVersion: 1, walls: [] };
  const created = execute(history(empty), { schemaVersion: 1, walls: [wall] });
  const moved = execute(created, { schemaVersion: 1, walls: [{ ...wall, x: 2000, y: 3000, rotation: 45 }] });
  const deleted = execute(moved, empty);
  assert.deepEqual(undo(deleted).present, moved.present);
  assert.deepEqual(undo(undo(deleted)).present, created.present);
  assert.deepEqual(undo(undo(undo(deleted))).present, empty);
  assert.deepEqual(redo(undo(moved)).present, moved.present);
  assert.equal(execute(undo(moved), empty).future.length, 0);
  assert.equal(execute(created, created.present), created);
  assert.equal(history(moved.present).past.length, 0);
  assert.equal(wall.x, 1000);
});
test('rejects unsupported schema versions, duplicate IDs and invalid geometry', () => {
  const wall = newWall(randomUUID(), 0, 0);
  assert(!layoutSchema.safeParse({ schemaVersion: 2, walls: [] }).success);
  assert(!layoutSchema.safeParse({ schemaVersion: 1, walls: [wall, wall] }).success);
  assert(!layoutSchema.safeParse({ schemaVersion: 1, walls: [{ ...wall, width: -1 }] }).success);
  assert(!layoutSchema.safeParse({ schemaVersion: 1, walls: [{ ...wall, x: Infinity }] }).success);
});
