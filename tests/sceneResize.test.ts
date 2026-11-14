import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyPushPull } from '../src/shared/pushPull.js';
import { sceneResizeDocument, resizedScene } from '../src/shared/sceneResize.js';
import { layoutSchema, venueGeometrySchema, type Layout, type LayoutObject } from '../src/shared/layout.js';
import { createLayoutPartIndex, resolveLayoutObjectDetails } from '../src/shared/layoutObjects.js';
import { sceneLists } from '../src/shared/partLists.js';
import { STARTER_LIBRARY, STARTER_PART_IDS } from '../src/shared/parts/starter/index.js';

const index = createLayoutPartIndex(STARTER_LIBRARY);
const venue = venueGeometrySchema.parse({
  schemaVersion: 1, width: 12000, depth: 8000,
  walls: [{
    id: '10000000-0000-4000-8000-000000000099', label: 'Saalwand',
    x: 100, y: 100, rotation: 0, width: 5000, height: 3000, thickness: 200,
  }],
});

const ids = {
  wall: '20000000-0000-4000-8000-000000000010',
  deck: '20000000-0000-4000-8000-000000000011',
  solid: '20000000-0000-4000-8000-000000000012',
  box: '20000000-0000-4000-8000-000000000013',
} as const;

function wall(): LayoutObject {
  return {
    id: ids.wall, label: 'Wand', part: { id: STARTER_PART_IDS.wall, revision: 1 }, variant: 'plain',
    values: { B: 1200, H: 2400, D: 28 }, x: 4000, y: 3000, rotation: 90,
  };
}
function deck(): LayoutObject {
  return {
    id: ids.deck, label: 'Bühne', part: { id: STARTER_PART_IDS.deck, revision: 1 }, variant: '2x1',
    x: 3000, y: 2000, rotation: 0,
  };
}
function solid(): LayoutObject {
  return {
    id: ids.solid, label: 'Block', part: { id: STARTER_PART_IDS.solidPlatform, revision: 1 },
    values: { B: 2000, T: 1000, H: 400 }, x: 1000, y: 1000, rotation: 0,
  };
}
function box(): LayoutObject {
  return {
    id: ids.box, label: 'Kiste', part: { id: STARTER_PART_IDS.box, revision: 1 },
    x: 500, y: 500, rotation: 0,
  };
}
function layoutOf(...objects: LayoutObject[]): Layout {
  return layoutSchema.parse({ schemaVersion: 2, objects, joints: [] });
}
function pull(layout: Layout, handle: Parameters<typeof applyPushPull>[1], delta: number) {
  const document = sceneResizeDocument(layout, venue, index);
  return resizedScene(layout, applyPushPull(document, handle, delta), index);
}
const objectOf = (layout: Layout, id: string) => layout.objects.find(item => item.id === id)!;
function demand(layout: Layout, partId: string, variant: string) {
  const { objects } = resolveLayoutObjectDetails(layout, index);
  const lists = sceneLists({ objects, context: index.context, stock: { items: [], counts: [] } });
  return lists.stock.rows.find(row => row.partId === partId && row.variantKey === variant)?.required ?? 0;
}

test('Größe ziehen on a scene wall grows the dragged face and keeps the opposite face', () => {
  const layout = layoutOf(wall(), box());
  const document = sceneResizeDocument(layout, venue, index);
  assert.equal(document.walls?.some(item => item.id === ids.wall), true);
  assert.equal(document.walls?.some(item => item.label === 'Saalwand'), false);
  assert.equal(document.platforms?.some(item => item.id === ids.box), false);

  const wider = pull(layout, { kind: 'wall', id: ids.wall, face: 'px' }, 200);
  const moved = objectOf(wider, ids.wall);
  assert.equal(moved.values?.B, 1400);
  assert.equal(moved.values?.H, 2400);
  assert.equal(moved.values?.D, 28);
  assert.equal(moved.x, 4000);
  assert.equal(moved.y, 3100);
  assert.equal(moved.rotation, 90);
  assert.deepEqual(objectOf(wider, ids.box), box());

  const taller = pull(layout, { kind: 'wall', id: ids.wall, face: 'py' }, 100);
  assert.equal(objectOf(taller, ids.wall).values?.H, 2500);
  assert.equal(objectOf(taller, ids.wall).x, 4000);
  assert.equal(objectOf(taller, ids.wall).y, 3000);
});

