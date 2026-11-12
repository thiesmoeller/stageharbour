import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../src/server/app.js';
import { bootstrapAdministrator } from '../../src/server/identity/bootstrap.js';
import type { LayoutObject, Scene } from '../../src/shared/layout.js';
import { STARTER_PART_IDS } from '../../src/shared/parts/starter/index.js';
import { newPlaceholder } from '../../src/shared/placeholders.js';
import { testAdministrator, testDatabase } from '../helpers/database.js';

let fixture: Awaited<ReturnType<typeof testDatabase>>;
let app: Awaited<ReturnType<typeof createApp>>;
let headers: { cookie: string; origin: string };
let scene: Scene;

const wall = (x: number, y: number): LayoutObject => ({
  id: randomUUID(),
  label: 'Wandelement',
  part: { id: STARTER_PART_IDS.wall, revision: 1 },
  variant: 'plain',
  values: { B: 1200, H: 2400, D: 28 },
  x,
  y,
  rotation: 0,
});

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
    payload: { revision: 0, layout: { schemaVersion: 2, objects: [wall(2000, 3000)], joints: [] } },
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
    payload: { revision: 1, layout: { schemaVersion: 2, objects: [wall(4000, 3000)], joints: [] } },
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

test('client-captured Raumsicht images appear in the prepared PDF', async () => {
  const viewId = randomUUID();
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const created = await app.inject({
    method: 'POST', url: `/api/workspaces/${fixture.config.WORKSPACE_ID}/documents`, headers,
    payload: {
      ...spec('Mit Raumsicht'),
      viewCameras: [{
        id: viewId, label: 'Umlaufansicht',
        camera: { projection: 'perspective', position: { x: 4000, y: 2500, z: -2000 }, target: { x: 4000, y: 0, z: 3000 }, preset: 'orbit' },
      }],
      viewImages: { [`view-${scene.id}-${viewId}`]: png },
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  let job = created.json();
  for (let attempt = 0; attempt < 40 && (job.status === 'queued' || job.status === 'rendering'); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 50));
    job = (await app.inject({ url: `/api/workspaces/${fixture.config.WORKSPACE_ID}/documents/${job.id}`, headers })).json();
  }
  assert.equal(job.status, 'ready', JSON.stringify(job));
  const pdf = Buffer.from((await app.inject({
    url: `/api/workspaces/${fixture.config.WORKSPACE_ID}/documents/${job.id}/file`, headers,
  })).rawPayload);
  const text = pdf.toString('latin1');
  assert.equal(text.includes('3D-Ansicht konnte nicht gerendert werden.'), false);
  assert.ok(/\/Subtype\s*\/Image|XObject/.test(text), 'PDF contains an embedded image object');
});

test('recipient document drafts persist per production and can be replaced', async () => {
  const url = `/api/workspaces/${fixture.config.WORKSPACE_ID}/productions/${scene.productionId}/document-draft`;
  assert.equal((await app.inject({ url, headers })).json(), null);
  const draft = {
    spec: {
      ...spec('Regiefassung'),
      purpose: 'rehearsal',
      sections: ['cover', 'overviewPlan', 'roomViews'],
      introduction: 'Für die Probe.',
    },
  };
  const saved = await app.inject({ method: 'PUT', url, headers, payload: draft });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().spec.purpose, 'rehearsal');
  const loaded = await app.inject({ url, headers });
  assert.equal(loaded.statusCode, 200);
  assert.equal(loaded.json().spec.introduction, 'Für die Probe.');
  const replaced = await app.inject({
    method: 'PUT', url, headers,
    payload: { spec: { ...draft.spec, revisionName: 'Neue Fassung' } },
  });
  assert.equal(replaced.statusCode, 200, replaced.body);
  assert.equal((await app.inject({ url, headers })).json().spec.revisionName, 'Neue Fassung');
});

test('A2 paper and audience-viewpoint Raumsicht prepare a valid multi-sheet PDF', async () => {
  const viewId = randomUUID();
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const venuePut = await app.inject({
    method: 'PUT', url: `/api/workspaces/${fixture.config.WORKSPACE_ID}/scenes/${scene.id}/venue`, headers,
    payload: {
      venue: {
        ...scene.venue,
        audienceViewpoint: {
          x: 3600, y: -800, heightMm: 1200, targetX: 4000, targetY: 3000, targetHeightMm: 1200,
          label: 'Parkett vorn',
        },
        placeholders: [newPlaceholder('chair', randomUUID(), 4000, 900)],
      },
    },
  });
  assert.equal(venuePut.statusCode, 200, venuePut.body);
  const created = await app.inject({
    method: 'POST', url: `/api/workspaces/${fixture.config.WORKSPACE_ID}/documents`, headers,
    payload: {
      schemaVersion: 1, preset: 'presentation', kind: 'scene', revisionName: 'A2-Publikum',
      paper: 'A2', orientation: 'landscape', scale: 50,
      scenes: [{ sceneId: scene.id, elevationGroupIds: [] }],
      viewCameras: [{
        id: viewId, label: 'Publikumssicht',
        camera: {
          projection: 'perspective',
          position: { x: 3600, y: 1200, z: -800 },
          target: { x: 4000, y: 1200, z: 3000 },
          preset: 'audience',
        },
      }],
      viewImages: { [`view-${scene.id}-${viewId}`]: png },
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  let job = created.json();
  for (let attempt = 0; attempt < 40 && (job.status === 'queued' || job.status === 'rendering'); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 50));
    job = (await app.inject({ url: `/api/workspaces/${fixture.config.WORKSPACE_ID}/documents/${job.id}`, headers })).json();
  }
  assert.equal(job.status, 'ready', JSON.stringify(job));
  assert.ok((job.manifest?.pageCount ?? 0) >= 1);
  const pdf = Buffer.from((await app.inject({
    url: `/api/workspaces/${fixture.config.WORKSPACE_ID}/documents/${job.id}/file`, headers,
  })).rawPayload);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  // A2 landscape MediaBox in PDF points (594×420 mm → 1683.779528 × 1190.551181).
  assert.match(pdf.toString('latin1'), /\/MediaBox \[0 0 1683\.779528 1190\.551181\]/);
  assert.equal(pdf.toString('latin1').includes('3D-Ansicht konnte nicht gerendert werden.'), false);
});
