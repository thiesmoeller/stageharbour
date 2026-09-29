import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import { createApp } from '../../src/server/app.js';
import { bootstrapAdministrator } from '../../src/server/identity/bootstrap.js';
import { account, membership, user, workspace } from '../../src/server/db/schema.js';
import { EXAMPLE_DOOR_OPENING, EXAMPLE_PLAIN, inventoryWarnings, type Inventory } from '../../src/shared/inventory.js';
import { newWall, type Scene } from '../../src/shared/layout.js';
import { newWallType } from '../../src/shared/wall-types.js';
import { testAdministrator, testDatabase } from '../helpers/database.js';

let fixture: Awaited<ReturnType<typeof testDatabase>>;
let app: Awaited<ReturnType<typeof createApp>>;
let headers: { cookie: string; origin: string };
let inventoryUrl: string;
let scenesUrl: string;
let scene: Scene;
const plain = { ...newWallType(randomUUID()), ...EXAMPLE_PLAIN, name: 'Beispiel-Glattwand' };
const door = { ...newWallType(randomUUID()), name: 'Beispiel-Türwand', width: 1200, height: 2400, thickness: 28,
  openings: [{ id: randomUUID(), ...EXAMPLE_DOOR_OPENING }] };

before(async () => {
  fixture = await testDatabase();
  await bootstrapAdministrator(fixture.db, fixture.config, testAdministrator);
  app = await createApp(fixture.db, fixture.config);
  const login = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: testAdministrator });
  assert.equal(login.statusCode, 200);
  headers = { cookie: login.cookies.map(value => `${value.name}=${value.value}`).join('; '), origin: fixture.config.APP_ORIGIN };
  inventoryUrl = `/api/workspaces/${fixture.config.WORKSPACE_ID}/inventory`;
  scenesUrl = `/api/workspaces/${fixture.config.WORKSPACE_ID}/scenes`;
});
after(async () => { await app?.close(); await fixture?.dispose(); });

async function loginAs(email: string) {
  const response = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', headers: { origin: fixture.config.APP_ORIGIN }, payload: { email, password: testAdministrator.password } });
  assert.equal(response.statusCode, 200, response.body);
  return { cookie: response.cookies.map(value => `${value.name}=${value.value}`).join('; '), origin: fixture.config.APP_ORIGIN };
}

test('creates and lists inventory panels under an exclusive inventory lease', async () => {
  const empty = await app.inject({ url: inventoryUrl, headers });
  assert.equal(empty.statusCode, 200, empty.body);
  assert.deepEqual(empty.json(), { lease: null, types: [], panels: [], ballast: { slabs: 0, straps: 0 } });
  assert.equal((await app.inject({ method: 'POST', url: `${inventoryUrl}/panels`, headers, payload: { label: 'Beispiel-P01', type: plain } })).statusCode, 423);
  assert.equal((await app.inject({ method: 'POST', url: `${inventoryUrl}/lease`, headers })).statusCode, 200);
  const created = await app.inject({ method: 'POST', url: `${inventoryUrl}/panels`, headers, payload: { label: 'Beispiel-P01', type: plain, note: null } });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json().label, 'Beispiel-P01');
  assert.equal(created.json().available, true);
  assert.equal(created.json().type.name, 'Beispiel-Glattwand');
  const listed = (await app.inject({ url: inventoryUrl, headers })).json<Inventory>();
  assert.equal(listed.panels.length, 1);
  assert.equal(listed.types[0]?.name, 'Beispiel-Glattwand');
  assert.equal(listed.lease?.holderName, testAdministrator.name);
  assert.equal((await app.inject({ method: 'POST', url: `${inventoryUrl}/panels`, headers, payload: { label: 'Beispiel-P01', type: plain } })).statusCode, 409);
});

