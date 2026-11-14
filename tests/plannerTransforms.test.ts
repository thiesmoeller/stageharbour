import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutSchema, venueGeometrySchema, type Layout, type LayoutObject } from '../src/shared/layout.js';
import { createLayoutPartIndex, resolveLayoutObjects } from '../src/shared/layoutObjects.js';
import { STARTER_LIBRARY, STARTER_PART_IDS } from '../src/shared/parts/starter/index.js';
import { objectSnapShapes, transformLayoutGesture } from '../src/shared/plannerTransforms.js';

const ids = {
  wallA: '20000000-0000-4000-8000-000000000001',
  wallB: '20000000-0000-4000-8000-000000000002',
  table: '20000000-0000-4000-8000-000000000003',
  brace: '20000000-0000-4000-8000-000000000004',
} as const;
const index = createLayoutPartIndex(STARTER_LIBRARY);
const member = (id: string) => ({ kind: 'object' as const, id });
const venue = venueGeometrySchema.parse({ schemaVersion: 1, width: 8000, depth: 6000 });

function wall(id: string, x: number, y: number, rotation = 0): LayoutObject {
  return {
    id, label: 'Wand', part: { id: STARTER_PART_IDS.wall, revision: 1 }, variant: 'plain',
    values: { B: 1200, H: 2400, D: 28 }, x, y, rotation,
  };
}
function part(id: string, partId: string, x: number, y: number, variant?: string): LayoutObject {
  return { id, label: 'Teil', part: { id: partId, revision: 1 }, ...(variant ? { variant } : {}), x, y, rotation: 0 };
}
function layoutOf(...objects: LayoutObject[]): Layout {
  return layoutSchema.parse({ schemaVersion: 2, objects, joints: [] });
}
const resolve = (layout: Layout) => resolveLayoutObjects(layout, index);
const objectOf = (layout: Layout, id: string) => layout.objects.find(item => item.id === id)!;

test('snap shapes describe the footprint box of an object in its own frame', () => {
  const layout = layoutOf(wall(ids.wallA, 2000, 2500, 90));
  const shape = objectSnapShapes(resolve(layout)).get(ids.wallA)!;
  assert.equal(Math.round(shape.width), 1200);
  assert.equal(Math.round(shape.thickness), 28);
  assert(Math.abs(shape.cx) < 1e-6);
});

test('dragging a wall next to another wall snaps to its end and reports the mated hinge edges', () => {
  const layout = layoutOf(wall(ids.wallA, 2000, 2500), wall(ids.wallB, 4000, 2500));
  const result = transformLayoutGesture(layout, venue, [member(ids.wallB)], { x: -820, y: 12, rotation: 0 }, 'translate', false, resolve(layout));
  const moved = objectOf(result.layout, ids.wallB);
  assert.equal(moved.x, 3200);
  assert.equal(moved.y, 2500);
  assert(result.guides.length > 0, 'a guide shows what the wall snapped to');
  assert.deepEqual(result.connection, { moving: 'links', targetObject: ids.wallA, target: 'rechts' });
});

test('wall edges line up with a neighbouring wall even when no connector is in reach', () => {
  const layout = layoutOf(wall(ids.wallA, 2000, 2500), wall(ids.wallB, 5000, 3500));
  // 2.8 m to the right of wall A and 10 mm off its line: the faces line up, the gap stays.
  const result = transformLayoutGesture(layout, venue, [member(ids.wallB)], { x: -200, y: -990, rotation: 0 }, 'translate', false, resolve(layout));
  const moved = objectOf(result.layout, ids.wallB);
  assert.equal(moved.y, 2500);
  assert.equal(moved.x, 4800);
  assert(result.guides.some(guide => guide.kind === 'wall-edge'));
  assert.equal(result.connection, undefined);
});

test('Alt or a switched-off snap toggle keeps the free pointer position', () => {
  const layout = layoutOf(wall(ids.wallA, 2000, 2500), wall(ids.wallB, 4000, 2500));
  const result = transformLayoutGesture(layout, venue, [member(ids.wallB)], { x: -820, y: 12, rotation: 0 }, 'translate', true, resolve(layout));
  const moved = objectOf(result.layout, ids.wallB);
  assert.equal(moved.x, 3180);
  assert.equal(moved.y, 2512);
  assert.deepEqual(result.guides, []);
  assert.equal(result.connection, undefined);
});

