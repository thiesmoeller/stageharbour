import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STARTER_BRACE, STARTER_DECK, STARTER_DECK_LEG, STARTER_LIBRARY, STARTER_MATERIALS, STARTER_PARTS, STARTER_TABLE,
  buildLibraryExport, buildPartDetail, buildPartSummary, buildStockCount, buildStockItem, canonicalJson, closureOf, createPartContext,
  duplicateName, libraryFilename, newStockItemFields, partRefKey, planCreatePart, planDuplicatePart, planLibraryImport,
  planMaterialDelete, planMaterialUpsert, planSavePart, planStarterLibrary, rawChildRefs, sameDefinitionContent, sortMaterials,
  sortPartSummaries, sortStockCounts, sortStockItems, stockCountMaterialIssue, stockCountPartIssue, stockItemTargetIssue,
  updatedStockItemFields, valuesIssue, variantColumn, variantFromColumn, variantIssue, variantLabelOf,
  type ImportWorkspace, type PartDefinition, type PartMaterial, type PartSummary,
} from '../src/shared/parts/index.js';
import { crate, testId } from './helpers/crate.js';

const context = (parts: PartDefinition[] = []) => createPartContext({ materials: STARTER_MATERIALS, parts });
const NOW = new Date('2026-05-06T07:08:09.000Z');
const material = (key: string) => STARTER_MATERIALS.find(item => item.key === key)!;
const assembly = (serial: number, child: PartDefinition, revision = child.revision): PartDefinition => ({
  id: testId(serial), revision: 1, name: `Gestell ${serial}`, category: 'Test', parameters: [], bodies: [],
  children: [{ key: 'kiste', part: { id: child.id, revision }, variant: 'klein', at: [0, 0, 0] }],
  traits: { stock: 'none' },
});
const workspaceOf = (definitions: PartDefinition[], materials: PartMaterial[] = [...STARTER_MATERIALS]): ImportWorkspace => {
  const revisions = new Map<string, Map<number, PartDefinition>>();
  for (const definition of definitions) revisions.set(definition.id, new Map([...(revisions.get(definition.id) ?? []), [definition.revision, definition]]));
  return { materials: new Map(materials.map(item => [item.key, item])), revisions };
};
const fail = <T>(plan: { ok: boolean; failure?: T } | { ok: true; value: unknown }) => {
  assert.equal(plan.ok, false);
  return (plan as { failure: { status: number; message: string; issues?: { code: string }[] } }).failure;
};
const value = <T>(plan: { ok: true; value: T } | { ok: false }) => {
  assert.equal(plan.ok, true, JSON.stringify(plan));
  return (plan as { value: T }).value;
};

test('creating a part stamps revision 1 and refuses a taken id and an invalid definition', () => {
  const created = value(planCreatePart({ ...crate(1), revision: 7 }, context(), () => false));
  assert.equal(created.revision, 1);
  const taken = fail(planCreatePart(crate(1), context(), id => id === testId(1)));
  assert.deepEqual([taken.status, taken.message], [409, 'Ein Bauteil mit dieser ID gibt es bereits.']);
  const invalid = fail(planCreatePart(crate(1, 'X', { bodies: [{ kind: 'beam', key: 'a', material: 'gibt-es-nicht', from: [0, 0, 0], to: [1, 0, 0] }] }), context(), () => false));
  assert.equal(invalid.status, 422);
  assert.equal(invalid.issues![0]!.code, 'unknown-material');
  assert.equal(fail(planCreatePart('nonsense', context(), () => false)).status, 422);
});

test('saving stamps the id and the next revision, and refuses a stale base or a foreign id', () => {
  const base = { partId: testId(1), latestRevision: 3, baseRevision: 3, context: context() };
  const saved = value(planSavePart({ ...base, input: { ...crate(1, 'Neu'), revision: 99 } }));
  assert.deepEqual([saved.id, saved.revision, saved.name], [testId(1), 4, 'Neu']);
  assert.equal(value(planSavePart({ ...base, input: { ...crate(1), id: undefined } })).id, testId(1));
  const stale = fail(planSavePart({ ...base, baseRevision: 2, input: crate(1) }));
  assert.deepEqual([stale.status, stale.message], [409, 'Das Bauteil wurde inzwischen geändert (jetzt Revision 3). Bitte neu laden.']);
  assert.equal(fail(planSavePart({ ...base, input: crate(2) })).status, 400);
  assert.equal(fail(planSavePart({ ...base, input: { ...crate(1), bodies: [] } })).status, 422);
});

