import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import { createApp } from '../../src/server/app.js';
import { bootstrapAdministrator } from '../../src/server/identity/bootstrap.js';
import { account, membership, user, workspace } from '../../src/server/db/schema.js';
import { formGroup } from '../../src/shared/groups.js';
import { newWall, type Layout, type Scene, type SceneTemplate } from '../../src/shared/layout.js';
import { AUDIENCE_FLOOR_ID } from '../../src/shared/levels.js';
import { newKeepClearZone } from '../../src/shared/keepClear.js';
import { newOverheadBox } from '../../src/shared/overhead.js';
import { newOpening, newWallType } from '../../src/shared/wall-types.js';
import { testAdministrator, testDatabase } from '../helpers/database.js';

let fixture: Awaited<ReturnType<typeof testDatabase>>;
let app: Awaited<ReturnType<typeof createApp>>;
let headers: { cookie: string; origin: string };
let scenes: string;
let templates: string;
let source: Scene;
const panelId = '11111111-1111-4111-8111-111111111111';
const openingId = '22222222-2222-4222-8222-222222222222';
const typeId = '33333333-3333-4333-8333-333333333333';

before(async () => {
  fixture = await testDatabase();
  await bootstrapAdministrator(fixture.db, fixture.config, testAdministrator);
  app = await createApp(fixture.db, fixture.config);
  const login = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: testAdministrator });
  assert.equal(login.statusCode, 200);
  headers = { cookie: login.cookies.map(value => `${value.name}=${value.value}`).join('; '), origin: fixture.config.APP_ORIGIN };
  scenes = `/api/workspaces/${fixture.config.WORKSPACE_ID}/scenes`;
  templates = `/api/workspaces/${fixture.config.WORKSPACE_ID}/scene-templates`;
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

function sourcedLayout(): Layout {
  const type = { ...newWallType(typeId), name: 'Türwand', openings: [{ ...newOpening(openingId), width: 800 }] };
  const left = { ...newWall(randomUUID(), 1000, 2000), panelId, assemblyNumber: 1, typeId };
  const right = { ...newWall(randomUUID(), 5000, 2000), typeId };
  return formGroup(
    { schemaVersion: 1, wallTypes: [type], walls: [left, right], braces: [] },
    [{ kind: 'wall', id: left.id }, { kind: 'wall', id: right.id }],
    randomUUID(),
  );
}

test('capturing a named scene template clones layout including wall types', async () => {
  const created = await app.inject({
    method: 'POST', url: scenes, headers,
    payload: { productionName: 'Vorlagenproduktion', venueName: 'Vorlagensaal', sceneName: 'Quelle', width: 8000, depth: 6000 },
  });
  assert.equal(created.statusCode, 201, created.body);
  source = created.json();
  const layout = sourcedLayout();
  assert.equal((await app.inject({ method: 'POST', url: `${scenes}/${source.id}/lease`, headers })).statusCode, 200);
  assert.equal((await app.inject({
    method: 'PUT', url: `${scenes}/${source.id}/layout`, headers,
    payload: { revision: 0, layout },
  })).statusCode, 200);
  source = (await app.inject({ url: `${scenes}/${source.id}`, headers })).json<Scene>();
  const captured = await app.inject({
    method: 'POST', url: `${scenes}/${source.id}/templates`, headers,
    payload: { name: 'Grundriss A' },
  });
  assert.equal(captured.statusCode, 201, captured.body);
  const template = captured.json<SceneTemplate>();
  assert.equal(template.name, 'Grundriss A');
  assert.equal(template.layout.walls[0]?.panelId, panelId);
  assert.equal(template.layout.walls[0]?.x, 1000);
  assert.equal(template.layout.wallTypes?.[0]?.openings[0]?.width, 800);
  assert.equal(template.layout.groups?.[0]?.members.length, 2);
  const listing = (await app.inject({ url: templates, headers })).json<Array<{ id: string; name: string }>>();
  assert.equal(listing.some(item => item.id === template.id && item.name === 'Grundriss A'), true);
});

test('renames a scene template', async () => {
  const captured = await app.inject({
    method: 'POST', url: `${scenes}/${source.id}/templates`, headers,
    payload: { name: 'Umbenennvorlage' },
  });
  assert.equal(captured.statusCode, 201, captured.body);
  const template = captured.json<SceneTemplate>();
  const renamed = await app.inject({
    method: 'PATCH', url: `${templates}/${template.id}`, headers, payload: { name: 'Umbenennvorlage korrigiert' },
  });
  assert.equal(renamed.statusCode, 200, renamed.body);
  assert.equal(renamed.json().name, 'Umbenennvorlage korrigiert');
  assert.equal((await app.inject({ url: `${templates}/${template.id}`, headers })).json().name, 'Umbenennvorlage korrigiert');
  assert.equal((await app.inject({
    method: 'PATCH', url: `${templates}/${template.id}`, headers, payload: { name: '  ' },
  })).statusCode, 400);
});

