import { z } from 'zod';
import { layoutSchema, venueGeometrySchema, type Scene } from './layout.js';
import { overheadWarningsSchema, resolvedOverheadClearance } from './overhead.js';
import { keepClearWarningSchema, resolvedKeepClearWarnings } from './keepClear.js';
import { placeholderCorners, placeholderKindSchema } from './placeholders.js';
import { withVenueFixtureOpenings } from './venueFixtures.js';
import { defaultExportLayers, exportLayersSchema, resolveExportLayers, type ExportLayers } from './exportLayers.js';
import type { DrawingScale, PaperSize } from './tiling.js';
import { createLayoutPartIndex, type LayoutPartIndex } from './layoutObjects.js';
import { partLibrarySchema } from './parts/definition.js';
import { stockInventorySchema, type InventoryCount, type InventoryItem } from './partLists.js';
import { frozenInventory, layoutLibrary, resolveFrozen } from './frozenParts.js';

export { planTiles, PAGE_OVERLAP_MM, REGISTRATION_MARK_MM, drawingAreaMm } from './tiling.js';
export type { DrawingScale, PaperSize, PlanTile } from './tiling.js';
export { defaultExportLayers, exportLayersSchema, resolveExportLayers, EXPORT_LAYER_OPTIONS } from './exportLayers.js';
export type { ExportLayers } from './exportLayers.js';

const name = z.string().trim().min(1).max(120);
const point = z.strictObject({ x: z.number().finite(), y: z.number().finite() });
/** Default 1:50 construction scale: 1 mm on the page equals 50 mm on the model. Also 1:25 and 1:100. */
export const DRAWING_SCALE = 50;
export const paperSizeSchema = z.enum(['A4', 'A3', 'A2', 'A1']);
export const drawingScaleSchema = z.union([z.literal(25), z.literal(50), z.literal(100)]);
export const exportStatusSchema = z.enum(['pending', 'ready', 'failed']);
export const freezeExportSchema = z.strictObject({
  name, paper: paperSizeSchema.optional().default('A4'), scale: drawingScaleSchema.optional().default(DRAWING_SCALE),
  elevationGroupIds: z.array(z.uuid()).max(250).optional().default([]),
  layers: exportLayersSchema.partial().optional(),
});
/**
 * A frozen Bühnenbild. Version 2 inlines the exact part revisions and materials the layout used
 * (`library`) and the stock it was checked against, so drawings and lists are derived again from
 * the snapshot alone. Version 1 snapshots carried pre-resolved wall and object outlines; their
 * issued PDFs stay as stored bytes.
 */
export const CONSTRUCTION_SNAPSHOT_VERSION = 2;
export const constructionSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(CONSTRUCTION_SNAPSHOT_VERSION),
  paper: paperSizeSchema.default('A4'),
  scale: drawingScaleSchema,
  revisionId: z.uuid(),
  revisionName: name,
  issuedAt: z.string(),
  productionName: name, venueName: name, sceneName: name,
  venueVersionId: z.uuid(),
  venue: venueGeometrySchema,
  layout: layoutSchema,
  library: partLibrarySchema,
  stock: stockInventorySchema.default({ items: [], counts: [] }),
  elevationGroupIds: z.array(z.uuid()).max(250).default([]),
  layers: exportLayersSchema.default(defaultExportLayers),
  resolvedPlaceholders: z.array(z.strictObject({
    id: z.uuid(), kind: placeholderKindSchema, label: name,
    width: z.number().finite().min(1).max(100000), depth: z.number().finite().min(1).max(100000),
    height: z.number().finite().min(1).max(100000),
    corners: z.tuple([point, point, point, point]),
  })).default([]),
  warnings: overheadWarningsSchema.default([]),
  unresolvedWarnings: z.array(keepClearWarningSchema).default([]),
});
export type ConstructionSnapshot = z.infer<typeof constructionSnapshotSchema>;
export const exportRevisionSchema = z.object({
  id: z.uuid(), name, paper: paperSizeSchema.default('A4'), scale: drawingScaleSchema,
  status: exportStatusSchema, createdAt: z.string(),
});
export type ExportRevision = z.infer<typeof exportRevisionSchema>;
export const exportListSchema = z.array(exportRevisionSchema);

