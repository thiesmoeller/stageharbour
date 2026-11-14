import { z } from 'zod';
import { MAX_MODEL_BYTES } from '../../shared/assets.js';
import {
  POLYHAVEN_API, isPolyHavenDownloadUrl, millimetresFromPolyHavenModel, modelCatalogSchema,
  pickPolyHavenGlb, type ModelCatalogItem,
} from '../../shared/polyHaven.js';
import { surfaceCatalogItemSchema, surfaceCatalogSchema, type SurfaceCatalogItem } from '../../shared/surfaceRegistry.js';

const textureAssetSchema = z.looseObject({
  name: z.string(),
  description: z.string().optional().default(''),
  categories: z.array(z.string()).optional().default([]),
  tags: z.array(z.string()).optional().default([]),
  dimensions: z.tuple([z.number(), z.number()]),
  thumbnail_url: z.url(),
});
const modelAssetSchema = z.looseObject({
  name: z.string(),
  categories: z.array(z.string()).optional().default([]),
  tags: z.array(z.string()).optional().default([]),
  dimensions: z.array(z.number()).optional(),
  thumbnail_url: z.url(),
});

function textureItem(id: string, raw: z.infer<typeof textureAssetSchema>): SurfaceCatalogItem {
  return surfaceCatalogItemSchema.parse({
    id, name: raw.name, description: raw.description.slice(0, 1000), thumbnailUrl: raw.thumbnail_url,
    categories: raw.categories.slice(0, 30), tileWidthMm: raw.dimensions[0], tileHeightMm: raw.dimensions[1],
  });
}

function modelItem(id: string, raw: z.infer<typeof modelAssetSchema>): ModelCatalogItem {
  return { id, name: raw.name.slice(0, 160), thumbnailUrl: raw.thumbnail_url, categories: raw.categories.slice(0, 30) };
}

async function json(url: string, fetcher: typeof fetch) {
  const response = await fetcher(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Poly Haven returned ${response.status}`);
  return response.json();
}

export async function searchLocalTextures(query: string, fetcher: typeof fetch = fetch): Promise<SurfaceCatalogItem[]> {
  const words = query.trim();
  const url = words
    ? `${POLYHAVEN_API}/search?${new URLSearchParams({ q: words, t: 'textures' })}`
    : `${POLYHAVEN_API}/assets?type=textures`;
  const assets = z.record(z.string(), textureAssetSchema).parse(await json(url, fetcher));
  return surfaceCatalogSchema.parse(Object.entries(assets).slice(0, 48).map(([id, asset]) => textureItem(id, asset)));
}

export async function searchLocalModels(query: string, fetcher: typeof fetch = fetch): Promise<ModelCatalogItem[]> {
  const words = query.trim();
  const url = words
    ? `${POLYHAVEN_API}/search?${new URLSearchParams({ q: words, t: 'models' })}`
    : `${POLYHAVEN_API}/assets?t=models`;
  const assets = z.record(z.string(), modelAssetSchema).parse(await json(url, fetcher));
  return modelCatalogSchema.parse(Object.entries(assets).slice(0, 48).map(([id, asset]) => modelItem(id, asset)));
}

export async function downloadLocalModel(assetId: string, fetcher: typeof fetch = fetch) {
  const [files, listed] = await Promise.all([
    json(`${POLYHAVEN_API}/files/${encodeURIComponent(assetId)}`, fetcher),
    json(`${POLYHAVEN_API}/assets?t=models`, fetcher).then(value => z.record(z.string(), modelAssetSchema).parse(value)),
  ]);
  const asset = listed[assetId];
  if (!asset) throw new Error('Poly Haven model was not found');
  const glb = pickPolyHavenGlb(files);
  if (!glb || !isPolyHavenDownloadUrl(glb.url) || glb.size > MAX_MODEL_BYTES) throw new Error('Poly Haven model has no GLB');
  const response = await fetcher(glb.url);
  if (!response.ok) throw new Error(`Poly Haven download returned ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_MODEL_BYTES) throw new Error('Model is too large');
  return { item: modelItem(assetId, asset), bytes, ...millimetresFromPolyHavenModel(asset.dimensions) };
}

const jpgSchema = z.object({ size: z.number().int().positive(), url: z.url() });

export async function downloadLocalTexture(assetId: string, resolution: '1k' | '2k', fetcher: typeof fetch = fetch) {
  const listed = z.record(z.string(), textureAssetSchema).parse(await json(`${POLYHAVEN_API}/assets?type=textures`, fetcher));
  const asset = listed[assetId];
  if (!asset) throw new Error('Poly Haven material was not found');
  const files = z.record(z.string(), z.unknown()).parse(await json(`${POLYHAVEN_API}/files/${encodeURIComponent(assetId)}`, fetcher));
  const diffuse = files.Diffuse;
  const variant = diffuse && typeof diffuse === 'object' ? (diffuse as Record<string, unknown>)[resolution] : undefined;
  const jpg = variant && typeof variant === 'object' ? jpgSchema.parse((variant as Record<string, unknown>).jpg) : undefined;
  if (!jpg || !isPolyHavenDownloadUrl(jpg.url)) throw new Error('Material has no compatible base color map');
  const response = await fetcher(jpg.url);
  if (!response.ok) throw new Error(`Poly Haven download returned ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { item: textureItem(assetId, asset), bytes, mediaType: 'image/jpeg' as const };
}
