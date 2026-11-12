import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { hashPassword } from 'better-auth/crypto';
import { createApp } from '../../src/server/app.js';
import { bootstrapAdministrator } from '../../src/server/identity/bootstrap.js';
import { account, membership, user } from '../../src/server/db/schema.js';
import { readZip } from '../../src/shared/exchange/index.js';
import type { Layout, LayoutObject, Scene } from '../../src/shared/layout.js';
import { AUDIENCE_FLOOR_ID } from '../../src/shared/levels.js';
import { STARTER_PART_IDS } from '../../src/shared/parts/starter/index.js';
import { testAdministrator, testDatabase } from '../helpers/database.js';

let fixture: Awaited<ReturnType<typeof testDatabase>>;
let app: Awaited<ReturnType<typeof createApp>>;
let base: string;
let scene: Scene;
const headers: Record<string, { cookie: string; origin: string }> = {};
const viewerId = randomUUID();

const part = (partId: string, label: string, x: number, extra: Partial<LayoutObject> = {}): LayoutObject => ({
  id: randomUUID(), label, part: { id: partId, revision: 1 }, x, y: 2000, rotation: 0, support: AUDIENCE_FLOOR_ID, ...extra,
});

before(async () => {
  fixture = await testDatabase();
  await bootstrapAdministrator(fixture.db, fixture.config, testAdministrator);
  await fixture.db.insert(user).values({ id: viewerId, email: 'viewer@example.test', name: 'viewer' });
  await fixture.db.insert(account).values({
    id: randomUUID(), userId: viewerId, accountId: viewerId, providerId: 'credential', password: await hashPassword(testAdministrator.password),
  });
  await fixture.db.insert(membership).values({ workspaceId: fixture.config.WORKSPACE_ID, userId: viewerId, role: 'viewer' });
  app = await createApp(fixture.db, fixture.config);
  base = `/api/workspaces/${fixture.config.WORKSPACE_ID}`;
  for (const [role, email] of [['administrator', testAdministrator.email], ['viewer', 'viewer@example.test']] as const) {
    const login = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: { email, password: testAdministrator.password } });
    assert.equal(login.statusCode, 200);
    headers[role] = { cookie: login.cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; '), origin: fixture.config.APP_ORIGIN };
  }
  const created = await app.inject({
    method: 'POST', url: `${base}/scenes`, headers: headers.administrator,
    payload: { productionName: 'Tauschprobe', venueName: 'Große Aula', sceneName: 'Akt 1 – Wald', width: 10000, depth: 7000 },
  });
  assert.equal(created.statusCode, 201, created.body);
  scene = created.json<Scene>();
  const layout: Layout = {
    schemaVersion: 2,
    objects: [
      part(STARTER_PART_IDS.wall, 'Wand', 3000, { variant: 'plain', values: { B: 1200, H: 2400, D: 28 }, rotation: 30 }),
      part(STARTER_PART_IDS.deck, 'Podest', 6000, { variant: '2x1', values: { H: 400 } }),
      part(STARTER_PART_IDS.chair, 'Stuhl', 8000),
    ],
    joints: [],
  };
  assert.equal((await app.inject({ method: 'POST', url: `${base}/scenes/${scene.id}/lease`, headers: headers.administrator })).statusCode, 200);
  const saved = await app.inject({ method: 'PUT', url: `${base}/scenes/${scene.id}/layout`, headers: headers.administrator, payload: { revision: 0, layout } });
  assert.equal(saved.statusCode, 200, saved.body);
});
after(async () => { await app?.close(); await fixture?.dispose(); });

const url = (format: string, sceneId = scene.id) => `${base}/scenes/${sceneId}/export/${format}`;

test('glTF export streams a binary glb with download headers', async () => {
  const response = await app.inject({ url: url('gltf'), headers: headers.administrator });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers['content-type'], 'model/gltf-binary');
  assert.match(String(response.headers['content-disposition']), /^attachment; filename="Akt_1_Wald\.glb"; filename\*=UTF-8''Akt_1_Wald\.glb$/);
  assert.equal(response.headers['cache-control'], 'no-store');
  const bytes = response.rawPayload;
  assert.equal(bytes.subarray(0, 4).toString('latin1'), 'glTF');
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
  const root = json.nodes[json.scenes[0].nodes[0]];
  assert.equal(root.name, 'Akt 1 – Wald');
  const kinds = root.children.map((index: number) => json.nodes[index].extras.stageharbour.kind);
  assert.equal(kinds.filter((kind: string) => kind === 'part').length, 3);
  assert.equal(kinds.filter((kind: string) => kind === 'floor').length, 1);
});

test('MVR export streams a zip with the description and glb geometry', async () => {
  const response = await app.inject({ url: url('mvr'), headers: headers.administrator });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers['content-type'], 'application/octet-stream');
  assert.match(String(response.headers['content-disposition']), /filename="Akt_1_Wald\.mvr"/);
  const files = new Map((await readZip(new Uint8Array(response.rawPayload))).map(entry => [entry.name, entry.data]));
  const xml = new TextDecoder().decode(files.get('GeneralSceneDescription.xml'));
  assert.match(xml, /<GeneralSceneDescription verMajor="1" verMinor="6" provider="StageHarbour"/);
  assert.match(xml, /production="Tauschprobe"/);
  assert.equal((xml.match(/<SceneObject /g) ?? []).length, 1 + 3);
  assert.ok([...files.keys()].some(name => name.endsWith('.glb')));
});

test('a scene with a non-ASCII name still downloads under an ASCII fallback', async () => {
  const renamed = await app.inject({ method: 'PATCH', url: `${base}/scenes/${scene.id}`, headers: headers.administrator, payload: { name: 'Größe Übung' } });
  assert.equal(renamed.statusCode, 200, renamed.body);
  const response = await app.inject({ url: url('gltf'), headers: headers.administrator });
  assert.equal(response.statusCode, 200);
  assert.match(String(response.headers['content-disposition']), /filename="Grosse_Ubung\.glb"; filename\*=UTF-8''Gr%C3%B6%C3%9Fe_%C3%9Cbung\.glb/);
});

test('every member may download; strangers, bad ids and unknown formats are refused', async () => {
  assert.equal((await app.inject({ url: url('gltf'), headers: headers.viewer })).statusCode, 200);
  assert.equal((await app.inject({ url: url('mvr'), headers: headers.viewer })).statusCode, 200);
  assert.equal((await app.inject({ url: url('gltf') })).statusCode, 401);
  assert.equal((await app.inject({ url: url('gltf', randomUUID()), headers: headers.administrator })).statusCode, 404);
  assert.equal((await app.inject({ url: url('obj'), headers: headers.administrator })).statusCode, 400);
  assert.equal((await app.inject({ url: `/api/workspaces/${randomUUID()}/scenes/${scene.id}/export/gltf`, headers: headers.administrator })).statusCode, 404);
});
