import { z } from 'zod';
import {
  surfaceCatalogItemSchema, surfaceCatalogSchema, type SurfaceCatalogItem, type SurfaceMapKind,
} from '../../shared/surfaceRegistry.js';
import { inspectSurfaceTexture, MAX_SURFACE_TEXTURE_BYTES } from './files.js';

const API = 'https://api.polyhaven.com';
const USER_AGENT = 'HTS-Stage-Planner/1.0 (Poly-Haven-material-import)';

const assetSchema = z.looseObject({
  name: z.string(),
  description: z.string().optional().default(''),
  categories: z.array(z.string()).optional().default([]),
  tags: z.array(z.string()).optional().default([]),
  dimensions: z.tuple([z.number(), z.number()]),
  thumbnail_url: z.url(),
});
const assetsSchema = z.record(z.string(), assetSchema);
const downloadSchema = z.looseObject({
  size: z.number().int().positive().max(MAX_SURFACE_TEXTURE_BYTES),
  url: z.url(),
});

export type CatalogImport = {
  item: SurfaceCatalogItem;
  maps: Partial<Record<SurfaceMapKind, {
    bytes: Buffer;
    mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
    pixelWidth: number;
    pixelHeight: number;
  }>>;
};

export type SurfaceCatalogClient = {
  search(query: string): Promise<SurfaceCatalogItem[]>;
  download(assetId: string, resolution: '1k' | '2k'): Promise<CatalogImport>;
};

function item(id: string, raw: z.infer<typeof assetSchema>): SurfaceCatalogItem {
  return surfaceCatalogItemSchema.parse({
    id,
    name: raw.name,
    description: raw.description.slice(0, 1000),
    thumbnailUrl: raw.thumbnail_url,
    categories: raw.categories.slice(0, 30),
    tileWidthMm: raw.dimensions[0],
    tileHeightMm: raw.dimensions[1],
  });
}

export function createPolyHavenClient(fetcher: typeof fetch = fetch): SurfaceCatalogClient {
  let cached: { expires: number; assets: z.infer<typeof assetsSchema> } | undefined;

  async function json(url: string) {
    const response = await fetcher(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Poly Haven returned ${response.status}`);
    return response.json();
  }

  async function allAssets() {
    if (cached && cached.expires > Date.now()) return cached.assets;
    const assets = assetsSchema.parse(await json(`${API}/assets?type=textures`));
    cached = { expires: Date.now() + 10 * 60_000, assets };
    return assets;
  }

  async function download(url: string, expectedSize: number) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'dl.polyhaven.org') {
      throw new Error('Unexpected Poly Haven download host');
    }
    if (expectedSize > MAX_SURFACE_TEXTURE_BYTES) throw new Error('Texture is too large');
    const response = await fetcher(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok || !response.body) throw new Error(`Poly Haven download returned ${response.status}`);
    const chunks: Buffer[] = [];
    let size = 0;
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const bytes = Buffer.from(value);
      size += bytes.length;
      if (size > MAX_SURFACE_TEXTURE_BYTES) throw new Error('Texture is too large');
      chunks.push(bytes);
    }
    const bytes = Buffer.concat(chunks);
    const inspected = inspectSurfaceTexture(bytes, 'image/jpeg');
    return { bytes, ...inspected };
  }

  return {
    async search(query) {
      const assets = await allAssets();
      const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
      const matches = Object.entries(assets).filter(([id, asset]) => {
        const haystack = [id, asset.name, asset.description, ...asset.categories, ...asset.tags]
          .join(' ').toLocaleLowerCase();
        return words.every(word => haystack.includes(word));
      });
      matches.sort((left, right) => left[1].name.localeCompare(right[1].name));
      return surfaceCatalogSchema.parse(matches.slice(0, 48).map(([id, asset]) => item(id, asset)));
    },

    async download(assetId, resolution) {
      const [assets, rawFiles] = await Promise.all([
        allAssets(),
        json(`${API}/files/${encodeURIComponent(assetId)}`),
      ]);
      const asset = assets[assetId];
      if (!asset) throw new Error('Poly Haven material was not found');
      const files = z.record(z.string(), z.unknown()).parse(rawFiles);
      const candidates: Array<[SurfaceMapKind, string]> = [
        ['baseColor', 'Diffuse'],
        ['normal', 'nor_gl'],
        ['orm', 'arm'],
      ];
      if (!files.arm) candidates.push(
        ['roughness', 'Rough'],
        ['metalness', 'Metal'],
        ['occlusion', 'AO'],
      );
      const selected = candidates.flatMap(([kind, source]) => {
        const map = files[source];
        if (!map || typeof map !== 'object') return [];
        const variant = (map as Record<string, unknown>)[resolution];
        if (!variant || typeof variant !== 'object') return [];
        const jpg = (variant as Record<string, unknown>).jpg;
        const parsed = downloadSchema.safeParse(jpg);
        return parsed.success ? [[kind, parsed.data] as const] : [];
      });
      if (!selected.some(([kind]) => kind === 'baseColor')) throw new Error('Material has no compatible base color map');
      const downloaded = await Promise.all(selected.map(async ([kind, source]) => [kind, await download(source.url, source.size)] as const));
      return { item: item(assetId, asset), maps: Object.fromEntries(downloaded) };
    },
  };
}
