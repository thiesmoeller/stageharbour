import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/server/app.js';
import { bootstrapAdministrator } from '../../src/server/identity/bootstrap.js';
import { account, membership, user } from '../../src/server/db/schema.js';
import { testAdministrator, testDatabase } from '../helpers/database.js';
import { cubeGlb } from '../helpers/model.js';
import { LEASE_TTL_MS } from '../../src/shared/leases.js';

let fixture: Awaited<ReturnType<typeof testDatabase>>;
let app: Awaited<ReturnType<typeof createApp>>;
let base: string;
let now = new Date();
const ids = { editor: randomUUID(), viewer: randomUUID(), administrator: '' };
const headers: Record<string, { cookie: string; origin: string }> = {};
before(async () => {
  fixture = await testDatabase();
  await bootstrapAdministrator(fixture.db, fixture.config, testAdministrator);
  ids.administrator = (await fixture.db.select().from(user))[0]!.id;
  for (const role of ['editor', 'viewer'] as const) {
    await fixture.db.insert(user).values({ id: ids[role], email: `${role}@example.test`, name: role });
    await fixture.db.insert(account).values({ id: randomUUID(), userId: ids[role], accountId: ids[role], providerId: 'credential', password: await hashPassword(testAdministrator.password) });
    await fixture.db.insert(membership).values({ workspaceId: fixture.config.WORKSPACE_ID, userId: ids[role], role });
  }
  app = await createApp(fixture.db, fixture.config, { clock: () => now });
  base = `/api/workspaces/${fixture.config.WORKSPACE_ID}`;
  for (const role of ['administrator', 'editor', 'viewer']) {
    const response = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: { email: role === 'administrator' ? testAdministrator.email : `${role}@example.test`, password: testAdministrator.password } });
    assert.equal(response.statusCode, 200);
    headers[role] = { cookie: response.cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; '), origin: fixture.config.APP_ORIGIN };
  }
});
after(async () => { await app?.close(); await fixture?.dispose(); });
async function createScene() {
  const response = await app.inject({ method: 'POST', url: `${base}/scenes`, headers: headers.administrator,
    payload: { productionName: 'Berechtigungsprobe', venueName: 'Saal', sceneName: 'Szene', width: 8000, depth: 6000 } });
  assert.equal(response.statusCode, 201, response.body); return response.json();
}
async function post(url: string, role = 'administrator', payload: Record<string, unknown> = {}) {
  return app.inject({ method: 'POST', url, headers: headers[role], payload });
}

test('venue lease blocks competing publishers and allows takeover only after expiry', async () => {
  const scene = await createScene();
  const url = `${base}/venues/${scene.venueId}`;
  const payload = { venueVersionId: scene.venueVersionId, venue: { ...scene.venue, ceilingHeight: 4000 } };
  assert.equal((await post(`${url}/lease`, 'viewer')).statusCode, 403);
  assert.equal((await post(`${url}/lease`)).statusCode, 200);
  assert.equal((await post(`${url}/lease`, 'editor')).statusCode, 423);
  assert.equal((await app.inject({ method: 'PUT', url, headers: headers.editor, payload })).statusCode, 423);
  await post(`${base}/scenes/${scene.id}/lease`, 'editor');
  assert.equal((await app.inject({ method: 'PUT', url: `${base}/scenes/${scene.id}/venue`, headers: headers.editor, payload: { venue: payload.venue } })).statusCode, 423);
  now = new Date(now.getTime() + LEASE_TTL_MS + 1);
  assert.equal((await post(`${url}/lease`, 'editor')).statusCode, 200);
  assert.equal((await post(`${url}/lease/heartbeat`)).statusCode, 423);
  assert.equal((await app.inject({ method: 'PUT', url, headers: headers.editor, payload })).statusCode, 200);
  assert.equal((await app.inject({ method: 'PUT', url, headers: headers.administrator, payload })).statusCode, 423);
});

