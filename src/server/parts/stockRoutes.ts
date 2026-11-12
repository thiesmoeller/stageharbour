import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { errorSchema, workspaceParamsSchema } from '../../shared/contracts.js';
import {
  createStockItemSchema, listPartsQuerySchema, includesArchived, setStockCountSchema, stockCountSchema, stockCountsSchema,
  stockItemParamsSchema, stockItemSchema, stockItemsSchema, unprocessableSchema, updateStockItemSchema,
  type StockCount, type StockItem,
} from '../../shared/parts/catalog.js';
import { refused } from '../../shared/parts/catalogPlans.js';
import {
  buildStockCount, buildStockItem, newStockItemFields, sortStockCounts, sortStockItems, stockCountMaterialIssue,
  stockCountPartIssue, stockItemTargetIssue, updatedStockItemFields, variantColumn, variantFromColumn, type StockPart,
} from '../../shared/parts/stock.js';
import type { Database } from '../db/connection.js';
import { partDefinition, partRevision, stockCount, stockItem } from '../db/schema.js';
import { AccessError, type createAccess } from '../identity/access.js';
import { loadMaterials, type Store } from './data.js';
import { onConflict, unwrap } from './errors.js';

type ItemRow = typeof stockItem.$inferSelect;
type PartInfo = StockPart & { name: string };

