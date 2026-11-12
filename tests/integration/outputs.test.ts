import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createApp } from '../../src/server/app.js';
import { constructionPackage } from '../../src/server/db/schema.js';
import { bootstrapAdministrator } from '../../src/server/identity/bootstrap.js';
import { CONSTRUCTION_SNAPSHOT_VERSION, constructionSnapshotSchema } from '../../src/shared/export.js';
import { frozenLists } from '../../src/shared/frozenParts.js';
import type { LayoutObject, Scene } from '../../src/shared/layout.js';
import type { BuildLists } from '../../src/shared/partLists.js';
import { STARTER_MATERIALS } from '../../src/shared/parts/starter/materials.js';
import { STARTER_PART_IDS } from '../../src/shared/parts/starter/index.js';
import type { ProductionStockDemand } from '../../src/shared/stockDemand.js';
import { testAdministrator, testDatabase } from '../helpers/database.js';

let fixture: Awaited<ReturnType<typeof testDatabase>>;
let app: Awaited<ReturnType<typeof createApp>>;
let headers: { cookie: string; origin: string };
let base: string;
let first: Scene;
let second: Scene;
let pieceId: string;

const ref = (id: string) => ({ id, revision: 1 });
const wall = (variant: string, x: number, extra: Partial<LayoutObject> = {}): LayoutObject => ({
  id: randomUUID(), label: `Wand ${variant}`, part: ref(STARTER_PART_IDS.wall), variant,
  values: { B: 1200, H: 2400, D: 28 }, x, y: 3000, rotation: 0, ...extra,
});
const brace = (x: number, ballast: number): LayoutObject => ({
  id: randomUUID(), label: 'Stützdreieck', part: ref(STARTER_PART_IDS.brace), values: { ballast }, x, y: 3600, rotation: 0,
});

async function pdfText(bytes: Buffer) {
  const pdf = await getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  const pages = await Promise.all(Array.from({ length: pdf.numPages }, async (_, index) => {
    const content = await (await pdf.getPage(index + 1)).getTextContent();
    return content.items.map(item => 'str' in item ? item.str : '').join(' ');
  }));
  return pages.join(' ');
}

async function save(scene: Scene, objects: LayoutObject[]) {
  assert.equal((await app.inject({ method: 'POST', url: `${base}/scenes/${scene.id}/lease`, headers })).statusCode, 200);
  const saved = await app.inject({ method: 'PUT', url: `${base}/scenes/${scene.id}/layout`, headers,
    payload: { revision: 0, layout: { schemaVersion: 2, objects, joints: [] } } });
  assert.equal(saved.statusCode, 200, saved.body);
}

before(async () => {
  fixture = await testDatabase();
  await bootstrapAdministrator(fixture.db, fixture.config, testAdministrator);
  app = await createApp(fixture.db, fixture.config);
  const login = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: testAdministrator });
  headers = { cookie: login.cookies.map(value => `${value.name}=${value.value}`).join('; '), origin: fixture.config.APP_ORIGIN };
  base = `/api/workspaces/${fixture.config.WORKSPACE_ID}`;
  const created = await app.inject({ method: 'POST', url: `${base}/scenes`, headers, payload: {
    productionName: 'Ausgabeprobe', venueName: 'Saal', sceneName: 'Erster Akt', width: 9000, depth: 7000,
  } });
  assert.equal(created.statusCode, 201, created.body);
  first = created.json();
  const other = await app.inject({ method: 'POST', url: `${base}/scenes`, headers, payload: {
    productionId: first.productionId, venueVersionId: first.venueVersionId, sceneName: 'Zweiter Akt',
  } });
  assert.equal(other.statusCode, 201, other.body);
  second = other.json();
  const piece = await app.inject({ method: 'POST', url: `${base}/stock/items`, headers,
    payload: { partId: STARTER_PART_IDS.wall, label: 'W-01', variantKey: 'doorLeft' } });
  assert.equal(piece.statusCode, 201, piece.body);
  pieceId = piece.json().id;
  const count = await app.inject({ method: 'PUT', url: `${base}/stock/counts`, headers, payload: { materialKey: 'betonplatte-400', quantity: 3 } });
  assert.equal(count.statusCode, 200, count.body);
  await save(first, [wall('doorLeft', 2000, { stockItemId: pieceId }), brace(2000, 2)]);
  await save(second, [wall('doorLeft', 2000), wall('doorLeft', 3200), brace(2000, 2), brace(3200, 2)]);
});
after(async () => { await app?.close(); await fixture?.dispose(); });

