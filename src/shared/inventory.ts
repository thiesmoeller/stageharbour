import { z } from 'zod';
import { type Layout, type Wall } from './layout.js';
import { leaseHolderSchema } from './leases.js';
import { resolveWall, typesOf, wallTypeSchema, type Opening, type WallElementType } from './wall-types.js';

const name = z.string().trim().min(1).max(120);
const note = z.string().trim().max(500);

/** Reported physical stock. Not a seed; real panel labels and arch geometry are not recorded here. */
export const REPORTED_PANEL_COUNTS = { plain: 20, door: 6, window: 2, arch: 1 } as const;
/** The group owns one 250 mm arch panel; the opening profile is specified in slice 06, not here. */
export const REPORTED_ARCH_THICKNESS = 250;

export const GROUP_WALL_TYPE_KINDS = ['plain', 'doorLeft', 'doorRight', 'window', 'arch', 'half'] as const;
export type GroupWallTypeKind = (typeof GROUP_WALL_TYPE_KINDS)[number];
/** Names for the group's panel kinds, as seen in productions such as „Täglich klopft der Sensenmann“. */
export const GROUP_WALL_TYPE_NAMES = {
  plain: 'Glattwand',
  doorLeft: 'Türwand · Scharnier links',
  doorRight: 'Türwand · Scharnier rechts',
  window: 'Fensterwand',
  arch: 'Bogen',
  half: 'Halbe Wand',
} as const;
/** Stock label for the six door panels (both hinge hands). */
export const GROUP_DOOR_STOCK_NAME = 'Türwand';

/** Example-only millimetre placeholders. Labels and IDs used with these are not real inventory. */
export const EXAMPLE_PLAIN = { width: 1200, height: 2400, thickness: 28, openings: [] as Opening[] };
export const EXAMPLE_DOOR_OPENING = { left: 200, sill: 0, width: 800, height: 2000 };
export const EXAMPLE_WINDOW_OPENING = { left: 390, sill: 1100, width: 420, height: 900 };
/**
 * Rectangular stand-in for the arch walk-through until the rounded profile is measured (slice 06).
 * Outer size matches the standard panel; thickness uses the reported 250 mm arch panel.
 */
export const EXAMPLE_ARCH_OPENING = { left: 200, sill: 0, width: 800, height: 2000 };
/** Door returns / half-width scenic walls: 60 × 240 × 25 cm, as beside the Sensenmann door. */
export const EXAMPLE_HALF = { width: 600, height: 2400, thickness: 250, openings: [] as Opening[] };

export function groupWallTypeSizeLabel(kind: GroupWallTypeKind): string {
  if (kind === 'half') return '600×2400×250 mm';
  if (kind === 'arch') return '1200×2400×250 mm · rechteckige Öffnung vorläufig';
  if (kind === 'doorLeft' || kind === 'doorRight') return '1200×2400×28 mm · Tür 800×2000 weiß · Zarge 25×50';
  if (kind === 'window') return '1200×2400×28 mm · rechteckige Öffnung';
  return '1200×2400×28 mm';
}

/** Build a group wall-type template. Opening ids are required for kinds that include openings. */
export function groupWallType(kind: GroupWallTypeKind, typeId: string, openingId?: string): WallElementType {
  const name = GROUP_WALL_TYPE_NAMES[kind];
  if (kind === 'plain') return { id: typeId, name, ...EXAMPLE_PLAIN };
  if (kind === 'half') return { id: typeId, name, ...EXAMPLE_HALF };
  if (!openingId) throw new Error(`Opening id required for ${kind}`);
  if (kind === 'doorLeft' || kind === 'doorRight') {
    return {
      id: typeId, name, width: 1200, height: 2400, thickness: 28,
      openings: [{ id: openingId, ...EXAMPLE_DOOR_OPENING, hinge: kind === 'doorLeft' ? 'left' : 'right' }],
    };
  }
  if (kind === 'window') {
    return { id: typeId, name, width: 1200, height: 2400, thickness: 28, openings: [{ id: openingId, ...EXAMPLE_WINDOW_OPENING }] };
  }
  return {
    id: typeId, name, width: 1200, height: 2400, thickness: REPORTED_ARCH_THICKNESS,
    openings: [{ id: openingId, ...EXAMPLE_ARCH_OPENING }],
  };
}

