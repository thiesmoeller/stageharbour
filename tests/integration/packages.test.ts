import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/server/app.js';
import { bootstrapAdministrator } from '../../src/server/identity/bootstrap.js';
import { membership, workspace } from '../../src/server/db/schema.js';
import { renderConstructionPlan } from '../../src/server/exports/pdf.js';
import { EXAMPLE_PLAIN, type Inventory } from '../../src/shared/inventory.js';
import { newWall, type Scene } from '../../src/shared/layout.js';
import { newWallType } from '../../src/shared/wall-types.js';
import { testAdministrator, testDatabase } from '../helpers/database.js';

let fixture: Awaited<ReturnType<typeof testDatabase>>;
let app: Awaited<ReturnType<typeof createApp>>;
let headers: { cookie: string; origin: string };
let scenesUrl: string;
let inventoryUrl: string;
let readyId: string;
let packageUrl: string;
let originalPdf: Buffer;
const plain = { ...newWallType(randomUUID()), ...EXAMPLE_PLAIN, name: 'Beispiel-Glattwand' };
const input = { productionName: 'Paketproduktion', venueName: 'Beispielsaal', sceneName: 'Szene A', width: 8000, depth: 6000 };

before(async () => {
  fixture = await testDatabase();
  await bootstrapAdministrator(fixture.db, fixture.config, testAdministrator);
  app = await createApp(fixture.db, fixture.config, {
    renderPdf: async snapshot => renderConstructionPlan(snapshot),
  });
  const login = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: testAdministrator });
  assert.equal(login.statusCode, 200);
  headers = { cookie: login.cookies.map(value => `${value.name}=${value.value}`).join('; '), origin: fixture.config.APP_ORIGIN };
  scenesUrl = `/api/workspaces/${fixture.config.WORKSPACE_ID}/scenes`;
  inventoryUrl = `/api/workspaces/${fixture.config.WORKSPACE_ID}/inventory`;
});
after(async () => { await app?.close(); await fixture?.dispose(); });

function pdfText(bytes: Buffer) {
  return [...bytes.toString('latin1').matchAll(/<([0-9a-fA-F]+)>/g)]
    .map(match => Buffer.from(match[1] ?? '', 'hex').toString('latin1')).join('');
}

