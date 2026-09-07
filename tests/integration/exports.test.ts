import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/server/app.js';
import { bootstrapAdministrator } from '../../src/server/identity/bootstrap.js';
import { membership, workspace } from '../../src/server/db/schema.js';
import { renderConstructionPlan } from '../../src/server/exports/pdf.js';
import { newWall, type Scene } from '../../src/shared/layout.js';
import { testAdministrator, testDatabase } from '../helpers/database.js';

let fixture: Awaited<ReturnType<typeof testDatabase>>;
let app: Awaited<ReturnType<typeof createApp>>;
let headers: { cookie: string; origin: string };
let base: string;
let scene: Scene;
let failRender = false;
let readyId: string;
let movedWallX: number;
const input = { productionName: 'Beispielproduktion', venueName: 'Beispielsaal', sceneName: 'Erste Szene', width: 8000, depth: 6000 };
const wall = newWall(randomUUID(), 2000, 3000);

before(async () => {
  fixture = await testDatabase();
  await bootstrapAdministrator(fixture.db, fixture.config, testAdministrator);
  app = await createApp(fixture.db, fixture.config, {
    renderPdf: async snapshot => {
      if (failRender) throw new Error('forced failure');
      return renderConstructionPlan(snapshot);
    },
  });
  const login = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: testAdministrator });
  assert.equal(login.statusCode, 200);
  headers = { cookie: login.cookies.map(value => `${value.name}=${value.value}`).join('; '), origin: fixture.config.APP_ORIGIN };
  base = `/api/workspaces/${fixture.config.WORKSPACE_ID}/scenes`;
  const created = await app.inject({ method: 'POST', url: base, headers, payload: input });
  assert.equal(created.statusCode, 201, created.body);
  scene = created.json();
  assert.equal((await app.inject({ method: 'POST', url: `${base}/${scene.id}/lease`, headers })).statusCode, 200);
  assert.equal((await app.inject({
    method: 'PUT', url: `${base}/${scene.id}/layout`, headers,
    payload: { revision: 0, layout: { schemaVersion: 1, walls: [wall] } },
  })).statusCode, 200);
});
after(async () => { await app?.close(); await fixture?.dispose(); });

function firstWallX(pdf: Buffer) {
  const match = pdf.toString('latin1').match(/(\d+\.\d+)\s+\d+\.\d+\s+m\n(\d+\.\d+)\s+\d+\.\d+\s+l/);
  assert(match, 'expected a wall path in the PDF');
  return Number(match[1]);
}

test('freeze stores a named revision whose PDF stays unchanged after later layout edits', async () => {
  const frozen = await app.inject({ method: 'POST', url: `${base}/${scene.id}/exports`, headers, payload: { name: 'Erste Fassung' } });
  assert.equal(frozen.statusCode, 201, frozen.body);
  const revision = frozen.json();
  assert.equal(revision.name, 'Erste Fassung');
  assert.equal(revision.status, 'ready');
  assert.equal(revision.scale, 50);
  readyId = revision.id;
  const file = await app.inject({ url: `${base}/${scene.id}/exports/${revision.id}/file`, headers });
  assert.equal(file.statusCode, 200, file.body);
  assert.equal(file.headers['content-type'], 'application/pdf');
  const original = Buffer.from(file.rawPayload);
  assert.equal(original.subarray(0, 5).toString(), '%PDF-');
  const originalX = firstWallX(original);
  assert.equal((await app.inject({
    method: 'PUT', url: `${base}/${scene.id}/layout`, headers,
    payload: { revision: 1, layout: { schemaVersion: 1, walls: [{ ...wall, x: 9000 }] } },
  })).statusCode, 200);
  const again = await app.inject({ url: `${base}/${scene.id}/exports/${revision.id}/file`, headers });
  assert.deepEqual(Buffer.from(again.rawPayload), original);
  const later = await app.inject({ method: 'POST', url: `${base}/${scene.id}/exports`, headers, payload: { name: 'Spätere Fassung' } });
  assert.equal(later.statusCode, 201, later.body);
  movedWallX = firstWallX(Buffer.from((await app.inject({ url: `${base}/${scene.id}/exports/${later.json().id}/file`, headers })).rawPayload));
  assert.notEqual(movedWallX, originalX);
  const listing = await app.inject({ url: `${base}/${scene.id}/exports`, headers });
  assert.equal(listing.statusCode, 200);
  assert.deepEqual(listing.json().map((item: { name: string }) => item.name), ['Spätere Fassung', 'Erste Fassung']);
});

test('retry after failure uses the same frozen snapshot, not later layout edits', async () => {
  failRender = true;
  const frozen = await app.inject({ method: 'POST', url: `${base}/${scene.id}/exports`, headers, payload: { name: 'Wiederholungsfassung' } });
  assert.equal(frozen.statusCode, 201, frozen.body);
  assert.equal(frozen.json().status, 'failed');
  const id = frozen.json().id as string;
  assert.equal((await app.inject({ url: `${base}/${scene.id}/exports/${id}/file`, headers })).statusCode, 409);
  const loaded = (await app.inject({ url: `${base}/${scene.id}`, headers })).json<Scene>();
  assert.equal((await app.inject({
    method: 'PUT', url: `${base}/${scene.id}/layout`, headers,
    payload: { revision: loaded.revision, layout: { schemaVersion: 1, walls: [{ ...wall, x: 1000 }] } },
  })).statusCode, 200);
  failRender = false;
  const retried = await app.inject({ method: 'POST', url: `${base}/${scene.id}/exports/${id}/retry`, headers, payload: {} });
  assert.equal(retried.statusCode, 200, retried.body);
  assert.equal(retried.json().status, 'ready');
  assert.equal(retried.json().id, id);
  const pdf = await app.inject({ url: `${base}/${scene.id}/exports/${id}/file`, headers });
  assert.equal(pdf.statusCode, 200);
  assert.equal(firstWallX(Buffer.from(pdf.rawPayload)), movedWallX);
});

test('workspace substitution is denied and viewers cannot freeze or retry', async () => {
  const foreignId = randomUUID();
  await fixture.db.insert(workspace).values({ id: foreignId, name: 'Other workspace' });
  const [member] = await fixture.db.select().from(membership);
  await fixture.db.insert(membership).values({ workspaceId: foreignId, userId: member!.userId, role: 'editor' });
  const foreign = `/api/workspaces/${foreignId}/scenes/${scene.id}/exports`;
  assert.equal((await app.inject({ url: foreign, headers })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: foreign, headers, payload: { name: 'Fremd' } })).statusCode, 404);
  assert.equal((await app.inject({ url: `${foreign}/${readyId}/file`, headers })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: `${foreign}/${readyId}/retry`, headers, payload: {} })).statusCode, 404);
  await fixture.db.update(membership).set({ role: 'viewer' }).where(eq(membership.workspaceId, fixture.config.WORKSPACE_ID));
  assert.equal((await app.inject({ url: `${base}/${scene.id}/exports`, headers })).statusCode, 200);
  assert.equal((await app.inject({ url: `${base}/${scene.id}/exports/${readyId}/file`, headers })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/${scene.id}/exports`, headers, payload: { name: 'Nur Ansicht' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/${scene.id}/exports/${readyId}/retry`, headers, payload: {} })).statusCode, 403);
  assert.equal((await app.inject({ url: `${base}/${scene.id}/exports` })).statusCode, 401);
});
