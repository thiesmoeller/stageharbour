import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/server/app.js';
import { bootstrapAdministrator } from '../../src/server/identity/bootstrap.js';
import { membership } from '../../src/server/db/schema.js';
import type { LayoutObject, Scene } from '../../src/shared/layout.js';
import { STARTER_PART_IDS } from '../../src/shared/parts/starter/index.js';
import { testAdministrator, testDatabase } from '../helpers/database.js';

let fixture: Awaited<ReturnType<typeof testDatabase>>;
let app: Awaited<ReturnType<typeof createApp>>;
let headers: { cookie: string; origin: string };
let base: string;
before(async () => {
  fixture = await testDatabase();
  await bootstrapAdministrator(fixture.db, fixture.config, testAdministrator);
  app = await createApp(fixture.db, fixture.config);
  const login = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: testAdministrator });
  headers = { cookie: login.cookies.map(value => `${value.name}=${value.value}`).join('; '), origin: fixture.config.APP_ORIGIN };
  base = `/api/workspaces/${fixture.config.WORKSPACE_ID}`;
});
after(async () => { await app?.close(); await fixture?.dispose(); });

test('ballast stock requires a lease, persists, validates counts and isolates workspaces', async () => {
  const put = (payload: object) => app.inject({ method: 'PUT', url: `${base}/inventory/ballast`, headers, payload });
  assert.equal((await put({ slabs: 10, straps: 3 })).statusCode, 423);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/inventory/lease`, headers })).statusCode, 200);
  assert.equal((await put({ slabs: -1, straps: 3 })).statusCode, 400);
  assert.equal((await put({ slabs: 1.5, straps: 3 })).statusCode, 400);
  assert.equal((await put({ slabs: 10, straps: 3 })).statusCode, 200);
  assert.deepEqual((await app.inject({ url: `${base}/inventory`, headers })).json().ballast, { slabs: 10, straps: 3 });
  assert.equal((await app.inject({ method: 'PUT', url: `/api/workspaces/${randomUUID()}/inventory/ballast`, headers, payload: { slabs: 10, straps: 3 } })).statusCode, 404);
  await fixture.db.update(membership).set({ role: 'viewer' }).where(eq(membership.workspaceId, fixture.config.WORKSPACE_ID));
  assert.equal((await put({ slabs: 20, straps: 4 })).statusCode, 403);
  await fixture.db.update(membership).set({ role: 'administrator' }).where(eq(membership.workspaceId, fixture.config.WORKSPACE_ID));
});

test('requirements count maxima across saved scenes and separate venues', async () => {
  const response = await app.inject({ method: 'POST', url: `${base}/scenes`, headers, payload: {
    productionName: 'Ballast test', venueName: 'Venue A', sceneName: 'A', width: 8000, depth: 6000,
  } });
  assert.equal(response.statusCode, 201, response.body);
  const scene = response.json<Scene>();
  await app.inject({ method: 'POST', url: `${base}/scenes/${scene.id}/lease`, headers });
  const brace: LayoutObject = {
    id: randomUUID(), label: 'Stützdreieck', part: { id: STARTER_PART_IDS.brace, revision: 1 },
    values: { ballast: 2 }, x: 2000, y: 2000, rotation: 0,
  };
  const saved = await app.inject({ method: 'PUT', url: `${base}/scenes/${scene.id}/layout`, headers,
    payload: { revision: 0, layout: { schemaVersion: 2, objects: [brace], joints: [] } } });
  assert.equal(saved.statusCode, 200, saved.body);
  const second = await app.inject({ method: 'POST', url: `${base}/scenes`, headers, payload: {
    productionId: scene.productionId, venueVersionId: scene.venueVersionId, sceneName: 'B',
  } });
  assert.equal(second.statusCode, 201, second.body);
  const b = second.json<Scene>();
  await app.inject({ method: 'POST', url: `${base}/scenes/${b.id}/lease`, headers });
  const savedB = await app.inject({ method: 'PUT', url: `${base}/scenes/${b.id}/layout`, headers,
    payload: { revision: 0, layout: { schemaVersion: 2, objects: [brace, { ...brace, id: randomUUID() }], joints: [] } } });
  assert.equal(savedB.statusCode, 200, savedB.body);
  const result = await app.inject({ url: `${base}/productions/${scene.productionId}/venues/${scene.venueId}/requirements`, headers });
  assert.equal(result.statusCode, 200, result.body);
  assert.deepEqual(result.json().required, { braces: 2, slabs: 4, straps: 2 });
  assert.deepEqual(result.json().available, { slabs: 10, straps: 3 });
  assert.equal((await app.inject({ url: `${base}/productions/${scene.productionId}/venues/${randomUUID()}/requirements`, headers })).statusCode, 404);
});
