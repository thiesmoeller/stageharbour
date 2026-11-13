import { z } from 'zod';
import { ApiError } from '../api.js';
import { workspaceParamsSchema } from '../../shared/contracts.js';
import { can, type Capability } from '../../shared/permissions.js';
import {
  createPartSchema, createStockItemSchema, exportLibrarySchema, favouriteSchema, importLibrarySchema, includesArchived,
  listPartsQuerySchema, materialParamsSchema, partIdParamsSchema, partRevisionParamsSchema, resolvePartsSchema, savePartSchema,
  setStockCountSchema, stockItemParamsSchema, updateStockItemSchema,
  type CatalogIssue, type PartDetail, type PartSummary, type ResolvedParts, type StockCount, type StockItem,
} from '../../shared/parts/catalog.js';
import {
  buildPartDetail, buildPartSummary, closureOf, planCreatePart, planDuplicatePart, planMaterialDelete, planMaterialUpsert,
  planSavePart, rawChildRefs, refused, sortMaterials, sortPartSummaries, type Plan,
} from '../../shared/parts/catalogPlans.js';
import {
  createPartContext, materialSchema, partLibraryJsonSchema, partRefKey, type PartContext, type PartDefinition,
} from '../../shared/parts/definition.js';
import { buildLibraryExport, libraryFilename, planLibraryImport } from '../../shared/parts/libraryExchange.js';
import {
  buildStockCount, buildStockItem, newStockItemFields, sortStockCounts, sortStockItems, stockCountMaterialIssue,
  stockCountPartIssue, stockItemTargetIssue, updatedStockItemFields, variantColumn, type StockPart,
} from '../../shared/parts/stock.js';
import { definitionsByRevision, materialsByKey, type LocalCatalog, type LocalPart, type LocalStockItem } from './catalog.js';
import { match } from './route.js';
import type { LocalSnapshot } from './snapshot.js';
import type { LocalStore } from './store.js';

/** The part catalog, materials, library files and stock of browser-local mode: same routes as `src/server/parts`. */

export type PartsRequest = { path: string; method: string; query: URLSearchParams; body: unknown };
export type PartsResponse = { status: 200 | 201; value: unknown };
export type PartsHandlerOptions = { clock?: () => Date; newId?: () => string };

type Context = { store: LocalStore; clock: () => Date; newId: () => string };
type Params = Record<string, string>;
type Handler = (context: Context, params: Params, request: PartsRequest) => Promise<PartsResponse>;

const DUPLICATE_LABEL = 'Dieses Etikett ist bereits vergeben.';

function fail(status: number, message: string, issues?: CatalogIssue[]): never {
  throw new ApiError(status, message, { message, ...(issues ? { issues } : {}) });
}

function unwrap<T>(plan: Plan<T>): T {
  return plan.ok ? plan.value : fail(plan.failure.status, plan.failure.message, plan.failure.issues);
}

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  return result.success ? result.data : fail(400, 'Ungültige Anfrage.');
}

function requireAccess(snapshot: LocalSnapshot, workspaceId: string, capability: Capability): void {
  if (workspaceId !== snapshot.workspace.id) fail(404, 'Arbeitsbereich nicht verfügbar.');
  if (!can(snapshot.workspace.role, capability)) fail(403, 'Dafür fehlen Ihnen die Berechtigungen.');
}

async function read<T>(context: Context, workspaceId: string, view: (snapshot: LocalSnapshot) => T): Promise<T> {
  const snapshot = context.store.getSnapshot();
  requireAccess(snapshot, workspaceId, 'read');
  return view(snapshot);
}

async function write<T>(
  context: Context, workspaceId: string, capability: Capability, change: (draft: LocalSnapshot, now: Date) => T,
): Promise<T> {
  let result: T | undefined;
  await context.store.mutate(draft => {
    requireAccess(draft, workspaceId, capability);
    result = change(draft, context.clock());
  });
  return result as T;
}

function findPart(catalog: LocalCatalog, partId: string): LocalPart {
  const part = catalog.parts.find(item => item.id === partId);
  return part ?? fail(404, 'Bauteil nicht verfügbar.');
}

function findRevision(catalog: LocalCatalog, partId: string, revision: number) {
  const found = catalog.revisions.find(item => item.partId === partId && item.revision === revision);
  return found ?? fail(404, 'Revision nicht verfügbar.');
}

