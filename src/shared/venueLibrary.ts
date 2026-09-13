import { z } from 'zod';
import { venueGeometrySchema } from './layout.js';

export const createVenueSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  width: z.number().finite().positive().max(100000),
  depth: z.number().finite().positive().max(100000),
});
export const venueSummarySchema = z.object({
  id: z.uuid(), name: z.string(), venueVersionId: z.uuid(), width: z.number(), depth: z.number(),
});
export const venueListSchema = z.array(venueSummarySchema);
export const venueRecordSchema = venueSummarySchema.extend({ venue: venueGeometrySchema });
export type VenueRecord = z.infer<typeof venueRecordSchema>;
export const publishVenueSchema = z.strictObject({
  venueVersionId: z.uuid(), venue: venueGeometrySchema,
});