test('furniture snaps its edge flush to a wall face', () => {
  const layout = layoutOf(wall(ids.wallA, 2000, 2500), part(ids.table, STARTER_PART_IDS.table, 2000, 1500));
  const shape = objectSnapShapes(resolve(layout)).get(ids.table)!;
  // Bring the table's far edge within 60 mm of the wall's audience face (y = 2500 - 14).
  const target = 2500 - 14 - shape.thickness / 2 - shape.cy;
  const result = transformLayoutGesture(layout, venue, [member(ids.table)], { x: 0, y: target - 60 - 1500, rotation: 0 }, 'translate', false, resolve(layout));
  assert(Math.abs(objectOf(result.layout, ids.table).y - target) < 1e-6);
  assert(result.guides.some(guide => guide.kind === 'wall-edge'));
});

test('rotating snaps to 15° steps and Alt keeps the free angle', () => {
  const layout = layoutOf(wall(ids.wallA, 2000, 2500));
  const snapped = transformLayoutGesture(layout, venue, [member(ids.wallA)], { x: 0, y: 0, rotation: 88.6 }, 'rotate', false, resolve(layout));
  assert.equal(objectOf(snapped.layout, ids.wallA).rotation, 90);
  const free = transformLayoutGesture(layout, venue, [member(ids.wallA)], { x: 0, y: 0, rotation: 88.6 }, 'rotate', true, resolve(layout));
  assert(Math.abs(objectOf(free.layout, ids.wallA).rotation - 88.6) < 1e-9);
});

test('a multi-selection rotates around its common centre and keeps its shape', () => {
  const layout = layoutOf(wall(ids.wallA, 2000, 2500), wall(ids.wallB, 4000, 2500));
  const members = [member(ids.wallA), member(ids.wallB)];
  const result = transformLayoutGesture(layout, venue, members, { x: 0, y: 0, rotation: 90 }, 'rotate', false, resolve(layout));
  const a = objectOf(result.layout, ids.wallA), b = objectOf(result.layout, ids.wallB);
  assert.deepEqual([Math.round(a.x), Math.round(a.y), a.rotation], [3000, 1500, 90]);
  assert.deepEqual([Math.round(b.x), Math.round(b.y), b.rotation], [3000, 3500, 90]);
});

test('moving or rotating drops an explicit support so the object can jump onto a podium', () => {
  const pinned = { ...wall(ids.wallA, 2000, 2500), support: '00000000-0000-4000-8000-000000000001' };
  const layout = layoutOf(pinned, wall(ids.wallB, 4000, 2500));
  const moved = transformLayoutGesture(layout, venue, [member(ids.wallA)], { x: 100, y: 0, rotation: 0 }, 'translate', true, resolve(layout));
  assert.equal(objectOf(moved.layout, ids.wallA).support, undefined);
  assert.equal(objectOf(moved.layout, ids.wallB).support, undefined);
  const turned = transformLayoutGesture(layout, venue, [member(ids.wallA)], { x: 0, y: 0, rotation: 20 }, 'rotate', true, resolve(layout));
  assert.equal(objectOf(turned.layout, ids.wallA).support, undefined);
});

test('objects snap to the stage centreline', () => {
  const withCentre = venueGeometrySchema.parse({ schemaVersion: 1, width: 8000, depth: 6000, stageCentreline: { x: 4000, y: 0, rotation: 90 } });
  const layout = layoutOf(part(ids.table, STARTER_PART_IDS.table, 1000, 3000));
  const result = transformLayoutGesture(layout, withCentre, [member(ids.table)], { x: 2950, y: 0, rotation: 0 }, 'translate', false, resolve(layout));
  assert.equal(objectOf(result.layout, ids.table).x, 4000);
  assert(result.guides.some(guide => guide.kind === 'centreline'));
});