const latestDefinition = (catalog: LocalCatalog, part: LocalPart): PartDefinition =>
  findRevision(catalog, part.id, part.latestRevision).definition;

const latestDefinitions = (catalog: LocalCatalog): PartDefinition[] =>
  catalog.parts.map(part => latestDefinition(catalog, part));

const summaryOf = (catalog: LocalCatalog, part: LocalPart): PartSummary => buildPartSummary(part, latestDefinition(catalog, part));

function detailOf(catalog: LocalCatalog, partId: string): PartDetail {
  const part = findPart(catalog, partId);
  const revisions = catalog.revisions.filter(item => item.partId === partId)
    .map(item => ({ revision: item.revision, createdAt: item.createdAt, authorName: item.authorName }));
  return buildPartDetail(part, latestDefinition(catalog, part), revisions);
}

function contextFor(catalog: LocalCatalog, input: unknown): PartContext {
  const revisions = definitionsByRevision(catalog);
  return createPartContext({
    materials: catalog.materials,
    parts: closureOf(rawChildRefs(input), ref => revisions.get(ref.id)?.get(ref.revision)),
  });
}

function insertNewPart(draft: LocalSnapshot, definition: PartDefinition, now: Date): void {
  const stamp = now.toISOString();
  draft.catalog.parts.push({
    id: definition.id, name: definition.name, category: definition.category, latestRevision: definition.revision,
    favourite: false, archivedAt: null, createdAt: stamp, updatedAt: stamp,
  });
  draft.catalog.revisions.push({
    partId: definition.id, revision: definition.revision, definition, createdAt: stamp, authorName: draft.user.name,
  });
}

function addLatestRevision(draft: LocalSnapshot, definition: PartDefinition, now: Date): void {
  const stamp = now.toISOString();
  draft.catalog.revisions.push({
    partId: definition.id, revision: definition.revision, definition, createdAt: stamp, authorName: draft.user.name,
  });
  Object.assign(findPart(draft.catalog, definition.id), {
    name: definition.name, category: definition.category, latestRevision: definition.revision, updatedAt: stamp,
  });
}

function upsertMaterial(catalog: LocalCatalog, definition: z.output<typeof materialSchema>): void {
  const index = catalog.materials.findIndex(item => item.key === definition.key);
  if (index >= 0) catalog.materials[index] = definition;
  else catalog.materials.push(definition);
}

function stockPart(catalog: LocalCatalog, partId: string): (StockPart & { name: string }) | undefined {
  const part = catalog.parts.find(item => item.id === partId);
  return part && { name: part.name, archived: part.archivedAt !== null, definition: latestDefinition(catalog, part) };
}

function presentItem(catalog: LocalCatalog, item: LocalStockItem): StockItem {
  return buildStockItem(item, stockPart(catalog, item.partId));
}

function findItem(catalog: LocalCatalog, itemId: string): LocalStockItem {
  return catalog.stockItems.find(item => item.id === itemId) ?? fail(404, 'Bestandsstück nicht verfügbar.');
}

const labelTaken = (catalog: LocalCatalog, label: string, exceptId?: string): boolean =>
  catalog.stockItems.some(item => item.archivedAt === null && item.label === label && item.id !== exceptId);

function presentCount(catalog: LocalCatalog, count: LocalCatalog['stockCounts'][number]): StockCount {
  const materials = materialsByKey(catalog);
  return buildStockCount(count, {
    materialName: key => materials.get(key)?.name,
    part: id => stockPart(catalog, id),
  });
}

const base = '/api/workspaces/:workspaceId';

const routes: { method: string; pattern: string; handler: Handler }[] = [];
const route = (method: string, pattern: string, handler: Handler) => routes.push({ method, pattern, handler });
const ok = (value: unknown): PartsResponse => ({ status: 200, value });
const created = (value: unknown): PartsResponse => ({ status: 201, value });

route('GET', `${base}/parts`, async (context, params, request) => {
  const { workspaceId } = parse(workspaceParamsSchema, params);
  const query = parse(listPartsQuerySchema, Object.fromEntries(request.query));
  return ok(await read(context, workspaceId, ({ catalog }) => sortPartSummaries(
    catalog.parts.filter(part => includesArchived(query) || part.archivedAt === null).map(part => summaryOf(catalog, part)))));
});

