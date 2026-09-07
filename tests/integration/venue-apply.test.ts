import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import { createApp } from '../../src/server/app.js';
import { bootstrapAdministrator } from '../../src/server/identity/bootstrap.js';
import { account, membership, user, venueVersion } from '../../src/server/db/schema.js';
import { newWall, type Scene } from '../../src/shared/layout.js';
import { AUDIENCE_FLOOR_ID, newPlatform } from '../../src/shared/levels.js';
import { newOverheadBox } from '../../src/shared/overhead.js';
import { newKeepClearZone } from '../../src/shared/keepClear.js';
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
  assert.equal(login.statusCode, 200);
  headers = { cookie: login.cookies.map(value => `${value.name}=${value.value}`).join('; '), origin: fixture.config.APP_ORIGIN };
  base = `/api/workspaces/${fixture.config.WORKSPACE_ID}/scenes`;
});
after(async () => { await app?.close(); await fixture?.dispose(); });

async function loginAs(email: string) {
  const response = await app.inject({
    method: 'POST', url: '/api/auth/sign-in/email',
    headers: { origin: fixture.config.APP_ORIGIN },
    payload: { email, password: testAdministrator.password },
  });
  assert.equal(response.statusCode, 200, response.body);
  return { cookie: response.cookies.map(value => `${value.name}=${value.value}`).join('; '), origin: fixture.config.APP_ORIGIN };
}

