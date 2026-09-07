import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/server/app.js';
import { bootstrapAdministrator } from '../../src/server/identity/bootstrap.js';
import { membership, workspace } from '../../src/server/db/schema.js';
import { renderConstructionPlan } from '../../src/server/exports/pdf.js';
import { newBrace, newWall, type Scene } from '../../src/shared/layout.js';
import { formGroup } from '../../src/shared/groups.js';
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
  assert.equal(revision.paper, 'A4');
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

test('freeze then a later brace move does not change stored snapshot or PDF geometry', async () => {
  const created = await app.inject({ method: 'POST', url: base, headers, payload: { ...input, sceneName: 'Stützenfassung' } });
  assert.equal(created.statusCode, 201, created.body);
  const sceneId = created.json().id as string;
  const brace = newBrace(randomUUID(), 2000, 3000);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/${sceneId}/lease`, headers })).statusCode, 200);
  assert.equal((await app.inject({
    method: 'PUT', url: `${base}/${sceneId}/layout`, headers,
    payload: { revision: 0, layout: { schemaVersion: 1, walls: [], braces: [brace] } },
  })).statusCode, 200);
  const frozen = await app.inject({ method: 'POST', url: `${base}/${sceneId}/exports`, headers, payload: { name: 'Stützenplan' } });
  assert.equal(frozen.statusCode, 201, frozen.body);
  const original = Buffer.from((await app.inject({ url: `${base}/${sceneId}/exports/${frozen.json().id}/file`, headers })).rawPayload);
  const originalX = firstWallX(original);
  assert.equal((await app.inject({
    method: 'PUT', url: `${base}/${sceneId}/layout`, headers,
    payload: { revision: 1, layout: { schemaVersion: 1, walls: [], braces: [{ ...brace, x: 9000 }] } },
  })).statusCode, 200);
  const again = Buffer.from((await app.inject({ url: `${base}/${sceneId}/exports/${frozen.json().id}/file`, headers })).rawPayload);
  assert.deepEqual(again, original);
  const later = await app.inject({ method: 'POST', url: `${base}/${sceneId}/exports`, headers, payload: { name: 'Verschobene Stütze' } });
  assert.equal(later.statusCode, 201, later.body);
  assert.notEqual(firstWallX(Buffer.from((await app.inject({ url: `${base}/${sceneId}/exports/${later.json().id}/file`, headers })).rawPayload)), originalX);
});

test('freeze then later assembly edits do not change stored snapshot labels or notes', async () => {
  const created = await app.inject({ method: 'POST', url: base, headers, payload: { ...input, sceneName: 'Montagefassung' } });
  assert.equal(created.statusCode, 201, created.body);
  const sceneId = created.json().id as string;
  const left = { ...newWall(randomUUID(), 1000, 2000), assemblyNumber: 1 };
  const right = { ...newWall(randomUUID(), 5000, 2000), assemblyNumber: 2 };
  const connection = { id: randomUUID(), a: left.id, b: right.id };
  assert.equal((await app.inject({ method: 'POST', url: `${base}/${sceneId}/lease`, headers })).statusCode, 200);
  assert.equal((await app.inject({
    method: 'PUT', url: `${base}/${sceneId}/layout`, headers,
    payload: {
      revision: 0, layout: {
        schemaVersion: 1, walls: [left, right], connections: [connection], riggingNotes: 'Stifte an Position 1 belassen.',
      },
    },
  })).statusCode, 200);
  const frozen = await app.inject({ method: 'POST', url: `${base}/${sceneId}/exports`, headers, payload: { name: 'Montageplan' } });
  assert.equal(frozen.statusCode, 201, frozen.body);
  function pdfText(bytes: Buffer) {
    return [...bytes.toString('latin1').matchAll(/<([0-9a-fA-F]+)>/g)]
      .map(match => Buffer.from(match[1] ?? '', 'hex').toString('latin1')).join('');
  }
  const original = Buffer.from((await app.inject({ url: `${base}/${sceneId}/exports/${frozen.json().id}/file`, headers })).rawPayload);
  const originalText = pdfText(original);
  assert(originalText.includes('Position 1'), originalText);
  assert(originalText.includes('Stifte an Position 1 belassen.'), originalText);
  assert(originalText.includes('Verbindungskompatibilität prüft die Crew manuell'), originalText);
  assert.equal((await app.inject({
    method: 'PUT', url: `${base}/${sceneId}/layout`, headers,
    payload: {
      revision: 1, layout: {
        schemaVersion: 1, walls: [{ ...left, assemblyNumber: 9, x: 9000 }, right],
        connections: [], riggingNotes: 'Geändert nach dem Export.',
      },
    },
  })).statusCode, 200);
  const again = Buffer.from((await app.inject({ url: `${base}/${sceneId}/exports/${frozen.json().id}/file`, headers })).rawPayload);
  assert.deepEqual(again, original);
  const later = await app.inject({ method: 'POST', url: `${base}/${sceneId}/exports`, headers, payload: { name: 'Geänderte Montage' } });
  assert.equal(later.statusCode, 201, later.body);
  const laterText = pdfText(Buffer.from((await app.inject({ url: `${base}/${sceneId}/exports/${later.json().id}/file`, headers })).rawPayload));
  assert(laterText.includes('Position 9'), laterText);
  assert(laterText.includes('Geändert nach dem Export.'), laterText);
  assert(!laterText.includes('Stifte an Position 1 belassen.'), laterText);
});

test('freeze with paper and scale stores them and later layout edits keep the same pagination', async () => {
  const created = await app.inject({ method: 'POST', url: base, headers, payload: { ...input, sceneName: 'Kachelszene', width: 20000, depth: 6000 } });
  assert.equal(created.statusCode, 201, created.body);
  const sceneId = created.json().id as string;
  const left = newWall(randomUUID(), 2000, 3000);
  const right = newWall(randomUUID(), 18000, 3000);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/${sceneId}/lease`, headers })).statusCode, 200);
  assert.equal((await app.inject({
    method: 'PUT', url: `${base}/${sceneId}/layout`, headers,
    payload: { revision: 0, layout: { schemaVersion: 1, walls: [left, right] } },
  })).statusCode, 200);
  const tiled = await app.inject({
    method: 'POST', url: `${base}/${sceneId}/exports`, headers,
    payload: { name: 'A4-Kachel', paper: 'A4', scale: 50 },
  });
  assert.equal(tiled.statusCode, 201, tiled.body);
  assert.equal(tiled.json().paper, 'A4');
  assert.equal(tiled.json().scale, 50);
  const tiledPdf = Buffer.from((await app.inject({ url: `${base}/${sceneId}/exports/${tiled.json().id}/file`, headers })).rawPayload);
  assert.equal([...tiledPdf.toString('latin1').matchAll(/\/Type \/Page(?!s)/g)].length, 3);
  const a3 = await app.inject({
    method: 'POST', url: `${base}/${sceneId}/exports`, headers,
    payload: { name: 'A3-Detail', paper: 'A3', scale: 25 },
  });
  assert.equal(a3.statusCode, 201, a3.body);
  assert.equal(a3.json().paper, 'A3');
  assert.equal(a3.json().scale, 25);
  const original = Buffer.from((await app.inject({ url: `${base}/${sceneId}/exports/${a3.json().id}/file`, headers })).rawPayload);
  assert.match(original.toString('latin1'), /\/MediaBox \[0 0 841\.89 1190\.55\]/);
  assert.equal((await app.inject({
    method: 'PUT', url: `${base}/${sceneId}/layout`, headers,
    payload: { revision: 1, layout: { schemaVersion: 1, walls: [{ ...left, x: 1000 }, { ...right, x: 17000 }] } },
  })).statusCode, 200);
  const again = Buffer.from((await app.inject({ url: `${base}/${sceneId}/exports/${a3.json().id}/file`, headers })).rawPayload);
  assert.deepEqual(again, original);
  const listing = await app.inject({ url: `${base}/${sceneId}/exports`, headers });
  assert.equal(listing.statusCode, 200);
  assert.equal(listing.json().find((item: { name: string }) => item.name === 'A3-Detail')?.paper, 'A3');
});