test('Größe ziehen on a Bühnenelement snaps to 0.5 m and keeps one podium', () => {
  const layout = layoutOf(deck());
  const wider = pull(layout, { kind: 'platform', id: ids.deck, face: 'px' }, 2000);
  assert.equal(layoutSchema.safeParse(wider).success, true);
  assert.equal(wider.objects.length, 1);
  const podium = objectOf(wider, ids.deck);
  assert.equal(podium.values?.BO, 4000);
  assert.equal(podium.values?.TO, 1000);
  assert.equal(podium.values?.H, undefined);
  assert.equal(podium.x, 4000);
  assert.equal(podium.y, 2000);
  assert.equal(demand(wider, STARTER_PART_IDS.deck, '2x1'), 2);
  assert.equal(demand(wider, STARTER_PART_IDS.deckLeg, '600'), 8);

  const again = pull(wider, { kind: 'platform', id: ids.deck, face: 'px' }, 2000);
  assert.equal(again.objects.length, 1);
  assert.equal(objectOf(again, ids.deck).values?.BO, 6000);
  assert.equal(objectOf(again, ids.deck).values?.TO, 1000);
  assert.equal(objectOf(again, ids.deck).x, 5000);
  assert.equal(demand(again, STARTER_PART_IDS.deck, '2x1'), 3);

  const higher = pull(layout, { kind: 'platform', id: ids.deck, face: 'py' }, 250);
  assert.equal(higher.objects.length, 1);
  assert.equal(objectOf(higher, ids.deck).values?.H, 800);
  assert.equal(objectOf(higher, ids.deck).values?.BO, undefined);
  assert.equal(objectOf(higher, ids.deck).x, 3000);
  assert.equal(objectOf(higher, ids.deck).y, 2000);
  assert.equal(demand(higher, STARTER_PART_IDS.deck, '2x1'), 1);
});

test('an oversized Bühnenelement stays one outline when its height is pulled', () => {
  const layout = layoutOf({
    ...deck(),
    values: { BO: 4000, TO: 2000, H: 600 },
  });
  const higher = pull(layout, { kind: 'platform', id: ids.deck, face: 'py' }, 250);
  assert.equal(higher.objects.length, 1);
  const podium = objectOf(higher, ids.deck);
  assert.equal(podium.values?.H, 800);
  assert.equal(podium.values?.BO, 4000);
  assert.equal(podium.values?.TO, 2000);
  assert.equal(demand(higher, STARTER_PART_IDS.deck, '2x1'), 4);
  assert.equal(demand(higher, STARTER_PART_IDS.deckLeg, '800'), 16);
});

test('a podium that is not one catalog size demands the mixed stock modules', () => {
  const layout = layoutOf({
    ...deck(),
    values: { BO: 1000, TO: 1500, H: 600 },
  });
  assert.equal(layout.objects.length, 1);
  assert.equal(demand(layout, STARTER_PART_IDS.deck, '1x1'), 1);
  assert.equal(demand(layout, STARTER_PART_IDS.deck, '1x05'), 1);
  assert.equal(demand(layout, STARTER_PART_IDS.deck, '2x05'), 0);
  assert.equal(demand(layout, STARTER_PART_IDS.deck, '2x1'), 0);
  assert.equal(demand(layout, STARTER_PART_IDS.deckLeg, '600'), 8);
});

test('shrinking a Bühnenelement back to one catalog module clears the podium override', () => {
  const wide = pull(layoutOf(deck()), { kind: 'platform', id: ids.deck, face: 'px' }, 2000);
  const back = pull(wide, { kind: 'platform', id: ids.deck, face: 'nx' }, -2000);
  const podium = objectOf(back, ids.deck);
  assert.equal(back.objects.length, 1);
  assert.equal(podium.variant, '2x1');
  assert.equal(podium.values, undefined);
  assert.equal(podium.x, 5000);
  assert.equal(demand(back, STARTER_PART_IDS.deck, '2x1'), 1);
});

test('a massives Podest grows by the dragged millimetres without the deck module grid', () => {
  const layout = layoutOf(solid());
  const wider = pull(layout, { kind: 'platform', id: ids.solid, face: 'px' }, 200);
  const moved = objectOf(wider, ids.solid);
  assert.equal(moved.values?.B, 2200);
  assert.equal(moved.values?.T, 1000);
  assert.equal(moved.values?.H, 400);
  assert.equal(moved.x, 1100);
  assert.equal(moved.y, 1000);
  assert.equal(wider.objects.length, 1);
});