export const inventoryPanelSchema = z.strictObject({
  id: z.uuid(), label: name, typeId: z.uuid(), available: z.boolean(),
  note: note.nullable(), type: wallTypeSchema,
});
export type InventoryPanel = z.infer<typeof inventoryPanelSchema>;
export const createPanelSchema = z.strictObject({
  label: name, type: wallTypeSchema, available: z.boolean().default(true), note: note.nullable().optional(),
});
export const updatePanelSchema = z.strictObject({
  available: z.boolean().optional(), note: note.nullable().optional(),
}).refine(body => body.available !== undefined || body.note !== undefined, 'Availability or note required');
export const assignPanelSchema = z.strictObject({ panelId: z.uuid() });
export const inventorySchema = z.object({
  lease: leaseHolderSchema.nullable(),
  types: z.array(wallTypeSchema),
  panels: z.array(inventoryPanelSchema),
});
export type Inventory = z.infer<typeof inventorySchema>;

export type PlacementType = { id?: string; width: number; height: number; thickness: number; openings: Opening[] };
export type InventoryWarning = {
  kind: 'unassigned' | 'unavailable' | 'duplicate' | 'incompatible' | 'shortage';
  wallId?: string; panelId?: string; message: string;
};

function openingKey(opening: Pick<Opening, 'left' | 'sill' | 'width' | 'height' | 'hinge'>) {
  return `${opening.left}|${opening.sill}|${opening.width}|${opening.height}|${opening.hinge ?? ''}`;
}
function geometryKey(type: PlacementType) {
  return `${type.width}|${type.height}|${type.thickness}|${[...type.openings].map(openingKey).sort().join(';')}`;
}

/** Compatible when type ids match, or when outer dimensions and rectangular openings match. Opening ids are ignored. */
export function sameGeometry(panelType: Pick<WallElementType, 'width' | 'height' | 'thickness' | 'openings'>, placement: PlacementType): boolean {
  return panelType.width === placement.width && panelType.height === placement.height && panelType.thickness === placement.thickness
    && panelType.openings.length === placement.openings.length
    && [...panelType.openings].map(openingKey).sort().join() === [...placement.openings].map(openingKey).sort().join();
}
export function typesCompatible(panelType: WallElementType, placement: PlacementType): boolean {
  return (!!placement.id && panelType.id === placement.id) || sameGeometry(panelType, placement);
}

export function placementType(wall: Wall, types: WallElementType[]): PlacementType {
  const resolved = resolveWall(wall, types);
  return { id: wall.typeId, width: resolved.width, height: resolved.height, thickness: resolved.thickness, openings: resolved.openings };
}

export function usablePanels(panels: readonly InventoryPanel[]): InventoryPanel[] {
  return panels.filter(panel => panel.available);
}

export function inventoryWarnings(layout: Layout, panels: readonly InventoryPanel[]): InventoryWarning[] {
  const byId = new Map(panels.map(item => [item.id, item]));
  const types = typesOf(layout);
  const warnings: InventoryWarning[] = [];
  const assigned = new Map<string, string[]>();
  for (const wall of layout.walls) {
    if (!wall.panelId) {
      warnings.push({ kind: 'unassigned', wallId: wall.id, message: `„${wall.label}“ hat keine Platte zugewiesen.` });
      continue;
    }
    const holders = assigned.get(wall.panelId) ?? [];
    holders.push(wall.id);
    assigned.set(wall.panelId, holders);
    const panel = byId.get(wall.panelId);
    if (!panel) {
      warnings.push({ kind: 'unavailable', wallId: wall.id, panelId: wall.panelId, message: `Die zugewiesene Platte für „${wall.label}“ ist nicht im Bestand.` });
      continue;
    }
    if (!panel.available) {
      warnings.push({ kind: 'unavailable', wallId: wall.id, panelId: panel.id, message: `Platte ${panel.label} ist nicht verfügbar.` });
    }
    if (!typesCompatible(panel.type, placementType(wall, types))) {
      warnings.push({ kind: 'incompatible', wallId: wall.id, panelId: panel.id, message: `Platte ${panel.label} passt nicht zu „${wall.label}“.` });
    }
  }
  for (const [panelId, wallIds] of assigned) {
    if (wallIds.length < 2) continue;
    const panel = byId.get(panelId);
    warnings.push({ kind: 'duplicate', panelId, wallId: wallIds[0], message: `Platte ${panel?.label ?? panelId} ist in dieser Szene mehrfach zugewiesen.` });
  }
  const groups = new Map<string, { needed: number; placement: PlacementType }>();
  for (const wall of layout.walls) {
    const placement = placementType(wall, types);
    const key = geometryKey(placement);
    const group = groups.get(key) ?? { needed: 0, placement };
    group.needed += 1;
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const usable = panels.filter(item => item.available && typesCompatible(item.type, group.placement)).length;
    if (group.needed > usable) {
      warnings.push({ kind: 'shortage', message: `Bestand reicht nicht: ${group.needed} Plätze, ${usable} verfügbare Platten.` });
    }
  }
  return warnings;
}
