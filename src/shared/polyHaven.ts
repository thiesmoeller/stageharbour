import { z } from 'zod';

export const POLYHAVEN_API = 'https://api.polyhaven.com';
export const POLYHAVEN_DOWNLOAD_HOST = 'dl.polyhaven.org';
export const POLYHAVEN_THUMB_HOST = 'cdn.polyhaven.com';

export const modelCatalogItemSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9_]+$/).max(120),
  name: z.string().trim().min(1).max(160),
  thumbnailUrl: z.url().refine(value => new URL(value).hostname === POLYHAVEN_THUMB_HOST),
  categories: z.array(z.string().trim().min(1).max(120)).max(30),
});
export const modelCatalogSchema = z.array(modelCatalogItemSchema).max(48);
export type ModelCatalogItem = z.infer<typeof modelCatalogItemSchema>;

export const importPolyHavenModelSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9_]+$/).max(120),
});

export function isPolyHavenDownloadUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === POLYHAVEN_DOWNLOAD_HOST;
  } catch {
    return false;
  }
}

export type GlbCandidate = { url: string; size: number };

/** Smallest embedded GLB on dl.polyhaven.org. Loose .gltf/.bin pairs are ignored. */
export function pickPolyHavenGlb(files: unknown): GlbCandidate | undefined {
  const found: GlbCandidate[] = [];
  walk(files, found);
  found.sort((left, right) => left.size - right.size);
  return found[0];
}

function walk(node: unknown, found: GlbCandidate[]) {
  if (!node || typeof node !== 'object') return;
  const record = node as Record<string, unknown>;
  if (typeof record.url === 'string') {
    if (record.url.endsWith('.glb') && isPolyHavenDownloadUrl(record.url)) {
      const size = typeof record.size === 'number' && record.size > 0 ? record.size : Number.MAX_SAFE_INTEGER;
      found.push({ url: record.url, size });
    }
    return;
  }
  for (const value of Object.values(record)) walk(value, found);
}

/** Poly Haven model `dimensions` are metres. Missing bounds become a 1 m cube. */
export function millimetresFromPolyHavenModel(dimensions: unknown): { width: number; height: number; depth: number } {
  const mm = (value: number) => Math.max(1, Math.min(100000, Math.round(value * 1000)));
  if (Array.isArray(dimensions) && dimensions.length >= 3 && dimensions.slice(0, 3).every(value => typeof value === 'number' && value > 0)) {
    const [x, y, z] = dimensions as number[];
    return { width: mm(x ?? 1), height: mm(y ?? 1), depth: mm(z ?? 1) };
  }
  return { width: 1000, height: 1000, depth: 1000 };
}
