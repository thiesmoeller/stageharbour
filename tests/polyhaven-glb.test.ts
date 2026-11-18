import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSeedSnapshot, LOCAL_SEED_IDS } from '../src/client/local/seed.js';
import { parseSnapshot } from '../src/client/local/snapshot.js';
import { createLocalTransport } from '../src/client/local/transport.js';
import type { LocalStore } from '../src/client/local/store.js';
import { cubeGlb } from './helpers/model.js';
import { isPolyHavenDownloadUrl, millimetresFromPolyHavenModel, pickPolyHavenGlb } from '../src/shared/polyHaven.js';
import { newPlaceholder } from '../src/shared/placeholders.js';
import { sceneAndVenuePlaceholders } from '../src/shared/transforms.js';
import { stageElements } from '../src/client/editor/stageElements.js';
import { emptyLayout, venueGeometrySchema } from '../src/shared/layout.js';

test('Poly Haven GLB pick keeps only dl.polyhaven.org and prefers the smaller file', () => {
  assert.equal(isPolyHavenDownloadUrl('https://dl.polyhaven.org/file/ph-assets/Models/crate.glb'), true);
  assert.equal(isPolyHavenDownloadUrl('https://evil.example/crate.glb'), false);
  assert.equal(isPolyHavenDownloadUrl('http://dl.polyhaven.org/crate.glb'), false);
  const picked = pickPolyHavenGlb({
    gltf: {
      '2k': { glb: { url: 'https://dl.polyhaven.org/file/crate_2k.glb', size: 4000 } },
      '1k': { glb: { url: 'https://dl.polyhaven.org/file/crate_1k.glb', size: 1000 } },
    },
    loose: { url: 'https://cdn.example/crate.glb', size: 10 },
    gltfOnly: { url: 'https://dl.polyhaven.org/file/crate.gltf', size: 20 },
  });
  assert.deepEqual(picked, { url: 'https://dl.polyhaven.org/file/crate_1k.glb', size: 1000 });
  assert.equal(pickPolyHavenGlb({ gltf: { url: 'https://dl.polyhaven.org/file/crate.gltf', size: 20 } }), undefined);
});

test('Poly Haven model dimensions are millimetres with Z up converted to Y up', () => {
  assert.deepEqual(millimetresFromPolyHavenModel([1200, 500, 800]), { width: 1200, height: 800, depth: 500 });
  assert.deepEqual(millimetresFromPolyHavenModel(undefined), { width: 1000, height: 1000, depth: 1000 });
});

test('scene requisites and venue furniture both reach the plan and the room view', () => {
  const venueProp = newPlaceholder('chair', '11111111-1111-4111-8111-111111111111', 100, 100);
  const sceneProp = { ...newPlaceholder('box', '22222222-2222-4222-8222-222222222222', 400, 400), assetId: '33333333-3333-4333-8333-333333333333' };
  const layout = { ...emptyLayout(), placeholders: [sceneProp] };
  const merged = sceneAndVenuePlaceholders(layout, { placeholders: [venueProp] });
  assert.deepEqual(merged.map(item => item.id), [venueProp.id, sceneProp.id]);
  const drawn = stageElements(layout, venueGeometrySchema.parse({ schemaVersion: 1, width: 8000, depth: 6000, placeholders: [venueProp] }));
  const props = drawn.filter(item => item.element.kind === 'placeholder');
  assert.deepEqual(props.map(item => [item.scope, item.id]), [['venue', venueProp.id], ['scene', sceneProp.id]]);
});

test('local mode stores an imported Poly Haven GLB and an uploaded GLB', async () => {
  const glb = new Uint8Array(cubeGlb());
  const asset = {
    name: 'Kiste', categories: ['prop'], tags: [], dimensions: [0.8, 0.6, 0.5],
    thumbnail_url: 'https://cdn.polyhaven.com/asset_img/thumbs/crate.png',
  };
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/assets?') || url.includes('/search?')) return Response.json({ crate: asset });
    if (url.includes('/files/')) return Response.json({ gltf: { '1k': { glb: { url: 'https://dl.polyhaven.org/file/crate.glb', size: glb.length } } } });
    return new Response(glb.slice());
  }) as typeof fetch;
  try {
    let cache = parseSnapshot(createSeedSnapshot());
    const store: LocalStore = {
      getSnapshot: () => structuredClone(cache),
      async replaceSnapshot(snapshot) { cache = parseSnapshot(snapshot); },
      async resetToSeed() { cache = createSeedSnapshot(); return structuredClone(cache); },
      async mutate(update) { const draft = structuredClone(cache); update(draft); cache = parseSnapshot(draft); return structuredClone(cache); },
    };
    const transport = createLocalTransport(store);
    const base = `/api/workspaces/${LOCAL_SEED_IDS.workspace}`;
    const found = await transport.request(`${base}/assets/catalog/poly-haven?q=kiste`) as { id: string }[];
    assert.equal(found[0]?.id, 'crate');
    const imported = await transport.request(`${base}/assets/import/poly-haven`, { id: 'crate' }) as { definition: { source: { fileId: string } } };
    globalThis.fetch = async () => { throw new Error('Provider offline after reload'); };
    const reloadedTransport = createLocalTransport(store);
    const blob = await reloadedTransport.getBlob(`${base}/assets/files/${imported.definition.source.fileId}`);
    assert.equal(blob.type, 'model/gltf-binary');
    assert.equal((await blob.arrayBuffer()).byteLength, glb.length);
    const uploaded = await transport.upload(`${base}/assets/files`, new File([glb], 'stuhl.glb', { type: 'model/gltf-binary' })) as { fileId: string };
    const created = await transport.request(`${base}/assets`, {
      name: 'Stuhl',
      definition: { kind: 'model', width: 500, height: 900, depth: 500, source: { kind: 'upload', fileId: uploaded.fileId } },
    }) as { name: string };
    assert.equal(created.name, 'Stuhl');
    assert.equal(store.getSnapshot().assets.length, 2);
  } finally {
    globalThis.fetch = previous;
  }
});
