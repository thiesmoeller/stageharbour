import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { assemblyCaption, assignAssemblyNumbers, clearAssemblyNumbers, recordConnection } from '../src/shared/assembly.js';

test('left-to-right from the audience assigns assembly numbers in known +x order', () => {
  const left = { id: randomUUID(), x: 1000, y: 4000 };
  const middle = { id: randomUUID(), x: 3000, y: 2000 };
  const right = { id: randomUUID(), x: 5000, y: 1000 };
  const numbered = assignAssemblyNumbers([right, left, middle]);
  assert.equal(numbered.find(wall => wall.id === left.id)?.assemblyNumber, 1);
  assert.equal(numbered.find(wall => wall.id === middle.id)?.assemblyNumber, 2);
  assert.equal(numbered.find(wall => wall.id === right.id)?.assemblyNumber, 3);
});

test('assembly numbers stay put when a wall is later moved', () => {
  const left = { id: randomUUID(), x: 1000, y: 2000 };
  const right = { id: randomUUID(), x: 5000, y: 2000 };
  const [first, second] = assignAssemblyNumbers([left, right]);
  const moved = { ...second!, x: 0, y: 8000 };
  const again = assignAssemblyNumbers([first!, moved]);
  assert.equal(again.find(wall => wall.id === left.id)?.assemblyNumber, 1);
  assert.equal(again.find(wall => wall.id === right.id)?.assemblyNumber, 2);
  assert.equal(again.find(wall => wall.id === right.id)?.x, 0);
});

test('clearing assembly numbers drops every position so a later pass can renumber', () => {
  const left = { id: randomUUID(), x: 1000, y: 2000, label: 'Links', assemblyNumber: 1 };
  const right = { id: randomUUID(), x: 5000, y: 2000, label: 'Rechts', assemblyNumber: 2 };
  const cleared = clearAssemblyNumbers([left, right]);
  assert.equal(cleared[0]?.assemblyNumber, undefined);
  assert.equal(cleared[1]?.assemblyNumber, undefined);
  assert.equal(cleared[0]?.label, 'Links');
  assert.equal(cleared[1]?.x, 5000);
  const renumbered = assignAssemblyNumbers([{ ...cleared[1]!, x: 0 }, cleared[0]!]);
  assert.equal(renumbered.find(wall => wall.id === right.id)?.assemblyNumber, 1);
  assert.equal(renumbered.find(wall => wall.id === left.id)?.assemblyNumber, 2);
});

test('recording a connection does not change wall coordinates', () => {
  const a = { id: randomUUID(), x: 1200, y: 1800, rotation: 35 };
  const b = { id: randomUUID(), x: 4000, y: 2200, rotation: -10 };
  const layout = { walls: [a, b], connections: [] as { id: string; a: string; b: string }[] };
  const next = recordConnection(layout, a.id, b.id);
  assert.equal(next.walls[0], a);
  assert.equal(next.walls[1], b);
  assert.deepEqual(next.walls.map(wall => ({ x: wall.x, y: wall.y, rotation: wall.rotation })), [
    { x: 1200, y: 1800, rotation: 35 }, { x: 4000, y: 2200, rotation: -10 },
  ]);
  assert.equal(next.connections.length, 1);
  assert.equal(next.connections[0]?.a, a.id);
  assert.equal(next.connections[0]?.b, b.id);
});

test('plan caption uses the assigned number and, when present, the inventory label', () => {
  assert.equal(assemblyCaption(3, 'W12'), 'Position 3 · Platte W12');
  assert.equal(assemblyCaption(1), 'Position 1');
});
