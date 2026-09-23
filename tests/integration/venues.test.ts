import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import PDFDocument from 'pdfkit';
import { createApp } from '../../src/server/app.js';
import { bootstrapAdministrator } from '../../src/server/identity/bootstrap.js';
import { membership, workspace } from '../../src/server/db/schema.js';
import { renderConstructionPlan } from '../../src/server/exports/pdf.js';
import { millimetresPerUnit } from '../../src/shared/venue.js';
import { newCableRoutingCorridor, newConnectionPoint } from '../../src/shared/infrastructure.js';
import { type Scene } from '../../src/shared/layout.js';
import { newReportTemplate } from '../../src/shared/reportTemplate.js';
import { AUDIENCE_FLOOR_ID, newPlatform, newStair } from '../../src/shared/levels.js';
import { newOverheadBox } from '../../src/shared/overhead.js';
import { newKeepClearZone } from '../../src/shared/keepClear.js';
import { newPlaceholder } from '../../src/shared/placeholders.js';
import { testAdministrator, testDatabase } from '../helpers/database.js';
import { pngBytes, twoPagePdf } from '../helpers/references.js';

let fixture: Awaited<ReturnType<typeof testDatabase>>;
let app: Awaited<ReturnType<typeof createApp>>;
let headers: { cookie: string; origin: string };
let scenes: string;
let scene: Scene;
const input = { productionName: 'Beispielproduktion', venueName: 'Beispielsaal', sceneName: 'Erste Szene', width: 8000, depth: 6000 };
const outline = [
  { x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4200, y: 3500 }, { x: 200, y: 3200 },
];

before(async () => {
  fixture = await testDatabase();
  await bootstrapAdministrator(fixture.db, fixture.config, testAdministrator);
  app = await createApp(fixture.db, fixture.config, { renderPdf: renderConstructionPlan });
  const login = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: testAdministrator });
  assert.equal(login.statusCode, 200);
  headers = { cookie: login.cookies.map(value => `${value.name}=${value.value}`).join('; '), origin: fixture.config.APP_ORIGIN };
  scenes = `/api/workspaces/${fixture.config.WORKSPACE_ID}/scenes`;
  const created = await app.inject({ method: 'POST', url: scenes, headers, payload: input });
  assert.equal(created.statusCode, 201, created.body);
  scene = created.json();
});
after(async () => { await app?.close(); await fixture?.dispose(); });

function references() {
  return `/api/workspaces/${fixture.config.WORKSPACE_ID}/venue-references`;
}

test('uploads a workspace-authorized image and PDF; other workspaces and invalid files are rejected', async () => {
  const image = await app.inject({
    method: 'POST', url: references(), headers: { ...headers, 'content-type': 'image/png', 'x-file-name': 'grundriss.png' },
    payload: pngBytes(),
  });
  assert.equal(image.statusCode, 201, image.body);
  const stored = image.json();
  assert.equal(stored.kind, 'image');
  assert.equal(stored.pixelWidth, 8);
  assert.equal(stored.pixelHeight, 4);
  assert.equal(stored.originalName, 'grundriss.png');
  const pdf = await app.inject({
    method: 'POST', url: references(), headers: { ...headers, 'content-type': 'application/pdf', 'x-file-name': 'saal.pdf' },
    payload: await twoPagePdf(),
  });
  assert.equal(pdf.statusCode, 201, pdf.body);
  assert.equal(pdf.json().kind, 'pdf');
  assert.equal(pdf.json().pageCount, 2);
  const bytes = await app.inject({ url: `${references()}/${stored.id}/file`, headers });
  assert.equal(bytes.statusCode, 200);
  assert.equal(bytes.headers['content-type'], 'image/png');
  assert.deepEqual(Buffer.from(bytes.rawPayload), pngBytes());
  assert.equal((await app.inject({
    method: 'POST', url: references(), headers: { ...headers, 'content-type': 'image/png', 'x-file-name': 'nein.txt' },
    payload: Buffer.from('not an image'),
  })).statusCode, 400);
  assert.equal((await app.inject({
    method: 'POST', url: references(), headers: { ...headers, 'content-type': 'application/pdf', 'x-file-name': 'nein.pdf' },
    payload: Buffer.from('%PDF-broken'),
  })).statusCode, 400);
  const foreignId = randomUUID();
  await fixture.db.insert(workspace).values({ id: foreignId, name: 'Other workspace' });
  const [member] = await fixture.db.select().from(membership);
  await fixture.db.insert(membership).values({ workspaceId: foreignId, userId: member!.userId, role: 'editor' });
  assert.equal((await app.inject({ url: `/api/workspaces/${foreignId}/venue-references/${stored.id}/file`, headers })).statusCode, 404);
  assert.equal((await app.inject({
    method: 'POST', url: `/api/workspaces/${randomUUID()}/venue-references`,
    headers: { ...headers, 'content-type': 'image/png', 'x-file-name': 'fremd.png' }, payload: pngBytes(),
  })).statusCode, 404);
  assert.equal((await app.inject({
    method: 'PUT', url: `${scenes}/${scene.id}/venue`, headers,
    payload: { venue: { schemaVersion: 1, width: 8000, depth: 6000, outline } },
  })).statusCode, 423);
});

