import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ApiError } from '../src/client/api.js';
import { parseWorkspaceFileText } from '../src/client/local/fileBackup.js';
import { createPartsHandler } from '../src/client/local/partsTransport.js';
import { createSeedSnapshot, LOCAL_SEED_IDS } from '../src/client/local/seed.js';
import { SNAPSHOT_SCHEMA_VERSION, parseSnapshot, serializeSnapshot, type LocalSnapshot } from '../src/client/local/snapshot.js';
import type { LocalStore } from '../src/client/local/store.js';
import { createLocalTransport } from '../src/client/local/transport.js';
import { queryOf, pathOnly } from '../src/client/local/route.js';
import { setApiTransport, getApiTransport } from '../src/client/api.js';
import {
  catalogIssues, createPart, createStockItem, exportLibrary, getPart, importLibrary, listMaterials, listParts, listStockCounts, setStockCount,
} from '../src/client/partsApi.js';
import { STARTER_LIBRARY, STARTER_MATERIALS, STARTER_PARTS, partLibraryJsonSchema } from '../src/shared/parts/index.js';
import { crate, testId } from './helpers/crate.js';
import { PARTS_TRACE_FILE, normaliseTrace, runPartsScenario, type ScenarioRole, type TraceStep } from './helpers/partsScenario.js';

function memoryStore(initial: LocalSnapshot = createSeedSnapshot()): LocalStore {
  let cache = parseSnapshot(initial);
  return {
    getSnapshot: () => structuredClone(cache),
    async replaceSnapshot(snapshot) { cache = parseSnapshot(snapshot); },
    async resetToSeed() { cache = createSeedSnapshot(); return structuredClone(cache); },
    async mutate(update) {
      const draft = structuredClone(cache);
      update(draft);
      cache = parseSnapshot(draft);
      return structuredClone(cache);
    },
  };
}

const WORKSPACE = LOCAL_SEED_IDS.workspace;
const golden = (): TraceStep[] => JSON.parse(readFileSync(PARTS_TRACE_FILE, 'utf8'));
const asRole = (store: LocalStore, role: ScenarioRole) => store.mutate(draft => { draft.workspace.role = role; });

function asReply(error: unknown) {
  if (error instanceof ApiError) return { status: error.status, body: error.details };
  throw error;
}

test('the local handler answers the catalog scenario with the same status and body as the server', async () => {
  const store = memoryStore();
  const handle = createPartsHandler(store);
  const trace = normaliseTrace(await runPartsScenario({
    workspaceId: WORKSPACE,
    async send(role, method, path, payload) {
      await asRole(store, role);
      try {
        const response = await handle({ path: pathOnly(path), method, query: queryOf(path), body: payload });
        assert.ok(response, `${method} ${path} is routed`);
        return { status: response.status, body: response.value };
      } catch (error) {
        return asReply(error);
      }
    },
  }), WORKSPACE);
  const expected = golden();
  assert.equal(trace.length, expected.length);
  trace.forEach((entry, index) => assert.deepEqual(entry, expected[index], entry.step));
});

test('LocalTransport routes the same scenario to the catalog, with the same bodies and errors', async () => {
  const store = memoryStore();
  const transport = createLocalTransport(store);
  const trace = normaliseTrace(await runPartsScenario({
    workspaceId: WORKSPACE,
    async send(role, method, path, payload) {
      await asRole(store, role);
      try {
        return { status: 200, body: await transport.request(path, payload, method) };
      } catch (error) {
        return asReply(error);
      }
    },
  }), WORKSPACE);
  const expected = golden().map(entry => ({ ...entry, status: entry.status < 300 ? 200 : entry.status }));
  trace.forEach((entry, index) => assert.deepEqual(entry, expected[index], entry.step));
  assert.equal(trace.length, expected.length);
});

