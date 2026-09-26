import { z } from 'zod';

const coordinate = z.number().finite().min(-100000).max(100000);

/** Stage centreline pose (mm / degrees) — kept out of snapping.ts so layout schemas stay cycle-free. */
export const stageCentrelineSchema = z.strictObject({
  x: coordinate, y: coordinate,
  rotation: z.number().finite().min(-360).max(360),
});
export type StageCentreline = z.infer<typeof stageCentrelineSchema>;
export const centrelineSchema = stageCentrelineSchema;

export function defaultCentreline(venue: { width: number; depth: number }): StageCentreline {
  return { x: venue.width / 2, y: venue.depth / 2, rotation: 90 };
}