test('duplicates are named "Kopie", "Kopie 2" … and share nothing with the source', () => {
  assert.equal(duplicateName('Tisch', []), 'Tisch Kopie');
  assert.equal(duplicateName('Tisch', ['Tisch Kopie']), 'Tisch Kopie 2');
  assert.equal(duplicateName('Tisch', ['Tisch Kopie', 'Tisch Kopie 2']), 'Tisch Kopie 3');
  assert.ok(duplicateName('x'.repeat(120), []).length <= 120);
  const source = crate(1, 'Kiste', { revision: 4 });
  const copy = planDuplicatePart(source, testId(2), ['Kiste']);
  assert.deepEqual([copy.id, copy.revision, copy.name], [testId(2), 1, 'Kiste Kopie']);
  copy.parameters[0]!.label = 'Geändert';
  assert.equal(source.parameters[0]!.label, 'Breite');
});

test('materials stay while a part uses them and keep their kind while it does', () => {
  const users = [STARTER_BRACE, crate(1)];
  assert.equal(fail(planMaterialDelete('gibt-es-nicht', undefined, users)).status, 404);
  const used = fail(planMaterialDelete('latte-40x40', material('latte-40x40'), users));
  assert.equal(used.status, 409);
  assert.match(used.message, /„Kiste 1“, „Stützdreieck“/);
  const many = Array.from({ length: 8 }, (_, index) => crate(index + 1, `Kiste ${index + 1}`));
  assert.match(fail(planMaterialDelete('latte-40x40', material('latte-40x40'), many)).message, /und 3 weitere/);
  assert.deepEqual(value(planMaterialDelete('betonplatte-400', material('betonplatte-400'), [crate(1)])), null);
  const sheet: PartMaterial = { kind: 'sheet', key: 'latte-40x40', name: 'Latte', thickness: 40, weightKgPerM2: 1, color: '#aaaaaa' };
  assert.equal(fail(planMaterialUpsert(sheet, material('latte-40x40'), users)).status, 409);
  assert.deepEqual(value(planMaterialUpsert(sheet, material('latte-40x40'), [])), { created: false });
  assert.deepEqual(value(planMaterialUpsert(sheet, undefined, users)), { created: true });
  assert.deepEqual(value(planMaterialUpsert({ ...material('latte-40x40'), name: 'Neu' }, material('latte-40x40'), users)), { created: false });
});

test('summaries, details and sorting follow the German collation and break ties by id', () => {
  const record = { id: testId(1), name: 'Kiste', category: 'Test', latestRevision: 2, favourite: true, archivedAt: null, updatedAt: NOW.toISOString() };
  const summary = buildPartSummary(record, crate(1));
  assert.deepEqual(summary, {
    id: testId(1), name: 'Kiste', category: 'Test', latestRevision: 2, archived: false, favourite: true,
    variants: [{ key: 'klein', label: 'Klein' }, { key: 'gross', label: 'Groß' }], stock: 'item', updatedAt: NOW.toISOString(),
  });
  assert.equal(buildPartSummary({ ...record, archivedAt: NOW.toISOString() }, crate(1)).archived, true);
  assert.deepEqual(buildPartSummary(record, crate(1, 'K', { variants: undefined })).variants, []);
  const infos = [{ revision: 2, createdAt: 'b', authorName: null }, { revision: 1, createdAt: 'a', authorName: 'Ada' }];
  assert.deepEqual(buildPartDetail(record, crate(1), infos).revisions.map(item => item.revision), [1, 2]);
  const named = (name: string, id: string): PartSummary => ({ ...summary, name, id });
  assert.deepEqual(
    sortPartSummaries([named('Zelt', testId(1)), named('Äpfel', testId(2)), named('Birne', testId(4)), named('Birne', testId(3))]).map(item => [item.name, item.id]),
    [['Äpfel', testId(2)], ['Birne', testId(3)], ['Birne', testId(4)], ['Zelt', testId(1)]],
  );
  const kinds = sortMaterials(STARTER_MATERIALS).map(item => item.kind);
  assert.deepEqual(kinds, [...kinds].sort());
});