test('retry after a failed A3 freeze uses the same frozen paper and scale', async () => {
  const created = await app.inject({ method: 'POST', url: base, headers, payload: { ...input, sceneName: 'Wiederholungskachel' } });
  assert.equal(created.statusCode, 201, created.body);
  const sceneId = created.json().id as string;
  assert.equal((await app.inject({ method: 'POST', url: `${base}/${sceneId}/lease`, headers })).statusCode, 200);
  assert.equal((await app.inject({
    method: 'PUT', url: `${base}/${sceneId}/layout`, headers,
    payload: { revision: 0, layout: { schemaVersion: 1, walls: [newWall(randomUUID(), 2000, 3000)] } },
  })).statusCode, 200);
  failRender = true;
  const frozen = await app.inject({
    method: 'POST', url: `${base}/${sceneId}/exports`, headers,
    payload: { name: 'A3-Wiederholung', paper: 'A3', scale: 100 },
  });
  assert.equal(frozen.statusCode, 201, frozen.body);
  assert.equal(frozen.json().status, 'failed');
  assert.equal(frozen.json().paper, 'A3');
  assert.equal(frozen.json().scale, 100);
  failRender = false;
  const retried = await app.inject({ method: 'POST', url: `${base}/${sceneId}/exports/${frozen.json().id}/retry`, headers, payload: {} });
  assert.equal(retried.statusCode, 200, retried.body);
  assert.equal(retried.json().status, 'ready');
  assert.equal(retried.json().paper, 'A3');
  assert.equal(retried.json().scale, 100);
  const pdf = Buffer.from((await app.inject({ url: `${base}/${sceneId}/exports/${frozen.json().id}/file`, headers })).rawPayload);
  assert.match(pdf.toString('latin1'), /\/MediaBox \[0 0 841\.89 1190\.55\]/);
});

