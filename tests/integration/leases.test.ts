import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import { createApp } from '../../src/server/app.js';
import { bootstrapAdministrator } from '../../src/server/identity/bootstrap.js';
import { LeaseError, createLeases } from '../../src/server/productions/leases.js';
import { account, membership, user } from '../../src/server/db/schema.js';
import { LEASE_TTL_MS } from '../../src/shared/leases.js';
import { newWall, type Scene } from '../../src/shared/layout.js';
import { testAdministrator, testDatabase } from '../helpers/database.js';

let fixture: Awaited<ReturnType<typeof testDatabase>>;
let now = new Date('2026-09-07T10:00:00.000Z');
const clock = () => now;
let anna: { id: string; name: string };
let bert: { id: string; name: string };
const sceneId = randomUUID();
const venueId = randomUUID();

before(async () => {
  fixture = await testDatabase();
  await bootstrapAdministrator(fixture.db, fixture.config, testAdministrator);
  const annaId = randomUUID();
  const bertId = randomUUID();
  anna = { id: annaId, name: 'Anna Editor' };
  bert = { id: bertId, name: 'Bert Editor' };
  await fixture.db.insert(user).values([
    { id: anna.id, name: anna.name, email: 'anna@example.test' },
    { id: bert.id, name: bert.name, email: 'bert@example.test' },
  ]);
});
after(async () => { await fixture?.dispose(); });

test('an editor can acquire a free exclusive lease', async () => {
  const leases = createLeases(fixture.db, clock);
  const result = await leases.acquire(fixture.config.WORKSPACE_ID, 'scene', sceneId, anna);
  assert.deepEqual(result, { acquired: true, lease: { holderUserId: anna.id, holderName: anna.name } });
  assert.deepEqual(await leases.read(fixture.config.WORKSPACE_ID, 'scene', sceneId), { holderUserId: anna.id, holderName: anna.name });
});

test('a competing editor is refused while the lease is held', async () => {
  const leases = createLeases(fixture.db, clock);
  const result = await leases.acquire(fixture.config.WORKSPACE_ID, 'scene', sceneId, bert);
  assert.equal(result.acquired, false);
  assert.deepEqual(result.lease, { holderUserId: anna.id, holderName: anna.name });
});

test('the holder can refresh the lease and heartbeat extends expiry', async () => {
  const leases = createLeases(fixture.db, clock);
  now = new Date(now.getTime() + 20_000);
  const refresh = await leases.acquire(fixture.config.WORKSPACE_ID, 'scene', sceneId, anna);
  assert.equal(refresh.acquired, true);
  now = new Date(now.getTime() + 20_000);
  await leases.heartbeat(fixture.config.WORKSPACE_ID, 'scene', sceneId, anna.id);
  now = new Date(now.getTime() + LEASE_TTL_MS - 1_000);
  assert.deepEqual(await leases.read(fixture.config.WORKSPACE_ID, 'scene', sceneId), { holderUserId: anna.id, holderName: anna.name });
});

test('an expired lease can be taken by another editor; heartbeat from a non-holder is refused', async () => {
  const leases = createLeases(fixture.db, clock);
  now = new Date(now.getTime() + 2_000);
  assert.equal(await leases.read(fixture.config.WORKSPACE_ID, 'scene', sceneId), null);
  await assert.rejects(() => leases.heartbeat(fixture.config.WORKSPACE_ID, 'scene', sceneId, anna.id), error => {
    assert(error instanceof LeaseError); assert.equal(error.statusCode, 423); return true;
  });
  const taken = await leases.acquire(fixture.config.WORKSPACE_ID, 'scene', sceneId, bert);
  assert.deepEqual(taken, { acquired: true, lease: { holderUserId: bert.id, holderName: bert.name } });
  await assert.rejects(() => leases.heartbeat(fixture.config.WORKSPACE_ID, 'scene', sceneId, anna.id), error => {
    assert(error instanceof LeaseError); assert.equal(error.statusCode, 423); return true;
  });
});