test('child references are read defensively and the closure follows exact revisions without looping', () => {
  assert.deepEqual(rawChildRefs(null), []);
  assert.deepEqual(rawChildRefs({ children: 5 }), []);
  assert.deepEqual(rawChildRefs({ children: [null, { part: { id: 5, revision: 1 } }, { part: { id: testId(1), revision: 1.5 } }, { part: { id: testId(1), revision: 2 } }] }), [{ id: testId(1), revision: 2 }]);
  assert.equal(rawChildRefs({ children: Array.from({ length: 500 }, () => ({ part: { id: testId(1), revision: 1 } })) }).length, 200);

  const leaf = crate(1);
  const middle = assembly(2, leaf);
  const top = assembly(3, middle);
  const loop: PartDefinition = { ...assembly(4, leaf), children: [{ key: 'a', part: { id: testId(4), revision: 1 }, at: [0, 0, 0] }] };
  const known = new Map([leaf, middle, top, loop].map(definition => [partRefKey(definition), definition]));
  const found = closureOf([{ id: testId(3), revision: 1 }], ref => known.get(partRefKey(ref)));
  assert.deepEqual(found.map(item => item.id).sort(), [testId(1), testId(2), testId(3)]);
  assert.deepEqual(closureOf([{ id: testId(4), revision: 1 }], ref => known.get(partRefKey(ref))).map(item => item.id), [testId(4)]);
  assert.deepEqual(closureOf([{ id: testId(9), revision: 1 }], ref => known.get(partRefKey(ref))), []);
});

test('content comparison ignores key order and revision only', () => {
  const a = crate(1);
  const shuffled = JSON.parse(JSON.stringify(a), (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).reverse()) : item);
  assert.equal(canonicalJson(a), canonicalJson(shuffled));
  assert.equal(sameDefinitionContent(a, { ...shuffled, revision: 9 }), true);
  assert.equal(sameDefinitionContent(a, { ...a, name: 'Anders' }), false);
});

test('library file names are ASCII, dated and fall back for names without letters', () => {
  const day = new Date('2026-03-04T23:30:00.000Z');
  assert.equal(libraryFilename('Beispiel-Theatergruppe', day), 'bauteile-beispiel-theatergruppe-2026-03-04.stageharbour-parts.json');
  assert.equal(libraryFilename('Bühne für Größe & Co.', day), 'bauteile-buehne-fuer-groesse-co-2026-03-04.stageharbour-parts.json');
  assert.equal(libraryFilename('???', day), 'bauteile-arbeitsbereich-2026-03-04.stageharbour-parts.json');
  assert.ok(libraryFilename('a'.repeat(200), day).length < 90);
});

test('an export holds the chosen parts, the exact revisions they reference and the materials any of them names', () => {
  const leaf = crate(1);
  const middle = assembly(2, leaf);
  const top = assembly(3, middle);
  const byRef = new Map([leaf, middle, top].map(definition => [partRefKey(definition), definition]));
  const exported = buildLibraryExport({
    roots: [top], part: ref => byRef.get(partRefKey(ref)), material: key => STARTER_MATERIALS.find(item => item.key === key),
  });
  assert.deepEqual(exported.parts.map(item => item.name), ['Gestell 2', 'Gestell 3', 'Kiste 1'], 'ordered by name');
  assert.deepEqual(exported.materials.map(item => item.key), ['latte-40x40']);
  const again = buildLibraryExport({ roots: [top, leaf], part: ref => byRef.get(partRefKey(ref)), material: key => STARTER_MATERIALS.find(item => item.key === key) });
  assert.deepEqual(again, exported);
});

test('importing creates unknown parts under the file revisions, skips identical ones and adds changed ones as n + 1', () => {
  const leaf = crate(1);
  const library = { schemaVersion: 1, materials: [material('latte-40x40')], parts: [leaf] };
  const empty = workspaceOf([], []);
  const first = value(planLibraryImport({ input: library, overwriteMaterials: false, workspace: empty }));
  assert.deepEqual(first.materials.create.map(item => item.key), ['latte-40x40']);
  assert.deepEqual(first.parts.map(item => [item.definition.id, item.newPart]), [[leaf.id, true]]);
  assert.deepEqual(first.report.created, [{ id: leaf.id, name: leaf.name, fileRevision: 1, revision: 1 }]);

  const stored = workspaceOf([leaf]);
  const same = value(planLibraryImport({ input: library, overwriteMaterials: false, workspace: stored }));
  assert.deepEqual(same.parts, []);
  assert.deepEqual(same.report.skipped.map(item => item.revision), [1]);
  assert.deepEqual(same.report.materials.skipped, ['latte-40x40']);

  const changed = { ...library, parts: [{ ...leaf, name: 'Kiste, geändert' }] };
  const revised = value(planLibraryImport({ input: changed, overwriteMaterials: false, workspace: stored }));
  assert.deepEqual(revised.report.revised, [{ id: leaf.id, name: 'Kiste, geändert', fileRevision: 1, revision: 2 }]);
  assert.deepEqual(revised.parts.map(item => [item.definition.revision, item.newPart]), [[2, false]]);
  const again = value(planLibraryImport({ input: changed, overwriteMaterials: false, workspace: workspaceOf([leaf, revised.parts[0]!.definition]) }));
  assert.deepEqual([again.parts.length, again.report.skipped.length], [0, 1]);
});

