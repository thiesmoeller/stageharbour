import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newWall, newBrace, layoutSchema, type Layout } from '../src/shared/layout.js';
import { newPlaceholder } from '../src/shared/placeholders.js';
import { newPlatform } from '../src/shared/levels.js';
import { normalizeRotation, selectionPivot, transformSelection } from '../src/shared/editing.js';
import { copySelection, cutSelection, pasteClipboard, removeSelection } from '../src/shared/clipboard.js';
import { execute, history, undo, redo } from '../src/shared/history.js';
import { snapRotation } from '../src/shared/snapping.js';
import { transformVenue } from '../src/shared/venueEditing.js';
import { stageModel } from '../src/shared/transforms.js';

test('mixed 2D/3D transforms rotate around one pivot, preserve model identity and undo in one step', () => {
  const wall = newWall(randomUUID(), 1000, 1000), brace = newBrace(randomUUID(), 3000, 1000);
  const model = { ...newPlaceholder('box', randomUUID(), 2000, 2000), assetId: randomUUID() };
  const platform = newPlatform(randomUUID(), 2000, 0);
  const layout: Layout = { schemaVersion: 1, walls: [wall], braces: [brace], placeholders: [model], platforms: [platform] };
  const selected = [{ kind: 'wall' as const, id: wall.id }, { kind: 'brace' as const, id: brace.id }, { kind: 'placeholder' as const, id: model.id }, { kind: 'platform' as const, id: platform.id }];
  assert.deepEqual(selectionPivot(layout, selected), { x: 2000, y: 1000 });
  const moved = transformSelection(layout, selected, { x: 100, y: 200, rotation: 90 });
  assert.deepEqual([moved.walls[0]!.x, moved.walls[0]!.y], [2100, 200]);
  assert.equal(moved.placeholders![0]!.assetId, model.assetId);
  const edited = execute(history(layout), moved);
  assert.equal(edited.past.length, 1);
  assert.deepEqual(undo(edited).present, layout);
  assert.deepEqual(redo(undo(edited)).present, moved);
  assert(layoutSchema.safeParse(moved).success);
});

test('invalid transforms preserve the previous document and repeated rotations normalize', () => {
  const wall = newWall(randomUUID(), 99990, 0);
  const layout: Layout = { schemaVersion: 1, walls: [wall], braces: [] };
  const selected = [{ kind: 'wall' as const, id: wall.id }];
  assert.equal(transformSelection(layout, selected, { x: 100, y: 0, rotation: 0 }), layout);
  assert.equal(transformSelection(layout, selected, { x: NaN, y: 0, rotation: 0 }), layout);
  assert.equal(normalizeRotation(375), 15);
  assert.equal(transformSelection(layout, selected, { x: 0, y: 0, rotation: 375 }).walls[0]!.rotation, 15);
  assert.equal(snapRotation(14), 15);
  assert.equal(snapRotation(89), 90);
});

test('permanent venue walls and platforms transform together without altering the saved source', () => {
  const wall = newWall(randomUUID(), 1000, 1000);
  const platform = newPlatform(randomUUID(), 3000, 1000);
  const venue = { schemaVersion: 1 as const, width: 8000, depth: 6000, walls: [wall], platforms: [platform] };
  const moved = transformVenue(venue, [wall.id, platform.id], { x: 100, y: 200, rotation: 90 });
  assert.deepEqual([moved.walls![0]!.x, moved.walls![0]!.y], [2100, 200]);
  assert.equal(wall.x, 1000);
  assert.equal(moved.walls![0]!.rotation, 90);
  assert.equal(stageModel({ schemaVersion: 1, walls: [], braces: [] }, moved).walls[0]!.id, wall.id);
  assert.equal(transformVenue(venue, [wall.id], { x: Infinity, y: 0, rotation: 0 }), venue);
});

test('marquee clipboard and deletion include models; copy keeps asset references, cut keeps placement identities', () => {
  const model = { ...newPlaceholder('box', randomUUID(), 1000, 1000), assetId: randomUUID() };
  const brace = newBrace(randomUUID(), 2000, 1000);
  const layout: Layout = { schemaVersion: 1, walls: [], braces: [brace], placeholders: [model] };
  const selected = [{ kind: 'placeholder' as const, id: model.id }, { kind: 'brace' as const, id: brace.id }];
  const copied = pasteClipboard(layout, copySelection(layout, selected)!, randomUUID);
  assert.equal(copied.layout.placeholders!.length, 2);
  assert.notEqual(copied.layout.placeholders![1]!.id, model.id);
  assert.equal(copied.layout.placeholders![1]!.assetId, model.assetId);
  assert.equal(removeSelection(layout, selected).placeholders!.length, 0);
  assert.equal(removeSelection(layout, selected).braces.length, 0);
  const cut = cutSelection(layout, selected);
  const pasted = pasteClipboard(cut.layout, cut.clipboard!, randomUUID);
  assert.equal(pasted.layout.placeholders![0]!.id, model.id);
  assert.equal(pasted.consumed, true);
});