test('assigns and unassigns a compatible panel; viewer cannot write; foreign workspace is hidden', async () => {
  const createdScene = await app.inject({ method: 'POST', url: scenesUrl, headers, payload: {
    productionName: 'Bestandprobe', venueName: 'Probesaal', sceneName: 'Szene A', width: 8000, depth: 6000,
  } });
  assert.equal(createdScene.statusCode, 201, createdScene.body);
  scene = createdScene.json();
  const wall = newWall(randomUUID(), 2000, 3000);
  const other = newWall(randomUUID(), 4000, 3000);
  assert.equal((await app.inject({ method: 'POST', url: `${scenesUrl}/${scene.id}/lease`, headers })).statusCode, 200);
  const saved = await app.inject({
    method: 'PUT', url: `${scenesUrl}/${scene.id}/layout`, headers,
    payload: { revision: 0, layout: { schemaVersion: 1, walls: [wall, other] } },
  });
  assert.equal(saved.statusCode, 200, saved.body);

  const listed = (await app.inject({ url: inventoryUrl, headers })).json<Inventory>();
  const panel = listed.panels[0]!;
  const assigned = await app.inject({
    method: 'POST', url: `${scenesUrl}/${scene.id}/walls/${wall.id}/assignment`, headers, payload: { panelId: panel.id },
  });
  assert.equal(assigned.statusCode, 200, assigned.body);
  const loaded = (await app.inject({ url: `${scenesUrl}/${scene.id}`, headers })).json<Scene>();
  assert.equal(loaded.layout.walls.find(item => item.id === wall.id)?.panelId, panel.id);
  assert.equal(loaded.layout.walls.find(item => item.id === other.id)?.panelId, undefined);
  const duplicate = await app.inject({
    method: 'POST', url: `${scenesUrl}/${scene.id}/walls/${other.id}/assignment`, headers, payload: { panelId: panel.id },
  });
  assert.equal(duplicate.statusCode, 400);
  assert.equal((await app.inject({ url: `${scenesUrl}/${scene.id}`, headers })).json<Scene>().layout.walls.find(item => item.id === other.id)?.panelId, undefined);

  await app.inject({ method: 'POST', url: `${inventoryUrl}/panels`, headers, payload: { label: 'Beispiel-T01', type: door } });
  const doorPanel = (await app.inject({ url: inventoryUrl, headers })).json<Inventory>().panels.find(item => item.label === 'Beispiel-T01')!;
  const incompatible = await app.inject({
    method: 'POST', url: `${scenesUrl}/${scene.id}/walls/${other.id}/assignment`, headers, payload: { panelId: doorPanel.id },
  });
  assert.equal(incompatible.statusCode, 400);

  const cleared = await app.inject({ method: 'DELETE', url: `${scenesUrl}/${scene.id}/walls/${wall.id}/assignment`, headers });
  assert.equal(cleared.statusCode, 200, cleared.body);
  assert.equal((await app.inject({ url: `${scenesUrl}/${scene.id}`, headers })).json<Scene>().layout.walls.find(item => item.id === wall.id)?.panelId, undefined);
  assert.equal((await app.inject({
    method: 'POST', url: `${scenesUrl}/${scene.id}/walls/${wall.id}/assignment`, headers, payload: { panelId: panel.id },
  })).statusCode, 200);

  const viewerId = randomUUID();
  await fixture.db.insert(user).values({ id: viewerId, name: 'Vera Viewer', email: 'vera-inv@example.test' });
  await fixture.db.insert(account).values({
    id: randomUUID(), userId: viewerId, accountId: viewerId, providerId: 'credential',
    password: await hashPassword(testAdministrator.password),
  });
  await fixture.db.insert(membership).values({ workspaceId: fixture.config.WORKSPACE_ID, userId: viewerId, role: 'viewer' });
  const viewer = await loginAs('vera-inv@example.test');
  assert.equal((await app.inject({ url: inventoryUrl, headers: viewer })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: `${inventoryUrl}/panels`, headers: viewer, payload: { label: 'Beispiel-X', type: plain } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: `${scenesUrl}/${scene.id}/walls/${other.id}/assignment`, headers: viewer, payload: { panelId: panel.id } })).statusCode, 403);

  const foreignId = randomUUID();
  await fixture.db.insert(workspace).values({ id: foreignId, name: 'Other workspace' });
  await fixture.db.insert(membership).values({ workspaceId: foreignId, userId: (await fixture.db.select().from(membership).where(eq(membership.workspaceId, fixture.config.WORKSPACE_ID)))[0]!.userId, role: 'editor' });
  assert.equal((await app.inject({ url: `/api/workspaces/${foreignId}/inventory`, headers })).statusCode, 200);
  assert.deepEqual((await app.inject({ url: `/api/workspaces/${foreignId}/inventory`, headers })).json().panels, []);
  assert.equal((await app.inject({ url: `/api/workspaces/${randomUUID()}/inventory`, headers })).statusCode, 404);
});

