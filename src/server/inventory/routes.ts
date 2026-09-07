import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorSchema, workspaceParamsSchema } from '../../shared/contracts.js';
import { assignPanelSchema, createPanelSchema, inventoryPanelSchema, inventorySchema, sameGeometry, typesCompatible, updatePanelSchema, placementType } from '../../shared/inventory.js';
import { leaseHolderSchema } from '../../shared/leases.js';
import { typesOf, type WallElementType } from '../../shared/wall-types.js';
import type { Database } from '../db/connection.js';
import { inventoryPanel, inventoryWallType, scene } from '../db/schema.js';
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
    return access(request, workspaceId, ['administrator', 'editor']);
  }
  async function requireInventoryLease(request: FastifyRequest, workspaceId: string) {
    const { user } = await requireEditor(request, workspaceId);
    await leases.requireHeld(db, workspaceId, 'inventory', workspaceId, user.id);
    return user;
  }
  async function readInventory(workspaceId: string) {
    const types = await db.select().from(inventoryWallType).where(eq(inventoryWallType.workspaceId, workspaceId));
    const typeMap = new Map(types.map(row => [row.id, row.definition]));
    const rows = await db.select().from(inventoryPanel).where(eq(inventoryPanel.workspaceId, workspaceId)).orderBy(inventoryPanel.label);
    return {
      types: types.map(row => row.definition),
      panels: rows.map(row => {
        const type = typeMap.get(row.typeId);
        if (!type) throw new AccessError(404, 'Bestand nicht verfügbar.');
        return { id: row.id, label: row.label, typeId: row.typeId, available: row.available, note: row.note, type };
      }),
    };
  }
  async function ensureType(workspaceId: string, definition: WallElementType) {
    const [existing] = await db.select().from(inventoryWallType).where(and(eq(inventoryWallType.workspaceId, workspaceId), eq(inventoryWallType.id, definition.id)));
    if (!existing) {
      await db.insert(inventoryWallType).values({ id: definition.id, workspaceId, definition });
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
    await requireInventoryLease(request, workspaceId);
    const [duplicate] = await db.select({ id: inventoryPanel.id }).from(inventoryPanel)
      .where(and(eq(inventoryPanel.workspaceId, workspaceId), eq(inventoryPanel.label, request.body.label)));
    if (duplicate) throw new AccessError(409, 'Dieses Plattenetikett ist bereits vergeben.');
    const type = await ensureType(workspaceId, request.body.type);
    const id = randomUUID();
    const available = request.body.available ?? true;
    const note = request.body.note ?? null;
    await db.insert(inventoryPanel).values({ id, workspaceId, typeId: type.id, label: request.body.label, available, note });
    return reply.code(201).send({ id, label: request.body.label, typeId: type.id, available, note, type });
  });
  api.patch(`${path}/panels/:panelId`, { schema: { params: panelParams, body: updatePanelSchema, response: { 200: inventoryPanelSchema, ...errors } } }, async request => {
    const { workspaceId, panelId } = request.params;
    await requireInventoryLease(request, workspaceId);
    const [existing] = await db.select().from(inventoryPanel).where(and(eq(inventoryPanel.workspaceId, workspaceId), eq(inventoryPanel.id, panelId)));
    if (!existing) throw new AccessError(404, 'Platte nicht verfügbar.');
    const [updated] = await db.update(inventoryPanel).set({
      available: request.body.available ?? existing.available,
      note: request.body.note === undefined ? existing.note : request.body.note,
    }).where(and(eq(inventoryPanel.workspaceId, workspaceId), eq(inventoryPanel.id, panelId))).returning();
    const inventory = await readInventory(workspaceId);
    const panel = inventory.panels.find(item => item.id === updated!.id);
    if (!panel) throw new AccessError(404, 'Platte nicht verfügbar.');
    return panel;
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
      if (!record) throw new AccessError(404, 'Szene nicht verfügbar.');
      await leases.requireHeld(tx, workspaceId, 'scene', sceneId, user.id);
      const wall = record.layout.walls.find(item => item.id === wallId);
      if (!wall) throw new AccessError(404, 'Wandelement nicht verfügbar.');
      if (record.layout.walls.some(item => item.id !== wallId && item.panelId === panel.id)) {
        throw new InventoryError(400, 'Diese Platte ist in der Szene bereits zugewiesen.');
      }
      if (!typesCompatible(type.definition, placementType(wall, typesOf(record.layout)))) {
        throw new InventoryError(400, 'Diese Platte passt nicht zum Wandelement.');
      }
      await tx.update(scene).set({
        layout: { ...record.layout, walls: record.layout.walls.map(item => item.id === wallId ? { ...item, panelId: panel.id } : item) },
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
      if (!record) throw new AccessError(404, 'Szene nicht verfügbar.');
      await leases.requireHeld(tx, workspaceId, 'scene', sceneId, user.id);
      if (!record.layout.walls.some(item => item.id === wallId)) throw new AccessError(404, 'Wandelement nicht verfügbar.');
      await tx.update(scene).set({
        layout: { ...record.layout, walls: record.layout.walls.map(item => {
          if (item.id !== wallId) return item;
          const { panelId: _removed, ...rest } = item;
          return rest;
        }) },
        revision: sql`${scene.revision} + 1`,
      }).where(and(eq(scene.workspaceId, workspaceId), eq(scene.id, sceneId)));
    });
    return { ok: true as const };
  });
}