route('POST', `${base}/parts/resolve`, async (context, params, request) => {
  const { workspaceId } = parse(workspaceParamsSchema, params);
  const body = parse(resolvePartsSchema, request.body);
  return ok(await read(context, workspaceId, ({ catalog }): ResolvedParts => {
    const refs = [...new Map(body.refs.map(ref => [partRefKey(ref), ref])).values()];
    const revisions = definitionsByRevision(catalog);
    const found = refs.map(ref => revisions.get(ref.id)?.get(ref.revision));
    return {
      definitions: found.flatMap(definition => definition ?? []),
      missing: refs.filter((_ref, index) => !found[index]),
    };
  }));
});

route('GET', `${base}/parts/:partId`, async (context, params) => {
  const { workspaceId, partId } = parse(partIdParamsSchema, params);
  return ok(await read(context, workspaceId, ({ catalog }) => detailOf(catalog, partId)));
});

route('GET', `${base}/parts/:partId/revisions/:revision`, async (context, params) => {
  const { workspaceId, partId, revision } = parse(partRevisionParamsSchema, params);
  return ok(await read(context, workspaceId, ({ catalog }) => {
    const { createdAt, authorName, definition } = findRevision(catalog, partId, revision);
    return { partId, revision, createdAt, authorName, definition };
  }));
});

route('POST', `${base}/parts`, async (context, params, request) => {
  const { workspaceId } = parse(workspaceParamsSchema, params);
  const { definition: input } = parse(createPartSchema, request.body);
  return created(await write(context, workspaceId, 'parts', (draft, now) => {
    const definition = unwrap(planCreatePart(input, contextFor(draft.catalog, input), id => draft.catalog.parts.some(part => part.id === id)));
    insertNewPart(draft, definition, now);
    return detailOf(draft.catalog, definition.id);
  }));
});

route('POST', `${base}/parts/:partId/revisions`, async (context, params, request) => {
  const { workspaceId, partId } = parse(partIdParamsSchema, params);
  const body = parse(savePartSchema, request.body);
  return created(await write(context, workspaceId, 'parts', (draft, now) => {
    const part = findPart(draft.catalog, partId);
    const definition = unwrap(planSavePart({
      partId, latestRevision: part.latestRevision, baseRevision: body.baseRevision, input: body.definition,
      context: contextFor(draft.catalog, body.definition),
    }));
    addLatestRevision(draft, definition, now);
    return detailOf(draft.catalog, partId);
  }));
});

for (const action of ['archive', 'unarchive'] as const) {
  route('POST', `${base}/parts/:partId/${action}`, async (context, params) => {
    const { workspaceId, partId } = parse(partIdParamsSchema, params);
    return ok(await write(context, workspaceId, 'parts', (draft, now) => {
      const part = findPart(draft.catalog, partId);
      part.archivedAt = action === 'archive' ? part.archivedAt ?? now.toISOString() : null;
      part.updatedAt = now.toISOString();
      return summaryOf(draft.catalog, part);
    }));
  });
}

route('PUT', `${base}/parts/:partId/favourite`, async (context, params, request) => {
  const { workspaceId, partId } = parse(partIdParamsSchema, params);
  const body = parse(favouriteSchema, request.body);
  return ok(await write(context, workspaceId, 'parts', (draft, now) => {
    const part = findPart(draft.catalog, partId);
    part.favourite = body.favourite;
    part.updatedAt = now.toISOString();
    return summaryOf(draft.catalog, part);
  }));
});

route('POST', `${base}/parts/:partId/duplicate`, async (context, params) => {
  const { workspaceId, partId } = parse(partIdParamsSchema, params);
  return created(await write(context, workspaceId, 'parts', (draft, now) => {
    const source = latestDefinition(draft.catalog, findPart(draft.catalog, partId));
    const copy = planDuplicatePart(source, context.newId(), draft.catalog.parts.map(part => part.name));
    insertNewPart(draft, copy, now);
    return detailOf(draft.catalog, copy.id);
  }));
});

route('GET', `${base}/materials`, async (context, params) => {
  const { workspaceId } = parse(workspaceParamsSchema, params);
  return ok(await read(context, workspaceId, ({ catalog }) => sortMaterials(catalog.materials)));
});

