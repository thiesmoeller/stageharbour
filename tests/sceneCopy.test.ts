import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Layout, LayoutObject, VenueGeometry } from '../src/shared/layout.js';
import { AUDIENCE_FLOOR_ID } from '../src/shared/levels.js';
import { STARTER_PART_IDS } from '../src/shared/parts/starter/index.js';
import { copyLayoutIntoVenue, duplicateLayout } from '../src/shared/scenes.js';

const square = (size: number) => [{ x: 0, y: 0 }, { x: size, y: 0 }, { x: size, y: size }, { x: 0, y: size }];
const platform = (id: string, label: string) => ({ id, label, elevation: 600, outline: square(1000) });

function fixture() {
  const sourcePodium = randomUUID();
  const sourceOther = randomUUID();
  const targetPodium = randomUUID();
  const deck: LayoutObject = { id: randomUUID(), label: 'Podest', part: { id: STARTER_PART_IDS.deck, revision: 1 }, variant: '2x1', x: 1000, y: 1000, rotation: 0, support: sourcePodium, stockItemId: randomUUID() };
  const onDeck: LayoutObject = { id: randomUUID(), label: 'Wand', part: { id: STARTER_PART_IDS.wall, revision: 1 }, variant: 'plain', x: 1000, y: 1000, rotation: 0, support: deck.id, stockItemId: randomUUID() };
  const onOther: LayoutObject = { id: randomUUID(), label: 'Wand 2', part: { id: STARTER_PART_IDS.wall, revision: 1 }, variant: 'plain', x: 3000, y: 1000, rotation: 0, support: sourceOther };
  const onFloor: LayoutObject = { id: randomUUID(), label: 'Wand 3', part: { id: STARTER_PART_IDS.wall, revision: 1 }, variant: 'plain', x: 4200, y: 1000, rotation: 0, support: AUDIENCE_FLOOR_ID };
  const dimension = (a: object, b: object) => ({ id: randomUUID(), orientation: 'aligned' as const, offset: 300, a, b }) as NonNullable<Layout['dimensions']>[number];
  const layout: Layout = {
    schemaVersion: 2,
    objects: [deck, onDeck, onOther, onFloor],
    joints: [{ a: { object: onOther.id, connector: 'rechts' }, b: { object: onFloor.id, connector: 'links' } }],
    dimensions: [
      dimension({ kind: 'wall', scope: 'scene', wallId: onDeck.id, corner: 0 }, { kind: 'platform', scope: 'venue', platformId: sourcePodium, index: 1 }),
      dimension({ kind: 'outline', index: 0 }, { kind: 'platform', scope: 'venue', platformId: sourceOther, index: 0 }),
      dimension({ kind: 'outline', index: 7 }, { kind: 'wall', scope: 'scene', wallId: onFloor.id, corner: 0 }),
    ],
  };
  const destination: VenueGeometry = { schemaVersion: 1, width: 9000, depth: 7000, platforms: [platform(targetPodium, 'Neues Podest')] } as VenueGeometry;
  return { layout, destination, sourcePodium, targetPodium, deck, onDeck, onOther, onFloor };
}

test('copying into another venue remaps supports and venue dimensions, clears stock and keeps joints', () => {
  const { layout, destination, sourcePodium, targetPodium, deck, onDeck, onOther, onFloor } = fixture();
  const { layout: copy, unresolvedSupport } = copyLayoutIntoVenue(layout, destination, { [sourcePodium]: targetPodium }, randomUUID);
  const [copiedDeck, copiedOnDeck, copiedOther, copiedFloor] = copy.objects;
  assert.ok(copy.objects.every((object, index) => object.id !== layout.objects[index]!.id));
  assert.equal(copiedDeck!.support, targetPodium);
  assert.equal(copiedOnDeck!.support, copiedDeck!.id, 'object-owned support chains follow the copy');
  assert.equal(copiedOther!.support, undefined, 'unmapped venue surfaces are not guessed');
  assert.equal(copiedFloor!.support, AUDIENCE_FLOOR_ID);
  assert.ok(copy.objects.every(object => object.stockItemId === undefined), 'physical stock stays in the source venue');
  assert.deepEqual(unresolvedSupport.map(item => [item.objectId, item.kind]), [[copiedOther!.id, 'missing-surface']]);
  assert.deepEqual(copy.joints.map(joint => [joint.a.object, joint.b.object]), [[copiedOther!.id, copiedFloor!.id]]);
  assert.equal(copy.dimensions?.length, 1, 'dimensions to unmapped platforms or missing outline corners are dropped');
  assert.deepEqual(copy.dimensions![0]!.a, { kind: 'wall', scope: 'scene', wallId: copiedOnDeck!.id, corner: 0 });
  assert.deepEqual(copy.dimensions![0]!.b, { kind: 'platform', scope: 'venue', platformId: targetPodium, index: 1 });
  assert.ok(![deck, onDeck, onOther, onFloor].some(object => JSON.stringify(copy).includes(object.id)));
});

test('duplicating within the venue keeps stock assignments and venue anchors', () => {
  const { layout, sourcePodium, deck } = fixture();
  const copy = duplicateLayout(layout, randomUUID);
  assert.equal(copy.objects[0]!.stockItemId, deck.stockItemId);
  assert.equal(copy.objects[0]!.support, sourcePodium);
  assert.equal(copy.dimensions?.length, 3);
});
