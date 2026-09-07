import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { recordConnection } from '../src/shared/assembly.js';
import { formGroup } from '../src/shared/groups.js';
import { EXAMPLE_PLAIN, inventoryWarnings, type InventoryPanel } from '../src/shared/inventory.js';
import { layoutSchema, newWall, type Layout } from '../src/shared/layout.js';
import { AUDIENCE_FLOOR_ID, newPlatform, newStair } from '../src/shared/levels.js';
import { newPlaceholder } from '../src/shared/placeholders.js';
import { newKeepClearZone } from '../src/shared/keepClear.js';
import { newOverheadBox } from '../src/shared/overhead.js';
import { applyVenueVersion, copiedSceneName, copyLayoutIntoVenue, duplicateLayout, remountRigging } from '../src/shared/scenes.js';
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
  const table = newPlaceholder('table', randomUUID(), 2000, 1500);
  const withTable = { ...layout, placeholders: [table] };
  const copiedTable = duplicateLayout(withTable, randomUUID);
  assert.notEqual(copiedTable.placeholders?.[0]?.id, table.id);
  assert.equal(copiedTable.placeholders?.[0]?.x, 2000);
  assert.equal(copiedTable.placeholders?.[0]?.width, table.width);
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

test('copying a layout into a destination venue clears panel ids and uses chosen destination surfaces', () => {
  const type = newWallType(randomUUID());
  const sourceStage = newPlatform(randomUUID(), 4000, 4750);
  const leftoverStage = newPlatform(randomUUID(), 2000, 1500);
  const destStage = newPlatform(randomUUID(), 4000, 4750);
  const movable = newPlatform(randomUUID(), 3000, 2000);
  const assigned = { ...newWall(randomUUID(), 1000, 2000), panelId, assemblyNumber: 1, typeId: type.id };
  const partner = { ...newWall(randomUUID(), 5000, 2000), typeId: type.id };
  const onSourceStage = { ...newWall(randomUUID(), 4000, 4800), supportingSurfaceId: sourceStage.id, panelId: randomUUID() };
  const unmapped = { ...newWall(randomUUID(), 2000, 1500), supportingSurfaceId: leftoverStage.id };
  const onMovable = { ...newWall(randomUUID(), 3000, 2000), supportingSurfaceId: movable.id };
  const crossing = { ...newWall(randomUUID(), 4000, 3000), label: 'Bühnenwand', height: 2800 };
  const base: Layout = {
    schemaVersion: 1, wallTypes: [type], walls: [assigned, partner, onSourceStage, unmapped, onMovable, crossing],
    braces: [], platforms: [movable],
  };
  const layout = recordConnection(
    formGroup(base, [{ kind: 'wall', id: assigned.id }, { kind: 'wall', id: partner.id }], randomUUID()),
    assigned.id, partner.id,
  );
  const destination = {
    schemaVersion: 1 as const, width: 8000, depth: 6000,
    platforms: [destStage], ceilingHeight: 2000,
    overheadBoxes: [newOverheadBox(randomUUID(), 4000, 3000)],
    keepClearZones: [newKeepClearZone(randomUUID(), AUDIENCE_FLOOR_ID, 4000, 3000)],
  };
  const result = copyLayoutIntoVenue(layout, destination, { [sourceStage.id]: destStage.id }, randomUUID);
  const copy = layoutSchema.parse(result.layout);
  assert.equal(copy.walls[0]?.panelId, undefined);
  assert.equal(copy.walls[0]?.typeId, type.id);
  assert.equal(copy.walls[0]?.assemblyNumber, 1);
  assert.equal(copy.walls[0]?.x, 1000);
  assert.equal(copy.walls[1]?.x, 5000);
  assert.equal(copy.wallTypes?.[0]?.id, type.id);
  assert.notEqual(copy.walls[0]?.id, assigned.id);
  const copyIds = new Set(copy.walls.map(wall => wall.id));
  assert.equal(copy.groups?.[0]?.members.every(member => copyIds.has(member.id)), true);
  assert.equal(copy.connections?.[0]?.a, copy.walls[0]?.id);
  assert.equal(copy.platforms?.some(platform => platform.id === destStage.id), false);
  assert.equal(copy.platforms?.some(platform => platform.id === sourceStage.id), false);
  const copyMovable = copy.platforms?.[0];
  assert(copyMovable);
  assert.notEqual(copyMovable.id, movable.id);
  assert.equal(copy.walls[4]?.supportingSurfaceId, copyMovable.id);
  assert.equal(copy.walls[2]?.supportingSurfaceId, destStage.id);
  assert.equal(copy.walls[3]?.supportingSurfaceId, undefined);
  assert.equal(result.unresolvedSupport.some(item => item.objectId === copy.walls[3]?.id && item.kind === 'missing-surface'), true);
  assert.equal(result.warnings.some(item => item.kind === 'ceiling' && item.objectId === copy.walls[5]?.id), true);
  assert.equal(result.warnings.some(item => item.kind === 'overhead' && item.objectId === copy.walls[5]?.id), true);
  assert.equal(result.unresolvedWarnings.some(item => item.kind === 'keep-clear-overlap' && item.objectId === copy.walls[5]?.id), true);
  assert.equal(layout.walls[0]?.panelId, panelId);
  assert.equal(layout.walls[2]?.supportingSurfaceId, sourceStage.id);
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

test('applying a newer venue version remaps removed support and reruns clearance; skipping keeps diagnostics against the old pin', () => {
  const platform = newPlatform(randomUUID(), 4000, 4750);
  const movable = newPlatform(randomUUID(), 3000, 2000);
  const onPlatform = { ...newWall(randomUUID(), 4000, 4800), supportingSurfaceId: platform.id, panelId: randomUUID() };
  const crossing = { ...newWall(randomUUID(), 4000, 3000), label: 'Bühnenwand', height: 2800, panelId };
  const onMovable = { ...newWall(randomUUID(), 3000, 2000), supportingSurfaceId: movable.id };
  const layout: Layout = {
    schemaVersion: 1, walls: [onPlatform, crossing, onMovable], braces: [], platforms: [movable],
  };
  const versionA = { schemaVersion: 1 as const, width: 8000, depth: 6000, platforms: [platform], ceilingHeight: 8000 };
  const versionB = {
    schemaVersion: 1 as const, width: 8000, depth: 6000, ceilingHeight: 2000,
    overheadBoxes: [newOverheadBox(randomUUID(), 4000, 3000)],
    keepClearZones: [newKeepClearZone(randomUUID(), AUDIENCE_FLOOR_ID, 4000, 3000)],
  };
  const skipped = applyVenueVersion(layout, versionA);
  assert.equal(skipped.layout.walls[0]?.supportingSurfaceId, platform.id);
  assert.equal(skipped.unresolvedSupport.some(item => item.objectId === onPlatform.id), false);
  assert.equal(skipped.warnings.some(item => item.kind === 'ceiling'), false);
  assert.equal(skipped.unresolvedWarnings.length, 0);
  const applied = applyVenueVersion(layout, versionB);
  const parsed = layoutSchema.parse(applied.layout);
  assert.equal(parsed.walls[0]?.id, onPlatform.id);
  assert.equal(parsed.walls[0]?.panelId, onPlatform.panelId);
  assert.equal(parsed.walls[0]?.supportingSurfaceId, undefined);
  assert.equal(parsed.walls[1]?.panelId, panelId);
  assert.equal(parsed.walls[2]?.supportingSurfaceId, movable.id);
  assert.equal(applied.unresolvedSupport.some(item => item.objectId === onPlatform.id && item.kind === 'missing-surface'), true);
  assert.equal(applied.warnings.some(item => item.kind === 'ceiling' && item.objectId === crossing.id), true);
  assert.equal(applied.warnings.some(item => item.kind === 'overhead' && item.objectId === crossing.id), true);
  assert.equal(applied.unresolvedWarnings.some(item => item.kind === 'keep-clear-overlap' && item.objectId === crossing.id), true);
  const raised = applyVenueVersion(layout, {
    ...versionA, platforms: [{ ...platform, elevation: 2000 }], ceilingHeight: 4000,
  });
  assert.equal(raised.layout.walls[0]?.supportingSurfaceId, platform.id);
  assert.equal(raised.warnings.some(item => item.kind === 'ceiling' && item.objectId === onPlatform.id), true);
  assert.equal(skipped.warnings.some(item => item.objectId === onPlatform.id), false);
  assert.equal(layout.walls[0]?.supportingSurfaceId, platform.id);
  assert.equal(layout.walls[1]?.panelId, panelId);
});

