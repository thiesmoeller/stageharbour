import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newBrace, newWall, type Layout } from '../src/shared/layout.js';
import { membersInBounds, normalizeBounds } from '../src/shared/selection.js';
import { copySelection, pasteClipboard } from '../src/shared/clipboard.js';
import { AUDIENCE_FLOOR_ID, newPlatform, newStair } from '../src/shared/levels.js';

test('normalizeBounds orders rubber-band corners in plan millimetres', () => {
  assert.deepEqual(normalizeBounds({ x: 5000, y: 1000 }, { x: 1000, y: 4000 }), {
    minX: 1000, maxX: 5000, minY: 1000, maxY: 4000,
  });
});

test('membersInBounds selects only walls whose footprints lie fully inside the rubber band', () => {
  const left = newWall(randomUUID(), 1000, 2000);
  const right = newWall(randomUUID(), 6000, 2000);
  const far = newWall(randomUUID(), 9000, 4500);
  const layout: Layout = { schemaVersion: 1, walls: [left, right, far], braces: [] };
  // Left wall spans ~400–1600 × 1986–2014; right wall ~5400–6600 is only grazed.
  const enclosed = membersInBounds(layout, { minX: 300, maxX: 1700, minY: 1500, maxY: 2500 });
  assert.deepEqual(enclosed, [{ kind: 'wall', id: left.id }]);
  const grazed = membersInBounds(layout, { minX: 5500, maxX: 6200, minY: 1500, maxY: 2500 });
  assert.deepEqual(grazed, []);
});

test('membersInBounds includes braces fully inside the rubber band', () => {
  const wall = newWall(randomUUID(), 1000, 1000);
  const brace = newBrace(randomUUID(), 3000, 3000);
  const layout: Layout = { schemaVersion: 1, walls: [wall], braces: [brace] };
  const hit = membersInBounds(layout, { minX: 2700, maxX: 3300, minY: 2700, maxY: 3300 });
  assert.deepEqual(hit, [{ kind: 'brace', id: brace.id }]);
  const grazed = membersInBounds(layout, { minX: 2980, maxX: 3020, minY: 2980, maxY: 3020 });
  assert.deepEqual(grazed, []);
});

test('membersInBounds requires the stair footprint to lie fully inside the rubber band', () => {
  const platform = newPlatform(randomUUID(), 4000, 3000);
  const stair = newStair(randomUUID(), AUDIENCE_FLOOR_ID, platform.id, 4000, 2000);
  const layout: Layout = { schemaVersion: 1, walls: [], braces: [], platforms: [platform], stairs: [stair] };
  const grazed = membersInBounds(layout, { minX: 3990, maxX: 4010, minY: 1990, maxY: 2010 });
  assert.equal(grazed.some(item => item.kind === 'stair'), false);
  const enclosed = membersInBounds(layout, { minX: 3000, maxX: 5000, minY: 500, maxY: 3500 });
  assert.equal(enclosed.some(item => item.kind === 'stair'), true);
  const far = membersInBounds(layout, { minX: 9000, maxX: 9100, minY: 9000, maxY: 9100 });
  assert.equal(far.some(item => item.kind === 'stair'), false);
});

test('copying every rubber-band hit duplicates the multi-selection with new ids', () => {
  const left = { ...newWall(randomUUID(), 1000, 2000), panelId: randomUUID() };
  const right = { ...newWall(randomUUID(), 4000, 2000), panelId: randomUUID() };
  const layout: Layout = { schemaVersion: 1, walls: [left, right], braces: [] };
  const selected = membersInBounds(layout, { minX: 0, maxX: 5000, minY: 0, maxY: 4000 });
  const clipboard = copySelection(layout, selected.map(item => ({ kind: 'wall' as const, id: item.id })));
  assert(clipboard);
  assert.equal(clipboard.walls.length, 2);
  const pasted = pasteClipboard(layout, clipboard, randomUUID);
  assert.equal(pasted.layout.walls.length, 4);
  assert.equal(pasted.pasted.length, 2);
  assert.equal(pasted.layout.walls.filter(wall => wall.panelId === undefined).length, 2);
});
