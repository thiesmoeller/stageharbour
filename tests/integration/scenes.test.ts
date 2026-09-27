import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import { createApp } from '../../src/server/app.js';
import { bootstrapAdministrator } from '../../src/server/identity/bootstrap.js';
import { account, membership, user, workspace } from '../../src/server/db/schema.js';
import { recordConnection } from '../../src/shared/assembly.js';
import { formGroup } from '../../src/shared/groups.js';
import { inventoryWarnings } from '../../src/shared/inventory.js';
import { newWall, type Layout, type Scene } from '../../src/shared/layout.js';
import { AUDIENCE_FLOOR_ID } from '../../src/shared/levels.js';
import { newKeepClearZone } from '../../src/shared/keepClear.js';
import { newOverheadBox } from '../../src/shared/overhead.js';
import { testAdministrator, testDatabase } from '../helpers/database.js';

let fixture: Awaited<ReturnType<typeof testDatabase>>;
let app: Awaited<ReturnType<typeof createApp>>;
let headers: { cookie: string; origin: string };
let base: string;
let source: Scene;
const panelId = '11111111-1111-4111-8111-111111111111';
const input = { productionName: 'Doppelproduktion', venueName: 'Doppelsaal', sceneName: 'Erste Szene', width: 8000, depth: 6000 };

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

test('duplicating a scene in a production yields a new scene with the same physical panels', async () => {
  const created = await app.inject({ method: 'POST', url: base, headers, payload: input });
  assert.equal(created.statusCode, 201, created.body);
  source = created.json();
  const left = { ...newWall(randomUUID(), 1000, 2000), panelId, assemblyNumber: 1 };
  const right = { ...newWall(randomUUID(), 5000, 2000), assemblyNumber: 2 };
  const sourceLayout: Layout = {
    schemaVersion: 1, walls: [left, right], braces: [],
    riggingNotes: 'Stifte belassen.', riggingSetupId: randomUUID(),
  };
  const layout = recordConnection(
    formGroup(sourceLayout, [{ kind: 'wall', id: left.id }, { kind: 'wall', id: right.id }], randomUUID()),
    left.id, right.id,
  );
  assert.equal((await app.inject({ method: 'POST', url: `${base}/${source.id}/lease`, headers })).statusCode, 200);
  assert.equal((await app.inject({
    method: 'PUT', url: `${base}/${source.id}/layout`, headers,
    payload: { revision: 0, layout },
  })).statusCode, 200);
  source = (await app.inject({ url: `${base}/${source.id}`, headers })).json<Scene>();
  const duplicated = await app.inject({ method: 'POST', url: `${base}/${source.id}/duplicate`, headers, payload: {} });
  assert.equal(duplicated.statusCode, 201, duplicated.body);
  const copy = duplicated.json<Scene>();
  assert.notEqual(copy.id, source.id);
  assert.equal(copy.productionName, source.productionName);
  assert.equal(copy.venueName, source.venueName);
  assert.equal(copy.venueVersionId, source.venueVersionId);
  assert.equal(copy.name, 'Erste Szene (Kopie)');
  assert.equal(copy.revision, 0);
  assert.equal(copy.lease, null);
  assert.notEqual(copy.layout.walls[0]?.id, source.layout.walls[0]?.id);
  assert.equal(copy.layout.walls[0]?.panelId, panelId);
  assert.equal(copy.layout.walls[0]?.assemblyNumber, 1);
  assert.equal(copy.layout.walls[0]?.x, 1000);
  const copyIds = new Set(copy.layout.walls.map(wall => wall.id));
  assert.equal(copy.layout.groups?.[0]?.members.every(member => copyIds.has(member.id)), true);
  assert.equal(copy.layout.riggingSetupId, source.layout.riggingSetupId);
  assert.equal(copy.layout.riggingNotes, 'Stifte belassen.');
  assert.equal(inventoryWarnings(source.layout, []).some(item => item.kind === 'duplicate'), false);
  assert.equal(inventoryWarnings(copy.layout, []).some(item => item.kind === 'duplicate'), false);
  const listing = (await app.inject({ url: base, headers })).json<Array<{ id: string; name: string; productionName: string }>>();
  assert.equal(listing.filter(item => item.productionName === input.productionName).length, 2);
});

