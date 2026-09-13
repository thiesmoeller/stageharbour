import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  EXAMPLE_ARCH_OPENING, EXAMPLE_DOOR_OPENING, EXAMPLE_HALF, EXAMPLE_PLAIN, EXAMPLE_WINDOW_OPENING,
  GROUP_WALL_TYPE_KINDS, GROUP_WALL_TYPE_NAMES, REPORTED_ARCH_THICKNESS, REPORTED_PANEL_COUNTS,
  groupWallType, inventoryWarnings, typesCompatible, usablePanels, type InventoryPanel,
} from '../src/shared/inventory.js';
import { layoutSchema, newWall, type Layout } from '../src/shared/layout.js';
import { newWallType } from '../src/shared/wall-types.js';

function panel(overrides: Partial<InventoryPanel> & Pick<InventoryPanel, 'type'>): InventoryPanel {
  const type = overrides.type;
  return { id: randomUUID(), label: 'Beispiel-P01', typeId: type.id, available: true, note: null, ...overrides, type };
}

test('reported stock is 29 panels and does not invent arch-opening geometry', () => {
  assert.equal(REPORTED_PANEL_COUNTS.plain + REPORTED_PANEL_COUNTS.door + REPORTED_PANEL_COUNTS.window + REPORTED_PANEL_COUNTS.arch, 29);
  assert.deepEqual(REPORTED_PANEL_COUNTS, { plain: 20, door: 6, window: 2, arch: 1 });
  assert.equal(REPORTED_ARCH_THICKNESS, 250);
  assert.equal(EXAMPLE_PLAIN.openings.length, 0);
  assert.deepEqual(EXAMPLE_DOOR_OPENING, { left: 200, sill: 0, width: 800, height: 2000 });
  assert.deepEqual(EXAMPLE_WINDOW_OPENING, { left: 390, sill: 1100, width: 420, height: 900 });
  assert.deepEqual(EXAMPLE_ARCH_OPENING, { left: 200, sill: 0, width: 800, height: 2000 });
  assert.deepEqual(EXAMPLE_HALF, { width: 600, height: 2400, thickness: 250, openings: [] });
});

test('group wall-type templates cover Sensenmann stock including half walls beside the door', () => {
  assert.deepEqual([...GROUP_WALL_TYPE_KINDS], ['plain', 'doorLeft', 'doorRight', 'window', 'arch', 'half']);
  const plain = groupWallType('plain', randomUUID());
  assert.equal(plain.name, GROUP_WALL_TYPE_NAMES.plain);
  assert.deepEqual({ width: plain.width, height: plain.height, thickness: plain.thickness, openings: plain.openings }, EXAMPLE_PLAIN);
  const doorLeft = groupWallType('doorLeft', randomUUID(), randomUUID());
  assert.equal(doorLeft.name, GROUP_WALL_TYPE_NAMES.doorLeft);
  assert.equal(doorLeft.openings.length, 1);
  assert.equal(doorLeft.openings[0]?.hinge, 'left');
  assert.deepEqual({ left: doorLeft.openings[0]?.left, sill: doorLeft.openings[0]?.sill, width: doorLeft.openings[0]?.width, height: doorLeft.openings[0]?.height }, EXAMPLE_DOOR_OPENING);
  const doorRight = groupWallType('doorRight', randomUUID(), randomUUID());
  assert.equal(doorRight.name, GROUP_WALL_TYPE_NAMES.doorRight);
  assert.equal(doorRight.openings[0]?.hinge, 'right');
  const window = groupWallType('window', randomUUID(), randomUUID());
  assert.equal(window.name, GROUP_WALL_TYPE_NAMES.window);
  const arch = groupWallType('arch', randomUUID(), randomUUID());
  assert.equal(arch.name, GROUP_WALL_TYPE_NAMES.arch);
  assert.equal(arch.thickness, REPORTED_ARCH_THICKNESS);
  const half = groupWallType('half', randomUUID());
  assert.equal(half.name, GROUP_WALL_TYPE_NAMES.half);
  assert.deepEqual({ width: half.width, height: half.height, thickness: half.thickness, openings: half.openings }, EXAMPLE_HALF);
});

