import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { createApp } from '../../src/server/app.js';
import { bootstrapAdministrator } from '../../src/server/identity/bootstrap.js';
import type { Layout, LayoutObject, Scene } from '../../src/shared/layout.js';
import { AUDIENCE_FLOOR_ID } from '../../src/shared/levels.js';
import { STARTER_PART_IDS } from '../../src/shared/parts/starter/index.js';
import { testAdministrator, testDatabase } from '../helpers/database.js';

let fixture: Awaited<ReturnType<typeof testDatabase>>;
let app: Awaited<ReturnType<typeof createApp>>;
let headers: { cookie: string; origin: string };
let base: string;
let source: Scene;

const object = (id: string, x: number, stockItemId?: string): LayoutObject => ({
  id,
  label: 'Wandelement',
  part: { id: STARTER_PART_IDS.wall, revision: 1 },
  variant: 'plain',
  values: { B: 1200, H: 2400, D: 28 },
  x,
  y: 2000,
  rotation: 0,
  support: AUDIENCE_FLOOR_ID,
  ...(stockItemId ? { stockItemId } : {}),
});

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
  base = `/api/workspaces/${fixture.config.WORKSPACE_ID}/scenes`;
});
after(async () => { await app?.close(); await fixture?.dispose(); });

test('duplicate remaps v2 objects, joints and groups while preserving physical stock references', async () => {
  const created = await app.inject({
    method: 'POST',
    url: base,
    headers,
    payload: {
      productionName: 'Doppelproduktion',
      venueName: 'Doppelsaal',
      sceneName: 'Erste Szene',
      width: 8000,
      depth: 6000,
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  source = created.json<Scene>();
  const stock = await app.inject({
    method: 'POST',
    url: `/api/workspaces/${fixture.config.WORKSPACE_ID}/stock/items`,
    headers,
    payload: { label: 'W-01', partId: STARTER_PART_IDS.wall, variantKey: 'plain' },
  });
  assert.equal(stock.statusCode, 201, stock.body);
  const stockItemId = stock.json().id as string;
  const left = { ...object(randomUUID(), 1000, stockItemId), assemblyNumber: 1 };
  const right = { ...object(randomUUID(), 5000), assemblyNumber: 2 };
  const groupId = randomUUID();
  const jointId = randomUUID();
  const layout: Layout = {
    schemaVersion: 2,
    objects: [left, right],
    joints: [{
      id: jointId,
      a: { object: left.id, connector: 'rechts' },
      b: { object: right.id, connector: 'links' },
    }],
    groups: [{
      id: groupId,
      members: [{ kind: 'object', id: left.id }, { kind: 'object', id: right.id }],
      rotation: 0,
    }],
    riggingNotes: 'Stifte belassen.',
    riggingSetupId: randomUUID(),
  };
  assert.equal((await app.inject({ method: 'POST', url: `${base}/${source.id}/lease`, headers })).statusCode, 200);
  const saved = await app.inject({
    method: 'PUT',
    url: `${base}/${source.id}/layout`,
    headers,
    payload: { revision: 0, layout },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  source = (await app.inject({ url: `${base}/${source.id}`, headers })).json<Scene>();

  const duplicated = await app.inject({
    method: 'POST',
    url: `${base}/${source.id}/duplicate`,
    headers,
    payload: {},
  });
  assert.equal(duplicated.statusCode, 201, duplicated.body);
  const copy = duplicated.json<Scene>();
  assert.equal(copy.name, 'Erste Szene (Kopie)');
  assert.equal(copy.layout.objects.length, 2);
  assert.notEqual(copy.layout.objects[0]?.id, source.layout.objects[0]?.id);
  assert.equal(copy.layout.objects[0]?.stockItemId, stockItemId);
  assert.equal(copy.layout.objects[0]?.assemblyNumber, 1);
  const copiedIds = new Set(copy.layout.objects.map(item => item.id));
  assert.equal(copy.layout.groups?.[0]?.members.every(member => copiedIds.has(member.id)), true);
  assert.equal(copiedIds.has(copy.layout.joints[0]!.a.object), true);
  assert.equal(copiedIds.has(copy.layout.joints[0]!.b.object), true);
  assert.notEqual(copy.layout.joints[0]?.id, jointId);
  assert.notEqual(copy.layout.groups?.[0]?.id, groupId);
  assert.equal(copy.layout.riggingSetupId, source.layout.riggingSetupId);
});

test('copy into another production remaps identities and clears stock assignments', async () => {
  const destination = (await app.inject({
    method: 'POST',
    url: base,
    headers,
    payload: {
      productionName: 'Gastspiel',
      venueName: 'Stadthalle',
      sceneName: 'Leer',
      width: 9000,
      depth: 7000,
    },
  })).json<Scene>();
  const copied = await app.inject({
    method: 'POST',
    url: `${base}/${source.id}/copy`,
    headers,
    payload: {
      productionId: destination.productionId,
      venueVersionId: destination.venueVersionId,
    },
  });
  assert.equal(copied.statusCode, 201, copied.body);
  const copy = copied.json<Scene>();
  assert.equal(copy.productionName, 'Gastspiel');
  assert.equal(copy.venueName, 'Stadthalle');
  assert.equal(copy.layout.objects.length, 2);
  assert.equal(copy.layout.objects.every(item => item.stockItemId === undefined), true);
  assert.equal(copy.layout.objects.every(item => item.support === AUDIENCE_FLOOR_ID), true);
  assert.notEqual(copy.layout.objects[0]?.id, source.layout.objects[0]?.id);
});

test('a second scene on an existing adaptation starts with an empty v2 layout', async () => {
  const blank = await app.inject({
    method: 'POST',
    url: base,
    headers,
    payload: {
      productionId: source.productionId,
      venueVersionId: source.venueVersionId,
      sceneName: 'Zweite Szene',
    },
  });
  assert.equal(blank.statusCode, 201, blank.body);
  assert.deepEqual(blank.json<Scene>().layout, { schemaVersion: 2, objects: [], joints: [] });
});