test('source layout PUT after capture leaves the stored template unchanged', async () => {
  const loaded = (await app.inject({ url: `${templates}/${(await app.inject({ url: templates, headers })).json<Array<{ id: string }>>()[0]!.id}`, headers })).json<SceneTemplate>();
  const edited: Layout = {
    ...source.layout,
    walls: source.layout.walls.map((wall, index) => index === 0 ? { ...wall, x: 1800 } : wall),
    wallTypes: source.layout.wallTypes?.map(type => ({
      ...type, width: 900, openings: type.openings.map(opening => ({ ...opening, width: 400 })),
    })),
  };
  assert.equal((await app.inject({
    method: 'PUT', url: `${scenes}/${source.id}/layout`, headers,
    payload: { revision: source.revision, layout: edited },
  })).statusCode, 200);
  const after = (await app.inject({ url: `${templates}/${loaded.id}`, headers })).json<SceneTemplate>();
  assert.equal(after.layout.walls[0]?.x, 1000);
  assert.equal(after.layout.wallTypes?.[0]?.openings[0]?.width, 800);
  assert.equal(after.layout.wallTypes?.[0]?.width, 1200);
  source = (await app.inject({ url: `${scenes}/${source.id}`, headers })).json<Scene>();
  assert.equal(source.layout.walls[0]?.x, 1800);
  assert.equal(source.layout.wallTypes?.[0]?.openings[0]?.width, 400);
});

test('instantiating a template into a production uses the destination venue and clears panel assignments', async () => {
  const destCreated = await app.inject({
    method: 'POST', url: scenes, headers,
    payload: { productionName: 'Gastspiel', venueName: 'Stadthalle', sceneName: 'Leere Gastszene', width: 8000, depth: 6000 },
  });
  assert.equal(destCreated.statusCode, 201, destCreated.body);
  const dest = destCreated.json<Scene>();
  assert.equal((await app.inject({ method: 'POST', url: `${scenes}/${dest.id}/lease`, headers })).statusCode, 200);
  const zone = { ...newKeepClearZone(randomUUID(), AUDIENCE_FLOOR_ID, 1000, 2000), label: 'Notausgang Ost' };
  const box = { ...newOverheadBox(randomUUID(), 1000, 2000), label: 'Lüftung', bottomHeight: 1800 };
  assert.equal((await app.inject({
    method: 'PUT', url: `${scenes}/${dest.id}/venue`, headers,
    payload: { venue: { ...dest.venue, ceilingHeight: 2000, keepClearZones: [zone], overheadBoxes: [box] } },
  })).statusCode, 200);
  const destPinned = (await app.inject({ url: `${scenes}/${dest.id}`, headers })).json<Scene>();
  const [template] = (await app.inject({ url: templates, headers })).json<Array<{ id: string }>>();
  const instantiated = await app.inject({
    method: 'POST', url: `${templates}/${template!.id}/instantiate`, headers,
    payload: { productionId: dest.productionId, venueVersionId: destPinned.venueVersionId, sceneName: 'Aus Vorlage' },
  });
  assert.equal(instantiated.statusCode, 201, instantiated.body);
  const copy = instantiated.json<Scene>();
  assert.notEqual(copy.id, source.id);
  assert.equal(copy.productionName, 'Gastspiel');
  assert.equal(copy.venueName, 'Stadthalle');
  assert.equal(copy.productionId, dest.productionId);
  assert.equal(copy.venueVersionId, destPinned.venueVersionId);
  assert.equal(copy.name, 'Aus Vorlage');
  assert.equal(copy.revision, 0);
  assert.equal(copy.lease, null);
  assert.equal(copy.layout.walls[0]?.panelId, undefined);
  assert.equal(copy.layout.walls[0]?.x, 1000);
  assert.equal(copy.layout.wallTypes?.[0]?.openings[0]?.width, 800);
  assert.equal(copy.venue.ceilingHeight, 2000);
  assert.equal((await app.inject({ method: 'POST', url: `${scenes}/${copy.id}/lease`, headers })).statusCode, 200);
  const moved = {
    ...copy.layout,
    walls: copy.layout.walls.map((wall, index) => index === 0 ? { ...wall, x: 2100 } : wall),
  };
  assert.equal((await app.inject({
    method: 'PUT', url: `${scenes}/${copy.id}/layout`, headers,
    payload: { revision: 0, layout: moved },
  })).statusCode, 200);
  const reloadedTemplate = (await app.inject({ url: `${templates}/${template!.id}`, headers })).json<SceneTemplate>();
  assert.equal(reloadedTemplate.layout.walls[0]?.x, 1000);
  assert.equal(reloadedTemplate.layout.walls[0]?.panelId, panelId);
  assert.equal(reloadedTemplate.layout.wallTypes?.[0]?.openings[0]?.width, 800);
  const reloadedCopy = (await app.inject({ url: `${scenes}/${copy.id}`, headers })).json<Scene>();
  assert.equal(reloadedCopy.layout.walls[0]?.x, 2100);
  assert.equal(reloadedCopy.layout.walls[0]?.panelId, undefined);
});

