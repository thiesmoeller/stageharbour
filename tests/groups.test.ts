import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { recordConnection } from '../src/shared/assembly.js';
import { canFormGroup, formGroup, groupContaining, groupPivot, transformGroup } from '../src/shared/groups.js';
import { execute, history, undo } from '../src/shared/history.js';
import { layoutSchema, newBrace, newWall, type Layout, type Wall } from '../src/shared/layout.js';
import { AUDIENCE_FLOOR_ID, newStair } from '../src/shared/levels.js';

function twoWalls(leftX: number, rightX: number, y = 0): { left: Wall; right: Wall; layout: Layout } {
  const left = newWall(randomUUID(), leftX, y);
  const right = newWall(randomUUID(), rightX, y);
  return { left, right, layout: { schemaVersion: 1, walls: [left, right], braces: [] } };
}

test('an explicit wall group translates around the centroid and keeps millimetre offsets', () => {
  const { left, right, layout } = twoWalls(0, 2000);
  const id = randomUUID();
  const grouped = formGroup(layout, [{ kind: 'wall', id: left.id }, { kind: 'wall', id: right.id }], id);
  assert.deepEqual(groupPivot(grouped, id), { x: 1000, y: 0 });
  const moved = transformGroup(grouped, id, { x: 1500, y: 400, rotation: 0 });
  const a = moved.walls.find(wall => wall.id === left.id)!;
  const b = moved.walls.find(wall => wall.id === right.id)!;
  assert.equal(a.x, 500);
  assert.equal(a.y, 400);
  assert.equal(b.x, 2500);
  assert.equal(b.y, 400);
  assert.equal(b.x - a.x, 2000);
  assert.equal(b.y - a.y, 0);
  assert.deepEqual(groupPivot(moved, id), { x: 1500, y: 400 });
});

test('rotating a group 90° around the centroid preserves relative millimetre offsets', () => {
  const { left, right, layout } = twoWalls(0, 2000);
  const id = randomUUID();
  const grouped = formGroup(layout, [{ kind: 'wall', id: left.id }, { kind: 'wall', id: right.id }], id);
  const rotated = transformGroup(grouped, id, { x: 1000, y: 0, rotation: 90 });
  const a = rotated.walls.find(wall => wall.id === left.id)!;
  const b = rotated.walls.find(wall => wall.id === right.id)!;
  assert(Math.abs(a.x - 1000) < 1e-8);
  assert(Math.abs(a.y - -1000) < 1e-8);
  assert(Math.abs(b.x - 1000) < 1e-8);
  assert(Math.abs(b.y - 1000) < 1e-8);
  assert.equal(a.rotation, 90);
  assert.equal(b.rotation, 90);
  assert(Math.abs(b.x - a.x) < 1e-8);
  assert(Math.abs((b.y - a.y) - 2000) < 1e-8);
  assert.deepEqual(groupPivot(rotated, id), { x: 1000, y: 0 });
  assert.equal(rotated.groups?.[0]?.rotation, 90);
});

test('a panel connection does not form a group or move the neighbour', () => {
  const { left, right, layout } = twoWalls(1000, 5000, 2000);
  const connected = recordConnection(layout, left.id, right.id);
  assert.equal(canFormGroup(connected, [{ kind: 'wall', id: left.id }]), false);
  assert.equal(groupContaining(connected, { kind: 'wall', id: left.id }), undefined);
  assert.deepEqual(connected.groups ?? [], []);
  const moved: Layout = { ...connected, walls: connected.walls.map(wall => wall.id === left.id ? { ...wall, x: 1500 } : wall) };
  assert.equal(moved.walls.find(wall => wall.id === left.id)?.x, 1500);
  assert.equal(moved.walls.find(wall => wall.id === right.id)?.x, 5000);
  assert.equal(moved.walls.find(wall => wall.id === right.id)?.y, 2000);
  assert.deepEqual(moved.groups ?? [], []);
});

