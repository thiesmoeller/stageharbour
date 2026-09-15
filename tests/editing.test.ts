import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newWall, newBrace, layoutSchema, type Layout } from '../src/shared/layout.js';
import { newPlaceholder } from '../src/shared/placeholders.js';
import { newPlatform } from '../src/shared/levels.js';
import { applyWallFinish, normalizeRotation, selectionPivot, transformSelection } from '../src/shared/editing.js';
import { copySelection, cutSelection, pasteClipboard, removeSelection } from '../src/shared/clipboard.js';
import { execute, history, undo, redo } from '../src/shared/history.js';
import { snapRotation } from '../src/shared/snapping.js';
import {
  copyVenueSelection, cutVenueSelection, pasteVenueSelection, removeVenueSelection, transformVenue, venueObjectsInBounds,
} from '../src/shared/venueEditing.js';
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

test('applyWallFinish paints or clears the same surface on every selected wall', () => {
  const left = newWall(randomUUID(), 1000, 2000);
  const right = { ...newWall(randomUUID(), 4000, 2000), finish: 'library:color-white' as const };
  const other = newWall(randomUUID(), 7000, 2000);
  const layout: Layout = { schemaVersion: 1, walls: [left, right, other], braces: [] };
  const painted = applyWallFinish(layout, [left.id, right.id], 'library:color-black');
  assert.equal(painted.walls.find(wall => wall.id === left.id)?.finish, 'library:color-black');
  assert.equal(painted.walls.find(wall => wall.id === right.id)?.finish, 'library:color-black');
  assert.equal(painted.walls.find(wall => wall.id === other.id)?.finish, undefined);
  const cleared = applyWallFinish(painted, [left.id, right.id], undefined);
  assert.equal('finish' in (cleared.walls.find(wall => wall.id === left.id) ?? {}), false);
  assert.equal('finish' in (cleared.walls.find(wall => wall.id === right.id) ?? {}), false);
  assert.equal(left.finish, undefined);
});

test('permanent venue walls and platforms transform together without altering the saved source', () => {
  const wall = newWall(randomUUID(), 1000, 1000);
  const platform = newPlatform(randomUUID(), 3000, 1000);
  const chair = newPlaceholder('chair', randomUUID(), 2000, 500);
  const venue = { schemaVersion: 1 as const, width: 8000, depth: 6000, walls: [wall], platforms: [platform], placeholders: [chair] };
  const moved = transformVenue(venue, [wall.id, platform.id], { x: 100, y: 200, rotation: 90 });
  assert.deepEqual([moved.walls![0]!.x, moved.walls![0]!.y], [2100, 200]);
  assert.equal(wall.x, 1000);
  assert.equal(moved.walls![0]!.rotation, 90);
  const spun = transformVenue(venue, [chair.id], { x: 50, y: 0, rotation: 45 });
  assert.equal(spun.placeholders![0]!.rotation, 45);
  assert.equal(spun.placeholders![0]!.x, 2050);
  assert.equal(stageModel({ schemaVersion: 1, walls: [], braces: [] }, spun).placeholders.some(item => item.id === chair.id), true);
  assert.equal(stageModel({ schemaVersion: 1, walls: [], braces: [] }, moved).walls[0]!.id, wall.id);
  assert.equal(transformVenue(venue, [wall.id], { x: Infinity, y: 0, rotation: 0 }), venue);
});

test('venue podium rotation turns the outline around its centroid', () => {
  const platform = newPlatform(randomUUID(), 4000, 3000);
  const before = platform.outline.map(point => ({ ...point }));
  const venue = { schemaVersion: 1 as const, width: 8000, depth: 6000, platforms: [platform] };
  const turned = transformVenue(venue, [platform.id], { x: 0, y: 0, rotation: 90 });
  assert.notDeepEqual(turned.platforms![0]!.outline, before);
  assert.deepEqual(
    {
      x: Math.round(turned.platforms![0]!.outline.reduce((sum, p) => sum + p.x, 0) / 4),
      y: Math.round(turned.platforms![0]!.outline.reduce((sum, p) => sum + p.y, 0) / 4),
    },
    { x: 4000, y: 3000 },
  );
});

test('venue rubberband, clipboard and dependent deletion keep platform references valid', () => {
  const wall = newWall(randomUUID(), 1000, 1000);
  const platform = newPlatform(randomUUID(), 5000, 4000);
  const supported = { ...newWall(randomUUID(), 5000, 4000), supportingSurfaceId: platform.id };
  const venue = { schemaVersion: 1 as const, width: 8000, depth: 6000, walls: [wall, supported], platforms: [platform] };
  assert.deepEqual(venueObjectsInBounds(venue, { minX: 500, maxX: 1500, minY: 500, maxY: 1500 }), [wall.id]);
  assert.equal(removeVenueSelection(venue, [platform.id]).blocked, true);
  assert.equal(removeVenueSelection(venue, [platform.id, supported.id]).blocked, false);
  const copied = pasteVenueSelection(venue, copyVenueSelection(venue, [wall.id])!, randomUUID);
  assert.equal(copied.venue.walls!.length, 3);
  assert.notEqual(copied.ids[0], wall.id);
  const cut = cutVenueSelection(venue, [wall.id]);
  assert.equal(cut.blocked, false);
  assert.equal(cut.venue.walls!.length, 1);
  const restored = pasteVenueSelection(cut.venue, cut.clipboard!, randomUUID);
  assert.equal(restored.venue.walls!.find(item => item.id === wall.id)?.x, wall.x);
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
