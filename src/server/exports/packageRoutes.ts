import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorSchema, workspaceParamsSchema } from '../../shared/contracts.js';
import { exportListSchema, exportRevisionSchema, type ExportRevision } from '../../shared/export.js';
import { sceneSchema } from '../../shared/layout.js';
import { constructionPackageSchema, freezePackage, freezePackageSchema, type ConstructionPackage } from '../../shared/package.js';
import type { Database } from '../db/connection.js';
import { adaptation, constructionPackage, inventoryPanel, inventoryWallType, production, scene, venue, venueVersion } from '../db/schema.js';
import { AccessError, type createAccess } from '../identity/access.js';
import { pdfForStoredSnapshot } from './documentRoutes.js';
import type { FileStorage } from './storage.js';

export function registerPackageRoutes(
  app: FastifyInstance, db: Database, access: ReturnType<typeof createAccess>, origin: string,
  storage: FileStorage, renderPdf: (snapshot: ConstructionPackage) => Promise<Buffer>,
) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const path = '/api/workspaces/:workspaceId/productions/:productionId/packages';
  const params = workspaceParamsSchema.extend({ productionId: z.uuid() });
  const item = params.extend({ packageId: z.uuid() });
  const errors = { 400: errorSchema, 401: errorSchema, 403: errorSchema, 404: errorSchema, 409: errorSchema };
  function asRevision(row: typeof constructionPackage.$inferSelect): ExportRevision {
    const stored = row.snapshot as { schemaVersion?: number; paper?: 'A4' | 'A3'; scale?: 25 | 50 | 100 };
    if (stored?.schemaVersion === 2 && stored.paper && stored.scale) {
      return { id: row.id, name: row.name, paper: stored.paper, scale: stored.scale, status: row.status, createdAt: row.createdAt.toISOString() };
    }
    const snapshot = constructionPackageSchema.parse(row.snapshot);
    return { id: row.id, name: row.name, paper: snapshot.paper, scale: snapshot.scale, status: row.status, createdAt: row.createdAt.toISOString() };
  }
  async function loadProduction(workspaceId: string, productionId: string) {
    const [row] = await db.select().from(production)
      .where(and(eq(production.workspaceId, workspaceId), eq(production.id, productionId)));
    if (!row) throw new AccessError(404, 'Produktion nicht verfügbar.');
    return row;
  }
  async function loadScenes(workspaceId: string, productionId: string, sceneIds: string[]) {
    const rows = await db.select({
      id: scene.id, name: scene.name, productionName: production.name, venueName: venue.name,
      productionId: production.id, venueId: venue.id,
      revision: scene.revision, venueVersionId: venueVersion.id, venue: venueVersion.geometry, layout: scene.layout,
    }).from(scene).innerJoin(adaptation, eq(scene.adaptationId, adaptation.id))
      .innerJoin(production, eq(adaptation.productionId, production.id))
      .innerJoin(venueVersion, eq(adaptation.venueVersionId, venueVersion.id))
      .innerJoin(venue, eq(venueVersion.venueId, venue.id))
      .where(and(eq(scene.workspaceId, workspaceId), eq(production.id, productionId), inArray(scene.id, sceneIds)));
    const byId = new Map(rows.map(row => [row.id, sceneSchema.parse({ ...row, lease: null })]));
    const loaded = sceneIds.map(id => byId.get(id));
    if (loaded.some(item => !item)) throw new AccessError(404, 'Szene nicht verfügbar.');
    return loaded as ReturnType<typeof sceneSchema.parse>[];
  }
  async function loadInventory(workspaceId: string) {
    const types = await db.select().from(inventoryWallType).where(eq(inventoryWallType.workspaceId, workspaceId));
    const typeMap = new Map(types.map(row => [row.id, row.definition]));
    const rows = await db.select().from(inventoryPanel).where(eq(inventoryPanel.workspaceId, workspaceId));
    return rows.map(row => {
      const type = typeMap.get(row.typeId);
      if (!type) throw new AccessError(404, 'Bestand nicht verfügbar.');
      return { id: row.id, label: row.label, typeId: row.typeId, available: row.available, note: row.note, type };
    });
  }
  async function loadRevision(workspaceId: string, productionId: string, packageId: string) {
    const [row] = await db.select().from(constructionPackage)
      .where(and(eq(constructionPackage.workspaceId, workspaceId), eq(constructionPackage.productionId, productionId), eq(constructionPackage.id, packageId)));
    if (!row) throw new AccessError(404, 'Fassung nicht verfügbar.');
    return row;
  }
  async function produce(row: typeof constructionPackage.$inferSelect) {
    try {
      const storageKey = `${row.workspaceId}/packages/${row.id}.pdf`;
      const issued = await pdfForStoredSnapshot(row.snapshot);
      await storage.put(storageKey, issued ?? await renderPdf(row.snapshot));
      await db.update(constructionPackage).set({ status: 'ready', storageKey })
        .where(and(eq(constructionPackage.workspaceId, row.workspaceId), eq(constructionPackage.id, row.id)));
    } catch (error) {
      app.log.error({ err: error, packageId: row.id }, 'Konstruktionspaket-PDF fehlgeschlagen');
      await db.update(constructionPackage).set({ status: 'failed' })
        .where(and(eq(constructionPackage.workspaceId, row.workspaceId), eq(constructionPackage.id, row.id)));
    }
  }
  api.get(path, { schema: { params, response: { 200: exportListSchema, ...errors } } }, async request => {
    await access(request, request.params.workspaceId);
    await loadProduction(request.params.workspaceId, request.params.productionId);
    const rows = await db.select().from(constructionPackage)
      .where(and(eq(constructionPackage.workspaceId, request.params.workspaceId), eq(constructionPackage.productionId, request.params.productionId)))
      .orderBy(desc(constructionPackage.createdAt));
    return rows.map(asRevision);
  });
  api.post(path, { schema: { params, body: freezePackageSchema, response: { 201: exportRevisionSchema, ...errors } } }, async (request, reply) => {
    if (request.headers.origin !== origin) throw new AccessError(403, 'Ungültiger Ursprung.');
    await access(request, request.params.workspaceId, 'exports');
    await loadProduction(request.params.workspaceId, request.params.productionId);
    const scenes = await loadScenes(request.params.workspaceId, request.params.productionId, request.body.sceneIds);
    const id = randomUUID();
    const issuedAt = new Date();
    const snapshot = freezePackage(scenes, {
      id, name: request.body.name, issuedAt, paper: request.body.paper, scale: request.body.scale,
      elevationGroupIds: request.body.elevationGroupIds, layers: request.body.layers,
    }, await loadInventory(request.params.workspaceId));
    await db.insert(constructionPackage).values({
      id, workspaceId: request.params.workspaceId, productionId: request.params.productionId, name: request.body.name,
      scale: snapshot.scale, status: 'pending', snapshot, createdAt: issuedAt,
    });
    await produce({ id, workspaceId: request.params.workspaceId, productionId: request.params.productionId, name: request.body.name,
      scale: snapshot.scale, status: 'pending', snapshot, storageKey: null, createdAt: issuedAt });
    return reply.code(201).send(asRevision(await loadRevision(request.params.workspaceId, request.params.productionId, id)));
  });
  api.post(`${path}/:packageId/retry`, { schema: { params: item, response: { 200: exportRevisionSchema, ...errors } } }, async (request, reply) => {
    if (request.headers.origin !== origin) throw new AccessError(403, 'Ungültiger Ursprung.');
    await access(request, request.params.workspaceId, 'exports');
    const row = await loadRevision(request.params.workspaceId, request.params.productionId, request.params.packageId);
    if (row.status === 'ready') return reply.code(409).send({ message: 'Diese Fassung ist bereits erzeugt.' });
    await produce(row);
    return asRevision(await loadRevision(request.params.workspaceId, request.params.productionId, request.params.packageId));
  });
  api.get(`${path}/:packageId/file`, { schema: { params: item, hide: true } }, async (request, reply) => {
    await access(request, request.params.workspaceId);
    const row = await loadRevision(request.params.workspaceId, request.params.productionId, request.params.packageId);
    if (row.status !== 'ready' || !row.storageKey) return reply.code(409).send({ message: 'Diese Fassung ist noch nicht als PDF verfügbar.' });
    return reply.type('application/pdf')
      .header('Content-Disposition', `attachment; filename="konstruktionspaket-${row.id}.pdf"`)
      .send(await storage.get(row.storageKey));
  });
  api.delete(`${path}/:packageId`, { schema: { params: item, response: { 204: z.undefined(), ...errors } } }, async (request, reply) => {
    if (request.headers.origin !== origin) throw new AccessError(403, 'Ungültiger Ursprung.');
    await access(request, request.params.workspaceId, 'exports');
    const row = await loadRevision(request.params.workspaceId, request.params.productionId, request.params.packageId);
    if (row.storageKey) await storage.remove?.(row.storageKey);
    await db.delete(constructionPackage)
      .where(and(eq(constructionPackage.workspaceId, request.params.workspaceId), eq(constructionPackage.id, row.id)));
    return reply.code(204).send();
  });
}
