import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/server/app.js';
import { scene as sceneTable } from '../../src/server/db/schema.js';
import { bootstrapAdministrator } from '../../src/server/identity/bootstrap.js';
import type { Layout, Scene } from '../../src/shared/layout.js';
import { STARTER_PART_IDS } from '../../src/shared/parts/starter/index.js';
import { testAdministrator, testDatabase } from '../helpers/database.js';

let fixture: Awaited<ReturnType<typeof testDatabase>>;
let app: Awaited<ReturnType<typeof createApp>>;
let headers: { cookie: string; origin: string };
let base: string;
let created: Scene;

const input = {
  productionName: 'Beispielproduktion',
  venueName: 'Beispielsaal',
  sceneName: 'Erste Szene',
  width: 8000,
  depth: 6000,
};
const wallObject = (id: string, x: number) => ({
  id,
  label: 'Wand',
  part: { id: STARTER_PART_IDS.wall, revision: 1 },
  variant: 'plain',
  values: { B: 1200, H: 2400, D: 28 },
  x,
  y: 1800,
  rotation: 35,
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

test('new scenes are writable only as layout v2', async () => {
  const response = await app.inject({ method: 'POST', url: base, headers, payload: input });
  assert.equal(response.statusCode, 201, response.body);
  created = response.json<Scene>();
  assert.deepEqual(created.layout, { schemaVersion: 2, objects: [], joints: [] });
  assert.deepEqual(created.venue, { schemaVersion: 1, width: 8000, depth: 6000 });

  assert.equal((await app.inject({ method: 'POST', url: `${base}/${created.id}/lease`, headers })).statusCode, 200);
  const id = randomUUID();
  const saves = await Promise.all([1000, 2000].map(x => app.inject({
    method: 'PUT',
    url: `${base}/${created.id}/layout`,
    headers,
    payload: {
      revision: 0,
      layout: { schemaVersion: 2, objects: [wallObject(id, x)], joints: [] },
    },
  })));
  assert.deepEqual(saves.map(response => response.statusCode).sort(), [200, 409]);
  const loaded = (await app.inject({ url: `${base}/${created.id}`, headers })).json<Scene>();
  assert.equal(loaded.revision, 1);
  assert.equal(loaded.layout.objects[0]?.x, saves[0]!.statusCode === 200 ? 1000 : 2000);

  for (const layout of [
    { schemaVersion: 1, walls: [], braces: [] },
    { schemaVersion: 2, objects: [], joints: [], walls: [] },
    { schemaVersion: 2, objects: [{ ...wallObject(randomUUID(), 200_000) }], joints: [] },
  ]) {
    const rejected: Awaited<ReturnType<typeof app.inject>> = await app.inject({
      method: 'PUT',
      url: `${base}/${created.id}/layout`,
      headers,
      payload: { revision: loaded.revision, layout },
    });
    assert.equal(rejected.statusCode, 400, rejected.body);
  }
});

test('a schema v1 database row is converted once on read and persisted as v2', async () => {
  const wallId = randomUUID();
  const stockItemId = randomUUID();
  const legacy = {
    schemaVersion: 1 as const,
    walls: [{
      id: wallId,
      label: 'Alte Türwand',
      x: 2400,
      y: 1800,
      rotation: 0,
      width: 1200,
      height: 2400,
      thickness: 28,
      panelId: stockItemId,
      assemblyNumber: 4,
      doorOpenPercent: 50,
      openings: [{
        id: randomUUID(),
        left: 200,
        sill: 0,
        width: 800,
        height: 2000,
        hinge: 'left' as const,
      }],
    }],
    braces: [],
  };
  await fixture.db.update(sceneTable).set({ layout: legacy as unknown as Layout }).where(eq(sceneTable.id, created.id));

  const loaded = await app.inject({ url: `${base}/${created.id}`, headers });
  assert.equal(loaded.statusCode, 200, loaded.body);
  const layout = loaded.json<Scene>().layout;
  assert.equal(layout.schemaVersion, 2);
  assert.equal(layout.objects[0]?.id, wallId);
  assert.equal(layout.objects[0]?.variant, 'doorLeft');
  assert.equal(layout.objects[0]?.stockItemId, stockItemId);
  assert.equal(layout.objects[0]?.assemblyNumber, 4);
  assert.deepEqual(layout.objects[0]?.state, { open: 50 });
  assert.equal('walls' in layout, false);

  const [stored] = await fixture.db.select({ layout: sceneTable.layout }).from(sceneTable)
    .where(eq(sceneTable.id, created.id));
  assert.equal((stored?.layout as Layout).schemaVersion, 2);
  assert.equal('walls' in (stored?.layout as object), false);
});