test('saving a venue inserts a new version; siblings stay pinned until they apply; freeze stays on the old pin', async () => {
  const created = await app.inject({
    method: 'POST', url: base, headers,
    payload: { productionName: 'Letztes Jahr', venueName: 'Saal', sceneName: 'Altes Gastspiel', width: 8000, depth: 6000 },
  });
  assert.equal(created.statusCode, 201, created.body);
  const lastYear = created.json<Scene>();
  assert.equal(lastYear.venueUpdateAvailable, false);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/${lastYear.id}/lease`, headers })).statusCode, 200);
  const platform = newPlatform(randomUUID(), 4000, 4750);
  assert.equal((await app.inject({
    method: 'PUT', url: `${base}/${lastYear.id}/venue`, headers,
    payload: { venue: { ...lastYear.venue, ceilingHeight: 8000, platforms: [platform] } },
  })).statusCode, 200);
  const pinnedA = (await app.inject({ url: `${base}/${lastYear.id}`, headers })).json<Scene>();
  assert.notEqual(pinnedA.venueVersionId, lastYear.venueVersionId);
  assert.equal(pinnedA.venue.ceilingHeight, 8000);
  const onPlatform = { ...newWall(randomUUID(), 4000, 4800), supportingSurfaceId: platform.id };
  const crossing = { ...newWall(randomUUID(), 4000, 4750), height: 2800, label: 'Bühnenwand' };
  assert.equal((await app.inject({
    method: 'PUT', url: `${base}/${lastYear.id}/layout`, headers,
    payload: { revision: pinnedA.revision, layout: { schemaVersion: 1, walls: [onPlatform, crossing], braces: [] } },
  })).statusCode, 200);
  const dest = (await app.inject({
    method: 'POST', url: base, headers,
    payload: { productionName: 'Dieses Jahr', venueName: 'Lager', sceneName: 'Leer', width: 8000, depth: 6000 },
  })).json<Scene>();
  const current = (await app.inject({ url: `${base}/${lastYear.id}`, headers })).json<Scene>();
  const copied = await app.inject({
    method: 'POST', url: `${base}/${lastYear.id}/copy`, headers,
    payload: {
      productionId: dest.productionId, venueVersionId: current.venueVersionId,
      surfaceMap: { [platform.id]: platform.id },
    },
  });
  assert.equal(copied.statusCode, 201, copied.body);
  const sibling = copied.json<Scene>();
  assert.equal(sibling.venueVersionId, current.venueVersionId);
  assert.equal(sibling.venue.ceilingHeight, 8000);
  assert.equal(sibling.venueUpdateAvailable, false);
  const frozen = await app.inject({ method: 'POST', url: `${base}/${lastYear.id}/exports`, headers, payload: { name: 'Vor der Decke' } });
  assert.equal(frozen.statusCode, 201, frozen.body);
  const original = Buffer.from((await app.inject({ url: `${base}/${lastYear.id}/exports/${frozen.json().id}/file`, headers })).rawPayload);
  const box = { ...newOverheadBox(randomUUID(), 4000, 4750), label: 'Lüftung' };
  const zone = { ...newKeepClearZone(randomUUID(), AUDIENCE_FLOOR_ID, 4000, 4750), label: 'Notausgang Ost' };
  const saved = await app.inject({
    method: 'PUT', url: `${base}/${lastYear.id}/venue`, headers,
    payload: { venue: { schemaVersion: 1, width: 8000, depth: 6000, ceilingHeight: 2000, overheadBoxes: [box], keepClearZones: [zone] } },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const issuer = (await app.inject({ url: `${base}/${lastYear.id}`, headers })).json<Scene>();
  assert.notEqual(issuer.venueVersionId, current.venueVersionId);
  assert.equal(issuer.venue.ceilingHeight, 2000);
  assert.equal(issuer.venueUpdateAvailable, false);
  assert.equal(issuer.layout.walls[0]?.supportingSurfaceId, undefined);
  const [oldRow] = await fixture.db.select().from(venueVersion).where(eq(venueVersion.id, current.venueVersionId));
  assert.equal(oldRow?.geometry.ceilingHeight, 8000);
  assert.equal(oldRow?.geometry.platforms?.[0]?.id, platform.id);
  const listing = (await app.inject({ url: base, headers })).json<Array<{ id: string; venueVersionId: string; venueUpdateAvailable: boolean }>>();
  const listedSibling = listing.find(item => item.id === sibling.id);
  assert.equal(listedSibling?.venueVersionId, current.venueVersionId);
  assert.equal(listedSibling?.venueUpdateAvailable, true);
  const stillPinned = (await app.inject({ url: `${base}/${sibling.id}`, headers })).json<Scene>();
  assert.equal(stillPinned.venueVersionId, current.venueVersionId);
  assert.equal(stillPinned.venue.ceilingHeight, 8000);
  assert.equal(stillPinned.venue.platforms?.[0]?.id, platform.id);
  assert.equal(stillPinned.venueUpdateAvailable, true);
  assert.equal(stillPinned.layout.walls[0]?.supportingSurfaceId, platform.id);
  assert.equal(stillPinned.layout.walls[1]?.supportingSurfaceId, AUDIENCE_FLOOR_ID);
  const afterSave = Buffer.from((await app.inject({ url: `${base}/${lastYear.id}/exports/${frozen.json().id}/file`, headers })).rawPayload);
  assert.deepEqual(afterSave, original);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/${sibling.id}/venue-apply`, headers, payload: {} })).statusCode, 423);
  const failed = (await app.inject({ url: `${base}/${sibling.id}`, headers })).json<Scene>();
  assert.equal(failed.venueVersionId, current.venueVersionId);
  assert.equal(failed.venue.ceilingHeight, 8000);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/${sibling.id}/lease`, headers })).statusCode, 200);
  const applied = await app.inject({ method: 'POST', url: `${base}/${sibling.id}/venue-apply`, headers, payload: {} });
  assert.equal(applied.statusCode, 200, applied.body);
  const result = applied.json<Scene & { unresolvedSupport: { kind: string; objectId: string }[]; warnings: { kind: string; objectId: string }[]; unresolvedWarnings: { kind: string; objectId: string }[] }>();
  assert.equal(result.venueVersionId, issuer.venueVersionId);
  assert.equal(result.venue.ceilingHeight, 2000);
  assert.equal(result.venueUpdateAvailable, false);
  assert.equal(result.layout.walls[0]?.supportingSurfaceId, undefined);
  assert.equal(result.unresolvedSupport.some(item => item.objectId === result.layout.walls[0]?.id && item.kind === 'missing-surface'), true);
  assert.equal(result.warnings.some(item => item.kind === 'ceiling' && item.objectId === result.layout.walls[1]?.id), true);
  assert.equal(result.warnings.some(item => item.kind === 'overhead' && item.objectId === result.layout.walls[1]?.id), true);
  assert.equal(result.unresolvedWarnings.some(item => item.kind === 'keep-clear-overlap' && item.objectId === result.layout.walls[1]?.id), true);
  const afterApply = Buffer.from((await app.inject({ url: `${base}/${lastYear.id}/exports/${frozen.json().id}/file`, headers })).rawPayload);
  assert.deepEqual(afterApply, original);
});

test('viewer cannot save or apply a venue version', async () => {
  const created = await app.inject({
    method: 'POST', url: base, headers,
    payload: { productionName: 'Viewerfassung', venueName: 'Viewersaal', sceneName: 'Szene', width: 8000, depth: 6000 },
  });
  assert.equal(created.statusCode, 201, created.body);
  const scene = created.json<Scene>();
  const viewerId = randomUUID();
  await fixture.db.insert(user).values({ id: viewerId, name: 'Vera Viewer', email: 'vera-venue@example.test' });
  await fixture.db.insert(account).values({
    id: randomUUID(), userId: viewerId, accountId: viewerId, providerId: 'credential',
    password: await hashPassword(testAdministrator.password),
  });
  await fixture.db.insert(membership).values({ workspaceId: fixture.config.WORKSPACE_ID, userId: viewerId, role: 'viewer' });
  const viewer = await loginAs('vera-venue@example.test');
  assert.equal((await app.inject({
    method: 'PUT', url: `${base}/${scene.id}/venue`, headers: viewer,
    payload: { venue: { schemaVersion: 1, width: 8000, depth: 6000, ceilingHeight: 2000 } },
  })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/${scene.id}/venue-apply`, headers: viewer, payload: {} })).statusCode, 403);
  const loaded = (await app.inject({ url: `${base}/${scene.id}`, headers })).json<Scene>();
  assert.equal(loaded.venueVersionId, scene.venueVersionId);
  assert.equal(loaded.venue.ceilingHeight, undefined);
});
