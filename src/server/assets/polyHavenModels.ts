import { z } from 'zod';
import { MAX_MODEL_BYTES } from '../../shared/assets.js';
import {
  POLYHAVEN_API, isPolyHavenDownloadUrl, millimetresFromPolyHavenModel, modelCatalogItemSchema,
  modelCatalogSchema, pickPolyHavenGlb, type ModelCatalogItem,
} from '../../shared/polyHaven.js';

const USER_AGENT = 'HTS-Stage-Planner/1.0 (Poly-Haven-model-import)';

const assetSchema = z.looseObject({
  name: z.string(),
  categories: z.array(z.string()).optional().default([]),
  tags: z.array(z.string()).optional().default([]),
  dimensions: z.array(z.number()).optional(),
  thumbnail_url: z.url(),
});
const assetsSchema = z.record(z.string(), assetSchema);

export type ModelImport = {
  item: ModelCatalogItem;
  bytes: Buffer;
  width: number;
  height: number;
  depth: number;
};

export type ModelCatalogClient = {
  search(query: string): Promise<ModelCatalogItem[]>;
  download(assetId: string): Promise<ModelImport>;
};

function item(id: string, raw: z.infer<typeof assetSchema>): ModelCatalogItem {
  return modelCatalogItemSchema.parse({
    id,
    name: raw.name.slice(0, 160),
    thumbnailUrl: raw.thumbnail_url,
    categories: raw.categories.slice(0, 30),
  });
}

export function createPolyHavenModelClient(fetcher: typeof fetch = fetch): ModelCatalogClient {
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
    const assets = assetsSchema.parse(await json(`${POLYHAVEN_API}/assets?t=models`));
    cached = { expires: Date.now() + 10 * 60_000, assets };
    return assets;
  }

  return {
    async search(query) {
      const words = query.trim();
      if (words) {
        try {
          const searched = assetsSchema.parse(await json(`${POLYHAVEN_API}/search?${new URLSearchParams({ q: words, t: 'models' })}`));
          return modelCatalogSchema.parse(Object.entries(searched).slice(0, 48).map(([id, asset]) => item(id, asset)));
        } catch {
          // Fall back to the cached model list.
        }
      }
      const assets = await allAssets();
      const terms = words.toLocaleLowerCase().split(/\s+/).filter(Boolean);
      const matches = Object.entries(assets).filter(([id, asset]) => {
        const haystack = [id, asset.name, ...asset.categories, ...asset.tags].join(' ').toLocaleLowerCase();
        return terms.every(word => haystack.includes(word));
      });
      matches.sort((left, right) => left[1].name.localeCompare(right[1].name));
      return modelCatalogSchema.parse(matches.slice(0, 48).map(([id, asset]) => item(id, asset)));
    },

    async download(assetId) {
      const [assets, rawFiles] = await Promise.all([
        allAssets(),
        json(`${POLYHAVEN_API}/files/${encodeURIComponent(assetId)}`),
      ]);
      const asset = assets[assetId];
      if (!asset) throw new Error('Poly Haven model was not found');
      const glb = pickPolyHavenGlb(rawFiles);
      if (!glb || !isPolyHavenDownloadUrl(glb.url)) throw new Error('Poly Haven model has no GLB');
      if (glb.size > MAX_MODEL_BYTES) throw new Error('Model is too large');
      const response = await fetcher(glb.url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`Poly Haven download returned ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > MAX_MODEL_BYTES) throw new Error('Model is too large');
      const size = millimetresFromPolyHavenModel(asset.dimensions);
      return { item: item(assetId, asset), bytes, ...size };
    },
  };
}
