import type { Texture } from 'three';

/**
 * Starts loading the image behind `url`. Exactly one of the callbacks is called, once, later or
 * synchronously. The loader must not throw.
 */
export type TextureLoad = (url: string, onLoad: (texture: Texture) => void, onError: (error: unknown) => void) => void;

export type TextureState = 'loading' | 'ready' | 'failed';

export type TextureCache = {
  /**
   * Registers one user of the texture behind `url` and returns its release function. `onReady`
   * receives the shared texture as soon as it is decoded: at once when it already is, never when
   * the request fails or the user releases first. The shared texture must not be modified; clone it
   * for a repeat or rotation of its own (clones share the uploaded image).
   */
  acquire(url: string, onReady: (texture: Texture) => void): () => void;
  state(url: string): TextureState | undefined;
  /** Number of users currently holding `url`. */
  references(url: string): number;
  /** Number of URLs the cache holds, in any state. */
  size(): number;
  /** Called after a texture finished loading or failed, so a canvas can draw another frame. */
  subscribe(listener: () => void): () => void;
};

type Entry = {
  state: TextureState;
  texture?: Texture;
  references: number;
  waiting: Set<(texture: Texture) => void>;
};

/**
 * Textures keyed by URL and counted by user. The first user starts the request, later users share
 * it, and the texture is disposed when the last user lets go. A failed request is kept as failed
 * while it has users, so a broken URL is asked for once and not on every render; the next first
 * user retries.
 */
export function createTextureCache(load: TextureLoad, onFailure: (url: string, error: unknown) => void = () => {}): TextureCache {
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of [...listeners]) listener(); };

  function start(url: string, entry: Entry) {
    const settle = (apply: () => void) => {
      if (entry.state !== 'loading') return;
      apply();
      notify();
    };
    try {
      load(url, texture => {
        // The entry was dropped while the request was in flight: nobody wants this texture.
        if (entries.get(url) !== entry) { texture.dispose(); return; }
        settle(() => {
          entry.state = 'ready';
          entry.texture = texture;
          const waiting = [...entry.waiting];
          entry.waiting.clear();
          for (const ready of waiting) ready(texture);
        });
      }, error => {
        if (entries.get(url) !== entry) return;
        settle(() => {
          entry.state = 'failed';
          entry.waiting.clear();
          onFailure(url, error);
        });
      });
    } catch (error) {
      settle(() => {
        entry.state = 'failed';
        entry.waiting.clear();
        onFailure(url, error);
      });
    }
  }

  return {
    acquire(url, onReady) {
      let entry = entries.get(url);
      const created = !entry;
      if (!entry) {
        entry = { state: 'loading', references: 0, waiting: new Set() };
        entries.set(url, entry);
      }
      const held = entry;
      held.references++;
      if (held.state === 'ready') onReady(held.texture!);
      else if (held.state === 'loading') held.waiting.add(onReady);
      if (created) start(url, held);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        held.waiting.delete(onReady);
        if (--held.references > 0 || entries.get(url) !== held) return;
        entries.delete(url);
        held.texture?.dispose();
      };
    },
    state: url => entries.get(url)?.state,
    references: url => entries.get(url)?.references ?? 0,
    size: () => entries.size,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
