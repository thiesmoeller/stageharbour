import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/server/app.js';
import { sceneTemplate as templateTable } from '../../src/server/db/schema.js';
import { bootstrapAdministrator } from '../../src/server/identity/bootstrap.js';
import type { Layout, Scene, SceneTemplate } from '../../src/shared/layout.js';
import { AUDIENCE_FLOOR_ID } from '../../src/shared/levels.js';
import { STARTER_PART_IDS } from '../../src/shared/parts/starter/index.js';
import { testAdministrator, testDatabase } from '../helpers/database.js';

let fixture: Awaited<ReturnType<typeof testDatabase>>;
let app: Awaited<ReturnType<typeof createApp>>;
let headers: { cookie: string; origin: string };
let scenes: string;
let templates: string;
let source: Scene;
let captured: SceneTemplate;

before(async () => {
  fixture = await testDatabase();
  await bootstrapAdministrator(fixture.db, fixture.config, testAdministrator);
  app = await createApp(fixture.db, fixture.config);
  const login = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: testAdministrator });
  assert.equal(login.statusCode, 200);
  headers = {
    cookie: login.cookies.map(value => `${value.name}=${value.value}`).join('; '),
    origin: fixture.config.APP_ORIGIN,
  };
  scenes = `/api/workspaces/${fixture.config.WORKSPACE_ID}/scenes`;
  templates = `/api/workspaces/${fixture.config.WORKSPACE_ID}/scene-templates`;
});
after(async () => { await app?.close(); await fixture?.dispose(); });

test('capture stores a detached v2 object layout and later source edits do not mutate it', async () => {
  source = (await app.inject({
    method: 'POST',
    url: scenes,
    headers,
    payload: {
      productionName: 'Vorlagenproduktion',
      venueName: 'Vorlagensaal',
      sceneName: 'Quelle',
      width: 8000,
      depth: 6000,
    },
  })).json<Scene>();
  const stock = await app.inject({
    method: 'POST',
    url: `/api/workspaces/${fixture.config.WORKSPACE_ID}/stock/items`,
    headers,
    payload: { label: 'T-01', partId: STARTER_PART_IDS.wall, variantKey: 'doorLeft' },
  });
  assert.equal(stock.statusCode, 201, stock.body);
  const stockItemId = stock.json().id as string;
  const first = randomUUID(), second = randomUUID();
  const layout: Layout = {
    schemaVersion: 2,
    objects: [
      {
        id: first, label: 'Türwand',
        part: { id: STARTER_PART_IDS.wall, revision: 1 },
        variant: 'doorLeft',
        values: { B: 1200, H: 2400, D: 28, openingLeft: 200, openingB: 800, openingH: 2000 },
        x: 1000, y: 2000, rotation: 0, support: AUDIENCE_FLOOR_ID,
        stockItemId, assemblyNumber: 1,
      },
      {
        id: second, label: 'Wand',
        part: { id: STARTER_PART_IDS.wall, revision: 1 },
        variant: 'plain',
        x: 5000, y: 2000, rotation: 0, support: AUDIENCE_FLOOR_ID,
      },
    ],
    joints: [],
    groups: [{
      id: randomUUID(),
      members: [{ kind: 'object', id: first }, { kind: 'object', id: second }],
      rotation: 0,
    }],
  };
  assert.equal((await app.inject({ method: 'POST', url: `${scenes}/${source.id}/lease`, headers })).statusCode, 200);
  const saved = await app.inject({
    method: 'PUT',
    url: `${scenes}/${source.id}/layout`,
    headers,
    payload: { revision: 0, layout },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  source = (await app.inject({ url: `${scenes}/${source.id}`, headers })).json<Scene>();

  const response = await app.inject({
    method: 'POST',
    url: `${scenes}/${source.id}/templates`,
    headers,
    payload: { name: 'Grundriss A' },
  });
  assert.equal(response.statusCode, 201, response.body);
  captured = response.json<SceneTemplate>();
  assert.equal(captured.layout.schemaVersion, 2);
  assert.equal(captured.layout.objects[0]?.stockItemId, stockItemId);
  assert.equal(captured.layout.objects[0]?.variant, 'doorLeft');
  assert.equal(captured.layout.groups?.[0]?.members.length, 2);

  const moved = {
    ...source.layout,
    objects: source.layout.objects.map((item, index) => index === 0 ? { ...item, x: 1800 } : item),
  };
  const edited = await app.inject({
    method: 'PUT',
    url: `${scenes}/${source.id}/layout`,
    headers,
    payload: { revision: source.revision, layout: moved },
  });
  assert.equal(edited.statusCode, 200, edited.body);
  const unchanged = (await app.inject({ url: `${templates}/${captured.id}`, headers })).json<SceneTemplate>();
  assert.equal(unchanged.layout.objects[0]?.x, 1000);
});

test('instantiate remaps object identities and clears stock assignments', async () => {
  const destination = (await app.inject({
    method: 'POST',
    url: scenes,
    headers,
    payload: {
      productionName: 'Gastspiel',
      venueName: 'Stadthalle',
      sceneName: 'Leer',
      width: 9000,
      depth: 7000,
    },
  })).json<Scene>();
  const response = await app.inject({
    method: 'POST',
    url: `${templates}/${captured.id}/instantiate`,
    headers,
    payload: {
      productionId: destination.productionId,
      venueVersionId: destination.venueVersionId,
      sceneName: 'Aus Vorlage',
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  const copy = response.json<Scene>();
  assert.equal(copy.name, 'Aus Vorlage');
  assert.equal(copy.layout.objects.length, 2);
  assert.equal(copy.layout.objects.every(item => item.stockItemId === undefined), true);
  assert.notEqual(copy.layout.objects[0]?.id, captured.layout.objects[0]?.id);
  const objectIds = new Set(copy.layout.objects.map(item => item.id));
  assert.equal(copy.layout.groups?.[0]?.members.every(member => objectIds.has(member.id)), true);
});

test('a v1 template database row upgrades and saves back on read', async () => {
  const id = randomUUID();
  const wallId = randomUUID();
  await fixture.db.insert(templateTable).values({
    id,
    workspaceId: fixture.config.WORKSPACE_ID,
    name: 'Altvorlage',
    sourceSurfaces: [],
    layout: {
      schemaVersion: 1,
      walls: [{
        id: wallId,
        label: 'Alte Wand',
        x: 1000,
        y: 2000,
        rotation: 0,
        width: 1200,
        height: 2400,
        thickness: 28,
      }],
      braces: [],
    } as unknown as Layout,
  });
  const response = await app.inject({ url: `${templates}/${id}`, headers });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json<SceneTemplate>().layout.objects[0]?.id, wallId);
  const [stored] = await fixture.db.select({ layout: templateTable.layout }).from(templateTable)
    .where(eq(templateTable.id, id));
  assert.equal((stored?.layout as Layout).schemaVersion, 2);
});
