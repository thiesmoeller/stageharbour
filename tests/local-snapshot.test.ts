import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSeedSnapshot, LOCAL_SEED_IDS } from '../src/client/local/seed.js';
import { parseSnapshot, serializeSnapshot } from '../src/client/local/snapshot.js';
import { createLocalTransport } from '../src/client/local/transport.js';
import type { LocalStore } from '../src/client/local/store.js';
import { groupWallType } from '../src/shared/inventory.js';

function memoryStore(initial = createSeedSnapshot()): LocalStore {
  let cache = parseSnapshot(initial);
  return {
    getSnapshot() {
      return structuredClone(cache);
    },
    async replaceSnapshot(snapshot) {
      cache = parseSnapshot(snapshot);
    },
    async resetToSeed() {
      cache = createSeedSnapshot();
      return structuredClone(cache);
    },
    async mutate(update) {
      const draft = structuredClone(cache);
      update(draft);
      cache = parseSnapshot(draft);
      return structuredClone(cache);
    },
  };
}

test('seed snapshot parses and survives serialize roundtrip', () => {
  const seed = createSeedSnapshot();
  const parsed = parseSnapshot(seed);
  assert.equal(parsed.workspace.id, LOCAL_SEED_IDS.workspace);
  assert.equal(parsed.inventory.panels.length, 2);
  const again = serializeSnapshot(parsed);
  assert.equal(again.schemaVersion, 1);
  assert.equal(again.inventory.types.length, 2);
});

test('local transport inventory CRUD mutates snapshot', async () => {
  const store = memoryStore();
  const transport = createLocalTransport(store);
  const base = `/api/workspaces/${LOCAL_SEED_IDS.workspace}/inventory`;

  const finishWork = await transport.request(`${base}/finish-work`);
  assert.deepEqual(finishWork, []);

  const type = groupWallType('window', crypto.randomUUID(), crypto.randomUUID());
  const createdType = await transport.request(`${base}/types`, type);
  assert.equal((createdType as { id: string }).id, type.id);

  const panel = await transport.request(`${base}/panels`, {
    label: 'F-99',
    type,
    available: true,
    note: null,
  }) as { id: string; label: string; available: boolean };
  assert.equal(panel.label, 'F-99');

  const patched = await transport.request(`${base}/panels/${panel.id}`, { available: false }, 'PATCH') as { available: boolean };
  assert.equal(patched.available, false);

  const ballast = await transport.request(`${base}/ballast`, { slabs: 4, straps: 2 }, 'PUT');
  assert.deepEqual(ballast, { slabs: 4, straps: 2 });

  await transport.request(`${base}/panels/${panel.id}`, undefined, 'DELETE');
  await transport.request(`${base}/types/${type.id}`, undefined, 'DELETE');

  const snapshot = store.getSnapshot();
  assert.equal(snapshot.inventory.panels.some(item => item.id === panel.id), false);
  assert.equal(snapshot.inventory.types.some(item => item.id === type.id), false);
  assert.deepEqual(snapshot.inventory.ballast, { slabs: 4, straps: 2 });
});
