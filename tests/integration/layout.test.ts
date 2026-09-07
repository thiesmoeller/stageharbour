import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/server/app.js';
import { bootstrapAdministrator } from '../../src/server/identity/bootstrap.js';
import { membership, scene, venueVersion, workspace } from '../../src/server/db/schema.js';
import { newBrace, newWall, type Scene } from '../../src/shared/layout.js';
import { newWallType } from '../../src/shared/wall-types.js';
import { testAdministrator, testDatabase } from '../helpers/database.js';

let fixture: Awaited<ReturnType<typeof testDatabase>>;
let app: Awaited<ReturnType<typeof createApp>>;
let headers: { cookie: string; origin: string };
let base: string;
let created: Scene;
const input = { productionName: 'Beispielproduktion', venueName: 'Beispielsaal', sceneName: 'Erste Szene', width: 8000, depth: 6000 };
before(async () => {
  fixture = await testDatabase();
  await bootstrapAdministrator(fixture.db, fixture.config, testAdministrator);
  app = await createApp(fixture.db, fixture.config);
  const login = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: testAdministrator });
  assert.equal(login.statusCode, 200);
  headers = { cookie: login.cookies.map(value => `${value.name}=${value.value}`).join('; '), origin: fixture.config.APP_ORIGIN };
  base = `/api/workspaces/${fixture.config.WORKSPACE_ID}/scenes`;
});
after(async () => { await app?.close(); await fixture?.dispose(); });

