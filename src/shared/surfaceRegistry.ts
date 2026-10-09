import { z } from 'zod';

export const SURFACE_MAP_KINDS = [
  'baseColor', 'normal', 'orm', 'roughness', 'metalness', 'occlusion',
  'displacement', 'alpha', 'emissive',
] as const;
export const surfaceMapKindSchema = z.enum(SURFACE_MAP_KINDS);
export type SurfaceMapKind = z.infer<typeof surfaceMapKindSchema>;

export const surfaceTextureMapsSchema = z.strictObject({
  baseColor: z.uuid(),
  normal: z.uuid().optional(),
  orm: z.uuid().optional(),
  roughness: z.uuid().optional(),
  metalness: z.uuid().optional(),
  occlusion: z.uuid().optional(),
  displacement: z.uuid().optional(),
  alpha: z.uuid().optional(),
  emissive: z.uuid().optional(),
}).refine(value => !(value.orm && (value.roughness || value.metalness || value.occlusion)),
  'Packed ORM cannot be combined with separate occlusion, roughness or metalness maps');

export const surfaceDefinitionSchema = z.strictObject({
  workflow: z.literal('metallic-roughness').default('metallic-roughness'),
  /** Real-world size covered by one texture tile. */
  tileWidthMm: z.number().finite().min(10).max(100000),
  tileHeightMm: z.number().finite().min(10).max(100000),
  maps: surfaceTextureMapsSchema,
  baseColorFactor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#ffffff'),
  roughnessFactor: z.number().finite().min(0).max(1).default(1),
  metallicFactor: z.number().finite().min(0).max(1).default(0),
  normalScale: z.number().finite().min(0).max(4).default(1),
  displacementScaleMm: z.number().finite().min(0).max(1000).default(0),
  /** glTF/OpenGL tangent-space normal convention (+Y / green up). */
  normalConvention: z.literal('opengl').default('opengl'),
});
export type SurfaceDefinition = z.infer<typeof surfaceDefinitionSchema>;

export const surfaceScopeSchema = z.enum(['workspace', 'production']);
export type SurfaceScope = z.infer<typeof surfaceScopeSchema>;

export const surfaceRecordSchema = z.strictObject({
  id: z.uuid(),
  workspaceId: z.uuid(),
  productionId: z.uuid().nullable(),
  scope: surfaceScopeSchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(''),
  definition: surfaceDefinitionSchema,
  archived: z.boolean(),
});
export const surfaceListSchema = z.array(surfaceRecordSchema);
export type SurfaceRecord = z.infer<typeof surfaceRecordSchema>;

export const createSurfaceSchema = z.strictObject({
  scope: surfaceScopeSchema,
  productionId: z.uuid().optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(''),
  definition: surfaceDefinitionSchema,
}).refine(value => value.scope === 'production' ? !!value.productionId : !value.productionId,
  'Production scope requires exactly one production');

export const updateSurfaceSchema = z.strictObject({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional(),
  definition: surfaceDefinitionSchema.optional(),
}).refine(value => Object.keys(value).length > 0, 'At least one field required');

export const surfaceFileResultSchema = z.strictObject({
  fileId: z.uuid(),
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  pixelWidth: z.number().int().positive(),
  pixelHeight: z.number().int().positive(),
});

export const surfaceCatalogItemSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9_]+$/).max(120),
  name: z.string().trim().min(1).max(160),
  description: z.string().max(1000),
  thumbnailUrl: z.url().refine(value => new URL(value).hostname === 'cdn.polyhaven.com'),
  categories: z.array(z.string().trim().min(1).max(120)).max(30),
  tileWidthMm: z.number().finite().min(10).max(100000),
  tileHeightMm: z.number().finite().min(10).max(100000),
});
export const surfaceCatalogSchema = z.array(surfaceCatalogItemSchema).max(48);
export type SurfaceCatalogItem = z.infer<typeof surfaceCatalogItemSchema>;

export const importCatalogSurfaceSchema = z.strictObject({
  provider: z.literal('poly-haven'),
  assetId: z.string().regex(/^[a-z0-9_]+$/).max(120),
  resolution: z.enum(['1k', '2k']).default('1k'),
  scope: surfaceScopeSchema,
  productionId: z.uuid().optional(),
}).refine(value => value.scope === 'production' ? !!value.productionId : !value.productionId,
  'Production scope requires exactly one production');