test('requireHeld allows only the current unexpired holder', async () => {
  const leases = createLeases(fixture.db, clock);
  await leases.requireHeld(fixture.db, fixture.config.WORKSPACE_ID, 'scene', sceneId, bert.id);
  await assert.rejects(() => leases.requireHeld(fixture.db, fixture.config.WORKSPACE_ID, 'scene', sceneId, anna.id), error => {
    assert(error instanceof LeaseError); assert.equal(error.statusCode, 423); return true;
  });
  now = new Date(now.getTime() + LEASE_TTL_MS + 1);
  await assert.rejects(() => leases.requireHeld(fixture.db, fixture.config.WORKSPACE_ID, 'scene', sceneId, bert.id), error => {
    assert(error instanceof LeaseError); assert.equal(error.statusCode, 423); return true;
  });
});

test('venue records use the same exclusive lease rules', async () => {
  const leases = createLeases(fixture.db, clock);
  const first = await leases.acquire(fixture.config.WORKSPACE_ID, 'venue', venueId, anna);
  assert.equal(first.acquired, true);
  const denied = await leases.acquire(fixture.config.WORKSPACE_ID, 'venue', venueId, bert);
  assert.equal(denied.acquired, false);
  assert.equal(denied.lease.holderName, anna.name);
  now = new Date(now.getTime() + LEASE_TTL_MS + 1);
  const taken = await leases.acquire(fixture.config.WORKSPACE_ID, 'venue', venueId, bert);
  assert.equal(taken.acquired, true);
  assert.equal((await leases.read(fixture.config.WORKSPACE_ID, 'scene', sceneId)), null);
});

test('a viewer never acquires; the second editor is read-only until expiry, then the first cannot overwrite', async () => {
  now = new Date('2026-09-07T12:00:00.000Z');
  const app = await createApp(fixture.db, fixture.config, { clock });
  const origin = fixture.config.APP_ORIGIN;
  const workspaceId = fixture.config.WORKSPACE_ID;
  const base = `/api/workspaces/${workspaceId}/scenes`;
  const adminHeaders = { cookie: await login(app, testAdministrator.email), origin };
  const created = (await app.inject({ method: 'POST', url: base, headers: adminHeaders, payload: {
    productionName: 'Pachtprobe', venueName: 'Probebühne', sceneName: 'Szene A', width: 8000, depth: 6000,
  } })).json<Scene>();
  assert.equal(created.lease, null);

  const viewerId = randomUUID();
  await fixture.db.insert(user).values({ id: viewerId, name: 'Vera Viewer', email: 'vera@example.test' });
  await fixture.db.insert(account).values({
    id: randomUUID(), userId: viewerId, accountId: viewerId, providerId: 'credential',
    password: await hashPassword(testAdministrator.password),
  });
  await fixture.db.insert(membership).values({ workspaceId, userId: viewerId, role: 'viewer' });
  await fixture.db.insert(membership).values({ workspaceId, userId: anna.id, role: 'editor' });
  await fixture.db.insert(membership).values({ workspaceId, userId: bert.id, role: 'editor' });
  await fixture.db.insert(account).values([
    { id: randomUUID(), userId: anna.id, accountId: anna.id, providerId: 'credential', password: await hashPassword(testAdministrator.password) },
    { id: randomUUID(), userId: bert.id, accountId: bert.id, providerId: 'credential', password: await hashPassword(testAdministrator.password) },
  ]);
  const viewerHeaders = { cookie: await login(app, 'vera@example.test'), origin };
  const annaHeaders = { cookie: await login(app, 'anna@example.test'), origin };
  const bertHeaders = { cookie: await login(app, 'bert@example.test'), origin };

  assert.equal((await app.inject({ method: 'POST', url: `${base}/${created.id}/lease`, headers: viewerHeaders })).statusCode, 403);
  assert.equal((await app.inject({ url: `${base}/${created.id}`, headers: viewerHeaders })).json().lease, null);

  const held = await app.inject({ method: 'POST', url: `${base}/${created.id}/lease`, headers: annaHeaders });
  assert.equal(held.statusCode, 200, held.body);
  assert.equal(held.json().holderName, anna.name);
  const denied = await app.inject({ method: 'POST', url: `${base}/${created.id}/lease`, headers: bertHeaders });
  assert.equal(denied.statusCode, 423);
  assert.match(denied.json().message, /Anna Editor/);
  const listing = (await app.inject({ url: base, headers: bertHeaders })).json<Scene[]>();
  assert.equal(listing.find(item => item.id === created.id)?.lease?.holderName, anna.name);
  const viewed = (await app.inject({ url: `${base}/${created.id}`, headers: bertHeaders })).json<Scene>();
  assert.equal(viewed.lease?.holderName, anna.name);

  const wall = newWall(randomUUID(), 1200, 1800);
  const layout = { schemaVersion: 1 as const, walls: [wall] };
  const saved = await app.inject({ method: 'PUT', url: `${base}/${created.id}/layout`, headers: annaHeaders, payload: { revision: 0, layout } });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal((await app.inject({ method: 'PUT', url: `${base}/${created.id}/layout`, headers: bertHeaders, payload: { revision: 1, layout } })).statusCode, 423);
  assert.equal((await app.inject({ method: 'PUT', url: `${base}/${created.id}/layout`, headers: viewerHeaders, payload: { revision: 1, layout } })).statusCode, 403);

  now = new Date(now.getTime() + LEASE_TTL_MS + 1);
  const stolen = await app.inject({ method: 'POST', url: `${base}/${created.id}/lease`, headers: bertHeaders });
  assert.equal(stolen.statusCode, 200, stolen.body);
  const bertWall = { ...wall, x: 3000 };
  const bertSave = await app.inject({
    method: 'PUT', url: `${base}/${created.id}/layout`, headers: bertHeaders,
    payload: { revision: 1, layout: { schemaVersion: 1, walls: [bertWall] } },
  });
  assert.equal(bertSave.statusCode, 200, bertSave.body);

  const stale = await app.inject({
    method: 'PUT', url: `${base}/${created.id}/layout`, headers: annaHeaders,
    payload: { revision: 1, layout: { schemaVersion: 1, walls: [{ ...wall, x: 9999 }] } },
  });
  assert.equal(stale.statusCode, 423);
  const loaded = (await app.inject({ url: `${base}/${created.id}`, headers: annaHeaders })).json<Scene>();
  assert.equal(loaded.revision, 2);
  assert.equal(loaded.layout.walls[0]?.x, 3000);
  assert.equal(loaded.lease?.holderName, bert.name);

  await app.close();
});

