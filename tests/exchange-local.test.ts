import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSeedSnapshot, LOCAL_SEED_IDS } from '../src/client/local/seed.js';
import { parseSnapshot } from '../src/client/local/snapshot.js';
import { createLocalTransport } from '../src/client/local/transport.js';
import type { LocalStore } from '../src/client/local/store.js';
import { exchangePath, readZip } from '../src/shared/exchange/index.js';

function memoryStore(): LocalStore {
  const cache = parseSnapshot(createSeedSnapshot());
  return {
    getSnapshot: () => structuredClone(cache),
    async replaceSnapshot() {},
    async resetToSeed() { return structuredClone(cache); },
    async mutate() { return structuredClone(cache); },
  };
}

test('the demo workspace exports its seed scene as glTF and MVR through the local transport', async () => {
  const transport = createLocalTransport(memoryStore());
  const objects = parseSnapshot(createSeedSnapshot()).scenes.find(scene => scene.id === LOCAL_SEED_IDS.scene)!.layout.objects.length;
  assert.ok(objects > 0);

  const glb = await transport.getBlob(exchangePath(LOCAL_SEED_IDS.workspace, LOCAL_SEED_IDS.scene, 'gltf'));
  assert.equal(glb.type, 'model/gltf-binary');
  assert.equal(new TextDecoder().decode(new Uint8Array(await glb.arrayBuffer()).subarray(0, 4)), 'glTF');

  const mvr = await transport.getBlob(exchangePath(LOCAL_SEED_IDS.workspace, LOCAL_SEED_IDS.scene, 'mvr'));
  const files = new Map((await readZip(new Uint8Array(await mvr.arrayBuffer()))).map(entry => [entry.name, entry.data]));
  const xml = new TextDecoder().decode(files.get('GeneralSceneDescription.xml'));
  assert.ok((xml.match(/<SceneObject /g) ?? []).length >= objects);
  assert.ok([...files.keys()].some(name => name.endsWith('.glb')));

  await assert.rejects(transport.getBlob(exchangePath(LOCAL_SEED_IDS.workspace, LOCAL_SEED_IDS.scene, 'gltf').replace('gltf', 'obj')), /Austauschformat/);
  await assert.rejects(transport.getBlob(exchangePath(LOCAL_SEED_IDS.workspace, 'a5000000-0000-4000-8000-0000000000ff', 'mvr')), /nicht verfügbar/);
  await assert.rejects(transport.getBlob('/api/workspaces/x/documents/y/file'), /nicht verfügbar/);
});
