import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execute, history, redo, undo } from '../src/shared/history.js';
import { layoutSchema, newBrace, newWall, wallCorners, type Layout } from '../src/shared/layout.js';
import { braceCorners } from '../src/shared/braceTransforms.js';

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
  const empty: Layout = { schemaVersion: 1, walls: [], braces: [] };
  const created = execute(history(empty), { schemaVersion: 1, walls: [wall], braces: [] });
  const moved = execute(created, { schemaVersion: 1, walls: [{ ...wall, x: 2000, y: 3000, rotation: 45 }], braces: [] });
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
test('example brace defaults and a known millimetre footprint map to plan corners', () => {
  const brace = newBrace(randomUUID(), 2000, 3000);
  assert.equal(brace.label, 'Stütze');
  assert.equal(brace.footprintWidth, 600);
  assert.equal(brace.footprintDepth, 800);
  assert.equal(brace.height, 1800);
  assert.deepEqual(braceCorners(brace)[0], { x: 1700, y: 2600 });
  assert.deepEqual(braceCorners(brace)[1], { x: 2300, y: 2600 });
  assert.deepEqual(braceCorners(brace)[2], { x: 2300, y: 3400 });
  assert.deepEqual(braceCorners(brace)[3], { x: 1700, y: 3400 });
  const rotated = braceCorners({ ...brace, rotation: 90 })[0]!;
  assert(Math.abs(rotated.x - 2400) < 1e-8);
  assert(Math.abs(rotated.y - 2700) < 1e-8);
});
test('layouts without braces still parse; invalid brace geometry and duplicate IDs are rejected', () => {
  const parsed = layoutSchema.parse({ schemaVersion: 1, walls: [] });
  assert.deepEqual(parsed.braces, []);
  const brace = newBrace(randomUUID(), 0, 0);
  assert(!layoutSchema.safeParse({ schemaVersion: 1, walls: [], braces: [brace, brace] }).success);
  assert(!layoutSchema.safeParse({ schemaVersion: 1, walls: [], braces: [{ ...brace, footprintWidth: -1 }] }).success);
  assert(!layoutSchema.safeParse({ schemaVersion: 1, walls: [], braces: [{ ...brace, height: 0 }] }).success);
  assert(!layoutSchema.safeParse({ schemaVersion: 1, walls: [], braces: [{ ...brace, x: Infinity }] }).success);
});
test('placing a brace is one undoable layout command', () => {
  const brace = newBrace(randomUUID(), 1500, 2500);
  const empty: Layout = { schemaVersion: 1, walls: [], braces: [] };
  const placed = execute(history(empty), { schemaVersion: 1, walls: [], braces: [brace] });
  const moved = execute(placed, { schemaVersion: 1, walls: [], braces: [{ ...brace, x: 4000, rotation: 30 }] });
  assert.deepEqual(undo(moved).present, placed.present);
  assert.deepEqual(undo(undo(moved)).present, empty);
  assert.deepEqual(redo(undo(moved)).present, moved.present);
});