test('duplicating reads the source without a lease; freeze stays put after editing the copy', async () => {
  await app.inject({ method: 'POST', url: `${base}/${source.id}/lease/release`, headers });
  const frozen = await app.inject({ method: 'POST', url: `${base}/${source.id}/exports`, headers, payload: { name: 'Vor der Kopie' } });
  assert.equal(frozen.statusCode, 201, frozen.body);
  const original = Buffer.from((await app.inject({ url: `${base}/${source.id}/exports/${frozen.json().id}/file`, headers })).rawPayload);
  const editorId = randomUUID();
  await fixture.db.insert(user).values({ id: editorId, name: 'Zweite Bearbeitung', email: 'editor-dup@example.test' });
  await fixture.db.insert(account).values({
    id: randomUUID(), userId: editorId, accountId: editorId, providerId: 'credential',
    password: await hashPassword(testAdministrator.password),
  });
  await fixture.db.insert(membership).values({ workspaceId: fixture.config.WORKSPACE_ID, userId: editorId, role: 'editor' });
  const other = await loginAs('editor-dup@example.test');
  assert.equal((await app.inject({ method: 'POST', url: `${base}/${source.id}/lease`, headers: other })).statusCode, 200);
  const duplicated = await app.inject({ method: 'POST', url: `${base}/${source.id}/duplicate`, headers, payload: {} });
  assert.equal(duplicated.statusCode, 201, duplicated.body);
  const copy = duplicated.json<Scene>();
  assert.equal(copy.lease, null);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/${copy.id}/lease`, headers })).statusCode, 200);
  const moved = {
    ...copy.layout,
    walls: copy.layout.walls.map((wall, index) => index === 0 ? { ...wall, x: 1800 } : wall),
  };
  assert.equal((await app.inject({
    method: 'PUT', url: `${base}/${copy.id}/layout`, headers,
    payload: { revision: 0, layout: moved },
  })).statusCode, 200);
  const reloadedSource = (await app.inject({ url: `${base}/${source.id}`, headers })).json<Scene>();
  assert.equal(reloadedSource.layout.walls[0]?.x, 1000);
  assert.equal(reloadedSource.layout.walls[0]?.panelId, panelId);
  const reloadedCopy = (await app.inject({ url: `${base}/${copy.id}`, headers })).json<Scene>();
  assert.equal(reloadedCopy.layout.walls[0]?.x, 1800);
  assert.equal(reloadedCopy.layout.walls[0]?.panelId, panelId);
  const again = Buffer.from((await app.inject({ url: `${base}/${source.id}/exports/${frozen.json().id}/file`, headers })).rawPayload);
  assert.deepEqual(again, original);
});

test('viewer cannot duplicate; foreign workspace is hidden', async () => {
  const foreignId = randomUUID();
  await fixture.db.insert(workspace).values({ id: foreignId, name: 'Other workspace' });
  const [member] = await fixture.db.select().from(membership).where(eq(membership.workspaceId, fixture.config.WORKSPACE_ID));
  await fixture.db.insert(membership).values({ workspaceId: foreignId, userId: member!.userId, role: 'editor' });
  assert.equal((await app.inject({ method: 'POST', url: `/api/workspaces/${foreignId}/scenes/${source.id}/duplicate`, headers, payload: {} })).statusCode, 404);
  const viewerId = randomUUID();
  await fixture.db.insert(user).values({ id: viewerId, name: 'Vera Viewer', email: 'vera-dup@example.test' });
  await fixture.db.insert(account).values({
    id: randomUUID(), userId: viewerId, accountId: viewerId, providerId: 'credential',
    password: await hashPassword(testAdministrator.password),
  });
  await fixture.db.insert(membership).values({ workspaceId: fixture.config.WORKSPACE_ID, userId: viewerId, role: 'viewer' });
  const viewer = await loginAs('vera-dup@example.test');
  assert.equal((await app.inject({ method: 'POST', url: `${base}/${source.id}/duplicate`, headers: viewer, payload: {} })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/${source.id}/duplicate`, headers: { origin: fixture.config.APP_ORIGIN }, payload: {} })).statusCode, 401);
});

