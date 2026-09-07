import { z } from 'zod';
import { layoutSchema, venueGeometrySchema, wallCorners, type Scene } from './layout.js';
import { braceCorners } from './braceTransforms.js';

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
  })),
  resolvedBraces: z.array(z.strictObject({
    id: z.uuid(), label: name, height: z.number().finite().min(1).max(100000),
    corners: z.tuple([point, point, point, point]),
  })).default([]),
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
    venueVersionId: scene.venueVersionId, venue: scene.venue,
    layout: structuredClone(scene.layout),
    resolvedWalls: scene.layout.walls.map(wall => {
      const [a, b, c, d] = wallCorners(wall);
      if (!a || !b || !c || !d) throw new Error('Wall geometry must resolve to four corners.');
      return { id: wall.id, label: wall.label, corners: [a, b, c, d] as const };
    }),
    resolvedBraces: (scene.layout.braces ?? []).map(brace => {
      const [a, b, c, d] = braceCorners(brace);
      if (!a || !b || !c || !d) throw new Error('Brace geometry must resolve to four corners.');
      return { id: brace.id, label: brace.label, height: brace.height, corners: [a, b, c, d] as const };
    }),
  };
}

export function germanDate(iso: string) {
  const value = new Date(iso);
  return `${String(value.getUTCDate()).padStart(2, '0')}.${String(value.getUTCMonth() + 1).padStart(2, '0')}.${value.getUTCFullYear()}`;
}
