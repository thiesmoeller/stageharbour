import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { recordConnection } from '../src/shared/assembly.js';
import { formGroup } from '../src/shared/groups.js';
import { EXAMPLE_PLAIN, inventoryWarnings, type InventoryPanel } from '../src/shared/inventory.js';
import { layoutSchema, newWall, type Layout } from '../src/shared/layout.js';
import { AUDIENCE_FLOOR_ID, newPlatform, newStair } from '../src/shared/levels.js';
import { copiedSceneName, duplicateLayout, remountRigging } from '../src/shared/scenes.js';
import { newWallType } from '../src/shared/wall-types.js';

const panelId = '11111111-1111-4111-8111-111111111111';

function panel(label: string): InventoryPanel {
  const type = { ...newWallType(randomUUID()), ...EXAMPLE_PLAIN, name: 'Beispiel-Glattwand' };
  return { id: panelId, label, typeId: type.id, available: true, note: null, type };
}

function assignedLayout(): { left: ReturnType<typeof newWall>; right: ReturnType<typeof newWall>; layout: Layout } {
  const left = { ...newWall(randomUUID(), 1000, 2000), panelId, assemblyNumber: 1 };
  const right = { ...newWall(randomUUID(), 5000, 2000), assemblyNumber: 2 };
  const platform = newPlatform(randomUUID(), 3000, 4000);
  const onPlatform = { ...newWall(randomUUID(), 3000, 4000), supportingSurfaceId: platform.id, panelId: randomUUID() };
  const stair = newStair(randomUUID(), AUDIENCE_FLOOR_ID, platform.id, 3000, 2500);
  const base: Layout = {
    schemaVersion: 1,
    walls: [left, right, onPlatform],
    braces: [],
    platforms: [platform],
    stairs: [stair],
    riggingNotes: 'Stifte belassen.',
  };
  const grouped = formGroup(base, [{ kind: 'wall', id: left.id }, { kind: 'wall', id: right.id }], randomUUID());
  const layout = recordConnection(grouped, left.id, right.id);
  return { left, right, layout };
}

test('duplicating a scene layout keeps panel identities and remaps independent placement records', () => {
  const { left, right, layout } = assignedLayout();
  const copy = duplicateLayout(layout, randomUUID);
  const parsed = layoutSchema.parse(copy);
  assert.notEqual(copy.walls[0]?.id, left.id);
  assert.notEqual(copy.walls[1]?.id, right.id);
  assert.equal(copy.walls[0]?.panelId, panelId);
  assert.equal(copy.walls[0]?.assemblyNumber, 1);
  assert.equal(copy.walls[0]?.x, 1000);
  assert.equal(copy.walls[1]?.x, 5000);
  assert.equal(copy.walls[1]?.panelId, undefined);
  const copyIds = new Set(copy.walls.map(wall => wall.id));
  assert.equal(copyIds.has(left.id), false);
  assert.equal(copy.groups?.[0]?.members.every(member => copyIds.has(member.id)), true);
  assert.notEqual(copy.groups?.[0]?.id, layout.groups?.[0]?.id);
  assert.equal(copy.connections?.[0]?.a, copy.walls[0]?.id);
  assert.equal(copy.connections?.[0]?.b, copy.walls[1]?.id);
  assert.notEqual(copy.connections?.[0]?.id, layout.connections?.[0]?.id);
  const copyPlatform = copy.platforms?.[0];
  assert(copyPlatform);
  assert.notEqual(copyPlatform.id, layout.platforms?.[0]?.id);
  assert.equal(copy.walls[2]?.supportingSurfaceId, copyPlatform.id);
  assert.equal(copy.stairs?.[0]?.upperSurfaceId, copyPlatform.id);
  assert.equal(copy.stairs?.[0]?.lowerSurfaceId, AUDIENCE_FLOOR_ID);
  assert.notEqual(copy.stairs?.[0]?.id, layout.stairs?.[0]?.id);
  copy.walls[0]!.x = 1800;
  assert.equal(layout.walls[0]?.x, 1000);
  assert.equal(parsed.walls[0]?.panelId, panelId);
});

test('the same physical panel in two scenes does not warn; two uses in one scene do', () => {
  const stock = [panel('Beispiel-P01')];
  const first: Layout = { schemaVersion: 1, walls: [{ ...newWall(randomUUID(), 1000, 1000), panelId }], braces: [] };
  const second = duplicateLayout(first, randomUUID);
  assert.equal(inventoryWarnings(first, stock).some(item => item.kind === 'duplicate'), false);
  assert.equal(inventoryWarnings(second, stock).some(item => item.kind === 'duplicate'), false);
  assert.equal(second.walls[0]?.panelId, panelId);
  const doubled: Layout = {
    schemaVersion: 1,
    walls: [
      { ...newWall(randomUUID(), 1000, 1000), panelId },
      { ...newWall(randomUUID(), 3000, 1000), panelId },
    ],
    braces: [],
  };
  assert.equal(inventoryWarnings(doubled, stock).some(item => item.kind === 'duplicate' && item.panelId === panelId), true);
});

test('a duplicate shares the rigging setup; remounting is a new setup and pin notes stay notes', () => {
  const { layout } = assignedLayout();
  const setupId = randomUUID();
  const sourced = { ...layout, riggingSetupId: setupId };
  const copy = duplicateLayout(sourced, randomUUID);
  assert.equal(copy.riggingSetupId, setupId);
  assert.equal(copy.riggingNotes, 'Stifte belassen.');
  const minted = duplicateLayout(layout, randomUUID);
  assert.equal(typeof minted.riggingSetupId, 'string');
  assert.notEqual(minted.riggingSetupId, setupId);
  assert.equal(layout.riggingSetupId, undefined);
  const remounted = remountRigging(copy, randomUUID);
  assert.notEqual(remounted.riggingSetupId, setupId);
  assert.equal(remounted.connections?.length, copy.connections?.length);
  assert.equal(remounted.walls[0]?.panelId, panelId);
  assert.equal(copiedSceneName('Erste Szene'), 'Erste Szene (Kopie)');
});