test('availability change keeps the scene reference and surfaces a warning', async () => {
  const loaded = (await app.inject({ url: `${scenesUrl}/${scene.id}`, headers })).json<Scene>();
  const wall = loaded.layout.walls.find(item => item.panelId)!;
  const panelId = wall.panelId!;
  const updated = await app.inject({
    method: 'PATCH', url: `${inventoryUrl}/panels/${panelId}`, headers, payload: { available: false, note: 'In Reparatur' },
  });
  assert.equal(updated.statusCode, 200, updated.body);
  assert.equal(updated.json().available, false);
  const reloaded = (await app.inject({ url: `${scenesUrl}/${scene.id}`, headers })).json<Scene>();
  assert.equal(reloaded.layout.walls.find(item => item.id === wall.id)?.panelId, panelId);
  const inventory = (await app.inject({ url: inventoryUrl, headers })).json<Inventory>();
  assert.equal(inventory.panels.find(item => item.id === panelId)?.available, false);
  const warnings = inventoryWarnings(reloaded.layout, inventory.panels);
  assert.equal(warnings.some(item => item.kind === 'unavailable' && item.panelId === panelId), true);
  assert.equal(reloaded.layout.walls.find(item => item.id === wall.id)?.panelId, panelId);

  const renamed = await app.inject({
    method: 'PATCH', url: `${inventoryUrl}/panels/${panelId}`, headers, payload: { label: 'Beispiel-P01-korrigiert', note: 'Erledigt' },
  });
  assert.equal(renamed.statusCode, 200, renamed.body);
  assert.equal(renamed.json().label, 'Beispiel-P01-korrigiert');
  assert.equal(renamed.json().note, 'Erledigt');
  const afterRename = (await app.inject({ url: `${scenesUrl}/${scene.id}`, headers })).json<Scene>();
  assert.equal(afterRename.layout.walls.find(item => item.id === wall.id)?.panelId, panelId);
  assert.equal((await app.inject({
    method: 'PATCH', url: `${inventoryUrl}/panels/${panelId}`, headers, payload: { label: 'Beispiel-T01' },
  })).statusCode, 409);
});

test('creates, updates and deletes stocked wall types under lease; geometry locks when panels use the type', async () => {
  const stocked = { ...newWallType(randomUUID()), name: 'Bestand-Katalogtyp', width: 1100, height: 2400, thickness: 28, openings: [] };
  assert.equal((await app.inject({ method: 'POST', url: `${inventoryUrl}/types`, headers, payload: stocked })).statusCode, 201);
  const renamed = { ...stocked, name: 'Bestand-Katalogtyp umbenannt', width: 1150 };
  const updated = await app.inject({ method: 'PUT', url: `${inventoryUrl}/types/${stocked.id}`, headers, payload: renamed });
  assert.equal(updated.statusCode, 200, updated.body);
  assert.equal(updated.json().name, 'Bestand-Katalogtyp umbenannt');
  assert.equal(updated.json().width, 1150);

  const panel = await app.inject({
    method: 'POST', url: `${inventoryUrl}/panels`, headers,
    payload: { label: 'Bestand-K01', type: renamed, note: null },
  });
  assert.equal(panel.statusCode, 201, panel.body);

  const geometryChange = await app.inject({
    method: 'PUT', url: `${inventoryUrl}/types/${stocked.id}`, headers,
    payload: { ...renamed, width: 1300 },
  });
  assert.equal(geometryChange.statusCode, 409);

  const nameOnly = await app.inject({
    method: 'PUT', url: `${inventoryUrl}/types/${stocked.id}`, headers,
    payload: { ...renamed, name: 'Bestand-Katalogtyp gesperrt' },
  });
  assert.equal(nameOnly.statusCode, 200, nameOnly.body);
  assert.equal(nameOnly.json().name, 'Bestand-Katalogtyp gesperrt');

  assert.equal((await app.inject({ method: 'DELETE', url: `${inventoryUrl}/types/${stocked.id}`, headers })).statusCode, 409);

  const unused = { ...newWallType(randomUUID()), name: 'Bestand-Unbenutzt', ...EXAMPLE_PLAIN };
  assert.equal((await app.inject({ method: 'POST', url: `${inventoryUrl}/types`, headers, payload: unused })).statusCode, 201);
  assert.equal((await app.inject({ method: 'DELETE', url: `${inventoryUrl}/types/${unused.id}`, headers })).statusCode, 200);
  assert.equal((await app.inject({ method: 'DELETE', url: `${inventoryUrl}/types/${unused.id}`, headers })).statusCode, 404);
  assert.equal((await app.inject({
    method: 'POST', url: `${inventoryUrl}/types`, headers, payload: { ...unused, id: stocked.id },
  })).statusCode, 409);
});

