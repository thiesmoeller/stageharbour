import { ballastStockSchema, EMPTY_BALLAST_STOCK } from './ballast.js';
import { z } from 'zod';
import { type Layout, type Wall } from './layout.js';
import { finishAssignmentSchema, physicalFinishSchema, wallSurfacesSchema } from './surfaces.js';
import { leaseHolderSchema } from './leases.js';
import { openingSchema, resolveWall, typesOf, wallTypeSchema, type Opening, type WallElementType } from './wall-types.js';

const name = z.string().trim().min(1).max(120);
const note = z.string().trim().max(500);

/** Reported physical stock. Not a seed; real panel labels are not recorded here. */
export const REPORTED_PANEL_COUNTS = { plain: 20, door: 6, window: 2, arch: 1 } as const;
/** The group owns one 250 mm arch panel (Roman arch opening: straight jambs + semicircular crown). */
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
 * Arch walk-through: door-sized clear opening (800×2000) with a semicircular crown.
 * Outer size matches the standard panel; thickness uses the reported 250 mm arch panel.
 */
export const EXAMPLE_ARCH_OPENING = { left: 200, sill: 0, width: 800, height: 2000, profile: 'arch' as const };
/** Door returns / half-width scenic walls: 60 × 240 × 25 cm, as beside the Sensenmann door. */
export const EXAMPLE_HALF = { width: 600, height: 2400, thickness: 250, openings: [] as Opening[] };

export function groupWallTypeSizeLabel(kind: GroupWallTypeKind): string {
  if (kind === 'half') return '600×2400×250 mm';
  if (kind === 'arch') return '1200×2400×250 mm · Bogenöffnung 800×2000';
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
  cutouts: z.array(openingSchema).max(20).optional(),
  currentFinish: physicalFinishSchema.nullable().optional(),
});
export type InventoryPanel = z.infer<typeof inventoryPanelSchema>;
export const createPanelSchema = z.strictObject({
  label: name, type: wallTypeSchema, available: z.boolean().default(true), note: note.nullable().optional(),
});
export const updatePanelSchema = z.strictObject({
  label: name.optional(),
  available: z.boolean().optional(),
  note: note.nullable().optional(),
  cutouts: z.array(openingSchema).max(20).optional(),
  finish: z.strictObject({ surfaces: wallSurfacesSchema, description: z.string().trim().max(300) }).optional(),
}).refine(body => body.label !== undefined || body.available !== undefined || body.note !== undefined || body.cutouts !== undefined || body.finish !== undefined, 'Label, availability or note required');
export const assignPanelSchema = z.strictObject({ panelId: z.uuid() });
export const inventorySchema = z.object({
  ballast: ballastStockSchema.default(EMPTY_BALLAST_STOCK),
  lease: leaseHolderSchema.nullable(),
  types: z.array(wallTypeSchema),
  panels: z.array(inventoryPanelSchema),
});
export type Inventory = z.infer<typeof inventorySchema>;
/** Create or replace a stocked wall-element type in the workspace catalog (Bestand). */
export const upsertInventoryTypeSchema = wallTypeSchema;

export type PlacementType = { id?: string; width: number; height: number; thickness: number; openings: Opening[] };
export type InventoryWarning = {
  kind: 'unassigned' | 'unavailable' | 'duplicate' | 'incompatible' | 'shortage';
  wallId?: string; panelId?: string; message: string;
};

function openingKey(opening: Pick<Opening, 'left' | 'sill' | 'width' | 'height' | 'hinge' | 'profile'>) {
  return `${opening.left}|${opening.sill}|${opening.width}|${opening.height}|${opening.hinge ?? ''}|${opening.profile ?? 'rectangle'}`;
}
function geometryKey(type: PlacementType) {
  return `${type.width}|${type.height}|${type.thickness}|${[...type.openings].map(openingKey).sort().join(';')}`;
}

/** Compatible when type ids match, or when outer dimensions and openings match. Opening ids are ignored. */
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
  const warnings: InventoryWarning[] = [];
  const assigned = new Map<string, string[]>();
  for (const object of layout.objects) {
    if (!object.stockItemId) continue;
    const holders = assigned.get(object.stockItemId) ?? [];
    holders.push(object.id);
    assigned.set(object.stockItemId, holders);
    const panel = byId.get(object.stockItemId);
    if (!panel) {
      warnings.push({ kind: 'unavailable', wallId: object.id, panelId: object.stockItemId, message: `Das Bestandsstück für „${object.label}“ ist nicht verfügbar.` });
      continue;
    }
    if (!panel.available) {
      warnings.push({ kind: 'unavailable', wallId: object.id, panelId: panel.id, message: `Bestandsstück ${panel.label} ist nicht verfügbar.` });
    }
  }
  for (const [panelId, wallIds] of assigned) {
    if (wallIds.length < 2) continue;
    const panel = byId.get(panelId);
    warnings.push({ kind: 'duplicate', panelId, wallId: wallIds[0], message: `Platte ${panel?.label ?? panelId} ist in diesem Bühnenbild mehrfach zugewiesen.` });
  }
  return warnings;
}

/** Legacy inventory endpoints no longer rewrite layouts; stock assignments are first-class object fields. */
export function snapshotPanelAssignments(_previous: Layout, next: Layout, _makeId: () => string): Layout {
  return next;
}

export const finishWorkSchema = z.strictObject({
  sceneId: z.uuid(), sceneName: z.string(), wallId: z.uuid(), wallLabel: z.string(), panelId: z.uuid(),
  assignment: finishAssignmentSchema,
});
export const finishWorkListSchema = z.array(finishWorkSchema);
export type FinishWork = z.infer<typeof finishWorkSchema>;