test('capturing reads the source without a lease', async () => {
  await app.inject({ method: 'POST', url: `${scenes}/${source.id}/lease/release`, headers });
  const editorId = randomUUID();
  await fixture.db.insert(user).values({ id: editorId, name: 'Zweite Bearbeitung', email: 'editor-template@example.test' });
  await fixture.db.insert(account).values({
    id: randomUUID(), userId: editorId, accountId: editorId, providerId: 'credential',
    password: await hashPassword(testAdministrator.password),
  });
  await fixture.db.insert(membership).values({ workspaceId: fixture.config.WORKSPACE_ID, userId: editorId, role: 'editor' });
  const other = await loginAs('editor-template@example.test');
  assert.equal((await app.inject({ method: 'POST', url: `${scenes}/${source.id}/lease`, headers: other })).statusCode, 200);
  const captured = await app.inject({
    method: 'POST', url: `${scenes}/${source.id}/templates`, headers,
    payload: { name: 'Ohne Pacht' },
  });
  assert.equal(captured.statusCode, 201, captured.body);
  assert.equal(captured.json<SceneTemplate>().name, 'Ohne Pacht');
});

test('viewer cannot capture or instantiate; foreign workspace is hidden', async () => {
  const [template] = (await app.inject({ url: templates, headers })).json<Array<{ id: string }>>();
  const dest = (await app.inject({
    method: 'POST', url: scenes, headers,
    payload: { productionName: 'Fremdproduktion', venueName: 'Fremdsaal', sceneName: 'Szene', width: 8000, depth: 6000 },
  })).json<Scene>();
  const payload = { productionId: dest.productionId, venueVersionId: dest.venueVersionId };
  const foreignId = randomUUID();
  await fixture.db.insert(workspace).values({ id: foreignId, name: 'Other workspace templates' });
  const [member] = await fixture.db.select().from(membership).where(eq(membership.workspaceId, fixture.config.WORKSPACE_ID));
  await fixture.db.insert(membership).values({ workspaceId: foreignId, userId: member!.userId, role: 'editor' });
  assert.equal((await app.inject({
    method: 'POST', url: `/api/workspaces/${foreignId}/scenes/${source.id}/templates`, headers,
    payload: { name: 'Fremd' },
  })).statusCode, 404);
  assert.equal((await app.inject({
    method: 'POST', url: `/api/workspaces/${foreignId}/scene-templates/${template!.id}/instantiate`, headers, payload,
  })).statusCode, 404);
  assert.equal((await app.inject({ url: `/api/workspaces/${foreignId}/scene-templates/${template!.id}`, headers })).statusCode, 404);
  const viewerId = randomUUID();
  await fixture.db.insert(user).values({ id: viewerId, name: 'Vera Viewer', email: 'vera-template@example.test' });
  await fixture.db.insert(account).values({
    id: randomUUID(), userId: viewerId, accountId: viewerId, providerId: 'credential',
    password: await hashPassword(testAdministrator.password),
  });
  await fixture.db.insert(membership).values({ workspaceId: fixture.config.WORKSPACE_ID, userId: viewerId, role: 'viewer' });
  const viewer = await loginAs('vera-template@example.test');
  assert.equal((await app.inject({
    method: 'POST', url: `${scenes}/${source.id}/templates`, headers: viewer, payload: { name: 'Vera' },
  })).statusCode, 403);
  assert.equal((await app.inject({
    method: 'POST', url: `${templates}/${template!.id}/instantiate`, headers: viewer, payload,
  })).statusCode, 403);
  assert.equal((await app.inject({
    method: 'POST', url: `${scenes}/${source.id}/templates`, headers: { origin: fixture.config.APP_ORIGIN }, payload: { name: 'Anon' },
  })).statusCode, 401);
  const listed = await app.inject({ url: templates, headers: viewer });
  assert.equal(listed.statusCode, 200, listed.body);
  assert.equal(listed.json<Array<{ name: string }>>().some(item => item.name === 'Grundriss A'), true);
});
