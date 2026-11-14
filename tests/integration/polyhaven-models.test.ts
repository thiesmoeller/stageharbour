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
