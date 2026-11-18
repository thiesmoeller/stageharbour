import { z } from 'zod';

export const POLYHAVEN_API = 'https://api.polyhaven.com';
export const POLYHAVEN_DOWNLOAD_HOST = 'dl.polyhaven.org';
export const POLYHAVEN_THUMB_HOST = 'cdn.polyhaven.com';

export const polyHavenIdSchema = z.string().regex(/^[A-Za-z0-9_]+$/).max(120);

/** Validate entries independently; diagnostics contain IDs and validation paths, never payloads. */
export function parseCatalogEntries<T>(input: unknown, parse: (id: string, value: unknown) => T): Record<string, T> {
  const records = z.record(z.string(), z.unknown()).parse(input);
  const accepted: Record<string, T> = Object.create(null);
  for (const [id, value] of Object.entries(records)) {
    try {
      polyHavenIdSchema.parse(id);
      accepted[id] = parse(id, value);
    } catch (error) {
      console.warn('Poly Haven rejected catalogue entry', id, error instanceof z.ZodError ? error.issues.map(issue => issue.path.join('.')) : 'invalid entry');
    }
  }
  return accepted;
}

export const modelCatalogItemSchema = z.strictObject({
  id: polyHavenIdSchema,
  name: z.string().trim().min(1).max(160),
  thumbnailUrl: z.url().refine(value => new URL(value).hostname === POLYHAVEN_THUMB_HOST),
  categories: z.array(z.string().trim().min(1).max(120)).max(30),
});
export const modelCatalogSchema = z.array(modelCatalogItemSchema).max(48);
export type ModelCatalogItem = z.infer<typeof modelCatalogItemSchema>;

export const importPolyHavenModelSchema = z.strictObject({
  id: polyHavenIdSchema,
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

/** Poly Haven model `dimensions` are millimetres (Blender X, Y, Z). Missing bounds become a 1 m cube. */
export function millimetresFromPolyHavenModel(dimensions: unknown): { width: number; height: number; depth: number } {
  const mm = (value: number) => Math.max(1, Math.min(100000, Math.round(value)));
  if (Array.isArray(dimensions) && dimensions.length >= 3 && dimensions.slice(0, 3).every(value => typeof value === 'number' && value > 0)) {
    const [x, y, z] = dimensions as number[];
    return { width: mm(x ?? 1), height: mm(z ?? 1), depth: mm(y ?? 1) };
  }
  return { width: 1000, height: 1000, depth: 1000 };
}

/** Search v2 returns ranked slugs; legacy responses contain full records. */
export async function expandCatalogSearch(input: unknown, all: () => Promise<unknown>): Promise<unknown> {
  if (!input || typeof input !== 'object' || !Object.hasOwn(input, 'results')) return input;
  const envelope = z.object({ results: z.array(z.unknown()) }).parse(input);
  if (!envelope.results.length) return {};
  const assets = z.record(z.string(), z.unknown()).parse(await all());
  const found: Record<string, unknown> = Object.create(null);
  for (const entry of envelope.results) {
    const parsed = z.object({ slug: polyHavenIdSchema }).safeParse(entry);
    if (!parsed.success) { console.warn('Poly Haven rejected search result', 'invalid slug'); continue; }
    if (Object.hasOwn(assets, parsed.data.slug)) found[parsed.data.slug] = assets[parsed.data.slug];
  }
  return found;
}
