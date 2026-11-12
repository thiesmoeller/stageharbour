import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, type BufferGeometry } from 'three';
import { UNIT_BOX, UNIT_PLANE, UNIT_SPHERE, createGeometryCache, geometryKey } from '../src/client/stage/geometryCache.js';

function tracked() {
  const geometry = new BoxGeometry(1, 2, 3);
  const state = { disposed: false };
  geometry.addEventListener('dispose', () => { state.disposed = true; });
  return { geometry: geometry as BufferGeometry, state };
}

test('equal inputs give equal keys whatever the property order', () => {
  assert.equal(geometryKey('deck', { width: 2000, depth: 1000 }, 40), geometryKey('deck', { depth: 1000, width: 2000 }, 40));
  assert.equal(
    geometryKey('wall', [{ x: 0, y: 0, shape: 'arch' }, { x: 5, y: 1 }]),
    geometryKey('wall', [{ shape: 'arch', y: 0, x: 0 }, { y: 1, x: 5 }]),
  );
  assert.equal(geometryKey('box', 0), geometryKey('box', -0));
});

test('different inputs, kinds and orders of list items give different keys', () => {
  const keys = [
    geometryKey('deck', 2000, 1000),
    geometryKey('deck', 1000, 2000),
    geometryKey('deck', 2000, 1000, 40),
    geometryKey('slab', 2000, 1000),
    geometryKey('deck', '2000', 1000),
    geometryKey('deck', [2000, 1000]),
    geometryKey('deck', [2000], [1000]),
    geometryKey('deck', { width: 2000, depth: 1000 }),
    geometryKey('deck', { width: 2000, depth: undefined }),
    geometryKey('deck', { width: 2000, depth: null }),
    geometryKey('deck', { width: 2000 }),
    geometryKey('deck', true, false),
    geometryKey('deck', 'a;b'),
    geometryKey('deck', 'a', 'b'),
    geometryKey('deck', 2000.5, 1000),
  ];
  assert.equal(new Set(keys).size, keys.length);
});

test('a geometry is built once per key and shared by everything that asks', () => {
  const cache = createGeometryCache();
  let built = 0;
  const build = () => { built++; return new BoxGeometry(1, 1, 1); };
  const first = cache.get('a', build);
  assert.equal(cache.get('a', build), first);
  assert.notEqual(cache.get('b', build), first);
  assert.equal(built, 2);
  assert.equal(cache.size(), 2);
  assert.equal(cache.references('a'), 0, 'looking a geometry up while rendering does not count as a use');
});

test('a geometry is disposed with its last user', () => {
  const cache = createGeometryCache();
  const { geometry, state } = tracked();
  cache.get('a', () => geometry);
  cache.retain('a', geometry);
  cache.retain('a', geometry);
  assert.equal(cache.references('a'), 2);
  cache.release('a');
  assert.equal(state.disposed, false);
  cache.release('a');
  assert.equal(state.disposed, true);
  assert.equal(cache.size(), 0);
  assert.doesNotThrow(() => cache.release('a'));
});

test('retaining after the entry was freed stores the geometry again (effects re-run in StrictMode)', () => {
  const cache = createGeometryCache();
  const { geometry } = tracked();
  cache.get('a', () => geometry);
  cache.retain('a', geometry);
  cache.release('a');
  cache.retain('a', geometry);
  assert.equal(cache.references('a'), 1);
  assert.equal(cache.get('a', () => assert.fail('must reuse the retained geometry')), geometry);
});

test('a stale geometry under a taken key is not counted against the current one', () => {
  const cache = createGeometryCache();
  const current = tracked(), stale = tracked();
  cache.get('a', () => current.geometry);
  cache.retain('a', current.geometry);
  cache.retain('a', stale.geometry);
  assert.equal(cache.references('a'), 1);
  assert.equal(cache.get('a', () => assert.fail('unused')), current.geometry);
});

test('the unit primitives have distinct keys and unit size', () => {
  assert.equal(new Set([UNIT_BOX.key, UNIT_PLANE.key, UNIT_SPHERE.key]).size, 3);
  const box = UNIT_BOX.build();
  box.computeBoundingBox();
  assert.deepEqual(box.boundingBox!.min.toArray(), [-0.5, -0.5, -0.5]);
  assert.deepEqual(box.boundingBox!.max.toArray(), [0.5, 0.5, 0.5]);
  const sphere = UNIT_SPHERE.build();
  sphere.computeBoundingSphere();
  assert.ok(Math.abs(sphere.boundingSphere!.radius - 1) < 1e-6);
});
