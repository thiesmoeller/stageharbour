import { z } from 'zod';

const scope = z.enum(['scene', 'venue']);

export const dimensionAnchorSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('outline'), index: z.number().int().min(0).max(500) }),
  /** Point along a venue outline edge. `t` is 0 at the start vertex and 1 at the end. */
  z.strictObject({ kind: z.literal('outlineEdge'), edge: z.number().int().min(0).max(500), t: z.number().min(0).max(1) }),
  z.strictObject({ kind: z.literal('wall'), scope, wallId: z.uuid(), corner: z.number().int().min(0).max(3) }),
  z.strictObject({ kind: z.literal('wallEdge'), scope, wallId: z.uuid(), edge: z.number().int().min(0).max(3), t: z.number().min(0).max(1) }),
  z.strictObject({ kind: z.literal('platform'), scope, platformId: z.uuid(), index: z.number().int().min(0).max(32) }),
  z.strictObject({ kind: z.literal('platformEdge'), scope, platformId: z.uuid(), edge: z.number().int().min(0).max(32), t: z.number().min(0).max(1) }),
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