test('stock demand per Bühnenbild, venue visit and production compares demand with stock', async () => {
  const scene = await app.inject({ url: `${base}/scenes/${first.id}/stock-demand`, headers });
  assert.equal(scene.statusCode, 200, scene.body);
  const lists = scene.json<BuildLists>();
  const walls = lists.stock.rows.find(row => row.partId === STARTER_PART_IDS.wall)!;
  assert.deepEqual([walls.kind, walls.variantKey, walls.required, walls.assigned, walls.available, walls.shortage], ['item', 'doorLeft', 1, 1, 1, 0]);
  const slabs = lists.stock.rows.find(row => row.materialKey === 'betonplatte-400')!;
  assert.deepEqual([slabs.required, slabs.available, slabs.shortage], [2, 3, 0]);
  assert.equal(lists.objects.find(row => row.partId === STARTER_PART_IDS.wall)?.stockItemLabel, 'W-01');
  assert.ok(lists.cutList.sheets.some(row => row.material === 'tischlerplatte-28'));
  assert.ok(lists.weightKg > 36, `weight ${lists.weightKg}`);

  const visit = await app.inject({ url: `${base}/productions/${first.productionId}/venues/${first.venueId}/stock-demand`, headers });
  assert.equal(visit.statusCode, 200, visit.body);
  const shared = visit.json<BuildLists>();
  assert.deepEqual(shared.scenes.map(item => item.name).sort(), ['Erster Akt', 'Zweiter Akt']);
  const visitWalls = shared.stock.rows.find(row => row.partId === STARTER_PART_IDS.wall)!;
  assert.deepEqual([visitWalls.required, visitWalls.available, visitWalls.shortage], [2, 1, 1], 'the larger Bühnenbild sets the demand');
  const visitSlabs = shared.stock.rows.find(row => row.materialKey === 'betonplatte-400')!;
  assert.deepEqual([visitSlabs.required, visitSlabs.available, visitSlabs.shortage], [4, 3, 1]);
  assert.equal(shared.stock.warnings.filter(warning => warning.kind === 'shortage').length, 2);

  const production = await app.inject({ url: `${base}/productions/${first.productionId}/stock-demand`, headers });
  assert.equal(production.statusCode, 200, production.body);
  const tour = production.json<ProductionStockDemand>();
  assert.deepEqual(tour.visits.map(item => item.venueName), ['Saal']);
  assert.equal(tour.total.stock.rows.find(row => row.materialKey === 'betonplatte-400')?.required, 4);

  assert.equal((await app.inject({ url: `${base}/scenes/${randomUUID()}/stock-demand`, headers })).statusCode, 404);
  assert.equal((await app.inject({ url: `${base}/productions/${first.productionId}/venues/${randomUUID()}/stock-demand`, headers })).statusCode, 404);
  assert.equal((await app.inject({ url: `/api/workspaces/${randomUUID()}/scenes/${first.id}/stock-demand`, headers })).statusCode, 404);
});

