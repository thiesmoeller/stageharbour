import { ballastStockSchema, EMPTY_BALLAST_STOCK } from '../../shared/ballast.js';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorSchema, workspaceParamsSchema } from '../../shared/contracts.js';
import { assignPanelSchema, createPanelSchema, finishWorkListSchema, snapshotPanelAssignments, inventoryPanelSchema, inventorySchema, sameGeometry, typesCompatible, updatePanelSchema, upsertInventoryTypeSchema, placementType } from '../../shared/inventory.js';
import { leaseHolderSchema } from '../../shared/leases.js';
import { typesOf, wallTypeSchema, type WallElementType } from '../../shared/wall-types.js';
import type { Database } from '../db/connection.js';
import { inventoryBallast, inventoryPanel, inventoryWallType, scene } from '../db/schema.js';
import { AccessError, type createAccess } from '../identity/access.js';
import { LeaseError, type Leases } from '../productions/leases.js';

export class InventoryError extends Error {
  constructor(public statusCode: 400, message: string) { super(message); }
}

export function registerInventoryRoutes(app: FastifyInstance, db: Database, access: ReturnType<typeof createAccess>, origin: string, leases: Leases) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const path = '/api/workspaces/:workspaceId/inventory';
  const panelParams = workspaceParamsSchema.extend({ panelId: z.uuid() });
  const assignmentParams = workspaceParamsSchema.extend({ sceneId: z.uuid(), wallId: z.uuid() });
  const errors = { 400: errorSchema, 401: errorSchema, 403: errorSchema, 404: errorSchema, 409: errorSchema, 423: errorSchema };
  async function requireEditor(request: FastifyRequest, workspaceId: string) {
    if (request.headers.origin !== origin) throw new AccessError(403, 'Ungültiger Ursprung.');
    return access(request, workspaceId, 'inventory');
  }
  async function readInventory(workspaceId: string, store: Pick<Database, 'select'> = db) {
    const types = await store.select().from(inventoryWallType).where(eq(inventoryWallType.workspaceId, workspaceId));
    const typeMap = new Map(types.map(row => [row.id, row.definition]));
    const rows = await store.select().from(inventoryPanel).where(eq(inventoryPanel.workspaceId, workspaceId)).orderBy(inventoryPanel.label);
    const [ballast] = await store.select({ slabs: inventoryBallast.slabs, straps: inventoryBallast.straps }).from(inventoryBallast).where(eq(inventoryBallast.workspaceId, workspaceId));
    return {
      ballast: ballast ?? EMPTY_BALLAST_STOCK,
      types: types.map(row => row.definition),
      panels: rows.map(row => {
        const type = typeMap.get(row.typeId);
        if (!type) throw new AccessError(404, 'Bestand nicht verfügbar.');
        return { id: row.id, label: row.label, typeId: row.typeId, available: row.available, note: row.note, type, cutouts: row.cutouts, currentFinish: row.currentFinish };
      }),
    };
  }
  async function ensureType(workspaceId: string, definition: WallElementType, store: Pick<Database, 'select' | 'insert'>) {
    const [existing] = await store.select().from(inventoryWallType).where(and(eq(inventoryWallType.workspaceId, workspaceId), eq(inventoryWallType.id, definition.id)));
    if (!existing) {
      await store.insert(inventoryWallType).values({ id: definition.id, workspaceId, definition });
      return definition;
    }
    if (!sameGeometry(existing.definition, definition)) {
      throw new AccessError(409, 'Dieser Wandtyp ist im Bestand bereits anders definiert.');
    }
    return existing.definition;
  }

  api.get(path, { schema: { params: workspaceParamsSchema, response: { 200: inventorySchema, ...errors } } }, async request => {
    await access(request, request.params.workspaceId);
    return { lease: await leases.read(request.params.workspaceId, 'inventory', request.params.workspaceId), ...(await readInventory(request.params.workspaceId)) };
  });
  api.put(`${path}/ballast`, { schema: { params: workspaceParamsSchema, body: ballastStockSchema, response: { 200: ballastStockSchema, ...errors } } }, async request => {
    const { workspaceId } = request.params;
    const { user } = await requireEditor(request, workspaceId);
    return db.transaction(async tx => {
      await leases.requireHeld(tx, workspaceId, 'inventory', workspaceId, user.id);
      await tx.insert(inventoryBallast).values({ workspaceId, ...request.body })
        .onConflictDoUpdate({ target: inventoryBallast.workspaceId, set: request.body });
      return request.body;
    });
  });
  api.post(`${path}/lease`, { schema: { params: workspaceParamsSchema, response: { 200: leaseHolderSchema, ...errors } } }, async request => {
    const { user } = await requireEditor(request, request.params.workspaceId);
    const result = await leases.acquire(request.params.workspaceId, 'inventory', request.params.workspaceId, { id: user.id, name: user.name });
    if (!result.acquired) throw new LeaseError(423, `Wird bereits von ${result.lease.holderName} bearbeitet.`);
    return result.lease;
  });
  api.post(`${path}/lease/heartbeat`, { schema: { params: workspaceParamsSchema, response: { 200: z.object({ ok: z.literal(true) }), ...errors } } }, async request => {
    const { user } = await requireEditor(request, request.params.workspaceId);
    await leases.heartbeat(request.params.workspaceId, 'inventory', request.params.workspaceId, user.id);
    return { ok: true as const };
  });
  api.post(`${path}/lease/release`, { schema: { params: workspaceParamsSchema, response: { 200: z.object({ ok: z.literal(true) }), ...errors } } }, async request => {
    const { user } = await requireEditor(request, request.params.workspaceId);
    await leases.release(request.params.workspaceId, 'inventory', request.params.workspaceId, user.id);
    return { ok: true as const };
  });
  api.post(`${path}/panels`, { schema: { params: workspaceParamsSchema, body: createPanelSchema, response: { 201: inventoryPanelSchema, ...errors } } }, async (request, reply) => {
    const { workspaceId } = request.params;
    const { user } = await requireEditor(request, workspaceId);
    const result = await db.transaction(async tx => {
      await leases.requireHeld(tx, workspaceId, 'inventory', workspaceId, user.id);
      const [duplicate] = await tx.select({ id: inventoryPanel.id }).from(inventoryPanel)
        .where(and(eq(inventoryPanel.workspaceId, workspaceId), eq(inventoryPanel.label, request.body.label)));
      if (duplicate) throw new AccessError(409, 'Dieses Plattenetikett ist bereits vergeben.');
      const type = await ensureType(workspaceId, request.body.type, tx);
      const id = randomUUID();
      const available = request.body.available ?? true;
      const note = request.body.note ?? null;
      await tx.insert(inventoryPanel).values({ id, workspaceId, typeId: type.id, label: request.body.label, available, note });
      return { id, label: request.body.label, typeId: type.id, available, note, type };
    });
    return reply.code(201).send(result);
  });
  api.patch(`${path}/panels/:panelId`, { schema: { params: panelParams, body: updatePanelSchema, response: { 200: inventoryPanelSchema, ...errors } } }, async request => {
    const { workspaceId, panelId } = request.params;
    const { user } = await requireEditor(request, workspaceId);
    const result = await db.transaction(async tx => {
      await leases.requireHeld(tx, workspaceId, 'inventory', workspaceId, user.id);
      const [existing] = await tx.select().from(inventoryPanel).where(and(eq(inventoryPanel.workspaceId, workspaceId), eq(inventoryPanel.id, panelId)));
      if (!existing) throw new AccessError(404, 'Platte nicht verfügbar.');
      const nextLabel = request.body.label ?? existing.label;
      if (request.body.label !== undefined && request.body.label !== existing.label) {
        const [duplicate] = await tx.select({ id: inventoryPanel.id }).from(inventoryPanel)
          .where(and(eq(inventoryPanel.workspaceId, workspaceId), eq(inventoryPanel.label, request.body.label)));
        if (duplicate) throw new AccessError(409, 'Dieses Plattenetikett ist bereits vergeben.');
      }
      if (request.body.cutouts) {
        const [type] = await tx.select().from(inventoryWallType).where(and(eq(inventoryWallType.workspaceId, workspaceId), eq(inventoryWallType.id, existing.typeId)));
        if (!type || !wallTypeSchema.safeParse({ ...type.definition, openings: [...type.definition.openings, ...request.body.cutouts] }).success) {
          throw new AccessError(400, 'Ausschnitte müssen innerhalb der Platte liegen und eindeutige IDs haben (höchstens 20 Öffnungen).');
        }
      }
      const [updated] = await tx.update(inventoryPanel).set({
        label: nextLabel,
        cutouts: request.body.cutouts ?? existing.cutouts,
        currentFinish: request.body.finish ? { ...request.body.finish, confirmedAt: new Date().toISOString() } : existing.currentFinish,
        available: request.body.available ?? existing.available,
        note: request.body.note === undefined ? existing.note : request.body.note,
      }).where(and(eq(inventoryPanel.workspaceId, workspaceId), eq(inventoryPanel.id, panelId))).returning();
      const inventory = await readInventory(workspaceId, tx);
      const panel = inventory.panels.find(item => item.id === updated!.id);
      if (!panel) throw new AccessError(404, 'Platte nicht verfügbar.');
      return panel;
    });
    return result;
  });
  api.delete(`${path}/panels/:panelId`, { schema: { params: panelParams, response: { 200: z.object({ ok: z.literal(true) }), ...errors } } }, async request => {
    const { workspaceId, panelId } = request.params;
    const { user } = await requireEditor(request, workspaceId);
    await db.transaction(async tx => {
      await leases.requireHeld(tx, workspaceId, 'inventory', workspaceId, user.id);
      const [panel] = await tx.select().from(inventoryPanel).where(and(eq(inventoryPanel.workspaceId, workspaceId), eq(inventoryPanel.id, panelId))).for('update');
      if (!panel) throw new AccessError(404, 'Platte nicht verfügbar.');
      const records = await tx.select().from(scene).where(eq(scene.workspaceId, workspaceId));
      const used = records.filter(record => record.layout.objects.some(object => object.stockItemId === panelId));
      if (used.length) throw new AccessError(409, `Platte ist noch zugewiesen: ${used.map(record => record.name).join(', ')}. Zuweisungen zuerst in den Bühnenbildern lösen.`);
      await tx.delete(inventoryPanel).where(and(eq(inventoryPanel.workspaceId, workspaceId), eq(inventoryPanel.id, panelId)));
    });
    return { ok: true as const };
  });
  api.get(`${path}/finish-work`, { schema: { params: workspaceParamsSchema, response: { 200: finishWorkListSchema, ...errors } } }, async request => {
    const { workspaceId } = request.params;
    await access(request, workspaceId);
    return [];
  });
  api.post(`${path}/panels/:panelId/finish-complete`, {
    schema: { params: panelParams, body: z.strictObject({ sceneId: z.uuid(), wallId: z.uuid(), assignmentId: z.uuid() }), response: { 200: inventoryPanelSchema, ...errors } },
  }, async request => {
    const { workspaceId, panelId } = request.params;
    const { user } = await requireEditor(request, workspaceId);
    return db.transaction(async tx => {
      await leases.requireHeld(tx, workspaceId, 'inventory', workspaceId, user.id);
      throw new AccessError(409, 'Oberflächenarbeiten werden jetzt am Bestandsstück des Bauteils dokumentiert.');
    });
  });
  const typeParams = workspaceParamsSchema.extend({ typeId: z.uuid() });
  api.post(`${path}/types`, {
    schema: { params: workspaceParamsSchema, body: upsertInventoryTypeSchema, response: { 201: wallTypeSchema, ...errors } },
  }, async (request, reply) => {
    const { workspaceId } = request.params;
    const { user } = await requireEditor(request, workspaceId);
    const result = await db.transaction(async tx => {
      await leases.requireHeld(tx, workspaceId, 'inventory', workspaceId, user.id);
      const [existing] = await tx.select().from(inventoryWallType)
        .where(and(eq(inventoryWallType.workspaceId, workspaceId), eq(inventoryWallType.id, request.body.id)));
      if (existing) throw new AccessError(409, 'Dieser Wandtyp ist im Bestand bereits angelegt.');
      await tx.insert(inventoryWallType).values({ id: request.body.id, workspaceId, definition: request.body });
      return request.body;
    });
    return reply.code(201).send(result);
  });
  api.put(`${path}/types/:typeId`, {
    schema: { params: typeParams, body: upsertInventoryTypeSchema, response: { 200: wallTypeSchema, ...errors } },
  }, async request => {
    const { workspaceId, typeId } = request.params;
    const { user } = await requireEditor(request, workspaceId);
    if (request.body.id !== typeId) throw new AccessError(400, 'Wandtyp-ID stimmt nicht überein.');
    return db.transaction(async tx => {
      await leases.requireHeld(tx, workspaceId, 'inventory', workspaceId, user.id);
      const [existing] = await tx.select().from(inventoryWallType)
        .where(and(eq(inventoryWallType.workspaceId, workspaceId), eq(inventoryWallType.id, typeId)));
      if (!existing) throw new AccessError(404, 'Wandtyp nicht verfügbar.');
      const [inUse] = await tx.select({ id: inventoryPanel.id }).from(inventoryPanel)
        .where(and(eq(inventoryPanel.workspaceId, workspaceId), eq(inventoryPanel.typeId, typeId))).limit(1);
      if (inUse && !sameGeometry(existing.definition, request.body)) {
        throw new AccessError(409, 'Dieser Wandtyp ist im Bestand bereits anders definiert.');
      }
      await tx.update(inventoryWallType).set({ definition: request.body })
        .where(and(eq(inventoryWallType.workspaceId, workspaceId), eq(inventoryWallType.id, typeId)));
      return request.body;
    });
  });
  api.delete(`${path}/types/:typeId`, {
    schema: { params: typeParams, response: { 200: z.object({ ok: z.literal(true) }), ...errors } },
  }, async request => {
    const { workspaceId, typeId } = request.params;
    const { user } = await requireEditor(request, workspaceId);
    await db.transaction(async tx => {
      await leases.requireHeld(tx, workspaceId, 'inventory', workspaceId, user.id);
      const [existing] = await tx.select().from(inventoryWallType)
        .where(and(eq(inventoryWallType.workspaceId, workspaceId), eq(inventoryWallType.id, typeId)));
      if (!existing) throw new AccessError(404, 'Wandtyp nicht verfügbar.');
      const [inUse] = await tx.select({ id: inventoryPanel.id }).from(inventoryPanel)
        .where(and(eq(inventoryPanel.workspaceId, workspaceId), eq(inventoryPanel.typeId, typeId))).limit(1);
      if (inUse) throw new AccessError(409, 'Dieser Wandtyp wird noch von Platten verwendet.');
      await tx.delete(inventoryWallType)
        .where(and(eq(inventoryWallType.workspaceId, workspaceId), eq(inventoryWallType.id, typeId)));
    });
    return { ok: true as const };
  });
  api.post('/api/workspaces/:workspaceId/scenes/:sceneId/walls/:wallId/assignment', {
    schema: { params: assignmentParams, body: assignPanelSchema, response: { 200: z.object({ panelId: z.uuid() }), ...errors } },
  }, async request => {
    const { workspaceId, sceneId, wallId } = request.params;
    const { user } = await requireEditor(request, workspaceId);
    const [panel] = await db.select().from(inventoryPanel).where(and(eq(inventoryPanel.workspaceId, workspaceId), eq(inventoryPanel.id, request.body.panelId)));
    if (!panel) throw new AccessError(404, 'Platte nicht verfügbar.');
    const [type] = await db.select().from(inventoryWallType).where(and(eq(inventoryWallType.workspaceId, workspaceId), eq(inventoryWallType.id, panel.typeId)));
    if (!type) throw new AccessError(404, 'Platte nicht verfügbar.');
    await db.transaction(async tx => {
      const [record] = await tx.select().from(scene).where(and(eq(scene.workspaceId, workspaceId), eq(scene.id, sceneId)));
      if (!record) throw new AccessError(404, 'Bühnenbild nicht verfügbar.');
      await leases.requireHeld(tx, workspaceId, 'scene', sceneId, user.id);
      const [lockedPanel] = await tx.select().from(inventoryPanel).where(and(eq(inventoryPanel.workspaceId, workspaceId), eq(inventoryPanel.id, panel.id))).for('share');
      if (!lockedPanel) throw new AccessError(404, 'Platte nicht verfügbar.');
      const object = record.layout.objects.find(item => item.id === wallId);
      if (!object) throw new AccessError(404, 'Bauteil nicht verfügbar.');
      if (record.layout.objects.some(item => item.id !== wallId && item.stockItemId === panel.id)) {
        throw new InventoryError(400, 'Diese Platte ist im Bühnenbild bereits zugewiesen.');
      }
      await tx.update(scene).set({
        layout: { ...record.layout, objects: record.layout.objects.map(item => item.id === wallId ? { ...item, stockItemId: panel.id } : item) },
        revision: sql`${scene.revision} + 1`,
      }).where(and(eq(scene.workspaceId, workspaceId), eq(scene.id, sceneId)));
    });
    return { panelId: panel.id };
  });
  api.delete('/api/workspaces/:workspaceId/scenes/:sceneId/walls/:wallId/assignment', {
    schema: { params: assignmentParams, response: { 200: z.object({ ok: z.literal(true) }), ...errors } },
  }, async request => {
    const { workspaceId, sceneId, wallId } = request.params;
    const { user } = await requireEditor(request, workspaceId);
    await db.transaction(async tx => {
      const [record] = await tx.select().from(scene).where(and(eq(scene.workspaceId, workspaceId), eq(scene.id, sceneId)));
      if (!record) throw new AccessError(404, 'Bühnenbild nicht verfügbar.');
      await leases.requireHeld(tx, workspaceId, 'scene', sceneId, user.id);
      if (!record.layout.objects.some(item => item.id === wallId)) throw new AccessError(404, 'Bauteil nicht verfügbar.');
      await tx.update(scene).set({
        layout: { ...record.layout, objects: record.layout.objects.map(item => {
          if (item.id !== wallId) return item;
          const { stockItemId: _removed, ...rest } = item;
          return rest;
        }) },
        revision: sql`${scene.revision} + 1`,
      }).where(and(eq(scene.workspaceId, workspaceId), eq(scene.id, sceneId)));
    });
    return { ok: true as const };
  });
}
