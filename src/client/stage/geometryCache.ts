import { BoxGeometry, PlaneGeometry, SphereGeometry, type BufferGeometry } from 'three';

/**
 * Geometries keyed by their inputs and counted by user, so identical elements share one
 * BufferGeometry (one set of GPU buffers) and it is freed with its last user.
 *
 * `get` does not count: React components call it while rendering and count in an effect with
 * `retain`/`release`, so a render that never commits takes no reference.
 */
export type GeometryCache = {
  /** The geometry stored under `key`, built on first use. */
  get(key: string, build: () => BufferGeometry): BufferGeometry;
  /** Counts one user of `key`. `geometry` is re-stored if the entry was freed in the meantime. */
  retain(key: string, geometry: BufferGeometry): void;
  /** Drops one user; the geometry is disposed when none are left. */
  release(key: string): void;
  references(key: string): number;
  size(): number;
};

export function createGeometryCache(): GeometryCache {
  const entries = new Map<string, { geometry: BufferGeometry; references: number }>();
  return {
    get(key, build) {
      let entry = entries.get(key);
      if (!entry) {
        entry = { geometry: build(), references: 0 };
        entries.set(key, entry);
      }
      return entry.geometry;
    },
    retain(key, geometry) {
      const entry = entries.get(key);
      if (!entry) entries.set(key, { geometry, references: 1 });
      else if (entry.geometry === geometry) entry.references++;
      // A different geometry under the same key belongs to a stale render; its owner disposes it.
    },
    release(key) {
      const entry = entries.get(key);
      if (!entry || --entry.references > 0) return;
      entries.delete(key);
      entry.geometry.dispose();
    },
    references: key => entries.get(key)?.references ?? 0,
    size: () => entries.size,
  };
}

type KeyPart = string | number | boolean | null | undefined | readonly KeyPart[] | { readonly [name: string]: KeyPart };

function canonical(part: KeyPart): string {
  if (part === undefined) return '~';
  if (part === null || typeof part === 'boolean' || typeof part === 'string') return JSON.stringify(part);
  if (typeof part === 'number') return Object.is(part, -0) ? '0' : String(part);
  if (Array.isArray(part)) return `[${(part as readonly KeyPart[]).map(canonical).join(',')}]`;
  const record = part as { readonly [name: string]: KeyPart };
  return `{${Object.keys(record).sort().map(name => `${name}:${canonical(record[name])}`).join(',')}}`;
}

/**
 * A cache key for a geometry `kind` built from `inputs`. Equal inputs give equal keys whatever the
 * property order; the builder must depend on nothing but these inputs.
 */
export function geometryKey(kind: string, ...inputs: KeyPart[]) {
  return `${kind}(${inputs.map(canonical).join(';')})`;
}

/** Unit primitives: the instance matrix or mesh scale carries the size, so each exists once. */
export const UNIT_BOX = { key: geometryKey('unit-box'), build: (): BufferGeometry => new BoxGeometry(1, 1, 1) } as const;
export const UNIT_PLANE = { key: geometryKey('unit-plane'), build: (): BufferGeometry => new PlaneGeometry(1, 1) } as const;
export const UNIT_SPHERE = { key: geometryKey('unit-sphere', 12, 8), build: (): BufferGeometry => new SphereGeometry(1, 12, 8) } as const;

/** The geometries of every StageCanvas on the page. */
export const stageGeometries = createGeometryCache();