export const exportPreviewSchema = z.strictObject({
  paper: paperSizeSchema.optional().default('A4'),
  scale: drawingScaleSchema.optional().default(DRAWING_SCALE),
  elevationGroupIds: z.array(z.uuid()).max(250).optional().default([]),
  layers: exportLayersSchema.partial().optional(),
});
export const exportPreviewResultSchema = z.strictObject({
  pageCount: z.number().int().positive(),
  planPages: z.number().int().nonnegative(),
  elevationPages: z.number().int().nonnegative(),
  notesPages: z.number().int().nonnegative(),
  tiles: z.number().int().nonnegative(),
});

/** Parts and stock of the workspace at issue time; the snapshot keeps only what the layout uses. */
export type FreezeSource = {
  index: Pick<LayoutPartIndex, 'part' | 'context'>;
  stock?: { items: readonly InventoryItem[]; counts: readonly InventoryCount[] };
};


const EMPTY_SOURCE: FreezeSource = { index: createLayoutPartIndex({ parts: [], materials: [] }) };

export function freezeSnapshot(
  scene: Scene,
  revision: {
    id: string; name: string; issuedAt: Date; paper?: PaperSize; scale?: DrawingScale;
    elevationGroupIds?: string[]; layers?: Partial<ExportLayers>;
  },
  source: FreezeSource = EMPTY_SOURCE,
): ConstructionSnapshot {
  const layout = structuredClone(scene.layout);
  const venue = withVenueFixtureOpenings(structuredClone(scene.venue), layout);
  const knownGroups = new Set((layout.groups ?? []).map(group => group.id));
  const elevationGroupIds = [...new Set(revision.elevationGroupIds ?? [])].filter(id => knownGroups.has(id));
  const library = layoutLibrary([layout], source.index);
  const stock = frozenInventory(library, [layout], source.stock ?? { items: [], counts: [] });
  const { objects } = resolveFrozen({ layout, venue, library, stock });
  return {
    schemaVersion: CONSTRUCTION_SNAPSHOT_VERSION, paper: revision.paper ?? 'A4', scale: revision.scale ?? DRAWING_SCALE,
    revisionId: revision.id, revisionName: revision.name, issuedAt: revision.issuedAt.toISOString(),
    productionName: scene.productionName, venueName: scene.venueName, sceneName: scene.name,
    venueVersionId: scene.venueVersionId, venue, layout, library, stock, elevationGroupIds,
    layers: resolveExportLayers(revision.layers),
    warnings: resolvedOverheadClearance(objects, venue),
    resolvedPlaceholders: (venue.placeholders ?? []).map(item => {
      const [a, b, c, d] = placeholderCorners(item);
      if (!a || !b || !c || !d) throw new Error('Placeholder geometry must resolve to four corners.');
      return {
        id: item.id, kind: item.kind, label: item.label,
        width: item.width, depth: item.depth, height: item.height, corners: [a, b, c, d] as const,
      };
    }),
    unresolvedWarnings: resolvedKeepClearWarnings(venue, objects),
  };
}

/** Objects of a frozen Bühnenbild, resolved from the revisions it inlined. */
export function snapshotObjects(snapshot: Pick<ConstructionSnapshot, 'layout' | 'venue' | 'library' | 'stock'>) {
  return resolveFrozen(snapshot);
}

export function germanDate(iso: string) {
  const value = new Date(iso);
  return `${String(value.getUTCDate()).padStart(2, '0')}.${String(value.getUTCMonth() + 1).padStart(2, '0')}.${value.getUTCFullYear()}`;
}
