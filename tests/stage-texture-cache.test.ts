import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Texture } from 'three';
import { createTextureCache, type TextureLoad } from '../src/client/stage/textureCache.js';

type Pending = { url: string; resolve: (texture: Texture) => void; reject: (error: unknown) => void };

/** A loader the test settles by hand; counts requests and disposals. */
function manualLoader() {
  const pending: Pending[] = [];
  const disposed: Texture[] = [];
  const load: TextureLoad = (url, onLoad, onError) => { pending.push({ url, resolve: onLoad, reject: onError }); };
  const texture = () => {
    const made = new Texture();
    made.addEventListener('dispose', () => disposed.push(made));
    return made;
  };
  return { load, pending, disposed, texture };
}

test('users of one URL share a single request and a single texture', () => {
  const loader = manualLoader();
  const cache = createTextureCache(loader.load);
  const received: Texture[] = [];
  const releaseA = cache.acquire('a.webp', texture => received.push(texture));
  const releaseB = cache.acquire('a.webp', texture => received.push(texture));
  assert.equal(loader.pending.length, 1);
  assert.equal(cache.state('a.webp'), 'loading');
  assert.equal(cache.references('a.webp'), 2);

  const texture = loader.texture();
  loader.pending[0]!.resolve(texture);
  assert.deepEqual(received, [texture, texture]);
  assert.equal(cache.state('a.webp'), 'ready');

  cache.acquire('a.webp', late => received.push(late));
  assert.equal(received.length, 3, 'a later user gets the decoded texture at once');
  assert.equal(loader.pending.length, 1);
  assert.equal(cache.references('a.webp'), 3);
  releaseA();
  releaseB();
  assert.equal(loader.disposed.length, 0);
});

test('the texture is disposed with its last user and requested again afterwards', () => {
  const loader = manualLoader();
  const cache = createTextureCache(loader.load);
  const releaseA = cache.acquire('a.webp', () => {});
  const releaseB = cache.acquire('a.webp', () => {});
  const texture = loader.texture();
  loader.pending[0]!.resolve(texture);

  releaseA();
  releaseA();
  assert.equal(cache.references('a.webp'), 1, 'releasing twice counts once');
  assert.equal(loader.disposed.length, 0);
  releaseB();
  assert.deepEqual(loader.disposed, [texture]);
  assert.equal(cache.state('a.webp'), undefined);
  assert.equal(cache.size(), 0);

  cache.acquire('a.webp', () => {});
  assert.equal(loader.pending.length, 2);
});

test('a texture that arrives after everybody let go is disposed and never delivered', () => {
  const loader = manualLoader();
  const cache = createTextureCache(loader.load);
  let delivered = 0;
  const release = cache.acquire('a.webp', () => { delivered++; });
  release();
  const texture = loader.texture();
  loader.pending[0]!.resolve(texture);
  assert.equal(delivered, 0);
  assert.deepEqual(loader.disposed, [texture]);
  assert.equal(cache.size(), 0);
});

test('a stale request does not disturb the entry that replaced it', () => {
  const loader = manualLoader();
  const cache = createTextureCache(loader.load);
  cache.acquire('a.webp', () => {})();
  const received: Texture[] = [];
  cache.acquire('a.webp', texture => received.push(texture));
  assert.equal(loader.pending.length, 2);

  const stale = loader.texture(), current = loader.texture();
  loader.pending[0]!.resolve(stale);
  assert.equal(cache.state('a.webp'), 'loading');
  assert.deepEqual(loader.disposed, [stale]);
  loader.pending[0]!.reject(new Error('late'));
  assert.equal(cache.state('a.webp'), 'loading');
  loader.pending[1]!.resolve(current);
  assert.deepEqual(received, [current]);
});

test('a failed request reports once, never delivers, and is retried only by a new first user', () => {
  const loader = manualLoader();
  const failures: string[] = [];
  const cache = createTextureCache(loader.load, url => failures.push(url));
  let delivered = 0;
  const release = cache.acquire('missing.webp', () => { delivered++; });
  loader.pending[0]!.reject(new Error('404'));
  assert.equal(cache.state('missing.webp'), 'failed');
  assert.deepEqual(failures, ['missing.webp']);

  const releaseSecond = cache.acquire('missing.webp', () => { delivered++; });
  assert.equal(loader.pending.length, 1, 'a URL known to be broken is not requested again while it has users');
  loader.pending[0]!.resolve(loader.texture());
  assert.equal(cache.state('missing.webp'), 'failed', 'a request settles once');
  assert.equal(delivered, 0);

  release();
  releaseSecond();
  assert.equal(cache.size(), 0);
  cache.acquire('missing.webp', () => {});
  assert.equal(loader.pending.length, 2);
});

test('a loader that throws counts as a failed request instead of breaking the caller', () => {
  const failures: unknown[] = [];
  const cache = createTextureCache(() => { throw new Error('no decoder'); }, (_url, error) => failures.push(error));
  assert.doesNotThrow(() => cache.acquire('a.ktx2', () => assert.fail('must not deliver')));
  assert.equal(cache.state('a.ktx2'), 'failed');
  assert.equal(failures.length, 1);
});

test('a loader that answers synchronously delivers to its first user', () => {
  const texture = new Texture();
  const cache = createTextureCache((_url, onLoad) => onLoad(texture));
  const received: Texture[] = [];
  cache.acquire('a.webp', loaded => received.push(loaded));
  assert.deepEqual(received, [texture]);
  assert.equal(cache.state('a.webp'), 'ready');
});

test('subscribers hear about every arrival and failure until they unsubscribe', () => {
  const loader = manualLoader();
  const cache = createTextureCache(loader.load);
  let notified = 0;
  const unsubscribe = cache.subscribe(() => { notified++; });
  cache.acquire('a.webp', () => {});
  cache.acquire('b.webp', () => {});
  assert.equal(notified, 0);
  loader.pending[0]!.resolve(loader.texture());
  assert.equal(notified, 1);
  loader.pending[1]!.reject(new Error('404'));
  assert.equal(notified, 2);
  unsubscribe();
  cache.acquire('c.webp', () => {});
  loader.pending[2]!.resolve(loader.texture());
  assert.equal(notified, 2);
});

test('different URLs are separate entries', () => {
  const loader = manualLoader();
  const cache = createTextureCache(loader.load);
  cache.acquire('a.webp', () => {});
  cache.acquire('b.webp', () => {});
  assert.equal(cache.size(), 2);
  assert.deepEqual(loader.pending.map(request => request.url), ['a.webp', 'b.webp']);
  assert.equal(cache.references('c.webp'), 0);
});