test('ungrouped individual edits still move only the edited wall', () => {
  const { left, right, layout } = twoWalls(0, 2000);
  const id = randomUUID();
  const grouped = formGroup(layout, [{ kind: 'wall', id: left.id }, { kind: 'wall', id: right.id }], id);
  const edited: Layout = { ...grouped, walls: grouped.walls.map(wall => wall.id === left.id ? { ...wall, x: 200, rotation: 15 } : wall) };
  assert.equal(edited.walls.find(wall => wall.id === left.id)?.x, 200);
  assert.equal(edited.walls.find(wall => wall.id === left.id)?.rotation, 15);
  assert.equal(edited.walls.find(wall => wall.id === right.id)?.x, 2000);
  assert.equal(edited.walls.find(wall => wall.id === right.id)?.rotation, 0);
  assert.equal(groupContaining(edited, { kind: 'wall', id: left.id })?.id, id);
});

test('a group transform is one undoable layout command', () => {
  const { left, right, layout } = twoWalls(0, 2000);
  const id = randomUUID();
  const grouped = formGroup(layout, [{ kind: 'wall', id: left.id }, { kind: 'wall', id: right.id }], id);
  const moved = execute(history(grouped), transformGroup(grouped, id, { x: 1500, y: 400, rotation: 90 }));
  assert.deepEqual(undo(moved).present, grouped);
  assert.equal(moved.present.walls.find(wall => wall.id === left.id)?.rotation, 90);
  assert.equal(moved.present.walls.find(wall => wall.id === right.id)?.rotation, 90);
});

test('braces and stairs share the wall group transform around the same centroid', () => {
  const wall = newWall(randomUUID(), 0, 0);
  const brace = newBrace(randomUUID(), 2000, 0);
  const stair = newStair(randomUUID(), AUDIENCE_FLOOR_ID, randomUUID(), 0, 2000);
  const id = randomUUID();
  const layout: Layout = { schemaVersion: 1, walls: [wall], braces: [brace], stairs: [stair] };
  const grouped = formGroup(layout, [
    { kind: 'wall', id: wall.id }, { kind: 'brace', id: brace.id }, { kind: 'stair', id: stair.id },
  ], id);
  assert.deepEqual(groupPivot(grouped, id), { x: 2000 / 3, y: 2000 / 3 });
  const moved = transformGroup(grouped, id, { x: 1000, y: 1000, rotation: 0 });
  assert.equal(moved.walls[0]?.x, 1000 - 2000 / 3);
  assert.equal(moved.braces[0]?.x, 2000 + 1000 - 2000 / 3);
  assert.equal(moved.stairs?.[0]?.y, 2000 + 1000 - 2000 / 3);
});

test('saved groups parse with the layout; connections and unknown members are not groups', () => {
  const left = newWall(randomUUID(), 0, 0);
  const right = newWall(randomUUID(), 2000, 0);
  const group = { id: randomUUID(), members: [{ kind: 'wall' as const, id: left.id }, { kind: 'wall' as const, id: right.id }], rotation: 45 };
  const parsed = layoutSchema.parse({ schemaVersion: 1, walls: [left, right], groups: [group] });
  assert.deepEqual(parsed.groups, [group]);
  assert.deepEqual(groupPivot(parsed, group.id), { x: 1000, y: 0 });
  assert(!layoutSchema.safeParse({
    schemaVersion: 1, walls: [left], groups: [{ id: randomUUID(), members: [{ kind: 'wall', id: left.id }, { kind: 'wall', id: randomUUID() }], rotation: 0 }],
  }).success);
  assert(!layoutSchema.safeParse({
    schemaVersion: 1, walls: [left, right], groups: [{ id: randomUUID(), members: [{ kind: 'brace', id: left.id }, { kind: 'brace', id: right.id }], rotation: 0 }],
  }).success);
  assert(!layoutSchema.safeParse({
    schemaVersion: 1, walls: [left, right], groups: [
      { id: randomUUID(), members: [{ kind: 'wall', id: left.id }, { kind: 'wall', id: right.id }], rotation: 0 },
      { id: randomUUID(), members: [{ kind: 'wall', id: left.id }, { kind: 'wall', id: right.id }], rotation: 0 },
    ],
  }).success);
});
