import { z } from 'zod';
import { layoutSchema, openingCorners, venueGeometrySchema, wallCorners, type Scene } from './layout.js';
import { braceCorners, braceSlabFootprints } from './braceTransforms.js';
import { overheadClearance, overheadWarningsSchema } from './overhead.js';
import { keepClearWarningSchema, keepClearWarnings } from './keepClear.js';
import { placeholderCorners, placeholderKindSchema } from './placeholders.js';
import { resolveWall } from './wall-types.js';
import { withVenueFixtureOpenings } from './venueFixtures.js';
import { defaultExportLayers, exportLayersSchema, resolveExportLayers, type ExportLayers } from './exportLayers.js';
import type { DrawingScale, PaperSize } from './tiling.js';

export { planTiles, PAGE_OVERLAP_MM, REGISTRATION_MARK_MM, drawingAreaMm } from './tiling.js';
export type { DrawingScale, PaperSize, PlanTile } from './tiling.js';
export { defaultExportLayers, exportLayersSchema, resolveExportLayers, EXPORT_LAYER_OPTIONS } from './exportLayers.js';
export type { ExportLayers } from './exportLayers.js';

const name = z.string().trim().min(1).max(120);
const point = z.strictObject({ x: z.number().finite(), y: z.number().finite() });
/** Default 1:50 construction scale: 1 mm on the page equals 50 mm on the model. Also 1:25 and 1:100. */
export const DRAWING_SCALE = 50;
export const paperSizeSchema = z.enum(['A4', 'A3']);
export const drawingScaleSchema = z.union([z.literal(25), z.literal(50), z.literal(100)]);
export const exportStatusSchema = z.enum(['pending', 'ready', 'failed']);
export const freezeExportSchema = z.strictObject({
  name, paper: paperSizeSchema.optional().default('A4'), scale: drawingScaleSchema.optional().default(DRAWING_SCALE),
  elevationGroupIds: z.array(z.uuid()).max(250).optional().default([]),
  layers: exportLayersSchema.partial().optional(),
});
export const constructionSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  paper: paperSizeSchema.default('A4'),
  scale: drawingScaleSchema,
  revisionId: z.uuid(),
  revisionName: name,
  issuedAt: z.string(),
  productionName: name, venueName: name, sceneName: name,
  venueVersionId: z.uuid(),
  venue: venueGeometrySchema,
  layout: layoutSchema,
  elevationGroupIds: z.array(z.uuid()).max(250).default([]),
  layers: exportLayersSchema.default(defaultExportLayers),
  resolvedWalls: z.array(z.strictObject({
    id: z.uuid(), label: name,
    assemblyNumber: z.number().int().positive().max(250).optional(),
    panelLabel: name.optional(),
    corners: z.tuple([point, point, point, point]),
    openings: z.array(z.strictObject({
      id: z.uuid(), left: z.number().finite(), sill: z.number().finite(),
      width: z.number().finite(), height: z.number().finite(),
      profile: z.enum(['rectangle', 'arch']).optional(),
      corners: z.tuple([point, point, point, point]),
    })).default([]),
  })),
  resolvedBraces: z.array(z.strictObject({
    timberCorners: z.tuple([point, point, point, point]).optional(),
    slabs: z.array(z.tuple([point, point, point, point])).optional(),
    id: z.uuid(), label: name, height: z.number().finite().min(1).max(100000),
    corners: z.tuple([point, point, point, point]),
  })).default([]),
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

export function freezeSnapshot(
  scene: Scene,
  revision: {
    id: string; name: string; issuedAt: Date; paper?: PaperSize; scale?: DrawingScale;
    elevationGroupIds?: string[]; layers?: Partial<ExportLayers>;
  },
  panelLabels: Readonly<Record<string, string>> = {},
): ConstructionSnapshot {
  const layout = structuredClone(scene.layout);
  const venue = withVenueFixtureOpenings(structuredClone(scene.venue), layout);
  const knownGroups = new Set((layout.groups ?? []).map(group => group.id));
  const elevationGroupIds = [...new Set(revision.elevationGroupIds ?? [])].filter(id => knownGroups.has(id));
  return {
    schemaVersion: 1, paper: revision.paper ?? 'A4', scale: revision.scale ?? DRAWING_SCALE,
    revisionId: revision.id, revisionName: revision.name, issuedAt: revision.issuedAt.toISOString(),
    productionName: scene.productionName, venueName: scene.venueName, sceneName: scene.name,
    venueVersionId: scene.venueVersionId, venue, layout, elevationGroupIds,
    layers: resolveExportLayers(revision.layers),
    warnings: overheadClearance(layout, venue),
    resolvedWalls: scene.layout.walls.map(wall => {
      const resolved = resolveWall(wall, scene.layout.wallTypes ?? []);
      const [a, b, c, d] = wallCorners(resolved);
      if (!a || !b || !c || !d) throw new Error('Wall geometry must resolve to four corners.');
      const panelLabel = wall.panelId ? panelLabels[wall.panelId] : undefined;
      return {
        id: resolved.id, label: resolved.label, corners: [a, b, c, d] as const,
        assemblyNumber: wall.assemblyNumber, panelLabel,
        openings: resolved.openings.map(opening => {
          const [oa, ob, oc, od] = openingCorners(resolved, opening);
          if (!oa || !ob || !oc || !od) throw new Error('Opening geometry must resolve to four corners.');
          return {
            id: opening.id, left: opening.left, sill: opening.sill, width: opening.width, height: opening.height,
            ...(opening.profile ? { profile: opening.profile } : {}),
            corners: [oa, ob, oc, od] as const,
          };
        }),
      };
    }),
    resolvedBraces: (scene.layout.braces ?? []).map(brace => {
      const [a, b, c, d] = braceCorners(brace);
      if (!a || !b || !c || !d) throw new Error('Brace geometry must resolve to four corners.');
      return { id: brace.id, label: brace.label, height: brace.height,
        ...(brace.ballast && brace.ballast.mode !== 'none' ? {
          timberCorners: braceCorners({ ...brace, ballast: undefined }) as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }],
          slabs: braceSlabFootprints(brace),
        } : {}), corners: [a, b, c, d] as const };
    }),
    resolvedPlaceholders: [...(venue.placeholders ?? []), ...(scene.layout.placeholders ?? [])].map(item => {
      const [a, b, c, d] = placeholderCorners(item);
      if (!a || !b || !c || !d) throw new Error('Placeholder geometry must resolve to four corners.');
      return {
        id: item.id, kind: item.kind, label: item.label,
        width: item.width, depth: item.depth, height: item.height, corners: [a, b, c, d] as const,
      };
    }),
    unresolvedWarnings: keepClearWarnings(venue, {
      ...layout,
      placeholders: [...(venue.placeholders ?? []), ...(layout.placeholders ?? [])],
    }),
  };
}

export function germanDate(iso: string) {
  const value = new Date(iso);
  return `${String(value.getUTCDate()).padStart(2, '0')}.${String(value.getUTCMonth() + 1).padStart(2, '0')}.${value.getUTCFullYear()}`;
}