test('saves a measured outline and calibration that survive reload', async () => {
  assert.equal((await app.inject({ method: 'POST', url: `${scenes}/${scene.id}/lease`, headers })).statusCode, 200);
  const uploaded = await app.inject({
    method: 'POST', url: references(), headers: { ...headers, 'content-type': 'application/pdf', 'x-file-name': 'spur.pdf' },
    payload: await twoPagePdf(),
  });
  assert.equal(uploaded.statusCode, 201, uploaded.body);
  const calibration = { pointA: { x: 0, y: 0 }, pointB: { x: 30, y: 40 }, distanceMm: 5000 };
  assert.equal(millimetresPerUnit(calibration), 100);
  const saved = await app.inject({
    method: 'PUT', url: `${scenes}/${scene.id}/venue`, headers,
    payload: {
      venue: {
        schemaVersion: 1, width: 8000, depth: 6000, outline,
        trace: { fileId: uploaded.json().id, page: 2, calibration },
      },
    },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const loaded = (await app.inject({ url: `${scenes}/${scene.id}`, headers })).json<Scene>();
  assert.deepEqual(loaded.venue.outline, outline);
  assert.deepEqual(loaded.venue.trace, { fileId: uploaded.json().id, page: 2, calibration });
  assert.equal((await app.inject({
    method: 'PUT', url: `${scenes}/${scene.id}/venue`, headers,
    payload: { venue: { schemaVersion: 1, width: 8000, depth: 6000, outline: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }] } },
  })).statusCode, 400);
});

