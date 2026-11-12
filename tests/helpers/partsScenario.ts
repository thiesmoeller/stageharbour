import { createHash } from 'node:crypto';
import { STARTER_BRACE, STARTER_DECK, STARTER_DECK_LEG, STARTER_MATERIALS, STARTER_TABLE } from '../../src/shared/parts/starter/index.js';
import type { PartDefinition, PartMaterial } from '../../src/shared/parts/definition.js';
import { crate, testId } from './crate.js';

/**
 * One walk through every route of the part catalog, materials, library and stock, recorded as a
 * trace. The server integration tests record it (`UPDATE_PARTS_TRACE=1` rewrites the golden
 * file) and the local-mode unit tests must produce the very same trace: same status and body for
 * every request. Ids that the scenario does not fix and timestamps are normalised.
 */

export type ScenarioRole = 'administrator' | 'editor' | 'viewer';
export type ScenarioReply = { status: number; body: unknown };
export type ScenarioWorld = {
  workspaceId: string;
  send(role: ScenarioRole, method: string, path: string, payload?: unknown): Promise<ScenarioReply>;
};
export type TraceStep = { step: string; role: ScenarioRole; request: string; status: number; body: unknown };

export const PARTS_TRACE_FILE = new URL('../fixtures/parts-api-trace.json', import.meta.url);

const FIXED_ID_PREFIXES = ['5a17e9a0-', 'c47a1090-'];
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/** Same text for the same run on any backend: stable ids stay, others are numbered by first appearance. */
export function normaliseTrace(trace: readonly TraceStep[], workspaceId: string): TraceStep[] {
  const numbered = new Map<string, string>();
  const text = JSON.stringify(trace)
    .replaceAll(workspaceId, '<workspace>')
    .replace(UUID, id => FIXED_ID_PREFIXES.some(prefix => id.startsWith(prefix))
      ? id : numbered.get(id) ?? (numbered.set(id, `<id${numbered.size + 1}>`), numbered.get(id)!))
    .replace(/"authorName":"[^"]*"/g, '"authorName":"<author>"')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<time>')
    .replace(/bauteile-[a-z0-9-]*-\d{4}-\d{2}-\d{2}\.stageharbour-parts\.json/g, 'bauteile-<workspace>-<date>.stageharbour-parts.json');
  return JSON.parse(text) as TraceStep[];
}

const FINISH = { surfaces: { front: { full: { kind: 'paint', ral: '9010' } } }, description: 'Weiß gestrichen' };