test('inventory lease protects GLB upload, catalog creation and archival', async () => {
  const url = `${base}/inventory/lease`;
  assert.equal((await post(url)).statusCode, 200);
  assert.equal((await post(url, 'editor')).statusCode, 423);
  const payload = { name: 'Wand', definition: { kind: 'wall', template: { width: 1200, height: 2400, thickness: 28 } } };
  assert.equal((await post(`${base}/assets`, 'editor', payload)).statusCode, 423);
  assert.equal((await post(`${base}/assets`, 'viewer', payload)).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/assets/files`, headers: { ...headers.editor, 'content-type': 'model/gltf-binary' }, payload: cubeGlb() })).statusCode, 423);
  const created = await post(`${base}/assets`, 'administrator', payload);
  assert.equal(created.statusCode, 201);
  assert.equal((await app.inject({ method: 'DELETE', url: `${base}/assets/${created.json().id}`, headers: headers.editor })).statusCode, 423);
});

test('recovery saves a local draft separately without changing or unlocking the original', async () => {
  const scene = await createScene();
  await post(`${base}/scenes/${scene.id}/lease`);
  const draft = { name: 'Geretteter Entwurf', layout: { schemaVersion: 1, walls: [], braces: [], riggingNotes: 'Lokale Änderung' }, sourceSurfaces: [] };
  assert.equal((await post(`${base}/scenes/${scene.id}/recover`, 'viewer', draft)).statusCode, 403);
  const result = await post(`${base}/scenes/${scene.id}/recover`, 'editor', draft);
  assert.equal(result.statusCode, 201, result.body);
  assert.equal(result.json().layout.riggingNotes, 'Lokale Änderung');
  const original = (await app.inject({ url: `${base}/scenes/${scene.id}`, headers: headers.editor })).json();
  assert.equal(original.revision, 0); assert.equal(original.lease.holderUserId, ids.administrator);
  assert.equal((await app.inject({ method: 'DELETE', url: `${base}/scenes/${scene.id}`, headers: headers.editor })).statusCode, 423);
});

test('venue publication cannot change a sibling scene held by another editor', async () => {
  const scene = await createScene();
  const copy = await post(`${base}/scenes/${scene.id}/duplicate`);
  assert.equal(copy.statusCode, 201, copy.body);
  await post(`${base}/scenes/${scene.id}/lease`);
  await post(`${base}/scenes/${copy.json().id}/lease`, 'editor');
  const result = await app.inject({ method: 'PUT', url: `${base}/scenes/${scene.id}/venue`, headers: headers.administrator,
    payload: { venue: { ...scene.venue, ceilingHeight: 4200 } } });
  assert.equal(result.statusCode, 423, result.body);
  const current = (await app.inject({ url: `${base}/scenes/${scene.id}`, headers: headers.administrator })).json();
  assert.equal(current.venueVersionId, scene.venueVersionId);
  assert.equal((await post(`${base}/scenes/${copy.json().id}/lease/heartbeat`, 'editor')).statusCode, 200);
});

test('downgrade and revocation take effect immediately and free held resources', async () => {
  const scene = await createScene();
  await post(`${base}/scenes/${scene.id}/lease`, 'editor');
  assert.equal((await app.inject({ method: 'PATCH', url: `${base}/members/${ids.editor}`, headers: headers.administrator, payload: { role: 'viewer' } })).statusCode, 200);
  assert.equal((await post(`${base}/scenes/${scene.id}/lease/heartbeat`, 'editor')).statusCode, 403);
  assert.equal((await post(`${base}/scenes/${scene.id}/lease`)).statusCode, 200);
  assert.equal((await app.inject({ method: 'DELETE', url: `${base}/members/${ids.editor}`, headers: headers.administrator })).statusCode, 200);
  assert.equal((await app.inject({ url: `${base}/scenes`, headers: headers.editor })).statusCode, 404);
});

test('audit is administrator-only and records lease takeovers and membership changes without secrets', async () => {
  assert.equal((await app.inject({ url: `${base}/audit`, headers: headers.viewer })).statusCode, 403);
  const result = await app.inject({ url: `${base}/audit`, headers: headers.administrator });
  assert.equal(result.statusCode, 200);
  const events = result.json();
  assert(events.some((entry: { action: string }) => entry.action === 'lease.takeover.venue'));
  assert(events.some((entry: { action: string }) => entry.action.includes('members/:userId')));
  assert(!result.body.includes(testAdministrator.password));
});

test('simultaneous administrator demotions cannot leave the workspace without an administrator', async () => {
  await fixture.db.update(membership).set({ role: 'administrator' }).where(eq(membership.userId, ids.viewer));
  const responses = await Promise.all([ids.administrator, ids.viewer].map(id => app.inject({ method: 'PATCH', url: `${base}/members/${id}`, headers: headers.administrator, payload: { role: 'editor' } })));
  assert(responses.some(response => response.statusCode === 200));
  assert(responses.some(response => response.statusCode === 409 || response.statusCode === 403));
  assert.equal((await fixture.db.select().from(membership)).filter(item => item.role === 'administrator').length, 1);
});