test('importing rewrites child references to the revisions the workspace ended up with', () => {
  const leaf = crate(1);
  const parent = assembly(2, leaf);
  const stored = workspaceOf([{ ...leaf, name: 'Kiste, schon geändert' }, { ...leaf, name: 'Kiste, schon geändert', revision: 2 }].slice(0, 1));
  const library = { schemaVersion: 1, materials: [material('latte-40x40')], parts: [leaf, parent] };
  const plan = value(planLibraryImport({ input: library, overwriteMaterials: false, workspace: stored }));
  const child = plan.parts.find(item => item.definition.id === parent.id)!.definition.children![0]!;
  const written = plan.parts.find(item => item.definition.id === leaf.id)!.definition;
  assert.deepEqual(child.part, { id: leaf.id, revision: written.revision });
  assert.equal(written.revision, 2);
  assert.deepEqual(plan.parts.map(item => item.definition.id), [leaf.id, parent.id], 'children first');
});

test('importing rejects a broken part and the parts built on it, and still plans the rest', () => {
  const good = crate(1);
  const broken = crate(2, 'Defekt', { bodies: [{ kind: 'beam', key: 'a', material: 'gibt-es-nicht', from: [0, 0, 0], to: [1, 0, 0] }] });
  const dependent = assembly(3, broken);
  const plan = value(planLibraryImport({
    input: { schemaVersion: 1, materials: [material('latte-40x40')], parts: [good, broken, dependent] },
    overwriteMaterials: false, workspace: workspaceOf([]),
  }));
  assert.deepEqual(plan.report.created.map(item => item.id), [good.id]);
  assert.deepEqual(plan.report.rejected.map(item => item.id).sort(), [broken.id, dependent.id].sort());
  assert.ok(plan.report.rejected.every(item => item.issues.length > 0));
  assert.deepEqual(plan.parts.map(item => item.definition.id), [good.id]);
});

test('importing refuses something that is not a library and honours overwriteMaterials', () => {
  const refused = fail(planLibraryImport({ input: { schemaVersion: 1, materials: 5 }, overwriteMaterials: false, workspace: workspaceOf([]) }));
  assert.deepEqual([refused.status, refused.message], [422, 'Die Datei ist keine gültige Bauteilbibliothek.']);
  assert.ok(refused.issues!.length > 0);

  const recoloured = { ...material('latte-40x40'), color: '#123456' };
  const library = { schemaVersion: 1, materials: [recoloured], parts: [] };
  const kept = value(planLibraryImport({ input: library, overwriteMaterials: false, workspace: workspaceOf([crate(1)]) }));
  assert.deepEqual([kept.materials.overwrite, kept.report.materials.skipped], [[], ['latte-40x40']]);
  const replaced = value(planLibraryImport({ input: library, overwriteMaterials: true, workspace: workspaceOf([crate(1)]) }));
  assert.deepEqual([replaced.materials.overwrite.length, replaced.report.materials.overwritten], [1, ['latte-40x40']]);
  const kindChange = fail(planLibraryImport({
    input: { schemaVersion: 1, materials: [{ kind: 'sheet', key: 'latte-40x40', name: 'Latte', thickness: 40, weightKgPerM2: 1, color: '#aaaaaa' }], parts: [] },
    overwriteMaterials: true, workspace: workspaceOf([crate(1)]),
  }));
  assert.equal(kindChange.status, 409);
});