test('the golden trace exercises every route, success and each failure class', () => {
  const steps = golden();
  const routes = new Set(steps.map(step => `${step.request.split(' ')[0]} ${step.request.split(' ')[1]!
    .replace(/^\/api\/workspaces\/[^/]+/, '').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id').replace(/\?.*$/, '')
    .replace(/\/materials\/[^/]+$/, '/materials/:key').replace(/\/revisions\/\d+$/, '/revisions/:n').replace(/\/(\w+)\/:id\/(\w+)$/, '/$1/:id/$2')}`));
  for (const expected of [
    'GET /parts', 'POST /parts/resolve', 'GET /parts/:id', 'GET /parts/:id/revisions/:n', 'POST /parts', 'POST /parts/:id/revisions',
    'POST /parts/:id/archive', 'POST /parts/:id/unarchive', 'PUT /parts/:id/favourite', 'POST /parts/:id/duplicate',
    'GET /materials', 'PUT /materials/:key', 'DELETE /materials/:key', 'POST /library/export', 'POST /library/import',
    'GET /stock/items', 'POST /stock/items', 'PATCH /stock/items/:id', 'POST /stock/items/:id/archive', 'POST /stock/items/:id/unarchive',
    'GET /stock/counts', 'PUT /stock/counts', 'GET /api/schemas/part-library.schema.json',
  ]) assert.ok(routes.has(expected), `${expected} is in the trace`);
  const statuses = new Set(steps.map(step => step.status));
  for (const status of [200, 201, 400, 403, 404, 409, 422]) assert.ok(statuses.has(status), `status ${status} is in the trace`);
});

test('the local library schema route serves the schema the server serves', async () => {
  const transport = createLocalTransport(memoryStore());
  assert.deepEqual(await transport.request('/api/schemas/part-library.schema.json'), JSON.parse(JSON.stringify(partLibraryJsonSchema())));
});

test('the typed client helpers work against LocalTransport and surface issues of rejected definitions', async () => {
  const previous = getApiTransport();
  setApiTransport(createLocalTransport(memoryStore(), { clock: () => new Date('2026-03-04T10:00:00.000Z') }));
  try {
    assert.equal((await listParts(WORKSPACE)).length, STARTER_PARTS.length);
    assert.equal((await listMaterials(WORKSPACE)).length, STARTER_MATERIALS.length);
    const created = await createPart(WORKSPACE, crate(1, 'Kiste'));
    assert.equal((await getPart(WORKSPACE, created.id)).name, 'Kiste');
    const item = await createStockItem(WORKSPACE, { label: 'K-01', partId: created.id, variantKey: 'klein' });
    assert.equal(item.partName, 'Kiste');
    const rejected = await createPart(WORKSPACE, crate(2, 'Defekt', { bodies: [{ kind: 'beam', key: 'a', material: 'gibt-es-nicht', from: [0, 0, 0], to: [1, 0, 0] }] }))
      .then(() => undefined, (error: unknown) => error);
    assert.equal((rejected as ApiError).status, 422);
    assert.equal(catalogIssues(rejected)[0]?.code, 'unknown-material');
    assert.deepEqual(catalogIssues(new Error('x')), []);
    const count = await setStockCount(WORKSPACE, { materialKey: 'gummifuss-50', quantity: 7 });
    assert.deepEqual((await listStockCounts(WORKSPACE)).map(entry => [entry.id, entry.quantity]), [[count.id, 7]]);
    const exported = await exportLibrary(WORKSPACE, { partIds: [created.id] });
    assert.equal(exported.filename, 'bauteile-beispiel-theatergruppe-2026-03-04.stageharbour-parts.json');
    const report = await importLibrary(WORKSPACE, exported.library);
    assert.deepEqual([report.created.length, report.revised.length, report.skipped.length], [0, 0, 1]);
  } finally {
    setApiTransport(previous);
  }
});

test('a rejected local write leaves the catalog untouched', async () => {
  const store = memoryStore();
  const transport = createLocalTransport(store);
  const before = JSON.stringify(store.getSnapshot().catalog);
  const failure = await transport.request(`/api/workspaces/${WORKSPACE}/library/import`, { library: { schemaVersion: 1, materials: 5 } })
    .then(() => undefined, (error: unknown) => error);
  assert.equal((failure as ApiError).status, 422);
  assert.equal(JSON.stringify(store.getSnapshot().catalog), before);
});

