import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../src/server/app.js';
import { bootstrapAdministrator } from '../../src/server/identity/bootstrap.js';
import { newWall, type Scene } from '../../src/shared/layout.js';
import { testAdministrator, testDatabase } from '../helpers/database.js';

let fixture: Awaited<ReturnType<typeof testDatabase>>;
let app: Awaited<ReturnType<typeof createApp>>;
let headers: { cookie: string; origin: string };
let scene: Scene;

before(async () => {
  fixture = await testDatabase();
  await bootstrapAdministrator(fixture.db, fixture.config, testAdministrator);
  app = await createApp(fixture.db, fixture.config);
  const login = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: testAdministrator });
  headers = { cookie: login.cookies.map(value => `${value.name}=${value.value}`).join('; '), origin: fixture.config.APP_ORIGIN };
  const created = await app.inject({
    method: 'POST', url: `/api/workspaces/${fixture.config.WORKSPACE_ID}/scenes`, headers,
    payload: { productionName: 'Dokumentprobe', venueName: 'Saal', sceneName: 'Erste Szene', width: 8000, depth: 6000 },
  });
  scene = created.json();
  assert.equal((await app.inject({ method: 'POST', url: `/api/workspaces/${fixture.config.WORKSPACE_ID}/scenes/${scene.id}/lease`, headers })).statusCode, 200);
  assert.equal((await app.inject({
    method: 'PUT', url: `/api/workspaces/${fixture.config.WORKSPACE_ID}/scenes/${scene.id}/layout`, headers,
    payload: { revision: 0, layout: { schemaVersion: 1, walls: [newWall(randomUUID(), 2000, 3000)] } },
  })).statusCode, 200);
});
after(async () => { await app?.close(); await fixture?.dispose(); });

function spec(name = 'Probe') {
  return {
    schemaVersion: 1, preset: 'construction', kind: 'scene', revisionName: name, paper: 'A4', orientation: 'portrait', scale: 50,
    scenes: [{ sceneId: scene.id, elevationGroupIds: [] }],
  };
}

async function readyJob() {
  const created = await app.inject({
    method: 'POST', url: `/api/workspaces/${fixture.config.WORKSPACE_ID}/documents`, headers, payload: spec(),
  });
  assert.equal(created.statusCode, 201, created.body);
  let job = created.json();
  for (let attempt = 0; attempt < 40 && (job.status === 'queued' || job.status === 'rendering'); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 50));
    job = (await app.inject({ url: `/api/workspaces/${fixture.config.WORKSPACE_ID}/documents/${job.id}`, headers })).json();
  }
  assert.equal(job.status, 'ready', JSON.stringify(job));
  const listed = await app.inject({ url: `/api/workspaces/${fixture.config.WORKSPACE_ID}/scenes/${scene.id}/exports`, headers });
  assert.equal(listed.json().length, 0);
  return job;
}

test('preparation does not issue, and a stale preview cannot be issued', async () => {
  const job = await readyJob();
  const file = await app.inject({ url: `/api/workspaces/${fixture.config.WORKSPACE_ID}/documents/${job.id}/file`, headers });
  assert.equal(file.headers['content-type'], 'application/pdf');
  assert.equal((await app.inject({
    method: 'PUT', url: `/api/workspaces/${fixture.config.WORKSPACE_ID}/scenes/${scene.id}/layout`, headers,
    payload: { revision: 1, layout: { schemaVersion: 1, walls: [newWall(randomUUID(), 4000, 3000)] } },
  })).statusCode, 200);
  const issued = await app.inject({
    method: 'POST', url: `/api/workspaces/${fixture.config.WORKSPACE_ID}/documents/${job.id}/issue`, headers, payload: {},
  });
  assert.equal(issued.statusCode, 409, issued.body);
});

test('issuing a fresh preview stores the reviewed PDF and a second issue is the same revision', async () => {
  const job = await readyJob();
  const preview = Buffer.from((await app.inject({ url: `/api/workspaces/${fixture.config.WORKSPACE_ID}/documents/${job.id}/file`, headers })).rawPayload);
  const issued = await app.inject({
    method: 'POST', url: `/api/workspaces/${fixture.config.WORKSPACE_ID}/documents/${job.id}/issue`, headers, payload: {},
  });
  assert.equal(issued.statusCode, 201, issued.body);
  const again = await app.inject({
    method: 'POST', url: `/api/workspaces/${fixture.config.WORKSPACE_ID}/documents/${job.id}/issue`, headers, payload: {},
  });
  assert.equal(again.json().id, issued.json().id);
  const stored = Buffer.from((await app.inject({
    url: `/api/workspaces/${fixture.config.WORKSPACE_ID}/scenes/${scene.id}/exports/${issued.json().id}/file`, headers,
  })).rawPayload);
  assert.equal(stored.equals(preview), true);
});