test('foreign origin cannot take a lease; releasing frees it for another editor', async () => {
  now = new Date('2026-09-07T13:00:00.000Z');
  const app = await createApp(fixture.db, fixture.config, { clock });
  const origin = fixture.config.APP_ORIGIN;
  const base = `/api/workspaces/${fixture.config.WORKSPACE_ID}/scenes`;
  const annaHeaders = { cookie: await login(app, 'anna@example.test'), origin };
  const bertHeaders = { cookie: await login(app, 'bert@example.test'), origin };
  const [existing] = (await app.inject({ url: base, headers: annaHeaders })).json<Scene[]>();
  assert(existing);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/${existing.id}/lease`, headers: { ...annaHeaders, origin: 'https://foreign.example' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/${existing.id}/lease`, headers: annaHeaders })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/${existing.id}/lease/release`, headers: annaHeaders })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/${existing.id}/lease`, headers: bertHeaders })).statusCode, 200);
  await app.close();
});

async function login(app: Awaited<ReturnType<typeof createApp>>, email: string) {
  const response = await app.inject({
    method: 'POST', url: '/api/auth/sign-in/email',
    headers: { origin: fixture.config.APP_ORIGIN }, payload: { email, password: testAdministrator.password },
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.cookies.map(value => `${value.name}=${value.value}`).join('; ');
}

test('workspace membership is required to inspect a lease', async () => {
  const app = await createApp(fixture.db, fixture.config, { clock });
  const [member] = await fixture.db.select().from(membership).where(eq(membership.userId, anna.id));
  await fixture.db.delete(membership).where(eq(membership.userId, anna.id));
  const headers = { cookie: await login(app, 'anna@example.test'), origin: fixture.config.APP_ORIGIN };
  const base = `/api/workspaces/${fixture.config.WORKSPACE_ID}/scenes`;
  const listing = await app.inject({ url: base, headers });
  assert.equal(listing.statusCode, 404);
  await fixture.db.insert(membership).values(member!);
  await app.close();
});