test('the seed holds the starter library, and snapshots keep catalog and stock through serialize and JSON', async () => {
  const seed = createSeedSnapshot();
  assert.equal(seed.schemaVersion, SNAPSHOT_SCHEMA_VERSION);
  assert.deepEqual(seed.catalog.parts.map(part => part.id).sort(), STARTER_LIBRARY.parts.map(part => part.id).sort());
  assert.deepEqual(seed.catalog.materials.map(item => item.key).sort(), STARTER_LIBRARY.materials.map(item => item.key).sort());
  assert.equal(seed.catalog.revisions.every(item => item.authorName === null), true);

  const store = memoryStore();
  const transport = createLocalTransport(store);
  await transport.request(`/api/workspaces/${WORKSPACE}/parts`, { definition: crate(1) });
  await transport.request(`/api/workspaces/${WORKSPACE}/stock/items`, { label: 'K-01', partId: testId(1), variantKey: 'gross' });
  await transport.request(`/api/workspaces/${WORKSPACE}/stock/counts`, { materialKey: 'gummifuss-50', quantity: 9 }, 'PUT');
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.catalog.parts.length, STARTER_PARTS.length + 1);
  assert.equal(snapshot.catalog.stockItems.length, 1);
  assert.equal(snapshot.catalog.stockCounts.length, 1);

  const text = JSON.stringify(serializeSnapshot(snapshot));
  const restored = parseWorkspaceFileText(text);
  assert.deepEqual(restored.catalog, snapshot.catalog);
  assert.deepEqual(parseSnapshot(JSON.parse(JSON.stringify(restored))).catalog, snapshot.catalog);
});

test('a version 1 snapshot is upgraded with the starter library and keeps everything else', () => {
  const current = createSeedSnapshot();
  const { catalog: _catalog, ...rest } = current;
  const old = { ...rest, schemaVersion: 1 };
  const upgraded = parseWorkspaceFileText(JSON.stringify(old));
  assert.equal(upgraded.schemaVersion, SNAPSHOT_SCHEMA_VERSION);
  assert.deepEqual(upgraded.inventory, current.inventory);
  assert.deepEqual(upgraded.scenes, current.scenes);
  assert.deepEqual(upgraded.catalog.parts.map(part => part.id).sort(), STARTER_LIBRARY.parts.map(part => part.id).sort());
  assert.throws(() => parseWorkspaceFileText(JSON.stringify({ ...current, schemaVersion: SNAPSHOT_SCHEMA_VERSION + 1 })), /neueren Version/);
  assert.throws(() => parseWorkspaceFileText(JSON.stringify({ ...current, schemaVersion: 0 })), /neueren Version/);
});

test('a snapshot whose catalog contradicts itself is rejected', () => {
  const break_ = (change: (catalog: LocalSnapshot['catalog']) => void) => {
    const snapshot = createSeedSnapshot();
    change(snapshot.catalog);
    return () => parseSnapshot(snapshot);
  };
  assert.throws(break_(catalog => { catalog.revisions.pop(); }), /neueste Revision fehlt|Revision/);
  assert.throws(break_(catalog => { catalog.revisions.push({ ...catalog.revisions[0]!, partId: testId(77) }); }));
  assert.throws(break_(catalog => { catalog.revisions[0]!.definition = { ...catalog.revisions[0]!.definition, revision: 5 }; }), /Nummern/);
  assert.throws(break_(catalog => { catalog.materials.push(catalog.materials[0]!); }), /Doppeltes Material/);
  assert.throws(break_(catalog => { catalog.stockCounts.push({ id: testId(1), materialKey: 'gibt-es-nicht', partId: null, variantKey: null, quantity: 1, updatedAt: '2026-01-01T00:00:00.000Z' }); }), /ohne Material/);
  const item = (serial: number, label: string, archivedAt: string | null) => ({
    id: testId(serial), label, partId: STARTER_PARTS[0]!.id, variantKey: null, values: {}, usable: true, notes: null, cutouts: [], finish: null,
    archivedAt, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  });
  assert.throws(break_(catalog => { catalog.stockItems.push(item(1, 'A', null), item(2, 'A', null)); }), /Doppeltes Etikett/);
  assert.doesNotThrow(break_(catalog => { catalog.stockItems.push(item(1, 'A', '2026-01-02T00:00:00.000Z'), item(2, 'A', null)); }));
});
