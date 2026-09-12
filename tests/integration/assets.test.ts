import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/server/app.js';
import { bootstrapAdministrator } from '../../src/server/identity/bootstrap.js';
import { membership, workspace } from '../../src/server/db/schema.js';
import { testAdministrator, testDatabase } from '../helpers/database.js';
import { cubeGlb } from '../helpers/model.js';

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
  base = `/api/workspaces/${fixture.config.WORKSPACE_ID}/assets`;
});
after(async () => { await app?.close(); await fixture?.dispose(); });

test('shared GLB assets survive restart and archival; layout references are workspace scoped', async () => {
  const payload = cubeGlb();
  const uploaded = await app.inject({ method: 'POST', url: `${base}/files`, headers: { ...headers, 'content-type': 'model/gltf-binary' }, payload });
  assert.equal(uploaded.statusCode, 201, uploaded.body);
  const fileId = uploaded.json().fileId;
  const definition = { kind: 'model', width: 1200, height: 900, depth: 800, source: { kind: 'upload', fileId } };
  const created = await app.inject({ method: 'POST', url: base, headers, payload: { name: 'Podest', definition } });
  assert.equal(created.statusCode, 201, created.body);
  const asset = created.json();
  await app.close(); app = await createApp(fixture.db, fixture.config);
  const file = await app.inject({ url: `${base}/files/${fileId}`, headers });
  assert.equal(file.statusCode, 200); assert.deepEqual(file.rawPayload, payload);
  assert.equal((await app.inject({ url: `${base}/files/${fileId}` })).statusCode, 401);

  const sceneBase = `/api/workspaces/${fixture.config.WORKSPACE_ID}/scenes`;
  const scene = (await app.inject({ method: 'POST', url: sceneBase, headers, payload: { productionName: 'Test', venueName: 'Saal', sceneName: 'Szene', width: 8000, depth: 6000 } })).json();
  await app.inject({ method: 'POST', url: `${sceneBase}/${scene.id}/lease`, headers });
  const prop = { id: randomUUID(), assetId: asset.id, label: 'Podest', x: 2000, y: 3000, kind: 'box' as const, rotation: 30, width: 1200, height: 900, depth: 800 };
  const layout = { schemaVersion: 1, walls: [], braces: [], placeholders: [prop] };
  assert.equal((await app.inject({ method: 'PUT', url: `${sceneBase}/${scene.id}/layout`, headers, payload: { revision: 0, layout } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'DELETE', url: `${base}/${asset.id}`, headers })).statusCode, 200);
  assert.equal((await app.inject({ url: base, headers })).json()[0].archived, true);
  assert.deepEqual((await app.inject({ url: `${sceneBase}/${scene.id}`, headers })).json().layout.placeholders, [prop]);
  assert.equal((await app.inject({ url: `${base}/files/${fileId}`, headers })).statusCode, 200);

  const foreign = randomUUID();
  await fixture.db.insert(workspace).values({ id: foreign, name: 'Andere Gruppe' });
  const member = (await fixture.db.select().from(membership))[0]!;
  await fixture.db.insert(membership).values({ workspaceId: foreign, userId: member.userId, role: 'editor' });
  const foreignBase = `/api/workspaces/${foreign}/assets`;
  assert.equal((await app.inject({ url: `${foreignBase}/files/${fileId}`, headers })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: foreignBase, headers, payload: { name: 'Fremd', definition } })).statusCode, 400);
  const foreignAsset = (await app.inject({ method: 'POST', url: foreignBase, headers, payload: { name: 'Wand', definition: { kind: 'wall', template: { width: 1200, height: 2400, thickness: 28 } } } })).json();
  assert.equal((await app.inject({ method: 'PUT', url: `${sceneBase}/${scene.id}/layout`, headers, payload: { revision: 1, layout: { ...layout, placeholders: [{ ...prop, assetId: foreignAsset.id }] } } })).statusCode, 400);
});

test('invalid models, cross-origin writes and viewer mutations are rejected', async () => {
  const upload = (payload: Buffer, origin = headers.origin) => app.inject({ method: 'POST', url: `${base}/files`, headers: { ...headers, origin, 'content-type': 'model/gltf-binary' }, payload });
  assert.equal((await upload(Buffer.from('not a model'))).statusCode, 400);
  assert.equal((await upload(cubeGlb('https://example.com/remote.bin'))).statusCode, 400);
  assert.equal((await upload(cubeGlb(), 'https://foreign.example')).statusCode, 403);
  await fixture.db.update(membership).set({ role: 'viewer' }).where(eq(membership.workspaceId, fixture.config.WORKSPACE_ID));
  assert.equal((await app.inject({ url: base, headers })).statusCode, 200);
  assert.equal((await upload(cubeGlb())).statusCode, 403);
  assert.equal((await app.inject({ method: 'DELETE', url: `${base}/${randomUUID()}`, headers })).statusCode, 403);
});