export async function runPartsScenario(world: ScenarioWorld): Promise<TraceStep[]> {
  const trace: TraceStep[] = [];
  const base = `/api/workspaces/${world.workspaceId}`;
  const parts = `${base}/parts`;
  const stock = `${base}/stock`;

  async function step(label: string, role: ScenarioRole, method: string, path: string, payload?: unknown): Promise<ScenarioReply> {
    const reply = await world.send(role, method, path, payload);
    trace.push({ step: label, role, request: `${method} ${path}`, status: reply.status, body: reply.body ?? null });
    return reply;
  }
  const bodyOf = (reply: ScenarioReply) => reply.body as any;

  await step('list parts', 'viewer', 'GET', parts);
  await step('list parts with archived', 'viewer', 'GET', `${parts}?includeArchived=true`);
  await step('list parts, bad query', 'viewer', 'GET', `${parts}?includeArchived=maybe`);
  await step('list parts in an unknown workspace', 'administrator', 'GET', '/api/workspaces/9d3f1a5c-0000-4000-8000-000000000000/parts');
  await step('list parts, workspace id not a uuid', 'administrator', 'GET', '/api/workspaces/nope/parts');
  await step('get starter deck', 'viewer', 'GET', `${parts}/${STARTER_DECK.id}`);
  await step('get starter revision', 'viewer', 'GET', `${parts}/${STARTER_DECK.id}/revisions/1`);
  await step('get missing revision', 'viewer', 'GET', `${parts}/${STARTER_DECK.id}/revisions/2`);
  await step('get revision zero', 'viewer', 'GET', `${parts}/${STARTER_DECK.id}/revisions/0`);
  await step('get unknown part', 'viewer', 'GET', `${parts}/${testId(404)}`);
  await step('get part, id not a uuid', 'viewer', 'GET', `${parts}/not-a-uuid`);

  const first = crate(1, 'Kiste Eins');
  await step('create part', 'editor', 'POST', parts, { definition: { ...first, revision: 7 } });
  await step('create part again', 'editor', 'POST', parts, { definition: first });
  await step('create part as viewer', 'viewer', 'POST', parts, { definition: crate(2) });
  await step('create part with an extra field', 'editor', 'POST', parts, { definition: crate(2), extra: 1 });
  await step('create part without a definition', 'editor', 'POST', parts, {});
  await step('create part that is not a definition', 'editor', 'POST', parts, { definition: { name: 5 } });
  await step('create part with an unknown material', 'editor', 'POST', parts, {
    definition: crate(2, 'Ohne Material', { bodies: [{ kind: 'beam', key: 'latte', material: 'gibt-es-nicht', from: [0, 0, 0], to: [500, 0, 0] }] }),
  });
  await step('create part below its minimum', 'editor', 'POST', parts, {
    definition: crate(2, 'Zu kurz', {
      parameters: [{ key: 'B', label: 'Breite', type: 'length', default: 600, scope: 'placement', range: { min: 0, max: 1200 } }],
      variants: undefined,
    }),
  });
  await step('get created part', 'viewer', 'GET', `${parts}/${first.id}`);

  const next = { ...first, name: 'Kiste Eins, neu', revision: 99, description: 'Zweite Fassung' };
  await step('save part', 'editor', 'POST', `${parts}/${first.id}/revisions`, { baseRevision: 1, definition: next });
  await step('save part from a stale revision', 'editor', 'POST', `${parts}/${first.id}/revisions`, { baseRevision: 1, definition: next });
  await step('save part with another id', 'editor', 'POST', `${parts}/${first.id}/revisions`, { baseRevision: 2, definition: { ...next, id: testId(9) } });
  await step('save part as viewer', 'viewer', 'POST', `${parts}/${first.id}/revisions`, { baseRevision: 2, definition: next });
  await step('save unknown part', 'editor', 'POST', `${parts}/${testId(404)}/revisions`, { baseRevision: 1, definition: next });
  await step('save invalid revision', 'editor', 'POST', `${parts}/${first.id}/revisions`, { baseRevision: 2, definition: { ...next, bodies: [] } });
  await step('get revision one after a save', 'viewer', 'GET', `${parts}/${first.id}/revisions/1`);
  await step('get revision two', 'viewer', 'GET', `${parts}/${first.id}/revisions/2`);

  await step('favourite part', 'editor', 'PUT', `${parts}/${first.id}/favourite`, { favourite: true });
  await step('favourite with a bad body', 'editor', 'PUT', `${parts}/${first.id}/favourite`, { favourite: 'yes' });
  await step('favourite as viewer', 'viewer', 'PUT', `${parts}/${first.id}/favourite`, { favourite: false });
  await step('archive part', 'editor', 'POST', `${parts}/${first.id}/archive`);
  await step('archive part again', 'editor', 'POST', `${parts}/${first.id}/archive`);
  await step('archive as viewer', 'viewer', 'POST', `${parts}/${first.id}/archive`);
  await step('archive unknown part', 'editor', 'POST', `${parts}/${testId(404)}/archive`);
  await step('list without the archived part', 'viewer', 'GET', parts);
  await step('list with the archived part', 'viewer', 'GET', `${parts}?includeArchived=true`);
  await step('unarchive part', 'editor', 'POST', `${parts}/${first.id}/unarchive`);
  await step('duplicate part', 'editor', 'POST', `${parts}/${first.id}/duplicate`);
  await step('duplicate part again', 'editor', 'POST', `${parts}/${first.id}/duplicate`);
  await step('duplicate as viewer', 'viewer', 'POST', `${parts}/${first.id}/duplicate`);
  await step('duplicate unknown part', 'editor', 'POST', `${parts}/${testId(404)}/duplicate`);

  await step('resolve refs', 'viewer', 'POST', `${parts}/resolve`, {
    refs: [{ id: first.id, revision: 1 }, { id: first.id, revision: 2 }, { id: first.id, revision: 1 }, { id: testId(404), revision: 1 }, { id: first.id, revision: 3 }],
  });
  await step('resolve no refs', 'viewer', 'POST', `${parts}/resolve`, { refs: [] });

  await step('list materials', 'viewer', 'GET', `${base}/materials`);
  const strip: PartMaterial = { kind: 'sheet', key: 'platte-9', name: 'Platte 9 mm', thickness: 9, weightKgPerM2: 6, color: '#c8a46e' };
  await step('add material', 'editor', 'PUT', `${base}/materials/${strip.key}`, strip);
  await step('replace material', 'editor', 'PUT', `${base}/materials/${strip.key}`, { ...strip, name: 'Platte 9 mm, Birke' });
  await step('material key differs from the address', 'editor', 'PUT', `${base}/materials/andere-platte`, strip);
  await step('material as viewer', 'viewer', 'PUT', `${base}/materials/${strip.key}`, strip);
  await step('material with a bad body', 'editor', 'PUT', `${base}/materials/${strip.key}`, { ...strip, thickness: -1 });
  await step('change the kind of a material in use', 'editor', 'PUT', `${base}/materials/latte-40x40`, {
    kind: 'sheet', key: 'latte-40x40', name: 'Latte', thickness: 40, weightKgPerM2: 10, color: '#aaaaaa',
  });
  await step('delete material in use', 'editor', 'DELETE', `${base}/materials/latte-40x40`);
  await step('delete unknown material', 'editor', 'DELETE', `${base}/materials/gibt-es-nicht`);
  await step('delete material as viewer', 'viewer', 'DELETE', `${base}/materials/${strip.key}`);

  await step('export library', 'viewer', 'POST', `${base}/library/export`, {});
  const exported = bodyOf(await step('export selected parts', 'viewer', 'POST', `${base}/library/export`, { partIds: [STARTER_TABLE.id, first.id] }));
  await step('export unknown part', 'viewer', 'POST', `${base}/library/export`, { partIds: [testId(404)] });
  await step('export with a bad body', 'viewer', 'POST', `${base}/library/export`, { partIds: ['x'] });

  await step('import what was exported', 'editor', 'POST', `${base}/library/import`, { library: exported.library });
  const changedParts: PartDefinition[] = exported.library.parts.map((part: PartDefinition) =>
    part.id === first.id && part.revision === 2 ? { ...part, name: 'Kiste Eins, importiert' } : part);
  const changedMaterials: PartMaterial[] = exported.library.materials.map((item: PartMaterial) =>
    item.key === 'latte-40x40' ? { ...item, color: '#112233' } : item);
  const changed = { ...exported.library, parts: changedParts, materials: changedMaterials };
  await step('import with a change, keeping materials', 'editor', 'POST', `${base}/library/import`, { library: changed });
  await step('import with a change, overwriting materials', 'editor', 'POST', `${base}/library/import`, { library: changed, overwriteMaterials: true });
  const imported = { schemaVersion: 1, materials: [], parts: [{ ...crate(5, 'Kiste Fünf'), revision: 1 }] };
  await step('import a new part with a missing material', 'editor', 'POST', `${base}/library/import`, {
    library: { ...imported, parts: [{ ...imported.parts[0], bodies: [{ kind: 'beam', key: 'latte', material: 'gibt-es-nicht', from: [0, 0, 0], to: [500, 0, 0] }] }] },
  });
  await step('import a new part', 'editor', 'POST', `${base}/library/import`, { library: { ...imported, materials: [STARTER_MATERIALS.find(item => item.key === 'latte-40x40')!] } });
  await step('import a document that is not a library', 'editor', 'POST', `${base}/library/import`, { library: { schemaVersion: 1, materials: 5 } });
  await step('import without a library', 'editor', 'POST', `${base}/library/import`, {});
  await step('import as viewer', 'viewer', 'POST', `${base}/library/import`, { library: exported.library });
  await step('get imported part', 'viewer', 'GET', `${parts}/${testId(5)}`);
  await step('get part after imports', 'viewer', 'GET', `${parts}/${first.id}`);

  await step('delete unused material', 'editor', 'DELETE', `${base}/materials/${strip.key}`);

  await step('list stock items', 'viewer', 'GET', `${stock}/items`);
  await step('create stock item', 'editor', 'POST', `${stock}/items`, {
    label: 'K-01', partId: first.id, variantKey: 'klein', notes: 'Linke Kante bestoßen',
    cutouts: [{ id: testId(700), left: 100, sill: 200, width: 80, height: 80 }],
  });
  const item = bodyOf(await step('create second stock item', 'editor', 'POST', `${stock}/items`, { label: 'K-02', partId: first.id, variantKey: 'gross' }));
  await step('create stock item with a taken label', 'editor', 'POST', `${stock}/items`, { label: 'K-01', partId: first.id, variantKey: 'klein' });
  await step('create stock item without its variant', 'editor', 'POST', `${stock}/items`, { label: 'K-03', partId: first.id });
  await step('create stock item with an unknown variant', 'editor', 'POST', `${stock}/items`, { label: 'K-03', partId: first.id, variantKey: 'riesig' });
  await step('create stock item for an unknown part', 'editor', 'POST', `${stock}/items`, { label: 'K-03', partId: testId(404) });
  await step('create stock item for a part stocked by count', 'editor', 'POST', `${stock}/items`, { label: 'S-01', partId: STARTER_DECK_LEG.id });
  await step('create stock item with an unknown value', 'editor', 'POST', `${stock}/items`, { label: 'D-01', partId: STARTER_DECK.id, variantKey: '2x1', values: { zzz: 1 } });
  await step('create stock item as viewer', 'viewer', 'POST', `${stock}/items`, { label: 'K-09', partId: first.id, variantKey: 'klein' });
  await step('create stock item with a bad body', 'editor', 'POST', `${stock}/items`, { label: '', partId: first.id });
  await step('update stock item', 'editor', 'PATCH', `${stock}/items/${item.id}`, { usable: false, notes: 'Verliehen', finish: FINISH, variantKey: 'klein' });
  await step('update stock item to a taken label', 'editor', 'PATCH', `${stock}/items/${item.id}`, { label: 'K-01' });
  await step('update stock item to an unknown variant', 'editor', 'PATCH', `${stock}/items/${item.id}`, { variantKey: 'riesig' });
  await step('update stock item with nothing', 'editor', 'PATCH', `${stock}/items/${item.id}`, {});
  await step('update unknown stock item', 'editor', 'PATCH', `${stock}/items/${testId(404)}`, { usable: true });
  await step('update stock item as viewer', 'viewer', 'PATCH', `${stock}/items/${item.id}`, { usable: true });
  await step('clear finish and cutouts', 'editor', 'PATCH', `${stock}/items/${item.id}`, { finish: null, cutouts: [] });
  await step('archive stock item', 'editor', 'POST', `${stock}/items/${item.id}/archive`);
  await step('archive unknown stock item', 'editor', 'POST', `${stock}/items/${testId(404)}/archive`);
  await step('list stock items without the archived one', 'viewer', 'GET', `${stock}/items`);
  await step('list stock items with the archived one', 'viewer', 'GET', `${stock}/items?includeArchived=true`);
  const reused = bodyOf(await step('reuse the label of an archived item', 'editor', 'POST', `${stock}/items`, { label: 'K-02', partId: first.id, variantKey: 'klein' }));
  await step('unarchive stock item with a taken label', 'editor', 'POST', `${stock}/items/${item.id}/unarchive`);
  await step('unarchive unknown stock item', 'editor', 'POST', `${stock}/items/${testId(404)}/unarchive`);
  await step('unarchive as viewer', 'viewer', 'POST', `${stock}/items/${item.id}/unarchive`);
  await step('archive the item that holds the label', 'editor', 'POST', `${stock}/items/${reused.id}/archive`);
  await step('unarchive stock item', 'editor', 'POST', `${stock}/items/${item.id}/unarchive`);
  await step('list stock items after unarchiving', 'viewer', 'GET', `${stock}/items?includeArchived=true`);
  await step('archive as viewer', 'viewer', 'POST', `${stock}/items/${item.id}/archive`);

  const screw: PartMaterial = { kind: 'hardware', key: 'schraube-test', name: 'Schraube', weightKgPerPiece: 0.01, color: '#888888' };
  await step('list stock counts', 'viewer', 'GET', `${stock}/counts`);
  await step('count a material', 'editor', 'PUT', `${stock}/counts`, { materialKey: 'gummifuss-50', quantity: 40 });
  await step('count a material again', 'editor', 'PUT', `${stock}/counts`, { materialKey: 'gummifuss-50', quantity: 35 });
  await step('count a part variant', 'editor', 'PUT', `${stock}/counts`, { partId: STARTER_DECK_LEG.id, variantKey: '600', quantity: 12 });
  await step('count a part without its variant', 'editor', 'PUT', `${stock}/counts`, { partId: STARTER_DECK_LEG.id, quantity: 12 });
  await step('count an unknown variant', 'editor', 'PUT', `${stock}/counts`, { partId: STARTER_DECK_LEG.id, variantKey: '1', quantity: 12 });
  await step('count a part with variants', 'editor', 'PUT', `${stock}/counts`, { partId: STARTER_BRACE.id, variantKey: 'standard', quantity: 3 });
  await step('count a profile material', 'editor', 'PUT', `${stock}/counts`, { materialKey: 'latte-40x40', quantity: 40 });
  await step('count an unknown material', 'editor', 'PUT', `${stock}/counts`, { materialKey: 'gibt-es-nicht', quantity: 1 });
  await step('count an unknown part', 'editor', 'PUT', `${stock}/counts`, { partId: testId(404), quantity: 1 });
  await step('count a part stocked as items', 'editor', 'PUT', `${stock}/counts`, { partId: first.id, variantKey: 'klein', quantity: 1 });
  await step('count a negative quantity', 'editor', 'PUT', `${stock}/counts`, { materialKey: 'gummifuss-50', quantity: -1 });
  await step('count with both targets', 'editor', 'PUT', `${stock}/counts`, { materialKey: 'gummifuss-50', partId: STARTER_DECK_LEG.id, quantity: 1 });
  await step('count as viewer', 'viewer', 'PUT', `${stock}/counts`, { materialKey: 'gummifuss-50', quantity: 1 });
  await step('list stock counts after counting', 'viewer', 'GET', `${stock}/counts`);
  await step('add a material to count', 'administrator', 'PUT', `${base}/materials/${screw.key}`, screw);
  await step('count the new material', 'administrator', 'PUT', `${stock}/counts`, { materialKey: screw.key, quantity: 200 });
  await step('delete the counted material', 'administrator', 'DELETE', `${base}/materials/${screw.key}`);
  await step('list stock counts after deleting a material', 'viewer', 'GET', `${stock}/counts`);

  const schema = await world.send('viewer', 'GET', '/api/schemas/part-library.schema.json');
  trace.push({
    step: 'library schema', role: 'viewer', request: 'GET /api/schemas/part-library.schema.json', status: schema.status,
    body: { sha256: createHash('sha256').update(JSON.stringify(schema.body)).digest('hex') },
  });
  await step('final part list', 'viewer', 'GET', `${parts}?includeArchived=true`);
  return trace;
}