route('PUT', `${base}/materials/:key`, async (context, params, request) => {
  const { workspaceId, key } = parse(materialParamsSchema, params);
  const body = parse(materialSchema, request.body);
  return ok(await write(context, workspaceId, 'parts', draft => {
    if (body.key !== key) fail(400, 'Der Schlüssel im Material stimmt nicht mit der Adresse überein.');
    unwrap(planMaterialUpsert(body, materialsByKey(draft.catalog).get(key), latestDefinitions(draft.catalog)));
    upsertMaterial(draft.catalog, body);
    return body;
  }));
});

route('DELETE', `${base}/materials/:key`, async (context, params) => {
  const { workspaceId, key } = parse(materialParamsSchema, params);
  return ok(await write(context, workspaceId, 'parts', draft => {
    unwrap(planMaterialDelete(key, materialsByKey(draft.catalog).get(key), latestDefinitions(draft.catalog)));
    draft.catalog.materials = draft.catalog.materials.filter(item => item.key !== key);
    draft.catalog.stockCounts = draft.catalog.stockCounts.filter(item => item.materialKey !== key);
    return { ok: true as const };
  }));
});

route('POST', `${base}/library/export`, async (context, params, request) => {
  const { workspaceId } = parse(workspaceParamsSchema, params);
  const body = parse(exportLibrarySchema, request.body);
  return ok(await read(context, workspaceId, snapshot => {
    const { catalog } = snapshot;
    const revisions = definitionsByRevision(catalog);
    const materials = materialsByKey(catalog);
    const wanted = body.partIds ? [...new Set(body.partIds)] : catalog.parts.filter(part => part.archivedAt === null).map(part => part.id);
    const roots = wanted.map(id => latestDefinition(catalog, findPart(catalog, id)));
    const library = buildLibraryExport({
      roots, part: ref => revisions.get(ref.id)?.get(ref.revision), material: key => materials.get(key),
    });
    return { filename: libraryFilename(snapshot.workspace.name, context.clock()), library };
  }));
});

route('POST', `${base}/library/import`, async (context, params, request) => {
  const { workspaceId } = parse(workspaceParamsSchema, params);
  const body = parse(importLibrarySchema, request.body);
  return ok(await write(context, workspaceId, 'parts', (draft, now) => {
    const plan = unwrap(planLibraryImport({
      input: body.library,
      overwriteMaterials: body.overwriteMaterials ?? false,
      workspace: { materials: materialsByKey(draft.catalog), revisions: definitionsByRevision(draft.catalog) },
    }));
    for (const definition of [...plan.materials.create, ...plan.materials.overwrite]) upsertMaterial(draft.catalog, definition);
    const newest = new Map<string, PartDefinition>();
    for (const { definition, newPart } of plan.parts) {
      if (newPart) insertNewPart(draft, definition, now);
      else {
        draft.catalog.revisions.push({
          partId: definition.id, revision: definition.revision, definition, createdAt: now.toISOString(), authorName: draft.user.name,
        });
      }
      if ((newest.get(definition.id)?.revision ?? 0) < definition.revision) newest.set(definition.id, definition);
    }
    for (const definition of newest.values()) {
      Object.assign(findPart(draft.catalog, definition.id), {
        name: definition.name, category: definition.category, latestRevision: definition.revision, updatedAt: now.toISOString(),
      });
    }
    return plan.report;
  }));
});

route('GET', '/api/schemas/part-library.schema.json', async () => ok(partLibraryJsonSchema()));

const stock = `${base}/stock`;

route('GET', `${stock}/items`, async (context, params, request) => {
  const { workspaceId } = parse(workspaceParamsSchema, params);
  const query = parse(listPartsQuerySchema, Object.fromEntries(request.query));
  return ok(await read(context, workspaceId, ({ catalog }) => sortStockItems(
    catalog.stockItems.filter(item => includesArchived(query) || item.archivedAt === null).map(item => presentItem(catalog, item)))));
});

route('POST', `${stock}/items`, async (context, params, request) => {
  const { workspaceId } = parse(workspaceParamsSchema, params);
  const body = parse(createStockItemSchema, request.body);
  return created(await write(context, workspaceId, 'inventory', (draft, now) => {
    const { catalog } = draft;
    const fields = newStockItemFields(body, now);
    const issue = stockItemTargetIssue({ part: stockPart(catalog, body.partId), variantKey: fields.variantKey, values: fields.values });
    if (issue) unwrap(refused(422, issue));
    if (labelTaken(catalog, fields.label)) fail(409, DUPLICATE_LABEL);
    const stamp = now.toISOString();
    const item: LocalStockItem = { id: context.newId(), partId: body.partId, ...fields, archivedAt: null, createdAt: stamp, updatedAt: stamp };
    catalog.stockItems.push(item);
    return presentItem(catalog, item);
  }));
});