test('freeze with selected groups keeps elevation pages after later ungrouping and wall moves', async () => {
  const created = await app.inject({ method: 'POST', url: base, headers, payload: { ...input, sceneName: 'Ansichtsszene' } });
  assert.equal(created.statusCode, 201, created.body);
  const sceneId = created.json().id as string;
  const front = { ...newWall(randomUUID(), 2000, 3000), label: 'Frontwand' };
  const side = { ...newWall(randomUUID(), 2600, 3600), rotation: 90, label: 'Seitenwand' };
  const groupId = randomUUID();
  const grouped = formGroup(
    { schemaVersion: 1 as const, walls: [front, side], braces: [] },
    [{ kind: 'wall', id: front.id }, { kind: 'wall', id: side.id }],
    groupId,
  );
  assert.equal((await app.inject({ method: 'POST', url: `${base}/${sceneId}/lease`, headers })).statusCode, 200);
  assert.equal((await app.inject({
    method: 'PUT', url: `${base}/${sceneId}/layout`, headers,
    payload: { revision: 0, layout: grouped },
  })).statusCode, 200);
  const frozen = await app.inject({
    method: 'POST', url: `${base}/${sceneId}/exports`, headers,
    payload: { name: 'Ansichtsfassung', elevationGroupIds: [groupId] },
  });
  assert.equal(frozen.statusCode, 201, frozen.body);
  function pdfText(bytes: Buffer) {
    return [...bytes.toString('latin1').matchAll(/<([0-9a-fA-F]+)>/g)]
      .map(match => Buffer.from(match[1] ?? '', 'hex').toString('latin1')).join('');
  }
  const original = Buffer.from((await app.inject({ url: `${base}/${sceneId}/exports/${frozen.json().id}/file`, headers })).rawPayload);
  const originalText = pdfText(original);
  assert(originalText.includes('Frontansicht'), originalText);
  assert(originalText.includes('Ansicht 0°'), originalText);
  assert(originalText.includes('Ansicht 90°'), originalText);
  assert(originalText.includes('Maßstab 1:50'), originalText);
  assert.equal((await app.inject({
    method: 'PUT', url: `${base}/${sceneId}/layout`, headers,
    payload: { revision: 1, layout: { schemaVersion: 1, walls: [{ ...front, x: 9000 }, { ...side, x: 8000, rotation: 0 }], braces: [] } },
  })).statusCode, 200);
  const again = Buffer.from((await app.inject({ url: `${base}/${sceneId}/exports/${frozen.json().id}/file`, headers })).rawPayload);
  assert.deepEqual(again, original);
  const later = await app.inject({ method: 'POST', url: `${base}/${sceneId}/exports`, headers, payload: { name: 'Ohne Ansichten' } });
  assert.equal(later.statusCode, 201, later.body);
  const laterText = pdfText(Buffer.from((await app.inject({ url: `${base}/${sceneId}/exports/${later.json().id}/file`, headers })).rawPayload));
  assert(!laterText.includes('Frontansicht'), laterText);
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