test('the starter plan adds only what is missing and never edits what a group changed', () => {
  const none = planStarterLibrary(STARTER_LIBRARY, { materialKeys: new Set(), parts: new Map() });
  assert.equal(none.materials.length, STARTER_MATERIALS.length);
  assert.equal(none.parts.length, STARTER_PARTS.length);
  assert.equal(none.parts.every(item => item.newPart), true);
  const everything = planStarterLibrary(STARTER_LIBRARY, {
    materialKeys: new Set(STARTER_MATERIALS.map(item => item.key)),
    parts: new Map(STARTER_PARTS.map(part => [part.id, { latestRevision: part.revision, revisions: new Set([part.revision]) }])),
  });
  assert.deepEqual([everything.materials, everything.parts], [[], []]);
  const ahead = planStarterLibrary(STARTER_LIBRARY, {
    materialKeys: new Set(), parts: new Map([[STARTER_TABLE.id, { latestRevision: 5, revisions: new Set([5]) }]]),
  });
  assert.equal(ahead.parts.some(item => item.definition.id === STARTER_TABLE.id), true, 'a missing revision below the latest is filled in');
  const own = planStarterLibrary(STARTER_LIBRARY, {
    materialKeys: new Set(), parts: new Map([[STARTER_TABLE.id, { latestRevision: 5, revisions: new Set([1, 5]) }]]),
  });
  assert.equal(own.parts.some(item => item.definition.id === STARTER_TABLE.id), false);
});

const item = (overrides: Partial<PartDefinition> = {}) => ({ definition: crate(1, 'Kiste', overrides), archived: false });

test('variant rules: a part with variants needs one of them, a part without takes none', () => {
  const kiste = crate(1);
  assert.equal(variantIssue(kiste, 'klein'), undefined);
  assert.match(variantIssue(kiste, null)!, /hat Varianten/);
  assert.match(variantIssue(kiste, 'riesig')!, /keine Variante „riesig“/);
  const plain = crate(2, 'Platte', { variants: undefined });
  assert.equal(variantIssue(plain, null), undefined);
  assert.match(variantIssue(plain, 'klein')!, /keine Varianten/);
  assert.deepEqual([variantLabelOf(kiste, 'gross'), variantLabelOf(kiste, 'riesig'), variantLabelOf(kiste, null)], ['Groß', null, null]);
  assert.deepEqual([variantColumn(null), variantColumn(undefined), variantColumn('a'), variantFromColumn(''), variantFromColumn('a')], ['', '', 'a', null, 'a']);
});

test('stock item targets: part, archived state, stock mode, variant and placement values', () => {
  assert.equal(stockItemTargetIssue({ part: undefined, variantKey: null }), 'Das Bauteil ist nicht vorhanden.');
  assert.equal(stockItemTargetIssue({ part: item(), variantKey: 'klein' }), undefined);
  assert.match(stockItemTargetIssue({ part: { ...item(), archived: true }, variantKey: 'klein' })!, /archiviert/);
  assert.equal(stockItemTargetIssue({ part: { ...item(), archived: true }, variantKey: 'klein', allowArchived: true }), undefined);
  assert.match(stockItemTargetIssue({ part: { definition: STARTER_DECK_LEG, archived: false }, variantKey: '600' })!, /Zählbestand/);
  assert.match(stockItemTargetIssue({ part: item(), variantKey: null })!, /Variante wählen/);
  const deck = { definition: STARTER_DECK, archived: false };
  assert.equal(stockItemTargetIssue({ part: deck, variantKey: '2x1', values: { H: 600 } }), undefined);
  assert.match(stockItemTargetIssue({ part: deck, variantKey: '2x1', values: { zzz: 1 } })!, /keinen Parameter „zzz“/);
  assert.match(stockItemTargetIssue({ part: deck, variantKey: '2x1', values: { B: 1000 } })!, /nicht von der Platzierung/);
  assert.match(stockItemTargetIssue({ part: deck, variantKey: '2x1', values: { H: 601 } })!, /nicht im Bereich/);
  assert.equal(valuesIssue(STARTER_DECK, undefined), undefined);
});

test('stock count targets: counted parts and hardware only', () => {
  assert.equal(stockCountPartIssue({ definition: STARTER_DECK_LEG, archived: false }, '600'), undefined);
  assert.equal(stockCountPartIssue(undefined, null), 'Das Bauteil ist nicht vorhanden.');
  assert.match(stockCountPartIssue({ definition: STARTER_DECK_LEG, archived: true }, '600')!, /archiviert/);
  assert.match(stockCountPartIssue({ definition: STARTER_DECK_LEG, archived: false }, null)!, /Variante wählen/);
  assert.match(stockCountPartIssue(item(), 'klein')!, /einzelne Bestandsstücke/);
  assert.equal(stockCountMaterialIssue(material('gummifuss-50')), undefined);
  assert.equal(stockCountMaterialIssue(undefined), 'Das Material ist nicht vorhanden.');
  assert.match(stockCountMaterialIssue(material('latte-40x40'))!, /nur Zubehör/);
});

