import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/server/app.js';
import { bootstrapAdministrator } from '../../src/server/identity/bootstrap.js';
import { membership } from '../../src/server/db/schema.js';
import { defaultLighting } from '../../src/shared/lighting.js';
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
  headers = { cookie: login.cookies.map(item => `${item.name}=${item.value}`).join('; '), origin: fixture.config.APP_ORIGIN };
  base = `/api/workspaces/${fixture.config.WORKSPACE_ID}`;
});
after(async () => { await app?.close(); await fixture?.dispose(); });

test('independent venues create no scenes; productions reuse and explicitly adopt their versions', async () => {
  const created = await app.inject({ method: 'POST', url: `${base}/venues`, headers, payload: { name: 'Theatersaal', width: 8000, depth: 6000 } });
  assert.equal(created.statusCode, 201, created.body);
  const venue = created.json();
  assert.deepEqual((await app.inject({ url: `${base}/scenes`, headers })).json(), []);
  const production = await app.inject({ method: 'POST', url: `${base}/scenes`, headers, payload: { productionName: 'Gastspiel', sceneName: 'Akt 1', venueVersionId: venue.venueVersionId } });
  assert.equal(production.statusCode, 201, production.body);
  const scene = production.json();
  assert.equal(scene.venueId, venue.id);
  assert.equal((await app.inject({ url: `${base}/venues`, headers })).json().length, 1);
  const geometry = { ...venue.venue, ceilingHeight: 5000, lighting: { ...defaultLighting, enabled: true } };
  const published = await app.inject({ method: 'PUT', url: `${base}/venues/${venue.id}`, headers, payload: { venueVersionId: venue.venueVersionId, venue: geometry } });
  assert.equal(published.statusCode, 200, published.body);
  const originalVersion = await app.inject({ url: `${base}/venues/${venue.id}/versions/${venue.venueVersionId}`, headers });
  assert.equal(originalVersion.statusCode, 200);
  assert.equal(originalVersion.json().venue.ceilingHeight, undefined);
  assert.equal((await app.inject({ url: `${base}/venues/${venue.id}/versions/${randomUUID()}`, headers })).statusCode, 404);
  const pinned = (await app.inject({ url: `${base}/scenes/${scene.id}`, headers })).json();
  assert.equal(pinned.venueVersionId, venue.venueVersionId);
  assert.equal(pinned.venue.ceilingHeight, undefined);
  assert.equal(pinned.venueUpdateAvailable, true);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/scenes/${scene.id}/lease`, headers, payload: {} })).statusCode, 200);
  const applied = await app.inject({ method: 'POST', url: `${base}/scenes/${scene.id}/venue-apply`, headers, payload: {} });
  assert.equal(applied.statusCode, 200, applied.body);
  assert.equal(applied.json().venueVersionId, published.json().venueVersionId);
  assert.deepEqual(applied.json().venue.lighting, geometry.lighting);
  const layout = { ...applied.json().layout, lighting: { ...defaultLighting, enabled: true, front: 40, backColor: '#123456' } };
  const saved = await app.inject({ method: 'PUT', url: `${base}/scenes/${scene.id}/layout`, headers, payload: { revision: applied.json().revision, layout } });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.deepEqual((await app.inject({ url: `${base}/scenes/${scene.id}`, headers })).json().layout.lighting, layout.lighting);
  assert.equal((await app.inject({ url: `${base}/venues/${venue.id}`, headers })).json().venue.lighting.front, 100);
});

test('concurrent publishers cannot overwrite a newer venue version', async () => {
  const venue = (await app.inject({ method: 'POST', url: `${base}/venues`, headers, payload: { name: 'Kleine Bühne', width: 4000, depth: 3000 } })).json();
  const responses = await Promise.all([2000, 3000].map(ceilingHeight => app.inject({ method: 'PUT', url: `${base}/venues/${venue.id}`, headers,
    payload: { venueVersionId: venue.venueVersionId, venue: { ...venue.venue, ceilingHeight } } })));
  assert.deepEqual(responses.map(response => response.statusCode).sort(), [200, 409]);
  const latest = (await app.inject({ url: `${base}/venues/${venue.id}`, headers })).json();
  assert.equal(latest.venueVersionId, responses.find(response => response.statusCode === 200)!.json().venueVersionId);
});

test('venue routes validate inputs and enforce origin, workspace and viewer permissions', async () => {
  const list = await app.inject({ url: `${base}/venues`, headers });
  const venue = list.json()[0];
  const record = (await app.inject({ url: `${base}/venues/${venue.id}`, headers })).json();
  const payload = { venueVersionId: record.venueVersionId, venue: record.venue };
  assert.equal((await app.inject({ url: `${base}/venues` })).statusCode, 401);
  assert.equal((await app.inject({ url: `/api/workspaces/${randomUUID()}/venues/${venue.id}`, headers })).statusCode, 404);
  assert.equal((await app.inject({ method: 'PUT', url: `${base}/venues/${venue.id}`, headers: { ...headers, origin: 'https://invalid.test' }, payload })).statusCode, 403);
  assert.equal((await app.inject({ method: 'PUT', url: `${base}/venues/${venue.id}`, headers, payload: { ...payload, venue: { ...record.venue, trace: { fileId: randomUUID() } } } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/scenes`, headers, payload: { productionName: 'Invalid', sceneName: 'Invalid', venueVersionId: randomUUID() } })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/venues`, headers, payload: { name: '', width: -1, depth: 1 } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'PUT', url: `${base}/venues/${venue.id}`, headers, payload: { ...payload, venue: { ...record.venue, lighting: { ...defaultLighting, front: -1 } } } })).statusCode, 400);
  await fixture.db.update(membership).set({ role: 'viewer' }).where(eq(membership.workspaceId, fixture.config.WORKSPACE_ID));
  assert.equal((await app.inject({ url: `${base}/venues`, headers })).statusCode, 200);
  assert.equal((await app.inject({ url: `${base}/venues/${venue.id}`, headers })).statusCode, 200);
  assert.equal((await app.inject({ method: 'PUT', url: `${base}/venues/${venue.id}`, headers, payload })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/venues`, headers, payload: { name: 'Forbidden', width: 1000, depth: 1000 } })).statusCode, 403);
});
