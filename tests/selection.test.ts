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

test('membersInBounds selects walls whose footprints meet the rubber band', () => {
  const left = newWall(randomUUID(), 1000, 2000);
  const right = newWall(randomUUID(), 6000, 2000);
  const far = newWall(randomUUID(), 9000, 4500);
  const layout: Layout = { schemaVersion: 1, walls: [left, right, far], braces: [] };
  const hit = membersInBounds(layout, { minX: 500, maxX: 6500, minY: 1500, maxY: 2500 });
  assert.deepEqual(hit.map(item => item.id).sort(), [left.id, right.id].sort());
  assert.equal(hit.every(item => item.kind === 'wall'), true);
});

test('membersInBounds includes braces that intersect the rubber band', () => {
  const wall = newWall(randomUUID(), 1000, 1000);
  const brace = newBrace(randomUUID(), 3000, 3000);
  const layout: Layout = { schemaVersion: 1, walls: [wall], braces: [brace] };
  const hit = membersInBounds(layout, { minX: 2800, maxX: 3200, minY: 2800, maxY: 3200 });
  assert.deepEqual(hit, [{ kind: 'brace', id: brace.id }]);
});

test('membersInBounds uses the stair footprint, not a fixed centre box', () => {
  const platform = newPlatform(randomUUID(), 4000, 3000);
  const stair = newStair(randomUUID(), AUDIENCE_FLOOR_ID, platform.id, 4000, 2000);
  const layout: Layout = { schemaVersion: 1, walls: [], braces: [], platforms: [platform], stairs: [stair] };
  const miss = membersInBounds(layout, { minX: 3990, maxX: 4010, minY: 1990, maxY: 2010 });
  assert.equal(miss.some(item => item.kind === 'stair'), true);
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
