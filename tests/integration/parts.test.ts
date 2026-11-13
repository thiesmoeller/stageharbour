import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { auditEvent, material, partDefinition, partRevision } from '../../src/server/db/schema.js';
import { ensureStarterLibrary } from '../../src/server/parts/starter.js';
import {
  libraryExportSchema, partDetailSchema, partRevisionSchema, partSummarySchema, importReportSchema,
  type ImportReport, type LibraryExport, type PartDetail, type PartSummary, type ResolvedParts,
} from '../../src/shared/parts/catalog.js';
import {
  STARTER_LIBRARY, STARTER_MATERIALS, STARTER_PARTS, partLibraryJsonSchema, partLibrarySchema, type PartDefinition, type PartMaterial,
} from '../../src/shared/parts/index.js';
import { crate, startCatalogApp, testId, type CatalogApp } from '../helpers/catalogApp.js';

let t: CatalogApp;
before(async () => { t = await startCatalogApp(); });
after(async () => { await t?.close(); });

const parts = () => `${t.base}/parts`;
const assembly = (serial: number, child: PartDefinition, name = `Gestell ${serial}`): PartDefinition => ({
  id: testId(serial), revision: 1, name, category: 'Test', parameters: [], bodies: [],
  children: [{ key: 'kiste', part: { id: child.id, revision: child.revision }, variant: 'klein', at: [0, 0, 0] }],
  traits: { stock: 'none' },
});
const canonical = (value: unknown) => JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : 1)) : item);

test('every workspace holds the starter library under its fixed ids, and ensuring it again changes nothing', async () => {
  const listed = await t.send<PartSummary[]>('viewer', 'GET', parts());
  assert.equal(listed.status, 200);
  const starterIds = STARTER_PARTS.map(part => part.id).sort();
  assert.deepEqual(listed.body.map(item => item.id).sort(), starterIds);
  for (const item of listed.body) partSummarySchema.parse(item);
  const materials = await t.send<PartMaterial[]>('viewer', 'GET', `${t.base}/materials`);
  assert.deepEqual(materials.body.map(item => item.key).sort(), STARTER_MATERIALS.map(item => item.key).sort());

  const first = await ensureStarterLibrary(t.fixture.db, t.workspaceId);
  const second = await ensureStarterLibrary(t.fixture.db, t.workspaceId);
  assert.deepEqual([first, second], [{ materials: 0, revisions: 0 }, { materials: 0, revisions: 0 }]);

  const other = await t.addWorkspace('Zweite Gruppe');
  assert.deepEqual(await ensureStarterLibrary(t.fixture.db, other), { materials: STARTER_MATERIALS.length, revisions: STARTER_PARTS.length });
  assert.deepEqual(await ensureStarterLibrary(t.fixture.db, other), { materials: 0, revisions: 0 });
  assert.equal((await t.send<PartSummary[]>('administrator', 'GET', `/api/workspaces/${other}/parts`)).body.length, STARTER_PARTS.length);
  assert.deepEqual(await ensureStarterLibrary(t.fixture.db, randomUUID()), { materials: 0, revisions: 0 });
});

test('ensuring the starter library keeps group edits, newer revisions and removed materials', async () => {
  const other = await t.addWorkspace('Gruppe mit Änderungen', { starter: true });
  const wall = STARTER_PARTS.find(part => part.name === 'Wandelement')!;
  const edited = { ...wall, name: 'Wandelement der Gruppe' };
  const saved = await t.send<PartDetail>('editor', 'POST', `/api/workspaces/${other}/parts/${wall.id}/revisions`, { baseRevision: 1, definition: edited });
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  const removed = STARTER_MATERIALS.find(item => item.key === 'spanngurt-25')!;
  const removal = await t.send('editor', 'DELETE', `/api/workspaces/${other}/materials/${removed.key}`);
  assert.equal(removal.status, 409, 'the Stützdreieck still names the strap');
  const changed = { ...STARTER_MATERIALS.find(item => item.key === 'latte-40x40')!, color: '#112233' };
  assert.equal((await t.send('editor', 'PUT', `/api/workspaces/${other}/materials/latte-40x40`, changed)).status, 200);

  assert.deepEqual(await ensureStarterLibrary(t.fixture.db, other), { materials: 0, revisions: 0 });
  const detail = (await t.send<PartDetail>('administrator', 'GET', `/api/workspaces/${other}/parts/${wall.id}`)).body;
  assert.equal(detail.latestRevision, 2);
  assert.equal(detail.name, 'Wandelement der Gruppe');
  const materials = (await t.send<PartMaterial[]>('administrator', 'GET', `/api/workspaces/${other}/materials`)).body;
  assert.deepEqual(materials.find(item => item.key === 'latte-40x40'), changed);
});

