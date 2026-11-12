import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { auditEvent } from '../../src/server/db/schema.js';
import { stockCountSchema, stockItemSchema, type StockCount, type StockItem } from '../../src/shared/parts/catalog.js';
import { STARTER_BRACE, STARTER_DECK, STARTER_DECK_LEG, STARTER_TABLE } from '../../src/shared/parts/index.js';
import { crate, startCatalogApp, testId, type CatalogApp } from '../helpers/catalogApp.js';

let t: CatalogApp;
before(async () => {
  t = await startCatalogApp();
  assert.equal((await t.send('editor', 'POST', `${t.base}/parts`, { definition: crate(1, 'Kiste') })).status, 201);
});
after(async () => { await t?.close(); });

const items = () => `${t.base}/stock/items`;
const counts = () => `${t.base}/stock/counts`;
const FINISH = { surfaces: { front: { full: { kind: 'paint', ral: '9010' } } }, description: 'Weiß gestrichen' };

test('creates, lists, reads and updates a stock item with finish, cutouts and notes', async () => {
  const created = await t.send<StockItem>('editor', 'POST', items(), {
    label: 'K-01', partId: testId(1), variantKey: 'klein', notes: 'Linke Kante bestoßen',
    cutouts: [{ id: randomUUID(), left: 100, sill: 200, width: 80, height: 80 }],
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const item = stockItemSchema.parse(created.body);
  assert.deepEqual([item.label, item.partName, item.variantKey, item.variantLabel], ['K-01', 'Kiste', 'klein', 'Klein']);
  assert.deepEqual([item.usable, item.archived, item.finish, item.values], [true, false, null, {}]);
  assert.equal(item.cutouts.length, 1);

  const listed = await t.send<StockItem[]>('viewer', 'GET', items());
  assert.deepEqual(listed.body, [item]);

  const updated = await t.send<StockItem>('editor', 'PATCH', `${items()}/${item.id}`, { usable: false, notes: null, finish: FINISH, variantKey: 'gross' });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.usable, false);
  assert.equal(updated.body.notes, null);
  assert.equal(updated.body.variantLabel, 'Groß');
  assert.equal(updated.body.finish?.description, 'Weiß gestrichen');
  assert.match(updated.body.finish!.confirmedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(updated.body.cutouts, item.cutouts, 'omitted fields stay');
  const cleared = await t.send<StockItem>('editor', 'PATCH', `${items()}/${item.id}`, { finish: null, cutouts: [] });
  assert.deepEqual([cleared.body.finish, cleared.body.cutouts], [null, []]);

  assert.equal((await t.send('editor', 'PATCH', `${items()}/${item.id}`, {})).status, 400);
  assert.equal((await t.send('editor', 'PATCH', `${items()}/${randomUUID()}`, { usable: true })).status, 404);
  assert.equal((await t.send('editor', 'PATCH', `${items()}/${item.id}`, { partId: testId(1) })).status, 400);
});

test('labels are unique among non-archived items; archiving frees the label', async () => {
  const first = (await t.send<StockItem[]>('viewer', 'GET', items())).body[0]!;
  const clash = await t.send('editor', 'POST', items(), { label: 'K-01', partId: testId(1), variantKey: 'klein' });
  assert.equal(clash.status, 409);
  const second = await t.send<StockItem>('editor', 'POST', items(), { label: 'K-02', partId: testId(1), variantKey: 'klein' });
  assert.equal(second.status, 201);
  assert.equal((await t.send('editor', 'PATCH', `${items()}/${second.body.id}`, { label: 'K-01' })).status, 409);

  const archived = await t.send<StockItem>('editor', 'POST', `${items()}/${first.id}/archive`);
  assert.equal(archived.status, 200);
  assert.equal(archived.body.archived, true);
  assert.deepEqual((await t.send<StockItem[]>('viewer', 'GET', items())).body.map(item => item.label), ['K-02']);
  assert.deepEqual((await t.send<StockItem[]>('viewer', 'GET', `${items()}?includeArchived=true`)).body.map(item => item.label), ['K-01', 'K-02']);

  const reused = await t.send<StockItem>('editor', 'POST', items(), { label: 'K-01', partId: testId(1), variantKey: 'gross' });
  assert.equal(reused.status, 201, 'a label of an archived item may be used again');
  assert.equal((await t.send('editor', 'POST', `${items()}/${first.id}/unarchive`)).status, 409);
  assert.equal((await t.send('editor', 'POST', `${items()}/${reused.body.id}/archive`)).status, 200);
  const restored = await t.send<StockItem>('editor', 'POST', `${items()}/${first.id}/unarchive`);
  assert.equal(restored.body.archived, false);
  assert.equal((await t.send('editor', 'POST', `${items()}/${randomUUID()}/archive`)).status, 404);
});

test('a stock item must point at an existing, active part, a variant of it and a part stocked as items', async () => {
  const body = { label: 'X-1', partId: testId(1), variantKey: 'klein' };
  const reject = async (payload: object, pattern: RegExp) => {
    const reply = await t.send('editor', 'POST', items(), payload);
    assert.equal(reply.status, 422, JSON.stringify(reply.body));
    assert.match(reply.body.message, pattern);
  };
  await reject({ ...body, partId: randomUUID() }, /nicht vorhanden/);
  await reject({ ...body, variantKey: 'riesig' }, /keine Variante „riesig“/);
  await reject({ ...body, variantKey: null }, /Variante wählen/);
  await reject({ ...body, partId: STARTER_DECK_LEG.id, variantKey: '600' }, /Zählbestand/);
  await reject({ ...body, partId: STARTER_TABLE.id, variantKey: null }, /kein Bestand/);
  await reject({ ...body, partId: STARTER_DECK.id, variantKey: '2x1', values: { H: 777 } }, /„H“/);
  await reject({ ...body, partId: STARTER_DECK.id, variantKey: '2x1', values: { zzz: 1 } }, /keinen Parameter/);
  await reject({ ...body, partId: STARTER_DECK.id, variantKey: '2x1', values: { B: 1 } }, /nicht von der Platzierung/);

  const deck = await t.send<StockItem>('editor', 'POST', items(), { label: 'Podest-1', partId: STARTER_DECK.id, variantKey: '2x1', values: { H: 800 } });
  assert.equal(deck.status, 201, JSON.stringify(deck.body));
  assert.deepEqual(deck.body.values, { H: 800 });
  const badUpdate = await t.send('editor', 'PATCH', `${items()}/${deck.body.id}`, { values: { H: 123 } });
  assert.equal(badUpdate.status, 422);
  assert.equal((await t.send('editor', 'POST', items(), { ...body, label: '', })).status, 400);

  const noVariants = crate(2, 'Ohne Varianten', { variants: undefined });
  assert.equal((await t.send('editor', 'POST', `${t.base}/parts`, { definition: noVariants })).status, 201);
  assert.equal((await t.send('editor', 'POST', items(), { label: 'OV-1', partId: noVariants.id })).status, 201);
  await reject({ label: 'OV-2', partId: noVariants.id, variantKey: 'klein' }, /keine Varianten/);

  assert.equal((await t.send('editor', 'POST', `${t.base}/parts/${testId(1)}/archive`)).status, 200);
  await reject({ ...body, label: 'X-2' }, /archiviert/);
  const stillEditable = await t.send('editor', 'PATCH', `${items()}/${(await t.send<StockItem[]>('viewer', 'GET', items())).body.find(item => item.label === 'K-02')!.id}`, { notes: 'auch archiviert editierbar', variantKey: 'gross' });
  assert.equal(stillEditable.status, 200, 'pieces of an archived part stay editable');
  assert.equal((await t.send('editor', 'POST', `${t.base}/parts/${testId(1)}/unarchive`)).status, 200);
});

test('stock counts: set by material and by part variant, validated and upserted', async () => {
  const empty = await t.send<StockCount[]>('viewer', 'GET', counts());
  assert.deepEqual(empty.body, []);

  const plate = await t.send<StockCount>('editor', 'PUT', counts(), { materialKey: 'betonplatte-400', quantity: 12 });
  assert.equal(plate.status, 200, JSON.stringify(plate.body));
  const parsed = stockCountSchema.parse(plate.body);
  assert.deepEqual([parsed.materialKey, parsed.partId, parsed.variantKey, parsed.name, parsed.quantity],
    ['betonplatte-400', null, null, 'Betonplatte 400 × 400 × 50 mm', 12]);
  const again = await t.send<StockCount>('editor', 'PUT', counts(), { materialKey: 'betonplatte-400', quantity: 7 });
  assert.equal(again.body.id, parsed.id, 'the same target keeps its row');
  assert.equal(again.body.quantity, 7);

  const leg = await t.send<StockCount>('editor', 'PUT', counts(), { partId: STARTER_DECK_LEG.id, variantKey: '600', quantity: 24 });
  assert.equal(leg.status, 200, JSON.stringify(leg.body));
  assert.deepEqual([leg.body.partId, leg.body.variantKey, leg.body.name, leg.body.variantLabel, leg.body.materialKey], [STARTER_DECK_LEG.id, '600', 'Steckfuß', '60 cm', null]);
  const other = await t.send<StockCount>('editor', 'PUT', counts(), { partId: STARTER_DECK_LEG.id, variantKey: '800', quantity: 8 });
  assert.notEqual(other.body.id, leg.body.id);
  const brace = await t.send<StockCount>('editor', 'PUT', counts(), { partId: STARTER_BRACE.id, variantKey: 'standard', quantity: 4 });
  assert.equal(brace.status, 200);

  const listed = await t.send<StockCount[]>('viewer', 'GET', counts());
  assert.equal(listed.body.length, 4);
  assert.deepEqual(listed.body.map(item => [item.name, item.variantKey, item.quantity]), [
    ['Betonplatte 400 × 400 × 50 mm', null, 7], ['Steckfuß', '600', 24], ['Steckfuß', '800', 8], ['Stützdreieck', 'standard', 4],
  ]);
  assert.equal((await t.send<StockCount>('editor', 'PUT', counts(), { materialKey: 'betonplatte-400', quantity: 0 })).body.quantity, 0);

  const reject = async (payload: object, pattern: RegExp) => {
    const reply = await t.send('editor', 'PUT', counts(), payload);
    assert.equal(reply.status, 422, JSON.stringify(reply.body));
    assert.match(reply.body.message, pattern);
  };
  await reject({ materialKey: 'gibt-es-nicht', quantity: 1 }, /Material ist nicht vorhanden/);
  await reject({ materialKey: 'latte-40x40', quantity: 1 }, /nur Zubehör/);
  await reject({ partId: STARTER_DECK.id, variantKey: '2x1', quantity: 1 }, /einzelne Bestandsstücke/);
  await reject({ partId: STARTER_DECK_LEG.id, variantKey: '999', quantity: 1 }, /keine Variante/);
  await reject({ partId: STARTER_DECK_LEG.id, quantity: 1 }, /Variante wählen/);
  await reject({ partId: randomUUID(), variantKey: null, quantity: 1 }, /nicht vorhanden/);
  for (const bad of [{ materialKey: 'betonplatte-400', quantity: -1 }, { materialKey: 'betonplatte-400', quantity: 1.5 },
    { materialKey: 'betonplatte-400', partId: STARTER_BRACE.id, quantity: 1 }, { quantity: 1 }]) {
    assert.equal((await t.send('editor', 'PUT', counts(), bad)).status, 400, JSON.stringify(bad));
  }
});

test('deleting a material removes its count', async () => {
  const strap = { kind: 'hardware', key: 'ersatz-gurt', name: 'Ersatzgurt', weightKgPerPiece: 0.2, color: '#aa0000' };
  assert.equal((await t.send('editor', 'PUT', `${t.base}/materials/${strap.key}`, strap)).status, 200);
  assert.equal((await t.send('editor', 'PUT', counts(), { materialKey: strap.key, quantity: 3 })).status, 200);
  assert.equal((await t.send('editor', 'DELETE', `${t.base}/materials/${strap.key}`)).status, 200);
  assert.equal((await t.send<StockCount[]>('viewer', 'GET', counts())).body.some(item => item.materialKey === strap.key), false);
});

test('permissions: viewers read stock, editors write it, anonymous callers do neither', async () => {
  const item = (await t.send<StockItem[]>('viewer', 'GET', items())).body[0]!;
  const writes: [string, string, unknown][] = [
    ['POST', items(), { label: 'V-1', partId: testId(1), variantKey: 'klein' }],
    ['PATCH', `${items()}/${item.id}`, { usable: true }],
    ['POST', `${items()}/${item.id}/archive`, undefined],
    ['POST', `${items()}/${item.id}/unarchive`, undefined],
    ['PUT', counts(), { materialKey: 'betonplatte-400', quantity: 1 }],
  ];
  for (const [method, url, payload] of writes) {
    assert.equal((await t.send('viewer', method, url, payload)).status, 403, `viewer ${method} ${url}`);
    assert.equal((await t.send('anonymous', method, url, payload)).status, 401, `anonymous ${method} ${url}`);
    const foreign = await t.app.inject({ method: method as 'POST', url, headers: { cookie: t.headers.editor.cookie, origin: 'https://evil.example' }, ...(payload !== undefined ? { payload: payload as object } : {}) });
    assert.equal(foreign.statusCode, 403, `foreign origin ${method} ${url}`);
  }
  for (const url of [items(), counts()]) {
    assert.equal((await t.send('viewer', 'GET', url)).status, 200);
    assert.equal((await t.send('anonymous', 'GET', url)).status, 401);
  }
  assert.equal((await t.send('administrator', 'POST', items(), { label: 'A-1', partId: testId(1), variantKey: 'klein' })).status, 201);
});

test('workspace ownership: stock of one workspace is invisible and untouchable from another', async () => {
  const mine = (await t.send<StockItem[]>('viewer', 'GET', items())).body[0]!;
  const other = await t.addWorkspace('Fremde Gruppe', { starter: true });
  const base = `/api/workspaces/${other}/stock`;
  assert.deepEqual((await t.send('administrator', 'GET', `${base}/items`)).body, []);
  assert.deepEqual((await t.send('administrator', 'GET', `${base}/counts`)).body, []);
  assert.equal((await t.send('administrator', 'PATCH', `${base}/items/${mine.id}`, { usable: false })).status, 404);
  assert.equal((await t.send('administrator', 'POST', `${base}/items/${mine.id}/archive`)).status, 404);
  assert.deepEqual((await t.send<StockItem[]>('viewer', 'GET', items())).body.find(item => item.id === mine.id), mine);

  const foreignPart = await t.send('administrator', 'POST', `${base}/items`, { label: 'F-1', partId: testId(1), variantKey: 'klein' });
  assert.equal(foreignPart.status, 422, 'a part of another workspace does not exist here');
  const sameStarter = await t.send<StockItem>('administrator', 'POST', `${base}/items`, { label: 'W-1', partId: STARTER_DECK.id, variantKey: '1x1' });
  assert.equal(sameStarter.status, 201);
  assert.deepEqual((await t.send<StockItem[]>('viewer', 'GET', items())).body.some(item => item.label === 'W-1'), false);
  const count = await t.send<StockCount>('administrator', 'PUT', `${base}/counts`, { materialKey: 'betonplatte-400', quantity: 99 });
  assert.equal(count.status, 200);
  const here = (await t.send<StockCount[]>('viewer', 'GET', counts())).body.find(item => item.materialKey === 'betonplatte-400');
  assert.notEqual(here?.quantity, 99);
  assert.equal((await t.send('viewer', 'GET', `${base}/items`)).status, 404);
  assert.equal((await t.send('viewer', 'PUT', `${base}/counts`, { materialKey: 'betonplatte-400', quantity: 1 })).status, 404);
  assert.equal((await t.send('anonymous', 'GET', `${base}/items`)).status, 401);
});

test('stock writes leave audit entries', async () => {
  const actions = (await t.fixture.db.select().from(auditEvent).where(eq(auditEvent.workspaceId, t.workspaceId))).map(item => item.action);
  for (const action of [
    'POST /api/workspaces/:workspaceId/stock/items', 'PATCH /api/workspaces/:workspaceId/stock/items/:itemId',
    'POST /api/workspaces/:workspaceId/stock/items/:itemId/archive', 'PUT /api/workspaces/:workspaceId/stock/counts',
  ]) assert.equal(actions.includes(action), true, action);
});