export function registerStockRoutes(
  app: FastifyInstance, db: Database, access: ReturnType<typeof createAccess>, origin: string, clock: () => Date,
) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const base = '/api/workspaces/:workspaceId/stock';
  const errors = { 400: errorSchema, 401: errorSchema, 403: errorSchema, 404: errorSchema, 409: errorSchema, 422: unprocessableSchema };
  const duplicateLabel = 'Dieses Etikett ist bereits vergeben.';

  async function requireEditor(request: FastifyRequest, workspaceId: string) {
    if (request.headers.origin !== origin) throw new AccessError(403, 'Ungültiger Ursprung.');
    return access(request, workspaceId, 'inventory');
  }

  async function readParts(store: Store, workspaceId: string, partIds: readonly string[]): Promise<Map<string, PartInfo>> {
    if (!partIds.length) return new Map();
    const rows = await store.select({ part: partDefinition, definition: partRevision.definition }).from(partDefinition)
      .innerJoin(partRevision, and(
        eq(partRevision.workspaceId, partDefinition.workspaceId), eq(partRevision.partId, partDefinition.id),
        eq(partRevision.revision, partDefinition.latestRevision)))
      .where(and(eq(partDefinition.workspaceId, workspaceId), inArray(partDefinition.id, [...partIds])));
    return new Map(rows.map(row => [row.part.id, {
      definition: row.definition, archived: row.part.archivedAt !== null, name: row.part.name,
    }]));
  }

  function itemOf(row: ItemRow, part: PartInfo | undefined): StockItem {
    return buildStockItem({
      id: row.id, label: row.label, partId: row.partId, variantKey: variantFromColumn(row.variantKey),
      values: row.values, usable: row.usable, notes: row.notes, cutouts: row.cutouts, finish: row.finish ?? null,
      archivedAt: row.archivedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    }, part);
  }

  async function readItem(store: Store, workspaceId: string, itemId: string, lock = false) {
    const query = store.select().from(stockItem).where(and(eq(stockItem.workspaceId, workspaceId), eq(stockItem.id, itemId)));
    const [row] = await (lock ? query.for('update') : query);
    if (!row) throw new AccessError(404, 'Bestandsstück nicht verfügbar.');
    return row;
  }

  async function presentItem(store: Store, row: ItemRow): Promise<StockItem> {
    return itemOf(row, (await readParts(store, row.workspaceId, [row.partId])).get(row.partId));
  }

  async function labelTaken(store: Store, workspaceId: string, label: string, exceptId?: string) {
    const rows = await store.select({ id: stockItem.id }).from(stockItem)
      .where(and(eq(stockItem.workspaceId, workspaceId), eq(stockItem.label, label), isNull(stockItem.archivedAt)));
    return rows.some(row => row.id !== exceptId);
  }

  api.get(`${base}/items`, {
    schema: { params: workspaceParamsSchema, querystring: listPartsQuerySchema, response: { 200: stockItemsSchema, ...errors } },
  }, async request => {
    const { workspaceId } = request.params;
    await access(request, workspaceId);
    const rows = await db.select().from(stockItem).where(and(
      eq(stockItem.workspaceId, workspaceId), includesArchived(request.query) ? undefined : isNull(stockItem.archivedAt)));
    const parts = await readParts(db, workspaceId, [...new Set(rows.map(row => row.partId))]);
    return sortStockItems(rows.map(row => itemOf(row, parts.get(row.partId))));
  });

  api.post(`${base}/items`, {
    schema: { params: workspaceParamsSchema, body: createStockItemSchema, response: { 201: stockItemSchema, ...errors } },
  }, async (request, reply) => {
    const { workspaceId } = request.params;
    const { user } = await requireEditor(request, workspaceId);
    const now = clock();
    const fields = newStockItemFields(request.body, now);
    const result = await db.transaction(async tx => {
      const part = (await readParts(tx, workspaceId, [request.body.partId])).get(request.body.partId);
      const issue = stockItemTargetIssue({ part, variantKey: fields.variantKey, values: fields.values });
      if (issue) unwrap(refused(422, issue));
      if (await labelTaken(tx, workspaceId, fields.label)) throw new AccessError(409, duplicateLabel);
      const [row] = await onConflict(duplicateLabel, () => tx.insert(stockItem).values({
        id: randomUUID(), workspaceId, label: fields.label, partId: request.body.partId, variantKey: variantColumn(fields.variantKey),
        values: fields.values, usable: fields.usable, notes: fields.notes, cutouts: fields.cutouts, finish: fields.finish,
        createdBy: user.id, createdAt: now, updatedAt: now,
      }).returning());
      return itemOf(row!, part);
    });
    return reply.code(201).send(result);
  });

  api.patch(`${base}/items/:itemId`, {
    schema: { params: stockItemParamsSchema, body: updateStockItemSchema, response: { 200: stockItemSchema, ...errors } },
  }, async request => {
    const { workspaceId, itemId } = request.params;
    await requireEditor(request, workspaceId);
    const now = clock();
    return db.transaction(async tx => {
      const row = await readItem(tx, workspaceId, itemId, true);
      const part = (await readParts(tx, workspaceId, [row.partId])).get(row.partId);
      const current = itemOf(row, part);
      const fields = updatedStockItemFields(current, request.body, now);
      if (request.body.variantKey !== undefined || request.body.values !== undefined) {
        const issue = stockItemTargetIssue({ part, variantKey: fields.variantKey, values: fields.values, allowArchived: true });
        if (issue) unwrap(refused(422, issue));
      }
      if (row.archivedAt === null && fields.label !== row.label && await labelTaken(tx, workspaceId, fields.label, itemId)) {
        throw new AccessError(409, duplicateLabel);
      }
      const [updated] = await onConflict(duplicateLabel, () => tx.update(stockItem).set({
        label: fields.label, variantKey: variantColumn(fields.variantKey), values: fields.values, usable: fields.usable,
        notes: fields.notes, cutouts: fields.cutouts, finish: fields.finish, updatedAt: now,
      }).where(and(eq(stockItem.workspaceId, workspaceId), eq(stockItem.id, itemId))).returning());
      return itemOf(updated!, part);
    });
  });

  for (const action of ['archive', 'unarchive'] as const) {
    api.post(`${base}/items/:itemId/${action}`, {
      schema: { params: stockItemParamsSchema, response: { 200: stockItemSchema, ...errors } },
    }, async request => {
      const { workspaceId, itemId } = request.params;
      await requireEditor(request, workspaceId);
      const now = clock();
      return db.transaction(async tx => {
        const row = await readItem(tx, workspaceId, itemId, true);
        if (action === 'unarchive' && row.archivedAt !== null && await labelTaken(tx, workspaceId, row.label)) {
          throw new AccessError(409, duplicateLabel);
        }
        const archivedAt = action === 'archive' ? row.archivedAt ?? now : null;
        const [updated] = await onConflict(duplicateLabel, () => tx.update(stockItem).set({ archivedAt, updatedAt: now })
          .where(and(eq(stockItem.workspaceId, workspaceId), eq(stockItem.id, itemId))).returning());
        return presentItem(tx, updated!);
      });
    });
  }

  type CountRow = typeof stockCount.$inferSelect;
  async function presentCounts(store: Store, workspaceId: string, rows: readonly CountRow[]): Promise<StockCount[]> {
    const materials = await loadMaterials(store, workspaceId);
    const parts = await readParts(store, workspaceId, [...new Set(rows.flatMap(row => row.partId ? [row.partId] : []))]);
    return sortStockCounts(rows.map(row => buildStockCount({
      id: row.id, materialKey: row.materialKey, partId: row.partId,
      variantKey: row.partId ? variantFromColumn(row.variantKey) : null, quantity: row.quantity, updatedAt: row.updatedAt.toISOString(),
    }, { materialName: key => materials.get(key)?.name, part: id => parts.get(id) })));
  }

  api.get(`${base}/counts`, {
    schema: { params: workspaceParamsSchema, response: { 200: stockCountsSchema, ...errors } },
  }, async request => {
    const { workspaceId } = request.params;
    await access(request, workspaceId);
    return presentCounts(db, workspaceId, await db.select().from(stockCount).where(eq(stockCount.workspaceId, workspaceId)));
  });

  api.put(`${base}/counts`, {
    schema: { params: workspaceParamsSchema, body: setStockCountSchema, response: { 200: stockCountSchema, ...errors } },
  }, async request => {
    const { workspaceId } = request.params;
    await requireEditor(request, workspaceId);
    const now = clock();
    const body = request.body;
    return db.transaction(async tx => {
      let partId: string | null = null;
      let materialKey: string | null = null;
      let variantKey: string | null = null;
      if ('materialKey' in body) {
        materialKey = body.materialKey;
        const issue = stockCountMaterialIssue((await loadMaterials(tx, workspaceId)).get(materialKey));
        if (issue) unwrap(refused(422, issue));
      } else {
        partId = body.partId;
        variantKey = body.variantKey ?? null;
        const issue = stockCountPartIssue((await readParts(tx, workspaceId, [partId])).get(partId), variantKey);
        if (issue) unwrap(refused(422, issue));
      }
      const [existing] = await tx.select().from(stockCount).where(and(
        eq(stockCount.workspaceId, workspaceId),
        materialKey !== null ? eq(stockCount.materialKey, materialKey) : and(eq(stockCount.partId, partId!), eq(stockCount.variantKey, variantColumn(variantKey))),
      )).for('update');
      const [row] = await onConflict('Der Bestand wurde gleichzeitig geändert. Bitte erneut versuchen.', () => existing
        ? tx.update(stockCount).set({ quantity: body.quantity, updatedAt: now }).where(eq(stockCount.id, existing.id)).returning()
        : tx.insert(stockCount).values({
          id: randomUUID(), workspaceId, materialKey, partId, variantKey: variantColumn(variantKey), quantity: body.quantity,
          createdAt: now, updatedAt: now,
        }).returning());
      return (await presentCounts(tx, workspaceId, [row!]))[0]!;
    });
  });
}