test('creates a complete production/adaptation/scene with a pinned venue version', async () => {
  const response = await app.inject({ method: 'POST', url: base, headers, payload: input });
  assert.equal(response.statusCode, 201, response.body);
  created = response.json();
  assert.equal(created.productionName, input.productionName);
  assert.deepEqual(created.venue, { schemaVersion: 1, width: 8000, depth: 6000 });
  assert.deepEqual(created.layout, { schemaVersion: 1, walls: [], braces: [] });
  assert.equal(created.revision, 0);
  assert.equal(created.lease, null);
  const listing = await app.inject({ url: base, headers });
  assert.equal(listing.statusCode, 200);
  assert.equal(listing.json()[0].id, created.id);
  assert.equal(listing.json()[0].layout, undefined);
  assert.equal(listing.json()[0].lease, null);
});
test('one competing save wins atomically; stale data cannot overwrite it', async () => {
  assert.equal((await app.inject({ method: 'POST', url: `${base}/${created.id}/lease`, headers })).statusCode, 200);
  const wall = newWall(randomUUID(), 1200, 1800);
  const saves = await Promise.all([1000, 2000].map(x => app.inject({
    method: 'PUT', url: `${base}/${created.id}/layout`, headers,
    payload: { revision: 0, layout: { schemaVersion: 1, walls: [{ ...wall, x, rotation: 35 }] } },
  })));
  assert.deepEqual(saves.map(value => value.statusCode).sort(), [200, 409]);
  const loaded = (await app.inject({ url: `${base}/${created.id}`, headers })).json<Scene>();
  assert.equal(loaded.revision, 1);
  assert.equal(loaded.layout.walls[0]!.x, saves[0]!.statusCode === 200 ? 1000 : 2000);
  assert.equal(loaded.venueVersionId, created.venueVersionId);
  assert.equal(loaded.layout.walls[0]!.rotation, 35);
  assert.equal(loaded.lease?.holderName, testAdministrator.name);
});
test('new venue information does not change a scene’s pinned geometry', async () => {
  const [original] = await fixture.db.select().from(venueVersion).where(eq(venueVersion.id, created.venueVersionId));
  await fixture.db.insert(venueVersion).values({ ...original!, id: randomUUID(), geometry: { schemaVersion: 1, width: 9000, depth: 7000 } });
  const loaded = (await app.inject({ url: `${base}/${created.id}`, headers })).json<Scene>();
  assert.deepEqual(loaded.venue, created.venue);
});
test('malformed documents and cross-origin writes leave saved data intact', async () => {
  for (const layout of [
    { schemaVersion: 2, walls: [] },
    { schemaVersion: 1, walls: [{ ...newWall(randomUUID(), 0, 0), width: -1 }] },
    { schemaVersion: 1, walls: [], braces: [{ ...newBrace(randomUUID(), 0, 0), height: 0 }] },
  ]) {
    assert.equal((await app.inject({ method: 'PUT', url: `${base}/${created.id}/layout`, headers, payload: { revision: 1, layout } })).statusCode, 400);
  }
  assert.equal((await app.inject({ method: 'POST', url: base, headers, payload: { ...input, width: 0 } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: base, headers: { ...headers, origin: 'https://foreign.example' }, payload: input })).statusCode, 403);
  assert.equal((await fixture.db.select().from(scene)).length, 1);
  assert.equal((await app.inject({ url: `${base}/${created.id}`, headers })).json().revision, 1);
});
test('saves and reloads wall types with rectangular openings; rejects openings outside the panel', async () => {
  const type = { ...newWallType(randomUUID()), name: 'Türwand', openings: [{ id: randomUUID(), left: 200, sill: 0, width: 800, height: 2000 }] };
  const wall = { ...newWall(randomUUID(), 2000, 3000), typeId: type.id, label: type.name };
  const saved = await app.inject({
    method: 'PUT', url: `${base}/${created.id}/layout`, headers,
    payload: { revision: 1, layout: { schemaVersion: 1, wallTypes: [type], walls: [wall] } },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const loaded = (await app.inject({ url: `${base}/${created.id}`, headers })).json<Scene>();
  assert.equal(loaded.layout.wallTypes?.[0]?.name, 'Türwand');
  assert.deepEqual(loaded.layout.wallTypes?.[0]?.openings[0], type.openings[0]);
  assert.equal(loaded.layout.walls[0]?.typeId, type.id);
  const invalid = await app.inject({
    method: 'PUT', url: `${base}/${created.id}/layout`, headers,
    payload: { revision: loaded.revision, layout: { schemaVersion: 1, wallTypes: [{ ...type, openings: [{ ...type.openings[0]!, left: 500 }] }], walls: [wall] } },
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal((await app.inject({ url: `${base}/${created.id}`, headers })).json<Scene>().layout.wallTypes?.[0]?.openings[0]?.left, 200);
});
test('freeze then later opening edits do not change the stored construction snapshot', async () => {
  const loaded = (await app.inject({ url: `${base}/${created.id}`, headers })).json<Scene>();
  const frozen = await app.inject({ method: 'POST', url: `${base}/${created.id}/exports`, headers, payload: { name: 'Türfassung' } });
  assert.equal(frozen.statusCode, 201, frozen.body);
  const original = Buffer.from((await app.inject({ url: `${base}/${created.id}/exports/${frozen.json().id}/file`, headers })).rawPayload);
  const type = loaded.layout.wallTypes![0]!;
  const edited = { ...type, openings: [{ ...type.openings[0]!, width: 400, left: 200 }] };
  assert.equal((await app.inject({
    method: 'PUT', url: `${base}/${created.id}/layout`, headers,
    payload: { revision: loaded.revision, layout: { schemaVersion: 1, wallTypes: [edited], walls: loaded.layout.walls } },
  })).statusCode, 200);
  const again = await app.inject({ url: `${base}/${created.id}/exports/${frozen.json().id}/file`, headers });
  assert.deepEqual(Buffer.from(again.rawPayload), original);
  const reloaded = (await app.inject({ url: `${base}/${created.id}`, headers })).json<Scene>();
  assert.equal(reloaded.layout.wallTypes?.[0]?.openings[0]?.width, 400);
});
test('saves and reloads weighted rear braces with the layout', async () => {
  const loaded = (await app.inject({ url: `${base}/${created.id}`, headers })).json<Scene>();
  const brace = newBrace(randomUUID(), 1500, 2500);
  const saved = await app.inject({
    method: 'PUT', url: `${base}/${created.id}/layout`, headers,
    payload: { revision: loaded.revision, layout: { ...loaded.layout, braces: [brace] } },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const reloaded = (await app.inject({ url: `${base}/${created.id}`, headers })).json<Scene>();
  assert.equal(reloaded.layout.braces.length, 1);
  assert.deepEqual(reloaded.layout.braces[0], brace);
});
test('workspace substitution and viewer writes are denied', async () => {
  const foreignId = randomUUID();
  await fixture.db.insert(workspace).values({ id: foreignId, name: 'Other workspace' });
  const [member] = await fixture.db.select().from(membership);
  await fixture.db.insert(membership).values({ workspaceId: foreignId, userId: member!.userId, role: 'editor' });
  const foreignBase = `/api/workspaces/${foreignId}/scenes`;
  assert.equal((await app.inject({ url: `${foreignBase}/${created.id}`, headers })).statusCode, 404);
  assert.equal((await app.inject({ method: 'PUT', url: `${foreignBase}/${created.id}/layout`, headers, payload: { revision: 1, layout: created.layout } })).statusCode, 404);
  assert.deepEqual((await app.inject({ url: foreignBase, headers })).json(), []);
  await fixture.db.update(membership).set({ role: 'viewer' }).where(eq(membership.workspaceId, fixture.config.WORKSPACE_ID));
  assert.equal((await app.inject({ url: `${base}/${created.id}`, headers })).statusCode, 200);
  assert.equal((await app.inject({ method: 'PUT', url: `${base}/${created.id}/layout`, headers, payload: { revision: 1, layout: created.layout } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: base, headers, payload: input })).statusCode, 403);
  assert.equal((await app.inject({ url: base })).statusCode, 401);
});
