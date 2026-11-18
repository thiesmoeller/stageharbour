import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../src/server/app.js';
import { bootstrapAdministrator } from '../../src/server/identity/bootstrap.js';
import type { ModelCatalogClient } from '../../src/server/assets/polyHavenModels.js';
import { testAdministrator, testDatabase } from '../helpers/database.js';
import { cubeGlb } from '../helpers/model.js';

const item = {
  id: 'crate',
  name: 'Kiste',
  thumbnailUrl: 'https://cdn.polyhaven.com/asset_img/thumbs/crate.png',
  categories: ['prop'],
};
const bytes = cubeGlb();
const models: ModelCatalogClient = {
  async search(query) { return query && !'kiste crate'.includes(query.toLowerCase()) ? [] : [item]; },
  async download() { return { item, bytes, width: 800, height: 600, depth: 500 }; },
};

let fixture: Awaited<ReturnType<typeof testDatabase>>;
let app: Awaited<ReturnType<typeof createApp>>;
let headers: { cookie: string; origin: string };
let base: string;

before(async () => {
  fixture = await testDatabase();
  await bootstrapAdministrator(fixture.db, fixture.config, testAdministrator);
  app = await createApp(fixture.db, fixture.config, { modelCatalog: models });
  const login = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: testAdministrator });
  headers = { cookie: login.cookies.map(value => `${value.name}=${value.value}`).join('; '), origin: fixture.config.APP_ORIGIN };
  base = `/api/workspaces/${fixture.config.WORKSPACE_ID}/assets`;
  assert.equal((await app.inject({ method: 'POST', url: `/api/workspaces/${fixture.config.WORKSPACE_ID}/inventory/lease`, headers })).statusCode, 200);
});
after(async () => { await app?.close(); await fixture?.dispose(); });

test('Poly Haven search and import store a workspace GLB asset', async () => {
  const catalog = await app.inject({ url: `${base}/catalog/poly-haven?q=kiste`, headers });
  assert.equal(catalog.statusCode, 200, catalog.body);
  assert.equal(catalog.json()[0].id, 'crate');
  const created = await app.inject({ method: 'POST', url: `${base}/import/poly-haven`, headers, payload: { id: 'crate' } });
  assert.equal(created.statusCode, 201, created.body);
  const asset = created.json();
  assert.equal(asset.name, 'Kiste');
  assert.equal(asset.definition.kind, 'model');
  assert.equal(asset.definition.source.kind, 'upload');
  assert.deepEqual(
    [asset.definition.width, asset.definition.height, asset.definition.depth],
    [800, 600, 500],
  );
  const file = await app.inject({ url: `${base}/files/${asset.definition.source.fileId}`, headers });
  assert.equal(file.statusCode, 200);
  assert.deepEqual(file.rawPayload, bytes);
  assert.equal((await app.inject({ url: `${base}/catalog/poly-haven?q=missing`, headers })).json().length, 0);
});

test('nested mesh dependencies survive restart, pin revisions, and prevent asset removal', async () => {
  const created = await app.inject({ method: 'POST', url: `${base}/import/poly-haven`, headers, payload: { id: 'crate' } });
  const asset = created.json();
  const root = base.replace(/\/assets$/, '');
  const { randomUUID } = await import('node:crypto');
  const child = { id: randomUUID(), revision: 1, name: 'Griff', category: 'Test', parameters: [], bodies: [{ kind: 'mesh', key: 'handle', assetId: asset.id, at: [100, 1000, 0], size: [120, 30, 40] }], traits: { stock: 'none' } };
  const definition = { ...child, id: randomUUID(), name: 'Tür', bodies: [], children: [{ key: 'handle-group', group: child, at: [0, 0, 0] }] };
  const part = await app.inject({ method: 'POST', url: `${root}/parts`, headers, payload: { definition } });
  assert.equal(part.statusCode, 201, part.body);
  const missing = structuredClone(definition);
  missing.id = randomUUID(); missing.children[0]!.group.bodies[0]!.assetId = randomUUID();
  const refused = await app.inject({ method: 'POST', url: `${root}/parts`, headers, payload: { definition: missing } });
  assert.equal(refused.statusCode, 422, refused.body);
  assert.match(refused.body, /unknown-asset/);
  const revised = await app.inject({ method: 'POST', url: `${root}/parts/${definition.id}/revisions`, headers, payload: { baseRevision: 1, definition: { ...definition, children: [], bodies: [{ kind: 'box', key: 'body', material: 'gummifuss-50', at: [0, 10, 0], size: [20, 20, 20] }] } } });
  assert.equal(revised.statusCode, 201, revised.body);
  const removed = await app.inject({ method: 'DELETE', url: `${base}/${asset.id}`, headers });
  assert.equal(removed.statusCode, 400, removed.body);
  await app.close(); app = await createApp(fixture.db, fixture.config);
  const old = await app.inject({ url: `${root}/parts/${definition.id}/revisions/1`, headers });
  assert.equal(old.statusCode, 200, old.body);
  assert.equal(old.json().definition.children[0].group.bodies[0].assetId, asset.id);
  const file = await app.inject({ url: `${base}/files/${asset.definition.source.fileId}`, headers });
  assert.deepEqual(file.rawPayload, bytes);
});
