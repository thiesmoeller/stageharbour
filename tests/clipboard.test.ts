import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { recordConnection } from '../src/shared/assembly.js';
import { PASTE_OFFSET_MM, copySelection, cutSelection, pasteClipboard, removeSelection } from '../src/shared/clipboard.js';
import { formGroup } from '../src/shared/groups.js';
import { execute, history, undo } from '../src/shared/history.js';
import { newWall, type Layout } from '../src/shared/layout.js';

const panelId = '11111111-1111-4111-8111-111111111111';

function twoAssignedWalls(): { left: ReturnType<typeof newWall>; right: ReturnType<typeof newWall>; outsider: ReturnType<typeof newWall>; layout: Layout } {
  const left = { ...newWall(randomUUID(), 1000, 2000), panelId, assemblyNumber: 1 };
  const right = { ...newWall(randomUUID(), 5000, 2000), panelId: randomUUID(), assemblyNumber: 2 };
  const outsider = { ...newWall(randomUUID(), 9000, 4000), panelId: randomUUID(), assemblyNumber: 3 };
  const base: Layout = { schemaVersion: 1, walls: [left, right, outsider], braces: [] };
  const grouped = formGroup(base, [{ kind: 'wall', id: left.id }, { kind: 'wall', id: right.id }], randomUUID());
  const connected = recordConnection(recordConnection(grouped, left.id, right.id), right.id, outsider.id);
  return { left, right, outsider, layout: connected };
}

test('copying a grouped selection yields new ids, drops panel assignments and remaps internal connections', () => {
  const { left, right, outsider, layout } = twoAssignedWalls();
  const clipboard = copySelection(layout, [{ kind: 'wall', id: left.id }, { kind: 'wall', id: right.id }]);
  assert(clipboard);
  const pasted = pasteClipboard(layout, clipboard, randomUUID).layout;
  const copies = pasted.walls.filter(wall => wall.id !== left.id && wall.id !== right.id && wall.id !== outsider.id);
  assert.equal(copies.length, 2);
  assert.notEqual(copies[0]?.id, left.id);
  assert.notEqual(copies[1]?.id, right.id);
  assert.equal(copies[0]?.panelId, undefined);
  assert.equal(copies[1]?.panelId, undefined);
  assert.equal(copies[0]?.assemblyNumber, undefined);
  assert.equal(copies[1]?.assemblyNumber, undefined);
  assert.equal(pasted.walls.find(wall => wall.id === left.id)?.panelId, panelId);
  const copyIds = new Set(copies.map(wall => wall.id));
  const copyGroup = pasted.groups?.find(group => group.members.every(member => copyIds.has(member.id)));
  assert.equal(copyGroup?.members.length, 2);
  assert.notEqual(copyGroup?.id, layout.groups?.[0]?.id);
  const copyConnection = pasted.connections?.find(connection => copyIds.has(connection.a) && copyIds.has(connection.b));
  assert(copyConnection);
  assert.notEqual(copyConnection.id, layout.connections?.find(connection =>
    (connection.a === left.id && connection.b === right.id) || (connection.a === right.id && connection.b === left.id),
  )?.id);
  assert.equal(pasted.connections?.some(connection =>
    (copyIds.has(connection.a) || copyIds.has(connection.b)) && (connection.a === outsider.id || connection.b === outsider.id),
  ), false);
  const ids = new Set(pasted.walls.map(wall => wall.id));
  assert.equal((pasted.connections ?? []).every(connection => ids.has(connection.a) && ids.has(connection.b)), true);
});

test('paste offset is 300 mm in +x and +y from the clipboard geometry', () => {
  assert.equal(PASTE_OFFSET_MM, 300);
  const wall = { ...newWall(randomUUID(), 1000, 2000), panelId };
  const layout: Layout = { schemaVersion: 1, walls: [wall], braces: [] };
  const clipboard = copySelection(layout, [{ kind: 'wall', id: wall.id }]);
  assert(clipboard);
  const copyId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const copy = pasteClipboard(layout, clipboard, () => copyId).layout.walls.find(item => item.id === copyId);
  assert.equal(copy?.x, 1300);
  assert.equal(copy?.y, 2300);
  assert.equal(copy?.panelId, undefined);
});

test('cut removes originals; paste keeps identities and panel assignments', () => {
  const { left, right, outsider, layout } = twoAssignedWalls();
  const originalGroupId = layout.groups![0]!.id;
  const internal = layout.connections!.find(connection =>
    (connection.a === left.id && connection.b === right.id) || (connection.a === right.id && connection.b === left.id),
  )!;
  const { layout: cutLayout, clipboard } = cutSelection(layout, [{ kind: 'wall', id: left.id }, { kind: 'wall', id: right.id }]);
  assert(clipboard);
  assert.deepEqual(cutLayout.walls.map(wall => wall.id), [outsider.id]);
  assert.equal(cutLayout.groups?.length ?? 0, 0);
  assert.equal((cutLayout.connections ?? []).some(connection =>
    connection.a === left.id || connection.b === left.id || connection.a === right.id || connection.b === right.id,
  ), false);
  const pasted = pasteClipboard(cutLayout, clipboard, randomUUID).layout;
  assert.equal(pasted.walls.find(wall => wall.id === left.id)?.panelId, panelId);
  assert.equal(pasted.walls.find(wall => wall.id === left.id)?.assemblyNumber, 1);
  assert.equal(pasted.walls.find(wall => wall.id === left.id)?.x, 1300);
  assert.equal(pasted.walls.find(wall => wall.id === right.id)?.x, 5300);
  assert.equal(pasted.walls.find(wall => wall.id === outsider.id)?.x, 9000);
  assert.equal(pasted.groups?.[0]?.id, originalGroupId);
  assert.deepEqual(new Set(pasted.groups?.[0]?.members.map(member => member.id)), new Set([left.id, right.id]));
  assert.equal(pasted.connections?.some(connection => connection.id === internal.id), true);
  assert.equal(pasted.connections?.some(connection => connection.a === outsider.id || connection.b === outsider.id), false);
});

test('undo of paste and cut restores geometry and panel assignments', () => {
  const { left, right, outsider, layout } = twoAssignedWalls();
  const { layout: cutLayout, clipboard } = cutSelection(layout, [{ kind: 'wall', id: left.id }, { kind: 'wall', id: right.id }]);
  assert(clipboard);
  const afterCut = execute(history(layout), cutLayout);
  const afterPaste = execute(afterCut, pasteClipboard(afterCut.present, clipboard, randomUUID).layout);
  assert.equal(afterPaste.present.walls.find(wall => wall.id === left.id)?.x, 1300);
  assert.deepEqual(undo(afterPaste).present, cutLayout);
  const restored = undo(undo(afterPaste)).present;
  assert.deepEqual(restored, layout);
  assert.equal(restored.walls.find(wall => wall.id === left.id)?.panelId, panelId);
  assert.equal(restored.walls.find(wall => wall.id === left.id)?.x, 1000);
  assert.equal(restored.walls.find(wall => wall.id === outsider.id)?.id, outsider.id);
});

test('removeSelection deletes every multi-selected wall', () => {
  const { left, right, outsider, layout } = twoAssignedWalls();
  const next = removeSelection(layout, [{ kind: 'wall', id: left.id }, { kind: 'wall', id: right.id }]);
  assert.deepEqual(next.walls.map(wall => wall.id), [outsider.id]);
  assert.equal(next.groups?.length ?? 0, 0);
});