test('copying a scene into another production uses the destination venue and clears panel assignments', async () => {
  const destInput = { productionName: 'Gastspiel', venueName: 'Stadthalle', sceneName: 'Leere Gastszene', width: 8000, depth: 6000 };
  const destCreated = await app.inject({ method: 'POST', url: base, headers, payload: destInput });
  assert.equal(destCreated.statusCode, 201, destCreated.body);
  const dest = destCreated.json<Scene>();
  assert.equal((await app.inject({ method: 'POST', url: `${base}/${dest.id}/lease`, headers })).statusCode, 200);
  const zone = { ...newKeepClearZone(randomUUID(), AUDIENCE_FLOOR_ID, 1000, 2000), label: 'Notausgang Ost' };
  const box = { ...newOverheadBox(randomUUID(), 1000, 2000), label: 'Lüftung', bottomHeight: 1800 };
  assert.equal((await app.inject({
    method: 'PUT', url: `${base}/${dest.id}/venue`, headers,
    payload: { venue: { ...dest.venue, ceilingHeight: 2000, keepClearZones: [zone], overheadBoxes: [box] } },
  })).statusCode, 200);
  const destPinned = (await app.inject({ url: `${base}/${dest.id}`, headers })).json<Scene>();
  const copied = await app.inject({
    method: 'POST', url: `${base}/${source.id}/copy`, headers,
    payload: { productionId: dest.productionId, venueVersionId: destPinned.venueVersionId },
  });
  assert.equal(copied.statusCode, 201, copied.body);
  const copy = copied.json<Scene>();
  assert.notEqual(copy.id, source.id);
  assert.notEqual(copy.id, dest.id);
  assert.equal(copy.productionName, 'Gastspiel');
  assert.equal(copy.venueName, 'Stadthalle');
  assert.equal(copy.productionId, dest.productionId);
  assert.equal(copy.venueVersionId, destPinned.venueVersionId);
  assert.equal(copy.lease, null);
  assert.equal(copy.layout.walls[0]?.panelId, undefined);
  assert.equal(copy.layout.walls[0]?.x, 1000);
  assert.equal(copy.layout.walls[0]?.assemblyNumber, 1);
  assert.notEqual(copy.layout.walls[0]?.id, source.layout.walls[0]?.id);
  const copyIds = new Set(copy.layout.walls.map(wall => wall.id));
  assert.equal(copy.layout.groups?.[0]?.members.every(member => copyIds.has(member.id)), true);
  assert.equal(copy.venue.ceilingHeight, 2000);
  assert.equal(copy.venue.keepClearZones?.[0]?.label, 'Notausgang Ost');
  assert.equal(copy.venue.overheadBoxes?.[0]?.label, 'Lüftung');
  assert.equal((await app.inject({ method: 'POST', url: `${base}/${copy.id}/lease`, headers })).statusCode, 200);
  const saved = await app.inject({
    method: 'PUT', url: `${base}/${copy.id}/layout`, headers,
    payload: { revision: 0, layout: copy.layout },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const warnings = saved.json().warnings as { kind: string; message: string }[];
  assert.equal(warnings.some(item => item.kind === 'ceiling'), true);
  assert.equal(warnings.some(item => item.kind === 'overhead'), true);
  assert.equal(warnings.some(item => item.kind === 'keep-clear-overlap'), true);
  const reloadedSource = (await app.inject({ url: `${base}/${source.id}`, headers })).json<Scene>();
  assert.equal(reloadedSource.layout.walls[0]?.panelId, panelId);
  assert.equal(reloadedSource.productionName, input.productionName);
});

test('copying reads the source without a lease; freeze stays put after editing the copy', async () => {
  const frozen = await app.inject({ method: 'POST', url: `${base}/${source.id}/exports`, headers, payload: { name: 'Vor der Anpassung' } });
  assert.equal(frozen.statusCode, 201, frozen.body);
  const original = Buffer.from((await app.inject({ url: `${base}/${source.id}/exports/${frozen.json().id}/file`, headers })).rawPayload);
  const destInput = { productionName: 'Zweitproduktion', venueName: 'Zweitsaal', sceneName: 'Leere Szene', width: 8000, depth: 6000 };
  const dest = (await app.inject({ method: 'POST', url: base, headers, payload: destInput })).json<Scene>();
  const copied = await app.inject({
    method: 'POST', url: `${base}/${source.id}/copy`, headers,
    payload: { productionId: dest.productionId, venueVersionId: dest.venueVersionId },
  });
  assert.equal(copied.statusCode, 201, copied.body);
  const copy = copied.json<Scene>();
  assert.equal(copy.lease, null);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/${copy.id}/lease`, headers })).statusCode, 200);
  const moved = {
    ...copy.layout,
    walls: copy.layout.walls.map((wall, index) => index === 0 ? { ...wall, x: 2100 } : wall),
  };
  assert.equal((await app.inject({
    method: 'PUT', url: `${base}/${copy.id}/layout`, headers,
    payload: { revision: 0, layout: moved },
  })).statusCode, 200);
  const reloadedSource = (await app.inject({ url: `${base}/${source.id}`, headers })).json<Scene>();
  assert.equal(reloadedSource.layout.walls[0]?.x, 1000);
  assert.equal(reloadedSource.layout.walls[0]?.panelId, panelId);
  const reloadedCopy = (await app.inject({ url: `${base}/${copy.id}`, headers })).json<Scene>();
  assert.equal(reloadedCopy.layout.walls[0]?.x, 2100);
  assert.equal(reloadedCopy.layout.walls[0]?.panelId, undefined);
  const again = Buffer.from((await app.inject({ url: `${base}/${source.id}/exports/${frozen.json().id}/file`, headers })).rawPayload);
  assert.deepEqual(again, original);
});

test('creating a blank scene on an existing production reuses adaptation and starts empty', async () => {
  const created = await app.inject({
    method: 'POST', url: base, headers,
    payload: { productionName: 'Leerproduktion', venueName: 'Leersaal', sceneName: 'Erste Szene', width: 8000, depth: 6000 },
  });
  assert.equal(created.statusCode, 201, created.body);
  const first = created.json<Scene>();
  assert.equal((await app.inject({ method: 'POST', url: `${base}/${first.id}/lease`, headers })).statusCode, 200);
  assert.equal((await app.inject({
    method: 'PUT', url: `${base}/${first.id}/layout`, headers,
    payload: { revision: 0, layout: { schemaVersion: 1, walls: [newWall(randomUUID(), 1000, 2000)], braces: [] } },
  })).statusCode, 200);
  await app.inject({ method: 'POST', url: `${base}/${first.id}/lease/release`, headers });

  const blank = await app.inject({
    method: 'POST', url: base, headers,
    payload: { productionId: first.productionId, venueVersionId: first.venueVersionId, sceneName: 'Zweite Szene' },
  });
  assert.equal(blank.statusCode, 201, blank.body);
  const second = blank.json<Scene>();
  assert.notEqual(second.id, first.id);
  assert.equal(second.productionId, first.productionId);
  assert.equal(second.productionName, 'Leerproduktion');
  assert.equal(second.venueVersionId, first.venueVersionId);
  assert.equal(second.venueName, 'Leersaal');
  assert.equal(second.name, 'Zweite Szene');
  assert.equal(second.revision, 0);
  assert.equal(second.lease, null);
  assert.deepEqual(second.layout.walls, []);
  assert.deepEqual(second.layout.braces, []);
  assert.equal((await app.inject({
    method: 'POST', url: base, headers,
    payload: { productionId: first.productionId, venueVersionId: randomUUID(), sceneName: 'Fehlt' },
  })).statusCode, 404);
  assert.equal((await app.inject({
    method: 'POST', url: base, headers,
    payload: { productionId: randomUUID(), venueVersionId: first.venueVersionId, sceneName: 'Fehlt' },
  })).statusCode, 404);
});

test('viewer cannot copy across productions; foreign workspace is hidden', async () => {
  const dest = (await app.inject({
    method: 'POST', url: base, headers,
    payload: { productionName: 'Fremdproduktion', venueName: 'Fremdsaal', sceneName: 'Szene', width: 8000, depth: 6000 },
  })).json<Scene>();
  const payload = { productionId: dest.productionId, venueVersionId: dest.venueVersionId };
  const foreignId = randomUUID();
  await fixture.db.insert(workspace).values({ id: foreignId, name: 'Other workspace copy' });
  const [member] = await fixture.db.select().from(membership).where(eq(membership.workspaceId, fixture.config.WORKSPACE_ID));
  await fixture.db.insert(membership).values({ workspaceId: foreignId, userId: member!.userId, role: 'editor' });
  assert.equal((await app.inject({ method: 'POST', url: `/api/workspaces/${foreignId}/scenes/${source.id}/copy`, headers, payload })).statusCode, 404);
  const viewerId = randomUUID();
  await fixture.db.insert(user).values({ id: viewerId, name: 'Vera Viewer', email: 'vera-copy@example.test' });
  await fixture.db.insert(account).values({
    id: randomUUID(), userId: viewerId, accountId: viewerId, providerId: 'credential',
    password: await hashPassword(testAdministrator.password),
  });
  await fixture.db.insert(membership).values({ workspaceId: fixture.config.WORKSPACE_ID, userId: viewerId, role: 'viewer' });
  const viewer = await loginAs('vera-copy@example.test');
  assert.equal((await app.inject({ method: 'POST', url: `${base}/${source.id}/copy`, headers: viewer, payload })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/${source.id}/copy`, headers: { origin: fixture.config.APP_ORIGIN }, payload })).statusCode, 401);
});