test('saves connection pins and corridors, freeze keeps them, later edits and other workspaces cannot change the snapshot', async () => {
  const current = (await app.inject({ url: `${scenes}/${scene.id}`, headers })).json<Scene>();
  const connectionPoints = [
    { ...newConnectionPoint(randomUUID(), 'power', 2500, 1800), label: 'Lichtstrom', notes: '16A an der Bühnenkante' },
    newConnectionPoint(randomUUID(), 'audio', 4100, 600),
  ];
  const cableRoutingCorridors = [
    { ...newCableRoutingCorridor(randomUUID(), [{ x: 0, y: 1200 }, { x: 4000, y: 1200 }]), label: 'Seitenbühne', notes: 'am Boden' },
  ];
  const saved = await app.inject({
    method: 'PUT', url: `${scenes}/${scene.id}/venue`, headers,
    payload: { venue: { ...current.venue, connectionPoints, cableRoutingCorridors } },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const loaded = (await app.inject({ url: `${scenes}/${scene.id}`, headers })).json<Scene>();
  assert.deepEqual(loaded.venue.connectionPoints, connectionPoints);
  assert.deepEqual(loaded.venue.cableRoutingCorridors, cableRoutingCorridors);
  const frozen = await app.inject({ method: 'POST', url: `${scenes}/${scene.id}/exports`, headers, payload: { name: 'Mit Anschlüssen' } });
  assert.equal(frozen.statusCode, 201, frozen.body);
  const original = Buffer.from((await app.inject({ url: `${scenes}/${scene.id}/exports/${frozen.json().id}/file`, headers })).rawPayload);
  assert.equal(original.subarray(0, 5).toString(), '%PDF-');
  const shown = [...original.toString('latin1').matchAll(/<([0-9a-fA-F]+)>/g)]
    .map(match => Buffer.from(match[1] ?? '', 'hex').toString('latin1')).join('');
  assert(shown.includes('Lichtstrom'), shown);
  const moved = connectionPoints.map((pin, index) => index ? pin : { ...pin, x: 100 });
  assert.equal((await app.inject({
    method: 'PUT', url: `${scenes}/${scene.id}/venue`, headers,
    payload: { venue: { ...loaded.venue, connectionPoints: moved, cableRoutingCorridors: [] } },
  })).statusCode, 200);
  const again = Buffer.from((await app.inject({ url: `${scenes}/${scene.id}/exports/${frozen.json().id}/file`, headers })).rawPayload);
  assert.deepEqual(again, original);
  const after = (await app.inject({ url: `${scenes}/${scene.id}`, headers })).json<Scene>();
  assert.equal(after.venue.connectionPoints?.[0]?.x, 100);
  assert.deepEqual(after.venue.cableRoutingCorridors, []);
  const foreignId = randomUUID();
  await fixture.db.insert(workspace).values({ id: foreignId, name: 'Fremde Spielstätte' });
  const [member] = await fixture.db.select().from(membership);
  await fixture.db.insert(membership).values({ workspaceId: foreignId, userId: member!.userId, role: 'editor' });
  assert.equal((await app.inject({
    method: 'PUT', url: `/api/workspaces/${foreignId}/scenes/${scene.id}/venue`, headers,
    payload: { venue: { schemaVersion: 1, width: 8000, depth: 6000, connectionPoints, cableRoutingCorridors } },
  })).statusCode, 404);
  await fixture.db.update(membership).set({ role: 'viewer' }).where(eq(membership.workspaceId, fixture.config.WORKSPACE_ID));
  assert.equal((await app.inject({
    method: 'PUT', url: `${scenes}/${scene.id}/venue`, headers,
    payload: { venue: { ...after.venue, connectionPoints, cableRoutingCorridors } },
  })).statusCode, 403);
  await fixture.db.update(membership).set({ role: 'administrator' }).where(eq(membership.workspaceId, fixture.config.WORKSPACE_ID));
});
test('saves permanent platforms and stairs on the pinned venue version', async () => {
  const loaded = (await app.inject({ url: `${scenes}/${scene.id}`, headers })).json<Scene>();
  const platform = newPlatform(randomUUID(), 4000, 4750);
  const stair = newStair(randomUUID(), AUDIENCE_FLOOR_ID, platform.id, 4000, 2500);
  const saved = await app.inject({
    method: 'PUT', url: `${scenes}/${scene.id}/venue`, headers,
    payload: { venue: { ...loaded.venue, platforms: [platform], stairs: [stair] } },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const again = (await app.inject({ url: `${scenes}/${scene.id}`, headers })).json<Scene>();
  assert.equal(again.venue.platforms?.[0]?.elevation, 400);
  assert.equal(again.venue.stairs?.[0]?.width, 1200);
  assert.deepEqual(again.venue.outline, outline);
  assert.notEqual(again.venueVersionId, loaded.venueVersionId);
});

test('saves a ceiling limit and rectangular overhead boxes on the pinned venue version', async () => {
  const loaded = (await app.inject({ url: `${scenes}/${scene.id}`, headers })).json<Scene>();
  const boxes = [
    { ...newOverheadBox(randomUUID(), 2500, 1800), label: 'Lüftung' },
    newOverheadBox(randomUUID(), 5000, 4000),
  ];
  const saved = await app.inject({
    method: 'PUT', url: `${scenes}/${scene.id}/venue`, headers,
    payload: { venue: { ...loaded.venue, ceilingHeight: 4000, overheadBoxes: boxes } },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const again = (await app.inject({ url: `${scenes}/${scene.id}`, headers })).json<Scene>();
  assert.equal(again.venue.ceilingHeight, 4000);
  assert.equal(again.venue.overheadBoxes?.length, 2);
  assert.equal(again.venue.overheadBoxes?.[0]?.bottomHeight, 2600);
  assert.equal(again.venue.overheadBoxes?.[0]?.thickness, 400);
  assert.notEqual(again.venueVersionId, loaded.venueVersionId);
});
test('saves keep-clear zones on the pinned venue version', async () => {
  const loaded = (await app.inject({ url: `${scenes}/${scene.id}`, headers })).json<Scene>();
  const zone = { ...newKeepClearZone(randomUUID(), AUDIENCE_FLOOR_ID, 1000, 500), label: 'Notausgang Ost', reason: 'Notausgang' };
  const saved = await app.inject({
    method: 'PUT', url: `${scenes}/${scene.id}/venue`, headers,
    payload: { venue: { ...loaded.venue, keepClearZones: [zone] } },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const again = (await app.inject({ url: `${scenes}/${scene.id}`, headers })).json<Scene>();
  assert.equal(again.venue.keepClearZones?.[0]?.label, 'Notausgang Ost');
  assert.equal(again.venue.keepClearZones?.[0]?.reason, 'Notausgang');
  assert.equal(again.venue.keepClearZones?.[0]?.supportingSurfaceId, AUDIENCE_FLOOR_ID);
  assert.deepEqual(again.venue.keepClearZones?.[0]?.polygon, zone.polygon);
  assert.notEqual(again.venueVersionId, loaded.venueVersionId);
  assert.deepEqual(again.venue.outline, outline);
});

test('saves audience chairs as venue placeholders on the pinned venue version', async () => {
  const loaded = (await app.inject({ url: `${scenes}/${scene.id}`, headers })).json<Scene>();
  const chair = newPlaceholder('chair', randomUUID(), 1200, 800);
  const saved = await app.inject({
    method: 'PUT', url: `${scenes}/${scene.id}/venue`, headers,
    payload: { venue: { ...loaded.venue, placeholders: [chair] } },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const again = (await app.inject({ url: `${scenes}/${scene.id}`, headers })).json<Scene>();
  assert.equal(again.venue.placeholders?.[0]?.kind, 'chair');
  assert.equal(again.venue.placeholders?.[0]?.x, 1200);
  assert.notEqual(again.venueVersionId, loaded.venueVersionId);
});

test('saves a stage centreline, freeze keeps it, later centreline edits do not change the stored PDF', async () => {
  const loaded = (await app.inject({ url: `${scenes}/${scene.id}`, headers })).json<Scene>();
  const stageCentreline = { x: 4000, y: 3000, rotation: 90 };
  const saved = await app.inject({
    method: 'PUT', url: `${scenes}/${scene.id}/venue`, headers,
    payload: { venue: { ...loaded.venue, stageCentreline } },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const again = (await app.inject({ url: `${scenes}/${scene.id}`, headers })).json<Scene>();
  assert.deepEqual(again.venue.stageCentreline, { x: 4000, y: 3000, rotation: 90 });
  const frozen = await app.inject({ method: 'POST', url: `${scenes}/${scene.id}/exports`, headers, payload: { name: 'Mit Mittellinie' } });
  assert.equal(frozen.statusCode, 201, frozen.body);
  const original = Buffer.from((await app.inject({ url: `${scenes}/${scene.id}/exports/${frozen.json().id}/file`, headers })).rawPayload);
  const shown = [...original.toString('latin1').matchAll(/<([0-9a-fA-F]+)>/g)]
    .map(match => Buffer.from(match[1] ?? '', 'hex').toString('latin1')).join('');
  assert(shown.includes('Mittellinie'), shown);
  assert.equal((await app.inject({
    method: 'PUT', url: `${scenes}/${scene.id}/venue`, headers,
    payload: { venue: { ...again.venue, stageCentreline: { x: 100, y: 200, rotation: 15 } } },
  })).statusCode, 200);
  const later = Buffer.from((await app.inject({ url: `${scenes}/${scene.id}/exports/${frozen.json().id}/file`, headers })).rawPayload);
  assert.deepEqual(later, original);
  const current = (await app.inject({ url: `${scenes}/${scene.id}`, headers })).json<Scene>();
  assert.deepEqual(current.venue.stageCentreline, { x: 100, y: 200, rotation: 15 });
});

test('frozen exports keep the measured outline and can still fetch the referenced source after later venue edits', async () => {
  const loaded = (await app.inject({ url: `${scenes}/${scene.id}`, headers })).json<Scene>();
  const fileId = loaded.venue.trace?.fileId;
  assert.equal(typeof fileId, 'string');
  assert.equal(loaded.venue.platforms?.[0]?.elevation, 400);
  const frozen = await app.inject({ method: 'POST', url: `${scenes}/${scene.id}/exports`, headers, payload: { name: 'Mit Umriss' } });
  assert.equal(frozen.statusCode, 201, frozen.body);
  const original = Buffer.from((await app.inject({ url: `${scenes}/${scene.id}/exports/${frozen.json().id}/file`, headers })).rawPayload);
  assert.equal(original.subarray(0, 5).toString(), '%PDF-');
  const laterOutline = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }];
  const replacement = await app.inject({
    method: 'POST', url: references(), headers: { ...headers, 'content-type': 'image/png', 'x-file-name': 'neu.png' },
    payload: pngBytes(),
  });
  assert.equal((await app.inject({
    method: 'PUT', url: `${scenes}/${scene.id}/venue`, headers,
    payload: { venue: { schemaVersion: 1, width: 1000, depth: 1000, outline: laterOutline, trace: { fileId: replacement.json().id } } },
  })).statusCode, 200);
  const again = Buffer.from((await app.inject({ url: `${scenes}/${scene.id}/exports/${frozen.json().id}/file`, headers })).rawPayload);
  assert.deepEqual(again, original);
  const source = await app.inject({ url: `${references()}/${fileId}/file`, headers });
  assert.equal(source.statusCode, 200);
  assert.equal(source.headers['content-type'], 'application/pdf');
  const current = (await app.inject({ url: `${scenes}/${scene.id}`, headers })).json<Scene>();
  assert.deepEqual(current.venue.outline, laterOutline);
  await fixture.db.update(membership).set({ role: 'viewer' }).where(eq(membership.workspaceId, fixture.config.WORKSPACE_ID));
  assert.equal((await app.inject({ url: `${references()}/${fileId}/file`, headers })).statusCode, 200);
  assert.equal((await app.inject({
    method: 'POST', url: references(), headers: { ...headers, 'content-type': 'image/png', 'x-file-name': 'viewer.png' },
    payload: pngBytes(),
  })).statusCode, 403);
  assert.equal((await app.inject({
    method: 'PUT', url: `${scenes}/${scene.id}/venue`, headers,
    payload: { venue: { schemaVersion: 1, width: 8000, depth: 6000, outline } },
  })).statusCode, 403);
});

test('renames a venue and shows the new name on the scene', async () => {
  await fixture.db.update(membership).set({ role: 'administrator' }).where(eq(membership.workspaceId, fixture.config.WORKSPACE_ID));
  const venues = `/api/workspaces/${fixture.config.WORKSPACE_ID}/venues`;
  const listed = await app.inject({ url: venues, headers });
  assert.equal(listed.statusCode, 200, listed.body);
  const venueId = listed.json().find((item: { name: string }) => item.name === 'Beispielsaal')?.id
    ?? listed.json()[0]?.id;
  assert.ok(venueId);
  const renamed = await app.inject({
    method: 'PATCH', url: `${venues}/${venueId}`, headers,
    payload: { name: 'Probesaal Ost' },
  });
  assert.equal(renamed.statusCode, 200, renamed.body);
  assert.equal(renamed.json().name, 'Probesaal Ost');
  assert.equal(renamed.json().venueVersionId, listed.json().find((item: { id: string }) => item.id === venueId)?.venueVersionId);
  const again = (await app.inject({ url: `${scenes}/${scene.id}`, headers })).json<Scene>();
  assert.equal(again.venueName, 'Probesaal Ost');
  assert.equal((await app.inject({
    method: 'PATCH', url: `${venues}/${venueId}`, headers,
    payload: { name: '   ' },
  })).statusCode, 400);
});

test('PATCH report-templates updates only templates and scene PUT venue round-trips them', async () => {
  await fixture.db.update(membership).set({ role: 'administrator' }).where(eq(membership.workspaceId, fixture.config.WORKSPACE_ID));
  const template = newReportTemplate(randomUUID(), 'Saalblatt');
  template.pages[0]!.frames = template.pages[0]!.frames.map(frame =>
    frame.kind === 'plan' ? { ...frame, planScope: 'scenery' as const } : frame.kind === 'view3d' ? { ...frame, view: 'front' as const } : frame);
  assert.equal((await app.inject({ method: 'POST', url: `${scenes}/${scene.id}/lease`, headers, payload: {} })).statusCode, 200);
  const before = (await app.inject({ url: `${scenes}/${scene.id}`, headers })).json<Scene>();
  const patched = await app.inject({
    method: 'PATCH', url: `${scenes}/${scene.id}/venue/report-templates`, headers,
    payload: { reportTemplates: [template] },
  });
  assert.equal(patched.statusCode, 200, patched.body);
  const body = patched.json();
  assert.equal(body.venue.reportTemplates?.[0]!.name, 'Saalblatt');
  assert.equal(body.venue.reportTemplates?.[0]!.pages[0]!.frames.find((frame: { kind: string }) => frame.kind === 'plan')?.planScope, 'scenery');
  assert.equal(body.venue.reportTemplates?.[0]!.pages[0]!.frames.find((frame: { kind: string }) => frame.kind === 'view3d')?.view, 'front');
  assert.equal(body.venue.width, before.venue.width);
  assert.equal(body.venue.depth, before.venue.depth);
  assert.deepEqual(body.venue.outline, before.venue.outline);
  const loaded = (await app.inject({ url: `${scenes}/${scene.id}`, headers })).json<Scene>();
  assert.equal(loaded.venue.reportTemplates?.[0]!.id, template.id);
  const nextTemplate = { ...template, name: 'Saalblatt v2' };
  const saved = await app.inject({
    method: 'PUT', url: `${scenes}/${scene.id}/venue`, headers,
    payload: { venue: { ...loaded.venue, reportTemplates: [nextTemplate] } },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().venue.reportTemplates?.[0]!.name, 'Saalblatt v2');
  const afterLayout = await app.inject({
    method: 'PUT', url: `${scenes}/${scene.id}/layout`, headers,
    payload: {
      revision: saved.json().revision,
      layout: { ...loaded.layout, reportTemplates: [newReportTemplate(randomUUID(), 'should-strip')] },
    },
  });
  assert.equal(afterLayout.statusCode, 200, afterLayout.body);
  const final = (await app.inject({ url: `${scenes}/${scene.id}`, headers })).json<Scene>();
  assert.equal(final.layout.reportTemplates, undefined);
  assert.equal(final.venue.reportTemplates?.[0]!.name, 'Saalblatt v2');
});
