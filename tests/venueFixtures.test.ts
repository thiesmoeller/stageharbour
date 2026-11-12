import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newCurtain } from '../src/shared/curtains.js';
import { layoutSchema, newWall, type Layout, type VenueGeometry } from '../src/shared/layout.js';
import { applyVenueVersion, duplicateLayout } from '../src/shared/scenes.js';
import { stageModel } from '../src/shared/transforms.js';
import {
  effectiveCurtains, effectiveVenueDoorOpen, pruneVenueFixtureState,
  setCurtainOpenPercent, setVenueDoorOpenPercent,
} from '../src/shared/venueFixtures.js';
import { newDoorOpening, newWallType } from '../src/shared/wall-types.js';

function doorVenue(): { venue: VenueGeometry; wallId: string; curtainId: string; typeId: string } {
  const typeId = randomUUID();
  const wallId = randomUUID();
  const curtainId = randomUUID();
  const type = { ...newWallType(typeId), name: 'Türwand', openings: [newDoorOpening(randomUUID(), 'left')] };
  const wall = { ...newWall(wallId, 2000, 1000), typeId, doorOpenPercent: 10 };
  const curtain = { ...newCurtain(curtainId, 4000, 3000), openPercent: 20 };
  return {
    typeId, wallId, curtainId,
    venue: { schemaVersion: 1, width: 8000, depth: 6000, walls: [wall], wallTypes: [type], curtains: [curtain] },
  };
}

test('scene opening overlays override venue curtain and door defaults', () => {
  const { venue, wallId, curtainId } = doorVenue();
  const empty: Layout = { schemaVersion: 2, objects: [], joints: [] };
  let layout: Layout = empty;
  layout = setCurtainOpenPercent(layout, curtainId, 75);
  layout = setVenueDoorOpenPercent(layout, wallId, 90);
  assert.equal(layoutSchema.safeParse(layout).success, true);
  assert.equal(effectiveCurtains(venue, layout)[0]!.openPercent, 75);
  assert.equal(effectiveVenueDoorOpen(venue.walls![0]!, layout), 90);
  assert.equal(effectiveCurtains(venue, empty)[0]!.openPercent, 20);
  assert.equal(effectiveVenueDoorOpen(venue.walls![0]!, empty), 10);
});

test('stageModel applies venue door opening overlays', () => {
  const { venue, wallId } = doorVenue();
  const layout = setVenueDoorOpenPercent({ schemaVersion: 2, objects: [], joints: [] }, wallId, 55);
  const model = stageModel(layout, venue);
  assert.equal(model.walls.find(wall => wall.id === wallId)?.doorOpenPercent, 55);
});

test('prune drops orphan fixture overlays; duplicate keeps them', () => {
  const { venue, wallId, curtainId } = doorVenue();
  let layout = setCurtainOpenPercent({ schemaVersion: 2, objects: [], joints: [] }, curtainId, 40);
  layout = setVenueDoorOpenPercent(layout, wallId, 30);
  layout = setCurtainOpenPercent(layout, randomUUID(), 99);
  layout = setVenueDoorOpenPercent(layout, randomUUID(), 99);
  const pruned = pruneVenueFixtureState(layout, venue);
  assert.deepEqual(pruned.venueFixtureState?.curtains, [{ id: curtainId, openPercent: 40 }]);
  assert.deepEqual(pruned.venueFixtureState?.doors, [{ wallId, doorOpenPercent: 30 }]);
  const emptyVenue: VenueGeometry = { schemaVersion: 1, width: 8000, depth: 6000 };
  assert.equal(pruneVenueFixtureState(layout, emptyVenue).venueFixtureState, undefined);
  const copy = duplicateLayout(layout, () => randomUUID());
  assert.deepEqual(copy.venueFixtureState, layout.venueFixtureState);
  const applied = applyVenueVersion(layout, emptyVenue);
  assert.equal(applied.layout.venueFixtureState, undefined);
});