test('freeze a package from chosen scenes; later inventory, type and venue edits leave PDF and lists unchanged', async () => {
  const created = await app.inject({ method: 'POST', url: scenesUrl, headers, payload: input });
  assert.equal(created.statusCode, 201, created.body);
  const sceneA = created.json<Scene>();
  packageUrl = `/api/workspaces/${fixture.config.WORKSPACE_ID}/productions/${sceneA.productionId}/packages`;
  const wallA = newWall(randomUUID(), 2000, 3000);
  const extra = newWall(randomUUID(), 5000, 2000);
  extra.label = 'Offene Wand';
  assert.equal((await app.inject({ method: 'POST', url: `${scenesUrl}/${sceneA.id}/lease`, headers })).statusCode, 200);
  assert.equal((await app.inject({
    method: 'PUT', url: `${scenesUrl}/${sceneA.id}/layout`, headers,
    payload: { revision: 0, layout: { schemaVersion: 1, wallTypes: [plain], walls: [wallA] } },
  })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: `${inventoryUrl}/lease`, headers })).statusCode, 200);
  const panel = (await app.inject({
    method: 'POST', url: `${inventoryUrl}/panels`, headers, payload: { label: 'W12', type: plain, note: null },
  })).json<{ id: string }>();
  const broken = (await app.inject({
    method: 'POST', url: `${inventoryUrl}/panels`, headers, payload: { label: 'W03', type: plain, note: null },
  })).json<{ id: string }>();
  assert.equal((await app.inject({
    method: 'POST', url: `${scenesUrl}/${sceneA.id}/walls/${wallA.id}/assignment`, headers, payload: { panelId: panel.id },
  })).statusCode, 200);
  const duplicated = await app.inject({ method: 'POST', url: `${scenesUrl}/${sceneA.id}/duplicate`, headers, payload: { sceneName: 'Szene B' } });
  assert.equal(duplicated.statusCode, 201, duplicated.body);
  const sceneB = duplicated.json<Scene>();
  const brokenWall = newWall(randomUUID(), 4000, 2000);
  brokenWall.label = 'Kaputte Wand';
  assert.equal((await app.inject({ method: 'POST', url: `${scenesUrl}/${sceneB.id}/lease`, headers })).statusCode, 200);
  const loadedB = (await app.inject({ url: `${scenesUrl}/${sceneB.id}`, headers })).json<Scene>();
  assert.equal((await app.inject({
    method: 'PUT', url: `${scenesUrl}/${sceneB.id}/layout`, headers,
    payload: { revision: loadedB.revision, layout: { ...loadedB.layout, walls: [...loadedB.layout.walls, extra, brokenWall] } },
  })).statusCode, 200);
  assert.equal((await app.inject({
    method: 'POST', url: `${scenesUrl}/${sceneB.id}/walls/${brokenWall.id}/assignment`, headers, payload: { panelId: broken.id },
  })).statusCode, 200);
  assert.equal((await app.inject({
    method: 'PATCH', url: `${inventoryUrl}/panels/${broken.id}`, headers, payload: { available: false, note: 'Reparatur' },
  })).statusCode, 200);
  const frozen = await app.inject({
    method: 'POST', url: packageUrl, headers,
    payload: { name: 'Paket Probe', sceneIds: [sceneA.id, sceneB.id] },
  });
  assert.equal(frozen.statusCode, 201, frozen.body);
  assert.equal(frozen.json().name, 'Paket Probe');
  assert.equal(frozen.json().status, 'ready');
  assert.equal(frozen.json().paper, 'A4');
  assert.equal(frozen.json().scale, 50);
  readyId = frozen.json().id;
  const file = await app.inject({ url: `${packageUrl}/${readyId}/file`, headers });
  assert.equal(file.statusCode, 200, file.body);
  assert.equal(file.headers['content-type'], 'application/pdf');
  originalPdf = Buffer.from(file.rawPayload);
  const text = pdfText(originalPdf);
  assert(text.includes('Stückliste'), text);
  assert(text.includes('W12'), text);
  assert(text.includes('Offene Wand'), text);
  assert(text.includes('W03'), text);
  assert(text.includes('2 physische Platten'), text);
  assert(text.includes('3 Einsätze'), text);
  assert.equal((await app.inject({
    method: 'PATCH', url: `${inventoryUrl}/panels/${panel.id}`, headers, payload: { available: false, note: 'Später defekt' },
  })).statusCode, 200);
  const listed = (await app.inject({ url: inventoryUrl, headers })).json<Inventory>();
  assert.equal(listed.panels.find(item => item.id === panel.id)?.available, false);
  const loadedA = (await app.inject({ url: `${scenesUrl}/${sceneA.id}`, headers })).json<Scene>();
  assert.equal((await app.inject({
    method: 'PUT', url: `${scenesUrl}/${sceneA.id}/layout`, headers,
    payload: {
      revision: loadedA.revision,
      layout: {
        schemaVersion: 1,
        wallTypes: [{ ...plain, width: 900, name: 'Geändert' }],
        walls: [{ ...loadedA.layout.walls[0]!, width: 900, x: 9000, panelId: undefined }],
      },
    },
  })).statusCode, 200);
  assert.equal((await app.inject({
    method: 'PUT', url: `${scenesUrl}/${sceneA.id}/venue`, headers,
    payload: { venue: { schemaVersion: 1, width: 12000, depth: 9000 } },
  })).statusCode, 200);
  const again = await app.inject({ url: `${packageUrl}/${readyId}/file`, headers });
  assert.deepEqual(Buffer.from(again.rawPayload), originalPdf);
  const listing = await app.inject({ url: packageUrl, headers });
  assert.equal(listing.statusCode, 200);
  assert.equal(listing.json()[0]?.name, 'Paket Probe');
});

test('viewer cannot freeze a package; foreign workspace is hidden', async () => {
  const foreignId = randomUUID();
  await fixture.db.insert(workspace).values({ id: foreignId, name: 'Other workspace' });
  const [member] = await fixture.db.select().from(membership);
  await fixture.db.insert(membership).values({ workspaceId: foreignId, userId: member!.userId, role: 'editor' });
  const foreign = `/api/workspaces/${foreignId}/productions/${randomUUID()}/packages`;
  assert.equal((await app.inject({ url: foreign, headers })).statusCode, 404);
  assert.equal((await app.inject({
    method: 'POST', url: foreign, headers, payload: { name: 'Fremd', sceneIds: [randomUUID()] },
  })).statusCode, 404);
  assert.equal((await app.inject({ url: `${foreign}/${readyId}/file`, headers })).statusCode, 404);
  await fixture.db.update(membership).set({ role: 'viewer' }).where(eq(membership.workspaceId, fixture.config.WORKSPACE_ID));
  assert.equal((await app.inject({ url: packageUrl, headers })).statusCode, 200);
  assert.equal((await app.inject({ url: `${packageUrl}/${readyId}/file`, headers })).statusCode, 200);
  assert.equal((await app.inject({
    method: 'POST', url: packageUrl, headers, payload: { name: 'Nur Ansicht', sceneIds: [randomUUID()] },
  })).statusCode, 403);
  assert.equal((await app.inject({ url: packageUrl })).statusCode, 401);
});
