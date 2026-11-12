import { z } from 'zod';
import type { Layout } from './layout.js';
import { STARTER_PART_IDS } from './parts/starter/index.js';

export const ballastSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('none') }),
  z.strictObject({ mode: z.literal('single'), side: z.enum(['left', 'right']).default('left') }),
  z.strictObject({ mode: z.literal('heavy') }),
]);
export type Ballast = z.infer<typeof ballastSchema>;
export const ballastStockSchema = z.strictObject({
  slabs: z.number().int().min(0).max(2147483647),
  straps: z.number().int().min(0).max(2147483647),
});
export type BallastStock = z.infer<typeof ballastStockSchema>;
export const EMPTY_BALLAST_STOCK: BallastStock = { slabs: 0, straps: 0 };
export const materialCountsSchema = ballastStockSchema.extend({ braces: z.number().int().nonnegative() });
export type MaterialCounts = z.infer<typeof materialCountsSchema>;
export const materialRequirementsSchema = z.strictObject({
  required: materialCountsSchema, available: ballastStockSchema, shortage: ballastStockSchema,
});
export function sceneMaterials(layout: Layout): MaterialCounts {
  const braces: readonly { ballast?: Ballast }[] = layout.objects
    .filter(object => object.part.id === STARTER_PART_IDS.brace)
    .map(object => {
      const value = object.values?.ballast ?? 0;
      return { ballast: value >= 2 ? { mode: 'heavy' as const }
        : value === 1 ? { mode: 'single' as const, side: 'left' as const }
          : { mode: 'none' as const } };
    });
  return braces.reduce((count, brace) => ({
    braces: count.braces + 1,
    slabs: count.slabs + (brace.ballast?.mode === 'heavy' ? 2 : brace.ballast?.mode === 'single' ? 1 : 0),
    straps: count.straps + (brace.ballast?.mode === 'heavy' ? 1 : 0),
  }), { braces: 0, slabs: 0, straps: 0 });
}
/** Independent maxima: fixed setup requirements for one play at one venue. */
export function materialRequirements(layouts: readonly Layout[], available: BallastStock) {
  const required = layouts.map(sceneMaterials).reduce((max, count) => ({
    braces: Math.max(max.braces, count.braces), slabs: Math.max(max.slabs, count.slabs), straps: Math.max(max.straps, count.straps),
  }), { braces: 0, slabs: 0, straps: 0 });
  return { required, available, shortage: { slabs: Math.max(0, required.slabs - available.slabs), straps: Math.max(0, required.straps - available.straps) } };
}
export function ballastLabel(ballast?: Ballast): string {
  return ballast?.mode === 'heavy' ? 'Schwer · 2 Gehwegplatten + 1 Spanngurt'
    : ballast?.mode === 'single' ? `Einfach · 1 Gehwegplatte (${ballast.side === 'right' ? 'rechts' : 'links'})` : 'Keine Beschwerung';
}