test('physical cutouts, actual finishes and deletion stay independent from frozen scene intent', async () => {
  await app.inject({ method: 'POST', url: `${inventoryUrl}/lease`, headers });
  const created = await app.inject({ method: 'POST', url: `${inventoryUrl}/panels`, headers, payload: { label: 'Finish-P01', type: plain } });
  assert.equal(created.statusCode, 201, created.body);
  const panelId = created.json().id;
  const cutout = { id: randomUUID(), left: 50, sill: 250, width: 80, height: 80 };
  const actual = { surfaces: { front: { full: { kind: 'paint', ral: '9010' } } }, description: 'White stock' };
  const patched = await app.inject({ method: 'PATCH', url: `${inventoryUrl}/panels/${panelId}`, headers, payload: { cutouts: [cutout], finish: actual, label: 'Finish-renamed' } });
  assert.equal(patched.statusCode, 200, patched.body);
  assert.equal(patched.json().label, 'Finish-renamed');
  assert.deepEqual(patched.json().cutouts, [cutout]);
  assert.equal((await app.inject({ method: 'PATCH', url: `${inventoryUrl}/panels/${panelId}`, headers, payload: { cutouts: [{ ...cutout, left: 5000 }] } })).statusCode, 400);
  const made = (await app.inject({ method: 'POST', url: scenesUrl, headers, payload: { productionName: 'Finish test', venueName: 'Room', sceneName: 'Painting', width: 8000, depth: 6000 } })).json<Scene>();
  await app.inject({ method: 'POST', url: `${scenesUrl}/${made.id}/lease`, headers });
  const wall = { ...newWall(randomUUID(), 1000, 2000), panelId, surfaces: { front: { full: { kind: 'paint', ral: '3020' } } } };
  const saved = await app.inject({ method: 'PUT', url: `${scenesUrl}/${made.id}/layout`, headers, payload: { revision: made.revision, layout: { schemaVersion: 1, walls: [wall], braces: [] } } });
  assert.equal(saved.statusCode, 200, saved.body);
  let loaded = (await app.inject({ url: `${scenesUrl}/${made.id}`, headers })).json<Scene>();
  const assignment = loaded.layout.walls[0]!.finishAssignment!;
  assert.ok(assignment?.id);
  const next = { ...loaded.layout, walls: [{ ...loaded.layout.walls[0]!, surfaces: actual.surfaces }] };
  assert.equal((await app.inject({ method: 'PUT', url: `${scenesUrl}/${made.id}/layout`, headers, payload: { revision: loaded.revision, layout: next } })).statusCode, 200);
  const stockBefore = (await app.inject({ url: inventoryUrl, headers })).json<Inventory>().panels.find(panel => panel.id === panelId)!;
  assert.deepEqual(stockBefore.currentFinish?.surfaces, actual.surfaces);
  assert.equal((await app.inject({ method: 'DELETE', url: `${inventoryUrl}/panels/${panelId}`, headers })).statusCode, 409);
  const completeUrl = `${inventoryUrl}/panels/${panelId}/finish-complete`;
  const completion = { sceneId: made.id, wallId: wall.id, assignmentId: assignment.id };
  assert.equal((await app.inject({ method: 'POST', url: completeUrl, headers, payload: { ...completion, assignmentId: randomUUID() } })).statusCode, 409);
  const completed = await app.inject({ method: 'POST', url: completeUrl, headers, payload: completion });
  assert.equal(completed.statusCode, 200, completed.body);
  assert.deepEqual(completed.json().currentFinish.surfaces, wall.surfaces);
  loaded = (await app.inject({ url: `${scenesUrl}/${made.id}`, headers })).json<Scene>();
  assert.deepEqual(loaded.layout.walls[0]!.surfaces, actual.surfaces);
  assert.deepEqual(loaded.layout.walls[0]!.finishAssignment, assignment);
  await app.inject({ method: 'DELETE', url: `${scenesUrl}/${made.id}/walls/${wall.id}/assignment`, headers });
  assert.equal((await app.inject({ method: 'POST', url: completeUrl, headers, payload: completion })).statusCode, 409);
  assert.equal((await app.inject({ method: 'DELETE', url: `${inventoryUrl}/panels/${panelId}`, headers })).statusCode, 200);
  assert.equal((await app.inject({ url: inventoryUrl, headers })).json<Inventory>().panels.some(panel => panel.id === panelId), false);
});
