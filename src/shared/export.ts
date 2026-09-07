import { z } from 'zod';
import { layoutSchema, openingCorners, venueGeometrySchema, wallCorners, type Scene } from './layout.js';
import { braceCorners } from './braceTransforms.js';
import { keepClearWarningSchema, keepClearWarnings } from './keepClear.js';
import { resolveWall } from './wall-types.js';

const name = z.string().trim().min(1).max(120);
const point = z.strictObject({ x: z.number().finite(), y: z.number().finite() });
/** Fixed 1:50 drawing scale for this slice: 1 mm on the page equals 50 mm on the model. Selectable A3/tiling is a later slice. */
export const DRAWING_SCALE = 50;
export const exportStatusSchema = z.enum(['pending', 'ready', 'failed']);
export const freezeExportSchema = z.strictObject({ name });
export const constructionSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  scale: z.literal(DRAWING_SCALE),
  revisionId: z.uuid(),
  revisionName: name,
  issuedAt: z.string(),
  productionName: name, venueName: name, sceneName: name,
  venueVersionId: z.uuid(),
  venue: venueGeometrySchema,
  layout: layoutSchema,
  resolvedWalls: z.array(z.strictObject({
    id: z.uuid(), label: name,
    corners: z.tuple([point, point, point, point]),
    openings: z.array(z.strictObject({
      id: z.uuid(), left: z.number().finite(), sill: z.number().finite(),
      width: z.number().finite(), height: z.number().finite(),
      corners: z.tuple([point, point, point, point]),
    })).default([]),
  })),
  resolvedBraces: z.array(z.strictObject({
    id: z.uuid(), label: name, height: z.number().finite().min(1).max(100000),
    corners: z.tuple([point, point, point, point]),
  })).default([]),
  unresolvedWarnings: z.array(keepClearWarningSchema).default([]),
});
export type ConstructionSnapshot = z.infer<typeof constructionSnapshotSchema>;
export const exportRevisionSchema = z.object({
  id: z.uuid(), name, scale: z.literal(DRAWING_SCALE),
  status: exportStatusSchema, createdAt: z.string(),
});
export type ExportRevision = z.infer<typeof exportRevisionSchema>;
export const exportListSchema = z.array(exportRevisionSchema);

export function freezeSnapshot(scene: Scene, revision: { id: string; name: string; issuedAt: Date }): ConstructionSnapshot {
  return {
    schemaVersion: 1, scale: DRAWING_SCALE,
    revisionId: revision.id, revisionName: revision.name, issuedAt: revision.issuedAt.toISOString(),
    productionName: scene.productionName, venueName: scene.venueName, sceneName: scene.name,
    venueVersionId: scene.venueVersionId, venue: structuredClone(scene.venue),
    layout: structuredClone(scene.layout),
    resolvedWalls: scene.layout.walls.map(wall => {
      const resolved = resolveWall(wall, scene.layout.wallTypes ?? []);
      const [a, b, c, d] = wallCorners(resolved);
      if (!a || !b || !c || !d) throw new Error('Wall geometry must resolve to four corners.');
      return {
        id: resolved.id, label: resolved.label, corners: [a, b, c, d] as const,
        openings: resolved.openings.map(opening => {
          const [oa, ob, oc, od] = openingCorners(resolved, opening);
          if (!oa || !ob || !oc || !od) throw new Error('Opening geometry must resolve to four corners.');
          return { id: opening.id, left: opening.left, sill: opening.sill, width: opening.width, height: opening.height, corners: [oa, ob, oc, od] as const };
        }),
      };
    }),
    resolvedBraces: (scene.layout.braces ?? []).map(brace => {
      const [a, b, c, d] = braceCorners(brace);
      if (!a || !b || !c || !d) throw new Error('Brace geometry must resolve to four corners.');
      return { id: brace.id, label: brace.label, height: brace.height, corners: [a, b, c, d] as const };
    }),
    unresolvedWarnings: keepClearWarnings(scene.venue, scene.layout),
  };
}

export function germanDate(iso: string) {
  const value = new Date(iso);
  return `${String(value.getUTCDate()).padStart(2, '0')}.${String(value.getUTCMonth() + 1).padStart(2, '0')}.${value.getUTCFullYear()}`;
}
