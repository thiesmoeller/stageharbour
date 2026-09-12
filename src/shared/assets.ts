import { z } from 'zod';
import { wallSchema, braceSchema } from './layout.js';

const dimension = z.number().finite().min(1).max(100000);
const vector = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
// Model definitions are immutable; scenes can resize individual instances.
export const modelSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('upload'), fileId: z.uuid() }),
  z.strictObject({ kind: z.literal('catalog'), catalogId: z.string().min(1).max(160),
    url: z.url().refine(value => {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === 'byrpxoiotywskoojsrzd.supabase.co'
        && url.pathname.startsWith('/storage/v1/object/public/items/system/') && url.pathname.endsWith('/model.glb') && !url.search && !url.hash;
    }),
    offset: vector, rotation: vector, scale: vector,
  }),
]);
export const assetDefinitionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('wall'), template: wallSchema.omit({ id: true, label: true, x: true, y: true, rotation: true }) }),
  z.strictObject({ kind: z.literal('brace'), template: braceSchema.omit({ id: true, label: true, x: true, y: true, rotation: true }) }),
  z.strictObject({ kind: z.literal('model'), width: dimension, height: dimension, depth: dimension, source: modelSourceSchema }),
]);
export const createAssetSchema = z.strictObject({ name: z.string().trim().min(1).max(120), definition: assetDefinitionSchema });
export const assetSchema = createAssetSchema.extend({ id: z.uuid(), archived: z.boolean() });
export const assetListSchema = z.array(assetSchema);
export type Asset = z.infer<typeof assetSchema>;
export type AssetDefinition = z.infer<typeof assetDefinitionSchema>;
