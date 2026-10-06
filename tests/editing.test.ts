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
import { newLightingFixture } from '../src/shared/hangPlan.js';

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
  const right = {
    ...newWall(randomUUID(), 4000, 2000),
    surfaces: { front: { full: { kind: 'library' as const, ref: 'library:color-white' } } },
  };
  const other = newWall(randomUUID(), 7000, 2000);
  const layout: Layout = { schemaVersion: 1, walls: [left, right, other], braces: [] };
  const painted = applyWallFinish(layout, [left.id, right.id], 'library:color-black');
  const leftFront = painted.walls.find(wall => wall.id === left.id)?.surfaces?.front?.full;
  const rightFront = painted.walls.find(wall => wall.id === right.id)?.surfaces?.front?.full;
  assert.equal(leftFront?.kind, 'library');
  assert.equal(leftFront?.kind === 'library' ? leftFront.ref : undefined, 'library:color-black');
  assert.equal(rightFront?.kind === 'library' ? rightFront.ref : undefined, 'library:color-black');
  assert.deepEqual(painted.walls.find(wall => wall.id === left.id)?.surfaces?.back?.full, leftFront);
  assert.deepEqual(painted.walls.find(wall => wall.id === left.id)?.surfaces?.edge, leftFront);
  assert.equal(painted.walls.find(wall => wall.id === other.id)?.surfaces, undefined);
  const cleared = applyWallFinish(painted, [left.id, right.id], undefined);
  assert.equal(cleared.walls.find(wall => wall.id === left.id)?.surfaces, undefined);
  assert.equal(cleared.walls.find(wall => wall.id === right.id)?.surfaces, undefined);
  assert.equal(left.surfaces, undefined);
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
  // Wall footprint spans ~400–1600; rubber band must enclose it fully.
  assert.deepEqual(venueObjectsInBounds(venue, { minX: 300, maxX: 1700, minY: 500, maxY: 1500 }), [wall.id]);
  assert.deepEqual(venueObjectsInBounds(venue, { minX: 500, maxX: 1500, minY: 500, maxY: 1500 }), []);
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

test('copying a truss duplicates hang points and lighting fixtures with new identities', () => {
  const trussId = randomUUID();
  const hangA = randomUUID();
  const hangB = randomUUID();
  const fixtureA = randomUUID();
  const fixtureB = randomUUID();
  const truss = {
    id: trussId, label: 'T1', x: 4000, y: 3000, rotation: 0,
    length: 6000, sectionWidth: 400, bottomHeight: 3500, thickness: 300,
    hangPoints: [{ id: hangA, offsetMm: -1000 }, { id: hangB, offsetMm: 1000 }],
  };
  const venue = {
    schemaVersion: 1 as const, width: 12000, depth: 8000,
    trusses: [truss],
    hangPlan: {
      fixtures: [
        newLightingFixture(fixtureA, trussId, hangA, 'fresnel', { label: 'F1' }),
        newLightingFixture(fixtureB, trussId, hangB, 'flood', { label: 'F2' }),
      ],
    },
  };
  const pasted = pasteVenueSelection(venue, copyVenueSelection(venue, [trussId])!, randomUUID, { x: 0, y: 1500 });
  assert.equal(pasted.venue.trusses!.length, 2);
  assert.equal(pasted.venue.hangPlan!.fixtures.length, 4);
  const copyTruss = pasted.venue.trusses!.find(item => item.id !== trussId)!;
  assert.notEqual(copyTruss.hangPoints[0]!.id, hangA);
  assert.notEqual(copyTruss.hangPoints[1]!.id, hangB);
  const copyFixtures = pasted.venue.hangPlan!.fixtures.filter(item => item.trussId === copyTruss.id);
  assert.equal(copyFixtures.length, 2);
  assert.deepEqual(copyFixtures.map(item => item.label).sort(), ['F1', 'F2']);
  assert.ok(copyFixtures.every(item => item.id !== fixtureA && item.id !== fixtureB));
  assert.ok(copyFixtures.every(item => copyTruss.hangPoints.some(hang => hang.id === item.hangPointId)));
  const removed = removeVenueSelection(venue, [trussId]);
  assert.equal(removed.blocked, false);
  assert.equal(removed.venue.trusses!.length, 0);
  assert.equal(removed.venue.hangPlan?.fixtures.length ?? 0, 0);
  const cut = cutVenueSelection(venue, [trussId]);
  assert.equal(cut.blocked, false);
  assert.equal(cut.venue.hangPlan?.fixtures.length ?? 0, 0);
  const restored = pasteVenueSelection(cut.venue, cut.clipboard!, randomUUID, { x: 500, y: 0 });
  assert.equal(restored.venue.trusses!.length, 1);
  assert.equal(restored.venue.hangPlan!.fixtures.length, 2);
  assert.equal(restored.venue.hangPlan!.fixtures[0]!.id, fixtureA);
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
