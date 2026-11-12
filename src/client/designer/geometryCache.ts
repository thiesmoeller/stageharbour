import type { ResolvedPart } from '../../shared/parts/resolve.js';

/** 53-bit string hash (cyrb53); keys only need to tell resolved shapes apart, not resist attacks. */
export function hashText(text: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Identity of the geometry a resolved part produces: equal solids and faces give an equal key. */
export function resolvedGeometryKey(part: Pick<ResolvedPart, 'solids' | 'faces'>): string {
  const text = JSON.stringify([part.solids, part.faces.map(face => [face.key, face.solid, face.side])]);
  return `${hashText(text)}:${text.length}`;
}

type Entry<T> = { value: T; users: number };

/**
 * Reference-counted geometry shared by every preview that shows the same shape. Released
 * entries stay for a while (`keep` most recent) so switching back to a variant costs nothing;
 * older ones are disposed.
 */
export class SharedGeometryCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly idle: string[] = [];

  constructor(private readonly dispose: (value: T) => void, private readonly keep = 8) {}

  acquire(key: string, build: () => T): T {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { value: build(), users: 0 };
      this.entries.set(key, entry);
    }
    const waiting = this.idle.indexOf(key);
    if (waiting >= 0) this.idle.splice(waiting, 1);
    entry.users++;
    return entry.value;
  }

  release(key: string) {
    const entry = this.entries.get(key);
    if (!entry || entry.users <= 0) return;
    entry.users--;
    if (entry.users > 0) return;
    this.idle.push(key);
    while (this.idle.length > this.keep) {
      const oldest = this.idle.shift()!;
      const stale = this.entries.get(oldest);
      this.entries.delete(oldest);
      if (stale) this.dispose(stale.value);
    }
  }

  users(key: string): number { return this.entries.get(key)?.users ?? 0; }
  has(key: string): boolean { return this.entries.has(key); }
}