test('unavailable panels do not count as usable stock', () => {
  const type = { ...newWallType(randomUUID()), ...EXAMPLE_PLAIN, name: 'Beispiel-Glattwand' };
  const stock = [
    panel({ label: 'Beispiel-A', type }),
    panel({ label: 'Beispiel-B', type, available: false, note: 'Reparatur' }),
  ];
  assert.deepEqual(usablePanels(stock).map(item => item.label), ['Beispiel-A']);
});

test('unassigned placements remain valid layouts', () => {
  const wall = newWall(randomUUID(), 1000, 1000);
  const parsed = layoutSchema.parse({ schemaVersion: 1, walls: [wall] });
  assert.equal(parsed.walls[0]?.panelId, undefined);
  assert.equal(inventoryWarnings(parsed, []).filter(item => item.kind === 'unassigned').length, 1);
});

test('duplicate panel assignment in one scene is warned; the layout still parses', () => {
  const type = { ...newWallType(randomUUID()), ...EXAMPLE_PLAIN, name: 'Beispiel-Glattwand' };
  const assigned = panel({ type });
  const walls = [
    { ...newWall(randomUUID(), 1000, 1000), panelId: assigned.id },
    { ...newWall(randomUUID(), 3000, 1000), panelId: assigned.id },
  ];
  const layout = layoutSchema.parse({ schemaVersion: 1, walls });
  assert.equal(layout.walls.filter(wall => wall.panelId === assigned.id).length, 2);
  assert.equal(inventoryWarnings(layout, [assigned]).some(item => item.kind === 'duplicate' && item.panelId === assigned.id), true);
});

test('incompatible type versus placement is warned; the assignment is kept', () => {
  const plain = { ...newWallType(randomUUID()), ...EXAMPLE_PLAIN, name: 'Beispiel-Glattwand' };
  const door = { ...newWallType(randomUUID()), name: 'Beispiel-Türwand', width: 1200, height: 2400, thickness: 28,
    openings: [{ id: randomUUID(), ...EXAMPLE_DOOR_OPENING }] };
  const assigned = panel({ type: door });
  const wall = { ...newWall(randomUUID(), 1000, 1000), typeId: plain.id, panelId: assigned.id };
  const layout: Layout = { schemaVersion: 1, wallTypes: [plain], walls: [wall], braces: [] };
  const warnings = inventoryWarnings(layout, [assigned]);
  assert.equal(layout.walls[0]?.panelId, assigned.id);
  assert.equal(warnings.some(item => item.kind === 'incompatible' && item.panelId === assigned.id), true);
  assert.equal(typesCompatible(door, plain), false);
  assert.equal(typesCompatible(plain, { width: 1200, height: 2400, thickness: 28, openings: [] }), true);
});

test('marking a referenced panel unavailable keeps the assignment and warns', () => {
  const type = { ...newWallType(randomUUID()), ...EXAMPLE_PLAIN, name: 'Beispiel-Glattwand' };
  const assigned = panel({ type, available: false, note: 'Beschädigt' });
  const layout: Layout = { schemaVersion: 1, walls: [{ ...newWall(randomUUID(), 1000, 1000), panelId: assigned.id }], braces: [] };
  const warnings = inventoryWarnings(layout, [assigned]);
  assert.equal(layout.walls[0]?.panelId, assigned.id);
  assert.equal(warnings.some(item => item.kind === 'unavailable' && item.panelId === assigned.id), true);
  assert.equal(usablePanels([assigned]).length, 0);
});

test('stock warnings compare placements against available compatible panels', () => {
  const type = { ...newWallType(randomUUID()), ...EXAMPLE_PLAIN, name: 'Beispiel-Glattwand' };
  const available = panel({ label: 'Beispiel-A', type });
  const broken = panel({ label: 'Beispiel-B', type, available: false });
  const layout: Layout = { schemaVersion: 1, walls: [newWall(randomUUID(), 1000, 1000), newWall(randomUUID(), 3000, 1000)], braces: [] };
  assert.equal(inventoryWarnings(layout, [available, broken]).some(item => item.kind === 'shortage'), true);
  const enough = [available, panel({ label: 'Beispiel-C', type })];
  assert.equal(inventoryWarnings(layout, enough).some(item => item.kind === 'shortage'), false);
});