test('renames a duplicated scene and its production', async () => {
  const created = await app.inject({
    method: 'POST', url: base, headers,
    payload: { productionName: 'Umbenennproduktion', venueName: 'Umbenennsaal', sceneName: 'Ursprung', width: 8000, depth: 6000 },
  });
  assert.equal(created.statusCode, 201, created.body);
  const origin = created.json<Scene>();
  const duplicated = await app.inject({ method: 'POST', url: `${base}/${origin.id}/duplicate`, headers, payload: {} });
  assert.equal(duplicated.statusCode, 201, duplicated.body);
  const copy = duplicated.json<Scene>();
  assert.equal(copy.name, 'Ursprung (Kopie)');
  const renamed = await app.inject({
    method: 'PATCH', url: `${base}/${copy.id}`, headers, payload: { name: 'Zweite Fassung' },
  });
  assert.equal(renamed.statusCode, 200, renamed.body);
  assert.equal(renamed.json().name, 'Zweite Fassung');
  assert.equal(renamed.json().revision, 0);
  assert.equal((await app.inject({ url: `${base}/${copy.id}`, headers })).json<Scene>().name, 'Zweite Fassung');
  assert.equal((await app.inject({
    method: 'PATCH', url: `${base}/${copy.id}`, headers, payload: { name: '   ' },
  })).statusCode, 400);
  const production = await app.inject({
    method: 'PATCH', url: `/api/workspaces/${fixture.config.WORKSPACE_ID}/productions/${origin.productionId}`,
    headers, payload: { name: 'Umbenanntes Stück' },
  });
  assert.equal(production.statusCode, 200, production.body);
  assert.equal(production.json().name, 'Umbenanntes Stück');
  assert.equal((await app.inject({ url: `${base}/${origin.id}`, headers })).json<Scene>().productionName, 'Umbenanntes Stück');
  assert.equal((await app.inject({ url: `${base}/${copy.id}`, headers })).json<Scene>().productionName, 'Umbenanntes Stück');
});