route('PATCH', `${stock}/items/:itemId`, async (context, params, request) => {
  const { workspaceId, itemId } = parse(stockItemParamsSchema, params);
  const body = parse(updateStockItemSchema, request.body);
  return ok(await write(context, workspaceId, 'inventory', (draft, now) => {
    const { catalog } = draft;
    const item = findItem(catalog, itemId);
    const part = stockPart(catalog, item.partId);
    const fields = updatedStockItemFields(presentItem(catalog, item), body, now);
    if (body.variantKey !== undefined || body.values !== undefined) {
      const issue = stockItemTargetIssue({ part, variantKey: fields.variantKey, values: fields.values, allowArchived: true });
      if (issue) unwrap(refused(422, issue));
    }
    if (item.archivedAt === null && fields.label !== item.label && labelTaken(catalog, fields.label, itemId)) fail(409, DUPLICATE_LABEL);
    Object.assign(item, fields, { updatedAt: now.toISOString() });
    return presentItem(catalog, item);
  }));
});

for (const action of ['archive', 'unarchive'] as const) {
  route('POST', `${stock}/items/:itemId/${action}`, async (context, params) => {
    const { workspaceId, itemId } = parse(stockItemParamsSchema, params);
    return ok(await write(context, workspaceId, 'inventory', (draft, now) => {
      const { catalog } = draft;
      const item = findItem(catalog, itemId);
      if (action === 'unarchive' && item.archivedAt !== null && labelTaken(catalog, item.label)) fail(409, DUPLICATE_LABEL);
      item.archivedAt = action === 'archive' ? item.archivedAt ?? now.toISOString() : null;
      item.updatedAt = now.toISOString();
      return presentItem(catalog, item);
    }));
  });
}

route('GET', `${stock}/counts`, async (context, params) => {
  const { workspaceId } = parse(workspaceParamsSchema, params);
  return ok(await read(context, workspaceId, ({ catalog }) =>
    sortStockCounts(catalog.stockCounts.map(count => presentCount(catalog, count)))));
});

route('PUT', `${stock}/counts`, async (context, params, request) => {
  const { workspaceId } = parse(workspaceParamsSchema, params);
  const body = parse(setStockCountSchema, request.body);
  return ok(await write(context, workspaceId, 'inventory', (draft, now) => {
    const { catalog } = draft;
    let materialKey: string | null = null;
    let partId: string | null = null;
    let variantKey: string | null = null;
    if ('materialKey' in body) {
      materialKey = body.materialKey;
      const issue = stockCountMaterialIssue(materialsByKey(catalog).get(materialKey));
      if (issue) unwrap(refused(422, issue));
    } else {
      partId = body.partId;
      variantKey = body.variantKey ?? null;
      const issue = stockCountPartIssue(stockPart(catalog, partId), variantKey);
      if (issue) unwrap(refused(422, issue));
    }
    const existing = catalog.stockCounts.find(count => materialKey !== null
      ? count.materialKey === materialKey
      : count.partId === partId && variantColumn(count.variantKey) === variantColumn(variantKey));
    const stamp = now.toISOString();
    if (existing) Object.assign(existing, { quantity: body.quantity, updatedAt: stamp });
    const count = existing ?? { id: context.newId(), materialKey, partId, variantKey, quantity: body.quantity, updatedAt: stamp };
    if (!existing) catalog.stockCounts.push(count);
    return presentCount(catalog, count);
  }));
});

/** Answers a request for the catalog, or returns undefined when the path and method are not part of it. */
export function createPartsHandler(store: LocalStore, options: PartsHandlerOptions = {}) {
  const context: Context = {
    store,
    clock: options.clock ?? (() => new Date()),
    newId: options.newId ?? (() => crypto.randomUUID()),
  };
  return async (request: PartsRequest): Promise<PartsResponse | undefined> => {
    for (const candidate of routes) {
      if (candidate.method !== request.method) continue;
      const params = match(request.path, candidate.pattern);
      if (params) return candidate.handler(context, params, request);
    }
    return undefined;
  };
}