test('creates a part as revision 1 and reads it back as detail, revision and list entry', async () => {
  const definition = crate(1, 'Kiste Eins');
  const created = await t.send<PartDetail>('editor', 'POST', parts(), { definition: { ...definition, revision: 7 } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const detail = partDetailSchema.parse(created.body);
  assert.equal(detail.latestRevision, 1);
  assert.equal(detail.definition.revision, 1, 'the stored revision is always the row revision');
  assert.equal(detail.definition.id, definition.id);
  assert.deepEqual(detail.variants, [{ key: 'klein', label: 'Klein' }, { key: 'gross', label: 'Groß' }]);
  assert.equal(detail.stock, 'item');
  assert.equal(detail.favourite, false);
  assert.equal(detail.archived, false);
  assert.deepEqual(detail.revisions.map(item => [item.revision, item.authorName]), [[1, 'Nutzer editor']]);

  const again = await t.send('editor', 'POST', parts(), { definition });
  assert.equal(again.status, 409);
  assert.equal(typeof again.body.message, 'string');

  const read = await t.send<PartDetail>('viewer', 'GET', `${parts()}/${definition.id}`);
  assert.deepEqual(read.body, detail);
  const revision = partRevisionSchema.parse((await t.send('viewer', 'GET', `${parts()}/${definition.id}/revisions/1`)).body);
  assert.equal(revision.revision, 1);
  assert.equal(revision.partId, definition.id);
  assert.equal(revision.authorName, 'Nutzer editor');
  assert.deepEqual(revision.definition, detail.definition);
  assert.equal((await t.send('viewer', 'GET', `${parts()}/${definition.id}/revisions/2`)).status, 404);
  assert.equal((await t.send('viewer', 'GET', `${parts()}/${randomUUID()}`)).status, 404);
  assert.equal((await t.send('viewer', 'GET', `${parts()}/not-a-uuid`)).status, 400);
  assert.equal((await t.send<PartSummary[]>('viewer', 'GET', parts())).body.some(item => item.id === definition.id), true);
});

test('answers an invalid definition with 422 and issues that name the body and the parameter', async () => {
  const broken = crate(2, 'Zu kurz', {
    parameters: [{ key: 'B', label: 'Breite', type: 'length', default: 600, scope: 'placement', range: { min: 0, max: 1200 } }],
    variants: undefined,
  });
  const reply = await t.send('editor', 'POST', parts(), { definition: broken });
  assert.equal(reply.status, 422);
  assert.equal(reply.body.message, 'Das Bauteil ist nicht gültig.');
  const issue = reply.body.issues.find((item: { body?: string }) => item.body === 'latte');
  assert.ok(issue, JSON.stringify(reply.body.issues));
  assert.equal(issue.parameter, 'B');
  assert.match(issue.message, /Mindestmaß/);
  assert.match(issue.message, /B = 0/);

  const unknownMaterial = await t.send('editor', 'POST', parts(), { definition: crate(2, 'Ohne Material', { bodies: [{ kind: 'beam', key: 'latte', material: 'gibt-es-nicht', from: [0, 0, 0], to: [500, 0, 0] }] }) });
  assert.equal(unknownMaterial.status, 422);
  assert.equal(unknownMaterial.body.issues[0].code, 'unknown-material');

  const notADefinition = await t.send('editor', 'POST', parts(), { definition: { name: 5 } });
  assert.equal(notADefinition.status, 422);
  assert.ok(notADefinition.body.issues.length > 0);
  assert.equal((await t.send('editor', 'POST', parts(), { definition: broken, extra: 1 })).status, 400);
  assert.equal((await t.send('viewer', 'GET', `${parts()}/${broken.id}`)).status, 404, 'nothing was stored');
});

test('saving creates revision n + 1, refuses a stale base with 409 and never touches older revisions', async () => {
  const id = testId(1);
  const original = (await t.send<PartDetail>('viewer', 'GET', `${parts()}/${id}`)).body;
  const next = { ...original.definition, name: 'Kiste Eins, neu', revision: 99, description: 'Zweite Fassung' };
  const saved = await t.send<PartDetail>('editor', 'POST', `${parts()}/${id}/revisions`, { baseRevision: 1, definition: next });
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  assert.equal(saved.body.latestRevision, 2);
  assert.equal(saved.body.name, 'Kiste Eins, neu');
  assert.equal(saved.body.definition.revision, 2);
  assert.deepEqual(saved.body.revisions.map(item => item.revision), [1, 2]);

  const stale = await t.send('editor', 'POST', `${parts()}/${id}/revisions`, { baseRevision: 1, definition: { ...next, name: 'Verspätet' } });
  assert.equal(stale.status, 409);
  assert.match(stale.body.message, /Revision 2/);
  assert.equal((await t.send<PartDetail>('viewer', 'GET', `${parts()}/${id}`)).body.latestRevision, 2);

  const first = await t.send<{ definition: PartDefinition }>('viewer', 'GET', `${parts()}/${id}/revisions/1`);
  assert.deepEqual(first.body.definition, original.definition, 'revision 1 is unchanged');
  assert.equal((await t.send('editor', 'POST', `${parts()}/${id}/revisions`, { baseRevision: 2, definition: { ...next, id: testId(99) } })).status, 400);
  const invalid = await t.send('editor', 'POST', `${parts()}/${id}/revisions`, { baseRevision: 2, definition: { ...next, bodies: [] } });
  assert.equal(invalid.status, 422);
  assert.equal(invalid.body.issues[0].code, 'empty-part');
  assert.equal((await t.send('editor', 'POST', `${parts()}/${randomUUID()}/revisions`, { baseRevision: 1, definition: next })).status, 404);
  assert.equal((await t.send<PartDetail>('viewer', 'GET', `${parts()}/${id}`)).body.latestRevision, 2);
});

test('revisions are immutable: no route changes one and the database rejects an update', async () => {
  const id = testId(1);
  const url = `${parts()}/${id}/revisions/1`;
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    const reply = await t.send('administrator', method, url, method === 'DELETE' ? undefined : { definition: crate(1) });
    assert.equal(reply.status, 404, `${method} ${url}`);
  }
  const [row] = await t.fixture.db.select().from(partRevision)
    .where(and(eq(partRevision.workspaceId, t.workspaceId), eq(partRevision.partId, id), eq(partRevision.revision, 1)));
  await assert.rejects(
    t.fixture.db.update(partRevision).set({ definition: { ...row!.definition, name: 'Verändert' } })
      .where(and(eq(partRevision.workspaceId, t.workspaceId), eq(partRevision.partId, id), eq(partRevision.revision, 1))),
    (error: { cause?: { message?: string } }) => /immutable/.test(error.cause?.message ?? String(error)),
  );
  const [after] = await t.fixture.db.select().from(partRevision)
    .where(and(eq(partRevision.workspaceId, t.workspaceId), eq(partRevision.partId, id), eq(partRevision.revision, 1)));
  assert.deepEqual(after!.definition, row!.definition);
});

test('accepts a definition larger than the default request limit', async () => {
  const bodies = Array.from({ length: 100 }, (_, index) => ({
    kind: 'beam' as const, key: `latte-${index}`, label: 'Latte mit einer ziemlich langen Beschriftung, damit der Körper groß wird', material: 'latte-40x40',
    from: [index, 0, 0] as [number, number, number], to: [index + 500, 0, 0] as [number, number, number],
  }));
  const big = crate(3, 'Großes Bauteil', { bodies, variants: undefined });
  assert.ok(JSON.stringify(big).length > 16 * 1024);
  const reply = await t.send('editor', 'POST', parts(), { definition: big });
  assert.equal(reply.status, 201, JSON.stringify(reply.body).slice(0, 300));
});

test('archives, restores and favourites a part; archived parts stay resolvable', async () => {
  const id = testId(1);
  const archived = await t.send<PartSummary>('editor', 'POST', `${parts()}/${id}/archive`);
  assert.equal(archived.status, 200);
  assert.equal(archived.body.archived, true);
  assert.equal((await t.send<PartSummary[]>('viewer', 'GET', parts())).body.some(item => item.id === id), false);
  const all = await t.send<PartSummary[]>('viewer', 'GET', `${parts()}?includeArchived=true`);
  assert.equal(all.body.find(item => item.id === id)?.archived, true);

  const resolved = await t.send<ResolvedParts>('viewer', 'POST', `${parts()}/resolve`, {
    refs: [{ id, revision: 1 }, { id, revision: 2 }, { id, revision: 2 }, { id, revision: 3 }, { id: randomUUID(), revision: 1 }],
  });
  assert.equal(resolved.status, 200);
  assert.deepEqual(resolved.body.definitions.map(item => [item.id, item.revision]), [[id, 1], [id, 2]]);
  assert.equal(resolved.body.missing.length, 2);
  assert.equal((await t.send('viewer', 'GET', `${parts()}/${id}`)).status, 200);

  const restored = await t.send<PartSummary>('editor', 'POST', `${parts()}/${id}/unarchive`);
  assert.equal(restored.body.archived, false);
  assert.equal((await t.send<PartSummary[]>('viewer', 'GET', parts())).body.some(item => item.id === id), true);

  const favourite = await t.send<PartSummary>('editor', 'PUT', `${parts()}/${id}/favourite`, { favourite: true });
  assert.equal(favourite.body.favourite, true);
  assert.equal((await t.send<PartDetail>('viewer', 'GET', `${parts()}/${id}`)).body.favourite, true);
  assert.equal((await t.send<PartSummary>('editor', 'PUT', `${parts()}/${id}/favourite`, { favourite: false })).body.favourite, false);
  assert.equal((await t.send('editor', 'PUT', `${parts()}/${id}/favourite`, { favourite: 'ja' })).status, 400);
  assert.equal((await t.send('editor', 'POST', `${parts()}/${randomUUID()}/archive`)).status, 404);
  assert.equal((await t.send('editor', 'POST', `${parts()}/resolve`, { refs: [] })).status, 400);
});

test('duplicates the latest revision as a new part named Kopie', async () => {
  const id = testId(1);
  const copy = await t.send<PartDetail>('editor', 'POST', `${parts()}/${id}/duplicate`);
  assert.equal(copy.status, 201, JSON.stringify(copy.body));
  assert.notEqual(copy.body.id, id);
  assert.equal(copy.body.name, 'Kiste Eins, neu Kopie');
  assert.equal(copy.body.latestRevision, 1);
  assert.equal(copy.body.definition.id, copy.body.id);
  assert.equal(copy.body.definition.revision, 1);
  assert.equal(copy.body.favourite, false);
  const source = (await t.send<PartDetail>('viewer', 'GET', `${parts()}/${id}`)).body;
  assert.deepEqual({ ...copy.body.definition, id: source.id, name: source.name, revision: source.definition.revision }, source.definition);
  const second = await t.send<PartDetail>('editor', 'POST', `${parts()}/${id}/duplicate`);
  assert.equal(second.body.name, 'Kiste Eins, neu Kopie 2');
  assert.equal((await t.send('editor', 'POST', `${parts()}/${randomUUID()}/duplicate`)).status, 404);
});

test('materials: list, upsert by key, guarded delete', async () => {
  const wood: PartMaterial = { kind: 'profile', key: 'dachlatte-30x50', name: 'Dachlatte 30 × 50', section: { width: 30, height: 50 }, weightKgPerM: 0.8, color: '#c8b080' };
  const url = `${t.base}/materials/${wood.key}`;
  assert.equal((await t.send('editor', 'PUT', url, wood)).status, 200);
  assert.deepEqual((await t.send<PartMaterial[]>('viewer', 'GET', `${t.base}/materials`)).body.find(item => item.key === wood.key), wood);
  const heavier = { ...wood, weightKgPerM: 1.1 };
  assert.deepEqual((await t.send('editor', 'PUT', url, heavier)).body, heavier);
  assert.equal((await t.send<PartMaterial[]>('viewer', 'GET', `${t.base}/materials`)).body.filter(item => item.key === wood.key).length, 1);
  assert.equal((await t.send('editor', 'PUT', url, { ...wood, key: 'anders' })).status, 400);
  assert.equal((await t.send('editor', 'PUT', url, { kind: 'profile', key: wood.key })).status, 400);

  const user = crate(4, 'Mit Dachlatte', { bodies: [{ kind: 'beam', key: 'latte', material: wood.key, from: [0, 0, 0], to: ['B', 0, 0] }] });
  assert.equal((await t.send('editor', 'POST', parts(), { definition: user })).status, 201);
  const refused = await t.send('editor', 'DELETE', url);
  assert.equal(refused.status, 409);
  assert.match(refused.body.message, /Mit Dachlatte/);
  const kind = await t.send('editor', 'PUT', url, { kind: 'sheet', key: wood.key, name: 'Platte', thickness: 10, weightKgPerM2: 5, color: '#ffffff' });
  assert.equal(kind.status, 409, 'a material in use cannot change its kind');

  const replacement = await t.send<PartDetail>('editor', 'POST', `${parts()}/${user.id}/revisions`, {
    baseRevision: 1, definition: { ...user, bodies: [{ ...user.bodies[0]!, material: 'latte-40x40' }] },
  });
  assert.equal(replacement.status, 201);
  assert.equal((await t.send('editor', 'DELETE', url)).status, 200);
  assert.equal((await t.send('editor', 'DELETE', url)).status, 404);
  assert.equal((await t.send<PartMaterial[]>('viewer', 'GET', `${t.base}/materials`)).body.some(item => item.key === wood.key), false);
});

test('exports selected parts with their children and materials, and a round trip into a fresh workspace keeps definitions byte-equal', async () => {
  const child = crate(10, 'Kiste Zehn');
  const parent = assembly(11, child, 'Gestell Elf');
  assert.equal((await t.send('editor', 'POST', parts(), { definition: child })).status, 201);
  assert.equal((await t.send('editor', 'POST', parts(), { definition: parent })).status, 201);
  const renamed = await t.send<PartDetail>('editor', 'POST', `${parts()}/${child.id}/revisions`, { baseRevision: 1, definition: { ...child, name: 'Kiste Zehn, zweite Fassung' } });
  assert.equal(renamed.status, 201);

  const exported = await t.send<LibraryExport>('viewer', 'POST', `${t.base}/library/export`, { partIds: [parent.id, child.id] });
  assert.equal(exported.status, 200, JSON.stringify(exported.body).slice(0, 300));
  libraryExportSchema.parse(exported.body);
  partLibrarySchema.parse(exported.body.library);
  assert.match(exported.body.filename, /^bauteile-beispiel-theatergruppe-\d{4}-\d{2}-\d{2}\.stageharbour-parts\.json$/);
  const refs = exported.body.library.parts.map(item => `${item.name}@${item.revision}`);
  assert.deepEqual([...refs].sort(), ['Gestell Elf@1', 'Kiste Zehn, zweite Fassung@2', 'Kiste Zehn@1']);
  assert.deepEqual(exported.body.library.materials.map(item => item.key), ['latte-40x40']);

  const fresh = await t.addWorkspace('Leere Gruppe');
  const freshBase = `/api/workspaces/${fresh}`;
  const imported = await t.send<ImportReport>('editor', 'POST', `${freshBase}/library/import`, { library: exported.body.library });
  assert.equal(imported.status, 200, JSON.stringify(imported.body));
  importReportSchema.parse(imported.body);
  assert.equal(imported.body.created.length, 3);
  assert.deepEqual([imported.body.revised.length, imported.body.skipped.length, imported.body.rejected.length], [0, 0, 0]);
  assert.deepEqual(imported.body.materials, { created: ['latte-40x40'], overwritten: [], skipped: [] });

  const back = await t.send<LibraryExport>('administrator', 'POST', `${freshBase}/library/export`, { partIds: [parent.id, child.id] });
  assert.equal(back.status, 200);
  assert.equal(JSON.stringify(back.body.library), JSON.stringify(exported.body.library));
  for (const definition of exported.body.library.parts) {
    const stored = (await t.send<{ definition: PartDefinition }>('administrator', 'GET', `${freshBase}/parts/${definition.id}/revisions/${definition.revision}`)).body.definition;
    assert.equal(canonical(stored), canonical(definition));
  }
  assert.equal((await t.send<PartDetail>('administrator', 'GET', `${freshBase}/parts/${child.id}`)).body.latestRevision, 2);

  const everything = await t.send<LibraryExport>('viewer', 'POST', `${t.base}/library/export`, {});
  assert.equal(everything.body.library.parts.some(item => item.id === testId(1)), true);
  assert.equal(everything.body.library.parts.some(item => STARTER_PARTS.some(starter => starter.id === item.id)), true);
  assert.equal((await t.send('viewer', 'POST', `${t.base}/library/export`, { partIds: [randomUUID()] })).status, 404);
  const archivedId = testId(3);
  await t.send('editor', 'POST', `${parts()}/${archivedId}/archive`);
  const withoutArchived = await t.send<LibraryExport>('viewer', 'POST', `${t.base}/library/export`, {});
  assert.equal(withoutArchived.body.library.parts.some(item => item.id === archivedId), false);
  const selected = await t.send<LibraryExport>('viewer', 'POST', `${t.base}/library/export`, { partIds: [archivedId] });
  assert.equal(selected.body.library.parts.some(item => item.id === archivedId), true);
});

test('import merges: identical is skipped, changed becomes a new revision, unknown ids are created', async () => {
  const target = await t.addWorkspace('Zielgruppe');
  const base = `/api/workspaces/${target}`;
  const wood = crate(20, 'Importkiste');
  const library = { schemaVersion: 1, materials: [], parts: [wood] };
  const first = await t.send<ImportReport>('editor', 'POST', `${base}/library/import`, { library: { ...library, materials: [STARTER_MATERIALS[0]] } });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.deepEqual(first.body.created.map(item => [item.name, item.revision]), [['Importkiste', 1]]);

  const again = await t.send<ImportReport>('editor', 'POST', `${base}/library/import`, { library });
  assert.deepEqual(again.body.skipped.map(item => [item.name, item.revision]), [['Importkiste', 1]]);
  assert.equal(again.body.created.length + again.body.revised.length, 0);
  assert.equal((await t.send<PartDetail>('administrator', 'GET', `${base}/parts/${wood.id}`)).body.latestRevision, 1);

  const changed = { ...wood, name: 'Importkiste, geändert', revision: 5 };
  const revised = await t.send<ImportReport>('editor', 'POST', `${base}/library/import`, { library: { ...library, parts: [changed] } });
  assert.deepEqual(revised.body.revised.map(item => [item.name, item.fileRevision, item.revision]), [['Importkiste, geändert', 5, 2]]);
  const detail = (await t.send<PartDetail>('administrator', 'GET', `${base}/parts/${wood.id}`)).body;
  assert.equal(detail.latestRevision, 2);
  assert.equal(detail.name, 'Importkiste, geändert');
  assert.equal(detail.definition.revision, 2);
  assert.equal((await t.send<{ definition: PartDefinition }>('administrator', 'GET', `${base}/parts/${wood.id}/revisions/1`)).body.definition.name, 'Importkiste');

  const unknown = crate(21, 'Neu mit Revision 3', { revision: 3 });
  const created = await t.send<ImportReport>('editor', 'POST', `${base}/library/import`, { library: { ...library, parts: [unknown, changed] } });
  assert.deepEqual(created.body.created.map(item => [item.name, item.revision]), [['Neu mit Revision 3', 3]]);
  assert.deepEqual(created.body.skipped.map(item => item.name), ['Importkiste, geändert']);
  assert.equal((await t.send<PartDetail>('administrator', 'GET', `${base}/parts/${unknown.id}`)).body.latestRevision, 3);
});

test('import rewrites child references to the revisions the workspace ended up with', async () => {
  const target = await t.addWorkspace('Gruppe mit Kind');
  const base = `/api/workspaces/${target}`;
  const mine = crate(30, 'Kiste Mein');
  assert.equal((await t.send('editor', 'POST', `${base}/parts`, { definition: { ...mine }, })).status, 422, 'material missing in this workspace');
  assert.equal((await t.send('editor', 'PUT', `${base}/materials/latte-40x40`, STARTER_MATERIALS[0])).status, 200);
  assert.equal((await t.send('editor', 'POST', `${base}/parts`, { definition: mine })).status, 201);

  const theirs = { ...mine, name: 'Kiste Ihre' };
  const parent = assembly(31, theirs, 'Gestell Ihre');
  const imported = await t.send<ImportReport>('editor', 'POST', `${base}/library/import`, {
    library: { schemaVersion: 1, materials: [], parts: [theirs, parent] },
  });
  assert.equal(imported.status, 200, JSON.stringify(imported.body));
  assert.deepEqual(imported.body.revised.map(item => [item.name, item.revision]), [['Kiste Ihre', 2]]);
  assert.deepEqual(imported.body.created.map(item => item.name), ['Gestell Ihre']);
  const stored = (await t.send<PartDetail>('administrator', 'GET', `${base}/parts/${parent.id}`)).body;
  assert.deepEqual(stored.definition.children![0]!.part, { id: mine.id, revision: 2 });
  const resolved = await t.send<ResolvedParts>('administrator', 'POST', `${base}/parts/resolve`, { refs: [stored.definition.children![0]!.part] });
  assert.equal(resolved.body.definitions[0]!.name, 'Kiste Ihre');

  const again = await t.send<ImportReport>('editor', 'POST', `${base}/library/import`, {
    library: { schemaVersion: 1, materials: [], parts: [theirs, parent] },
  });
  assert.equal(again.body.skipped.length, 2);
  assert.equal(again.body.created.length + again.body.revised.length, 0);
});

test('import reports rejected parts with their issues and takes in the rest', async () => {
  const target = await t.addWorkspace('Gruppe mit Fehlern');
  const base = `/api/workspaces/${target}`;
  const good = crate(40, 'Gute Kiste');
  const bad = crate(41, 'Schlechte Kiste', { bodies: [{ kind: 'beam', key: 'latte', material: 'fehlt', from: [0, 0, 0], to: [500, 0, 0] }] });
  const dependent = assembly(42, bad, 'Gestell auf schlechter Kiste');
  const reply = await t.send<ImportReport>('editor', 'POST', `${base}/library/import`, {
    library: { schemaVersion: 1, materials: [STARTER_MATERIALS[0]], parts: [good, bad, dependent] },
  });
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  assert.deepEqual(reply.body.created.map(item => item.name), ['Gute Kiste']);
  assert.deepEqual(reply.body.rejected.map(item => item.name).sort(), ['Gestell auf schlechter Kiste', 'Schlechte Kiste']);
  const badEntry = reply.body.rejected.find(item => item.id === bad.id)!;
  assert.equal(badEntry.issues[0]!.code, 'unknown-material');
  assert.match(badEntry.issues[0]!.message, /Schlechte Kiste/);
  const dependentEntry = reply.body.rejected.find(item => item.id === dependent.id)!;
  assert.ok(dependentEntry.issues.length > 0);
  assert.equal(dependentEntry.issues.every(item => item.part?.id === dependent.id), true);
  assert.equal((await t.send('administrator', 'GET', `${base}/parts/${bad.id}`)).status, 404);
  assert.equal((await t.send('administrator', 'GET', `${base}/parts/${good.id}`)).status, 200);

  const notLibrary = await t.send('editor', 'POST', `${base}/library/import`, { library: { schemaVersion: 2, materials: [], parts: [] } });
  assert.equal(notLibrary.status, 422);
  assert.ok(notLibrary.body.issues.length > 0);
  assert.equal((await t.send('editor', 'POST', `${base}/library/import`, { library: 'text' })).status, 422);
  assert.equal((await t.send('editor', 'POST', `${base}/library/import`, {})).status, 400, 'a request without a library is malformed');
});

test('import overwrites materials only when asked', async () => {
  const target = await t.addWorkspace('Gruppe mit Material');
  const base = `/api/workspaces/${target}`;
  const original = STARTER_MATERIALS[0] as PartMaterial & { color: string };
  const changed = { ...original, color: '#00ff00', weightKgPerM: 9 } as PartMaterial;
  const fresh: PartMaterial = { kind: 'hardware', key: 'schraube', name: 'Schraube', weightKgPerPiece: 0.01, color: '#888888' };
  assert.equal((await t.send('editor', 'PUT', `${base}/materials/${original.key}`, original)).status, 200);
  const file = { schemaVersion: 1, materials: [changed, fresh], parts: [] };

  const kept = await t.send<ImportReport>('editor', 'POST', `${base}/library/import`, { library: file });
  assert.deepEqual(kept.body.materials, { created: ['schraube'], overwritten: [], skipped: [original.key] });
  const afterKept = (await t.send<PartMaterial[]>('administrator', 'GET', `${base}/materials`)).body;
  assert.deepEqual(afterKept.find(item => item.key === original.key), original);

  const replaced = await t.send<ImportReport>('editor', 'POST', `${base}/library/import`, { library: file, overwriteMaterials: true });
  assert.deepEqual(replaced.body.materials, { created: [], overwritten: [original.key], skipped: ['schraube'] });
  assert.deepEqual((await t.send<PartMaterial[]>('administrator', 'GET', `${base}/materials`)).body.find(item => item.key === original.key), changed);

  const user = crate(50, 'Nutzt Latte');
  assert.equal((await t.send('editor', 'POST', `${base}/parts`, { definition: user })).status, 201);
  const kind = { kind: 'hardware' as const, key: original.key, name: 'Jetzt Zubehör', weightKgPerPiece: 1, color: '#ffffff' };
  const refused = await t.send('editor', 'POST', `${base}/library/import`, { library: { schemaVersion: 1, materials: [kind], parts: [] }, overwriteMaterials: true });
  assert.equal(refused.status, 409);
});

test('import is atomic: a failure while writing leaves nothing behind', async () => {
  const target = await t.addWorkspace('Gruppe mit Abbruch');
  const base = `/api/workspaces/${target}`;
  const fresh: PartMaterial = { kind: 'hardware', key: 'abbruch-schraube', name: 'Schraube', weightKgPerPiece: 0.01, color: '#888888' };
  const first = crate(60, 'Erste Kiste');
  const second = crate(61, 'Explodierende Kiste');
  await t.fixture.pool.query(`
    CREATE FUNCTION test_boom() RETURNS trigger AS $$ BEGIN
      IF NEW.definition->>'name' = 'Explodierende Kiste' THEN RAISE EXCEPTION 'boom'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER test_boom BEFORE INSERT ON part_revision FOR EACH ROW EXECUTE FUNCTION test_boom();`);
  try {
    const reply = await t.send('editor', 'POST', `${base}/library/import`, {
      library: { schemaVersion: 1, materials: [STARTER_MATERIALS[0], fresh], parts: [first, second] },
    });
    assert.equal(reply.status, 500);
  } finally {
    await t.fixture.pool.query('DROP TRIGGER test_boom ON part_revision; DROP FUNCTION test_boom()');
  }
  assert.deepEqual((await t.send<PartSummary[]>('administrator', 'GET', `${base}/parts`)).body, []);
  assert.deepEqual((await t.send<PartMaterial[]>('administrator', 'GET', `${base}/materials`)).body, []);
  const rows = await t.fixture.db.select().from(partDefinition).where(eq(partDefinition.workspaceId, target));
  assert.deepEqual(rows, []);
  assert.equal((await t.fixture.db.select().from(material).where(eq(material.workspaceId, target))).length, 0);
});

test('serves the library JSON Schema without a login', async () => {
  const reply = await t.app.inject({ url: '/api/schemas/part-library.schema.json' });
  assert.equal(reply.statusCode, 200);
  assert.match(String(reply.headers['content-type']), /application\/schema\+json/);
  assert.deepEqual(reply.json(), JSON.parse(JSON.stringify(partLibraryJsonSchema())));
});

test('permissions: everyone in the workspace reads, only editors and administrators write', async () => {
  const id = testId(1);
  const writes: [string, string, unknown][] = [
    ['POST', parts(), { definition: crate(70) }],
    ['POST', `${parts()}/${id}/revisions`, { baseRevision: 3, definition: crate(1) }],
    ['POST', `${parts()}/${id}/archive`, undefined],
    ['POST', `${parts()}/${id}/unarchive`, undefined],
    ['PUT', `${parts()}/${id}/favourite`, { favourite: true }],
    ['POST', `${parts()}/${id}/duplicate`, undefined],
    ['PUT', `${t.base}/materials/latte-40x40`, STARTER_MATERIALS[0]],
    ['DELETE', `${t.base}/materials/latte-40x40`, undefined],
    ['POST', `${t.base}/library/import`, { library: STARTER_LIBRARY }],
  ];
  for (const [method, url, payload] of writes) {
    const viewer = await t.send('viewer', method, url, payload);
    assert.equal(viewer.status, 403, `viewer ${method} ${url}`);
    assert.equal((await t.send('anonymous', method, url, payload)).status, 401, `anonymous ${method} ${url}`);
    const foreignOrigin = await t.app.inject({ method: method as 'POST', url, headers: { cookie: t.headers.editor.cookie, origin: 'https://evil.example' }, ...(payload !== undefined ? { payload: payload as object } : {}) });
    assert.equal(foreignOrigin.statusCode, 403, `foreign origin ${method} ${url}`);
  }
  const reads: [string, string, unknown?][] = [
    ['GET', parts()], ['GET', `${parts()}/${id}`], ['GET', `${parts()}/${id}/revisions/1`], ['GET', `${t.base}/materials`],
    ['POST', `${parts()}/resolve`, { refs: [{ id, revision: 1 }] }], ['POST', `${t.base}/library/export`, {}],
  ];
  for (const [method, url, payload] of reads) {
    assert.equal((await t.send('viewer', method, url, payload)).status, 200, `viewer ${method} ${url}`);
    assert.equal((await t.send('anonymous', method, url, payload)).status, 401, `anonymous ${method} ${url}`);
  }
  assert.equal((await t.send('editor', 'PUT', `${parts()}/${id}/favourite`, { favourite: true })).status, 200);
  assert.equal((await t.send('administrator', 'PUT', `${parts()}/${id}/favourite`, { favourite: false })).status, 200);
});

test('workspace ownership: another workspace cannot see, resolve, export or change these parts', async () => {
  const id = testId(1);
  const other = await t.addWorkspace('Fremde Gruppe', { starter: true });
  const otherBase = `/api/workspaces/${other}`;
  assert.equal((await t.send('administrator', 'GET', `${otherBase}/parts/${id}`)).status, 404);
  assert.equal((await t.send('administrator', 'GET', `${otherBase}/parts/${id}/revisions/1`)).status, 404);
  assert.equal((await t.send('administrator', 'POST', `${otherBase}/parts/${id}/archive`)).status, 404);
  assert.equal((await t.send('administrator', 'PUT', `${otherBase}/parts/${id}/favourite`, { favourite: true })).status, 404);
  assert.equal((await t.send('administrator', 'POST', `${otherBase}/parts/${id}/duplicate`)).status, 404);
  const save = await t.send('administrator', 'POST', `${otherBase}/parts/${id}/revisions`, { baseRevision: 1, definition: crate(1) });
  assert.equal(save.status, 404);
  const resolved = await t.send<ResolvedParts>('administrator', 'POST', `${otherBase}/parts/resolve`, { refs: [{ id, revision: 1 }] });
  assert.deepEqual(resolved.body, { definitions: [], missing: [{ id, revision: 1 }] });
  const exported = await t.send<LibraryExport>('administrator', 'POST', `${otherBase}/library/export`, {});
  assert.equal(exported.body.library.parts.some(item => item.id === id), false);
  assert.equal((await t.send('administrator', 'POST', `${otherBase}/library/export`, { partIds: [id] })).status, 404);
  const listed = await t.send<PartSummary[]>('administrator', 'GET', `${otherBase}/parts`);
  assert.equal(listed.body.some(item => item.id === id), false);

  const created = await t.send('administrator', 'POST', `${otherBase}/parts`, { definition: crate(1, 'Eigene Kiste in der Fremdgruppe') });
  assert.equal(created.status, 201, 'the same id may exist in another workspace');
  assert.equal((await t.send<PartDetail>('administrator', 'GET', `${t.base}/parts/${id}`)).body.name, 'Kiste Eins, neu');

  assert.equal((await t.send('viewer', 'GET', `${otherBase}/parts`)).status, 404, 'a non-member learns nothing');
  assert.equal((await t.send('viewer', 'POST', `${otherBase}/parts`, { definition: crate(71) })).status, 404);
  assert.equal((await t.send('viewer', 'GET', `/api/workspaces/${randomUUID()}/parts`)).status, 404);
  assert.equal((await t.send('anonymous', 'GET', `${otherBase}/parts`)).status, 401);
  assert.equal((await t.send('viewer', 'GET', `${otherBase}/materials`)).status, 404);
  assert.equal((await t.send('viewer', 'POST', `${otherBase}/library/import`, { library: STARTER_LIBRARY })).status, 404);
});

test('writes leave audit entries and the read-only POSTs leave none', async () => {
  const entries = async () => (await t.fixture.db.select().from(auditEvent).where(eq(auditEvent.workspaceId, t.workspaceId))).map(item => item.action);
  const entriesBefore = (await entries()).length;
  await t.send('viewer', 'POST', `${parts()}/resolve`, { refs: [{ id: testId(1), revision: 1 }] });
  await t.send('viewer', 'POST', `${t.base}/library/export`, {});
  assert.equal((await entries()).length, entriesBefore);

  const created = await t.send('editor', 'POST', parts(), { definition: crate(80, 'Auditkiste') });
  assert.equal(created.status, 201);
  await t.send('editor', 'POST', `${parts()}/${testId(80)}/revisions`, { baseRevision: 1, definition: crate(80, 'Auditkiste 2') });
  await t.send('editor', 'POST', `${parts()}/${testId(80)}/archive`);
  await t.send('editor', 'PUT', `${parts()}/${testId(80)}/favourite`, { favourite: true });
  await t.send('editor', 'PUT', `${t.base}/materials/latte-40x40`, STARTER_MATERIALS[0]);
  await t.send('editor', 'POST', `${t.base}/library/import`, { library: { schemaVersion: 1, materials: [], parts: [] } });
  await t.send('editor', 'POST', parts(), { definition: crate(80, 'Doppelt') });
  const actions = await entries();
  const route = (suffix: string) => `/api/workspaces/:workspaceId/${suffix}`;
  for (const action of [
    `POST ${route('parts/:partId/revisions')}`, `POST ${route('parts/:partId/archive')}`, `PUT ${route('parts/:partId/favourite')}`,
    `PUT ${route('materials/:key')}`, `POST ${route('library/import')}`,
  ]) assert.equal(actions.includes(action), true, action);
  const logged = await t.send<{ action: string; resourceId: string; actorName: string }[]>('administrator', 'GET', `${t.base}/audit`);
  assert.equal(logged.body.some(item => item.action === `POST ${route('parts')}` && item.resourceId === `${t.base}/parts` && item.actorName === 'Nutzer editor'), true);
  assert.equal(actions.includes(`POST ${route('parts')}`), true);
  assert.equal(actions.filter(item => item.includes('resolve') || item.includes('export')).length, 0);
});
