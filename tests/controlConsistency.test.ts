import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newWall, newBrace, type Layout, type VenueGeometry } from '../src/shared/layout.js';
import { newPlatform } from '../src/shared/levels.js';
import { newPlaceholder } from '../src/shared/placeholders.js';
import { transformLayoutGesture, transformVenueGesture } from '../src/shared/plannerTransforms.js';
import { sceneResizeDocument, resizedScene } from '../src/shared/sceneResize.js';
import { applyPushPull } from '../src/shared/pushPull.js';
import { navigatePlan } from '../src/client/editor/planNavigation.js';

const venue: VenueGeometry = { schemaVersion: 1, width: 8000, depth: 6000 };
test('mixed platform and wall translation preserves relative geometry and orientation', () => {
  const wall = { ...newWall(randomUUID(), 2000, 2000), rotation: 37 };
  const platform = newPlatform(randomUUID(), 5000, 3000);
  const layout: Layout = { schemaVersion: 1, walls: [wall], braces: [], platforms: [platform] };
  const members = [{ kind: 'wall' as const, id: wall.id }, { kind: 'platform' as const, id: platform.id }];
  const result = transformLayoutGesture(layout, venue, members, { x: 500, y: -200, rotation: 90 }, 'translate', true).layout;
  assert.equal(result.walls[0]!.rotation, 37);
  assert.equal(result.walls[0]!.x, 2500);
  assert.deepEqual(result.platforms![0]!.outline, platform.outline.map(p => ({ x: p.x + 500, y: p.y - 200 })));
});

test('stage and venue rotate with the same angle tolerance and never translate on rotation', () => {
  const wall = newWall(randomUUID(), 2000, 2000);
  const layout: Layout = { schemaVersion: 1, walls: [wall], braces: [] };
  for (const [rotation, expected] of [[7, 7], [14, 15], [91, 90]]) {
    const delta = { x: 100, y: 100, rotation: rotation! };
    const stage = transformLayoutGesture(layout, venue, [{ kind: 'wall', id: wall.id }], delta, 'rotate', false).layout.walls[0]!;
    const permanent = transformVenueGesture({ ...venue, walls: [wall] }, [wall.id], delta, 'rotate', false).venue.walls![0]!;
    assert.equal(stage.rotation, expected); assert.deepEqual(permanent, stage);
    assert.equal(stage.x, wall.x); assert.equal(stage.y, wall.y);
  }
});

test('placeholders snap identically against a wall in stage and venue, including Alt bypass', () => {
  const wall = newWall(randomUUID(), 2000, 2000);
  const prop = newPlaceholder('box', randomUUID(), 4000, 2000);
  const layout: Layout = { schemaVersion: 1, walls: [wall], braces: [], placeholders: [prop] };
  for (const bypass of [false, true]) {
    const delta = { x: -1060, y: 0, rotation: 0 };
    const stage = transformLayoutGesture(layout, venue, [{ kind: 'placeholder', id: prop.id }], delta, 'translate', bypass);
    const permanent = transformVenueGesture({ ...venue, walls: [wall], placeholders: [prop] }, [prop.id], delta, 'translate', bypass);
    assert.deepEqual(stage.layout.placeholders, permanent.venue.placeholders);
    assert.deepEqual(stage.guides, permanent.guides);
    if (bypass) assert.equal(stage.layout.placeholders![0]!.x, 2940);
  }
});

test('brace translation cannot align or rotate implicitly even near a wall', () => {
  const brace = { ...newBrace(randomUUID(), 2000, 2200), rotation: 37 };
  const layout: Layout = { schemaVersion: 1, walls: [newWall(randomUUID(), 2000, 2000)], braces: [brace] };
  for (const bypass of [false, true]) {
    assert.equal(transformLayoutGesture(layout, venue, [{ kind: 'brace', id: brace.id }], { x: 0, y: 30, rotation: 0 }, 'translate', bypass).layout.braces[0]!.rotation, 37);
  }
});

test('scene resizing changes the selected placeholder and preserves permanent platforms', () => {
  const platform = newPlatform(randomUUID(), 2000, 2000);
  const prop = newPlaceholder('box', randomUUID(), 2000, 2000);
  const layout: Layout = { schemaVersion: 1, walls: [], braces: [], placeholders: [prop] };
  const permanent = { ...venue, platforms: [platform] };
  const resized = applyPushPull(sceneResizeDocument(layout, permanent), { kind: 'placeholder', id: prop.id, face: 'px' }, 200);
  const next = resizedScene(layout, resized);
  assert.equal(next.placeholders![0]!.width, prop.width + 200);
  assert.equal(next.placeholders![0]!.x, prop.x + 100);
  assert.deepEqual(next.platforms, []);
  assert.deepEqual(permanent.platforms, [platform]);
});

test('zoom keeps the pointer anchored and Shift-wheel pans in plan units', () => {
  const view = { zoom: 1, pan: { x: 50, y: 100 }, centre: { x: 4000, y: 3000 } };
  const cursor = { x: 2000, y: 1500 };
  const zoomed = navigatePlan({ ctrlKey: true, metaKey: false, shiftKey: false, deltaX: 0, deltaY: -100 }, view, cursor)!;
  for (const key of ['x', 'y'] as const) assert(Math.abs((cursor[key] - view.centre[key] - zoomed.pan[key]) * zoomed.zoom - (cursor[key] - view.centre[key] - view.pan[key])) < 1e-8);
  assert.deepEqual(navigatePlan({ ctrlKey: false, metaKey: false, shiftKey: true, deltaX: 10, deltaY: 20 }, view, cursor), { zoom: 1, pan: { x: 70, y: 60 } });
});