test('stock item fields: defaults on create, partial update on patch, finish stamped as confirmed now', () => {
  const finish = { surfaces: { front: { full: { kind: 'paint' as const, ral: '9010' } } }, description: 'Weiß' };
  const created = newStockItemFields({ label: 'K-01', partId: testId(1) }, NOW);
  assert.deepEqual(created, { label: 'K-01', variantKey: null, values: {}, usable: true, notes: null, cutouts: [], finish: null });
  const painted = newStockItemFields({ label: 'K-01', partId: testId(1), variantKey: 'klein', notes: 'n', usable: false, finish }, NOW);
  assert.deepEqual(painted.finish, { ...finish, confirmedAt: NOW.toISOString() });
  assert.deepEqual([painted.variantKey, painted.notes, painted.usable], ['klein', 'n', false]);
  const later = new Date('2026-06-01T00:00:00.000Z');
  assert.deepEqual(updatedStockItemFields(painted, {}, later), painted);
  const changed = updatedStockItemFields(painted, { label: 'K-02', notes: null, variantKey: null, finish: { ...finish, description: 'Neu' } }, later);
  assert.deepEqual([changed.label, changed.notes, changed.variantKey, changed.finish?.confirmedAt], ['K-02', null, null, later.toISOString()]);
  assert.equal(updatedStockItemFields(painted, { finish: null }, later).finish, null);
  assert.deepEqual(updatedStockItemFields(painted, { values: { H: 600 } }, later).values, { H: 600 });
});

test('stock items and counts are presented with part and variant names, and sorted by name', () => {
  const record = {
    id: testId(10), label: 'K-01', partId: testId(1), variantKey: 'klein', values: {}, usable: true, notes: null, cutouts: [], finish: null,
    archivedAt: null, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
  };
  const part = { name: 'Kiste', definition: crate(1) };
  const built = buildStockItem(record, part);
  assert.deepEqual([built.partName, built.variantLabel, built.archived], ['Kiste', 'Klein', false]);
  assert.equal('archivedAt' in built, false);
  assert.deepEqual([buildStockItem({ ...record, archivedAt: NOW.toISOString() }, part).archived, buildStockItem(record, undefined).partName], [true, '']);
  const labels = (labelsIn: string[]) => sortStockItems(labelsIn.map((label, index) => buildStockItem({ ...record, id: testId(index + 1), label }, part))).map(entry => entry.label);
  assert.deepEqual(labels(['b-2', 'Ä-1', 'a-1']), ['a-1', 'Ä-1', 'b-2']);
  const shared = sortStockItems([
    buildStockItem({ ...record, id: testId(1), archivedAt: NOW.toISOString() }, part), buildStockItem({ ...record, id: testId(2) }, part),
  ]);
  assert.deepEqual(shared.map(entry => entry.archived), [false, true]);

  const lookup = { materialName: (key: string) => key === 'gummifuss-50' ? 'Gummifuß' : undefined, part: (id: string) => id === STARTER_DECK_LEG.id ? { name: 'Steckfuß', definition: STARTER_DECK_LEG } : undefined };
  const byMaterial = buildStockCount({ id: testId(1), materialKey: 'gummifuss-50', partId: null, variantKey: null, quantity: 3, updatedAt: NOW.toISOString() }, lookup);
  assert.deepEqual([byMaterial.name, byMaterial.variantLabel], ['Gummifuß', null]);
  const byPart = buildStockCount({ id: testId(2), materialKey: null, partId: STARTER_DECK_LEG.id, variantKey: '600', quantity: 3, updatedAt: NOW.toISOString() }, lookup);
  assert.deepEqual([byPart.name, byPart.variantLabel], ['Steckfuß', '60 cm']);
  assert.equal(buildStockCount({ id: testId(3), materialKey: 'unbekannt', partId: null, variantKey: null, quantity: 0, updatedAt: NOW.toISOString() }, lookup).name, 'unbekannt');
  assert.deepEqual(sortStockCounts([byPart, byMaterial]).map(entry => entry.name), ['Gummifuß', 'Steckfuß']);
});
