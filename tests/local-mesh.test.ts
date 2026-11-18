import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '../src/client/api.js';
import { createSeedSnapshot, LOCAL_SEED_IDS } from '../src/client/local/seed.js';
import { parseSnapshot, type LocalSnapshot } from '../src/client/local/snapshot.js';
import type { LocalStore } from '../src/client/local/store.js';
import { createLocalTransport } from '../src/client/local/transport.js';
import type { Asset } from '../src/shared/assets.js';
import { cubeGlb } from './helpers/model.js';

function memoryStore(initial: LocalSnapshot = createSeedSnapshot()): LocalStore {
  let cache = parseSnapshot(initial);
  return {
    getSnapshot: () => structuredClone(cache),
    async replaceSnapshot(snapshot) { cache = parseSnapshot(snapshot); },
    async resetToSeed() { cache = createSeedSnapshot(); return structuredClone(cache); },
    async mutate(update) { const draft = structuredClone(cache); update(draft); cache = parseSnapshot(draft); return structuredClone(cache); },
  };
}

const base = `/api/workspaces/${LOCAL_SEED_IDS.workspace}`;
const partId = 'd1d1d1d1-0000-4000-8000-000000000001';
const meshPart = (assetId: string, id = partId) => ({
  id, revision: 1, name: 'Griff', category: 'Zubehör', parameters: [],
  bodies: [{ kind: 'mesh', key: 'griff', assetId, at: [0, 15, 0], size: [120, 30, 40] }],
  traits: { stock: 'none' },
});

async function uploadModel(transport: ReturnType<typeof createLocalTransport>, name = 'Griff') {
  const glb = new File([new Uint8Array(cubeGlb())], `${name}.glb`, { type: 'model/gltf-binary' });
  const { fileId } = await transport.upload(`${base}/assets/files`, glb) as { fileId: string };
  return await transport.request(`${base}/assets`, {
    name, definition: { kind: 'model', width: 120, height: 30, depth: 40, source: { kind: 'upload', fileId } },
  }) as Asset;
}

async function status(run: Promise<unknown>): Promise<number> {
  try { await run; return 200; } catch (error) { if (error instanceof ApiError) return error.status; throw error; }
}

test('local parts accept a nested mesh body only for a model asset in the workspace', async () => {
  const transport = createLocalTransport(memoryStore());
  const asset = await uploadModel(transport);
  assert.equal(await status(transport.request(`${base}/parts`, { definition: meshPart(asset.id) })), 200);
  const missing = await transport.request(`${base}/parts`, { definition: meshPart('99999999-9999-4999-8999-999999999999', 'd1d1d1d1-0000-4000-8000-000000000002') })
    .then(() => undefined, error => error as ApiError);
  assert.equal(missing?.status, 422);
  assert.match(JSON.stringify(missing?.details), /unknown-asset/);
});

test('local asset delete keeps a model alive while any part revision uses it, like the server', async () => {
  const transport = createLocalTransport(memoryStore());
  const used = await uploadModel(transport, 'Benutzt');
  const free = await uploadModel(transport, 'Frei');
  await transport.request(`${base}/parts`, { definition: meshPart(used.id) });

  assert.equal(await status(transport.request(`${base}/assets/${used.id}`, undefined, 'DELETE')), 400);
  assert.equal(await status(transport.request(`${base}/assets/${free.id}`, undefined, 'DELETE')), 200);
  const listed = await transport.request(`${base}/assets`) as Asset[];
  assert.equal(listed.find(item => item.id === free.id)?.archived, true);
  assert.equal(listed.find(item => item.id === used.id)?.archived, false);
  assert.equal(await status(transport.request(`${base}/assets/99999999-9999-4999-8999-999999999999`, undefined, 'DELETE')), 404);
});

test('local asset rename only touches live assets', async () => {
  const transport = createLocalTransport(memoryStore());
  const asset = await uploadModel(transport);
  const renamed = await transport.request(`${base}/assets/${asset.id}`, { name: 'Neuer Griff' }, 'PATCH') as Asset;
  assert.equal(renamed.name, 'Neuer Griff');
  await transport.request(`${base}/assets/${asset.id}`, undefined, 'DELETE');
  assert.equal(await status(transport.request(`${base}/assets/${asset.id}`, { name: 'Zu spät' }, 'PATCH')), 404);
});

test('local getBlob serves a model through the same-origin absolute URL the stage viewer builds', async () => {
  const transport = createLocalTransport(memoryStore());
  const asset = await uploadModel(transport);
  const fileId = asset.definition.kind === 'model' && asset.definition.source.kind === 'upload' ? asset.definition.source.fileId : '';
  const previous = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = { location: { origin: 'http://localhost:5173' } };
  try {
    const blob = await transport.getBlob(`http://localhost:5173${base}/assets/files/${fileId}`);
    assert.equal(blob.type, 'model/gltf-binary');
    assert.equal((await blob.arrayBuffer()).byteLength, cubeGlb().length);
  } finally {
    if (previous === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = previous;
  }
});
