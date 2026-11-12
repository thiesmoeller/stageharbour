import { z } from 'zod';
import { wallFieldsStoredSchema, braceSchema } from './layout.js';
import { MODEL_ASSET_BASE_URL } from './assetHosts.js';

/** Uploaded GLB files stay under this limit so every workspace member can load them. */
export const MAX_MODEL_BYTES = 50 * 1024 * 1024;
export const MAX_MODEL_MB = MAX_MODEL_BYTES / (1024 * 1024);

const dimension = z.number().finite().min(1).max(100000);
const vector = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
export const modelAxisSchema = z.enum(['width', 'height', 'depth']);
export type ModelAxis = z.infer<typeof modelAxisSchema>;

/** Scale a glTF metre bounding box uniformly from one known millimetre exterior length. */
export function modelDimensionsFromReference(
  boundsM: { x: number; y: number; z: number },
  axis: ModelAxis,
  lengthMm: number,
): { width: number; height: number; depth: number } {
  const native = { width: boundsM.x, height: boundsM.y, depth: boundsM.z }[axis];
  if (!(native > 0) || !Number.isFinite(native)) throw new Error('Model has no usable bounds');
  if (!(lengthMm >= 1) || !Number.isFinite(lengthMm)) throw new Error('Invalid reference length');
  const scale = (lengthMm / 1000) / native;
  return {
    width: boundsM.x * scale * 1000,
    height: boundsM.y * scale * 1000,
    depth: boundsM.z * scale * 1000,
  };
}

const catalogHost = new URL(MODEL_ASSET_BASE_URL);

// Model definitions are immutable; scenes can resize individual instances.
export const modelSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('upload'), fileId: z.uuid() }),
  z.strictObject({ kind: z.literal('catalog'), catalogId: z.string().min(1).max(160),
    url: z.url().refine(value => {
      const url = new URL(value);
      return url.origin === catalogHost.origin
        && url.pathname.startsWith(`${catalogHost.pathname}/system/`) && url.pathname.endsWith('/model.glb') && !url.search && !url.hash;
    }),
    offset: vector, rotation: vector, scale: vector,
  }),
]);
export const assetDefinitionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('wall'), template: wallFieldsStoredSchema.omit({ id: true, label: true, x: true, y: true, rotation: true }) }),
  z.strictObject({ kind: z.literal('brace'), template: braceSchema.omit({ id: true, label: true, x: true, y: true, rotation: true }) }),
  z.strictObject({ kind: z.literal('model'), width: dimension, height: dimension, depth: dimension, source: modelSourceSchema }),
]);
export const createAssetSchema = z.strictObject({ name: z.string().trim().min(1).max(120), definition: assetDefinitionSchema });
export const renameAssetSchema = z.strictObject({ name: z.string().trim().min(1).max(120) });
export const assetSchema = createAssetSchema.extend({ id: z.uuid(), archived: z.boolean() });
export const assetListSchema = z.array(assetSchema);
export type Asset = z.infer<typeof assetSchema>;
export type AssetDefinition = z.infer<typeof assetDefinitionSchema>;
