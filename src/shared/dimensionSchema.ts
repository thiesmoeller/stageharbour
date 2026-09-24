import { z } from 'zod';

const scope = z.enum(['scene', 'venue']);

export const dimensionAnchorSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('outline'), index: z.number().int().min(0).max(500) }),
  z.strictObject({ kind: z.literal('wall'), scope, wallId: z.uuid(), corner: z.number().int().min(0).max(3) }),
  z.strictObject({ kind: z.literal('platform'), scope, platformId: z.uuid(), index: z.number().int().min(0).max(32) }),
  z.strictObject({ kind: z.literal('brace'), braceId: z.uuid(), corner: z.number().int().min(0).max(3) }),
]);
export type DimensionAnchor = z.infer<typeof dimensionAnchorSchema>;

export const playDimensionSchema = z.strictObject({
  id: z.uuid(),
  /** Along the two points, or locked to an axis, chosen by where the dimension line is pulled. */
  orientation: z.enum(['aligned', 'horizontal', 'vertical']),
  /**
   * Aligned: signed distance of the dimension line from the two points.
   * Horizontal: Y of the dimension line. Vertical: X of the dimension line.
   */
  offset: z.number().finite().min(-100000).max(100000),
  a: dimensionAnchorSchema,
  b: dimensionAnchorSchema,
});
export type PlayDimension = z.infer<typeof playDimensionSchema>;

export const playDimensionsSchema = z.array(playDimensionSchema).max(200)
  .refine(items => new Set(items.map(item => item.id)).size === items.length, 'Dimension IDs must be unique');