test('an issued package inlines its part definitions and keeps its lists after library edits', async () => {
  const created = await app.inject({ method: 'POST', url: `${base}/documents`, headers, payload: {
    schemaVersion: 1, preset: 'construction', purpose: 'technical', kind: 'package', revisionName: 'Paket 1', paper: 'A4',
    orientation: 'auto', scale: 50, scenes: [{ sceneId: first.id, elevationGroupIds: [] }, { sceneId: second.id, elevationGroupIds: [] }],
  } });
  assert.equal(created.statusCode, 201, created.body);
  let job = created.json();
  for (let attempt = 0; attempt < 100 && (job.status === 'queued' || job.status === 'rendering'); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 50));
    job = (await app.inject({ url: `${base}/documents/${job.id}`, headers })).json();
  }
  assert.equal(job.status, 'ready', JSON.stringify(job));
  const issued = await app.inject({ method: 'POST', url: `${base}/documents/${job.id}/issue`, headers, payload: {} });
  assert.equal(issued.statusCode, 201, issued.body);
  const issuedId = issued.json().id as string;

  const [row] = await fixture.db.select().from(constructionPackage)
    .where(and(eq(constructionPackage.workspaceId, fixture.config.WORKSPACE_ID), eq(constructionPackage.id, issuedId)));
  const scenes = (row!.snapshot as unknown as { scenes: { sceneId: string; snapshot: unknown }[] }).scenes;
  assert.equal(scenes.length, 2);
  const snapshot = constructionSnapshotSchema.parse(scenes.find(item => item.sceneId === first.id)!.snapshot);
  assert.equal(snapshot.schemaVersion, CONSTRUCTION_SNAPSHOT_VERSION);
  assert.deepEqual(snapshot.library.parts.map(part => `${part.id}@${part.revision}`).sort(),
    [STARTER_PART_IDS.wall, STARTER_PART_IDS.door, STARTER_PART_IDS.brace].map(id => `${id}@1`).sort());
  assert.ok(snapshot.library.materials.some(material => material.key === 'tischlerplatte-28'));
  assert.deepEqual(snapshot.stock.items.map(item => item.label), ['W-01']);
  const frozenWeight = frozenLists(snapshot).weightKg;

  const plate = STARTER_MATERIALS.find(material => material.key === 'tischlerplatte-28')!;
  const edited = await app.inject({ method: 'PUT', url: `${base}/materials/tischlerplatte-28`, headers,
    payload: { ...plate, weightKgPerM2: 40 } });
  assert.equal(edited.statusCode, 200, edited.body);
  const live = (await app.inject({ url: `${base}/scenes/${first.id}/stock-demand`, headers })).json<BuildLists>();
  assert.ok(live.weightKg > frozenWeight + 10, `live ${live.weightKg} vs frozen ${frozenWeight}`);
  const [again] = await fixture.db.select().from(constructionPackage).where(eq(constructionPackage.id, issuedId));
  const reread = constructionSnapshotSchema.parse((again!.snapshot as unknown as { scenes: { sceneId: string; snapshot: unknown }[] })
    .scenes.find(item => item.sceneId === first.id)!.snapshot);
  assert.equal(frozenLists(reread).weightKg, frozenWeight);

  const file = await app.inject({ url: `${base}/productions/${first.productionId}/packages/${issuedId}/file`, headers });
  assert.equal(file.statusCode, 200, file.body);
  assert.equal(file.headers['content-type'], 'application/pdf');
  const text = await pdfText(Buffer.from(file.rawPayload));
  for (const heading of ['Bauteilliste', 'Zuschnittliste', 'Bestandsbedarf']) assert.match(text, new RegExp(heading));
  assert.match(text, /W-01/);
});

test('the classic package export freezes v2 snapshots and renders the parts list', async () => {
  const created = await app.inject({ method: 'POST', url: `${base}/productions/${first.productionId}/packages`, headers,
    payload: { name: 'Klassisch', sceneIds: [first.id, second.id] } });
  assert.equal(created.statusCode, 201, created.body);
  const id = created.json().id as string;
  let status = created.json().status as string;
  for (let attempt = 0; attempt < 100 && status === 'pending'; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 50));
    status = (await app.inject({ url: `${base}/productions/${first.productionId}/packages`, headers }))
      .json<{ id: string; status: string }[]>().find(item => item.id === id)!.status;
  }
  assert.equal(status, 'ready');
  const file = await app.inject({ url: `${base}/productions/${first.productionId}/packages/${id}/file`, headers });
  assert.equal(file.statusCode, 200, file.body);
  const text = await pdfText(Buffer.from(file.rawPayload));
  assert.match(text, /Materialbedarf/);
  assert.match(text, /Betonplatte/);
});
