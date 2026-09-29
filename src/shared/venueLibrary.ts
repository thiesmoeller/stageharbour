import { z } from 'zod';
import { wallCorners, venueGeometrySchema, type VenueGeometry } from './layout.js';
import { measuredOutline } from './venue.js';
import { resolveWall } from './wall-types.js';

export const createVenueSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  width: z.number().finite().positive().max(100000),
  depth: z.number().finite().positive().max(100000),
});
export const renameVenueSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
});
export const venuePlanPreviewSchema = z.object({
  width: z.number(), depth: z.number(),
  outline: z.array(z.object({ x: z.number(), y: z.number() })).min(3).max(64).optional(),
  walls: z.array(z.object({ corners: z.array(z.object({ x: z.number(), y: z.number() })).min(3).max(8) })).max(250),
  platforms: z.array(z.object({ outline: z.array(z.object({ x: z.number(), y: z.number() })).min(3).max(32) })).max(50),
});
export type VenuePlanPreview = z.infer<typeof venuePlanPreviewSchema>;

/** Compact hall sketch for the venue library gallery. */
export function venuePlanPreview(venue: VenueGeometry): VenuePlanPreview {
  return {
    width: venue.width,
    depth: venue.depth,
    outline: measuredOutline(venue),
    walls: (venue.walls ?? []).map(wall => ({
      corners: wallCorners(resolveWall(wall, venue.wallTypes ?? [])),
    })),
    platforms: (venue.platforms ?? []).map(platform => ({ outline: platform.outline })),
  };
}

export const venueSummarySchema = z.object({
  id: z.uuid(), name: z.string(), venueVersionId: z.uuid(), width: z.number(), depth: z.number(),
  preview: venuePlanPreviewSchema.optional(),
});
export const venueListSchema = z.array(venueSummarySchema);
export const venueRecordSchema = venueSummarySchema.extend({ venue: venueGeometrySchema });
export type VenueRecord = z.infer<typeof venueRecordSchema>;
export const publishVenueSchema = z.strictObject({
  venueVersionId: z.uuid(), venue: venueGeometrySchema,
});
