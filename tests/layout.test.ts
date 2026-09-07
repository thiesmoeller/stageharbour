import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execute, history, redo, undo } from '../src/shared/history.js';
import { layoutSchema, newWall, openingCorners, wallCorners, type Layout } from '../src/shared/layout.js';
import { newWallType, resolveWall, wallTypeSchema } from '../src/shared/wall-types.js';

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

const door = { left: 200, sill: 0, width: 800, height: 2000 };
const windowA = { left: 80, sill: 1100, width: 420, height: 900 };
const windowB = { left: 700, sill: 1100, width: 420, height: 900 };

test('rejects openings that leave the panel and invalid type dimensions', () => {
  const id = randomUUID();
  assert(!wallTypeSchema.safeParse({ ...newWallType(id), width: 0 }).success);
  assert(!wallTypeSchema.safeParse({ ...newWallType(id), openings: [{ id: randomUUID(), ...door, left: 500 }] }).success);
  assert(!wallTypeSchema.safeParse({ ...newWallType(id), openings: [{ id: randomUUID(), ...door, sill: 500 }] }).success);
  assert(!wallTypeSchema.safeParse({ ...newWallType(id), openings: [{ id: randomUUID(), left: -1, sill: 0, width: 800, height: 2000 }] }).success);
  assert(!layoutSchema.safeParse({
    schemaVersion: 1, wallTypes: [newWallType(id)], walls: [{ ...newWall(randomUUID(), 0, 0), typeId: randomUUID() }],
  }).success);
});

test('accepts multiple rectangular openings that stay inside the panel', () => {
  const type = { ...newWallType(randomUUID()), name: 'Fensterwand', openings: [
    { id: randomUUID(), ...windowA }, { id: randomUUID(), ...windowB },
  ] };
  assert(wallTypeSchema.safeParse(type).success);
  const wall = { ...newWall(randomUUID(), 2000, 3000), typeId: type.id, label: type.name };
  const parsed = layoutSchema.parse({ schemaVersion: 1, wallTypes: [type], walls: [wall] });
  assert.equal(parsed.wallTypes?.length, 1);
  assert.deepEqual(resolveWall(wall, parsed.wallTypes ?? []).openings.map(opening => ({
    left: opening.left, sill: opening.sill, width: opening.width, height: opening.height,
  })), [windowA, windowB]);
});

test('resolved geometry exposes known opening millimetres for 3D and PDF', () => {
  const type = { ...newWallType(randomUUID()), openings: [{ id: randomUUID(), ...door }] };
  const wall = { ...newWall(randomUUID(), 2000, 3000), typeId: type.id, width: 999, height: 999, thickness: 9 };
  const resolved = resolveWall(wall, [type]);
  assert.equal(resolved.width, 1200);
  assert.equal(resolved.height, 2400);
  assert.equal(resolved.thickness, 28);
  assert.equal(resolved.openings[0]?.width, 800);
  assert.equal(resolved.openings[0]?.height, 2000);
  assert.equal(resolved.openings[0]?.left, 200);
  assert.equal(resolved.openings[0]?.sill, 0);
  assert.deepEqual(openingCorners(resolved, resolved.openings[0]!)[0], { x: 1600, y: 2986 });
  assert.deepEqual(openingCorners(resolved, resolved.openings[0]!)[1], { x: 2400, y: 2986 });
});
