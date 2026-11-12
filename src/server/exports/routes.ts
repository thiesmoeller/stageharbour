import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorSchema, workspaceParamsSchema } from '../../shared/contracts.js';
import { constructionSnapshotSchema, exportListSchema, exportPreviewResultSchema, exportPreviewSchema, exportRevisionSchema, freezeExportSchema, freezeSnapshot, type ConstructionSnapshot, type ExportRevision } from '../../shared/export.js';
import { sceneSchema } from '../../shared/layout.js';
import { migrateLayout } from '../../shared/layoutMigrate.js';
import { createLayoutPartIndex, resolveLayoutObjects } from '../../shared/layoutObjects.js';
import type { Database } from '../db/connection.js';
import { adaptation, constructionPlanRevision, production, scene, stockItem, venue, venueVersion } from '../db/schema.js';
import { loadAllRevisions, loadMaterials } from '../parts/data.js';
import { AccessError, type createAccess } from '../identity/access.js';
import type { FileStorage } from './storage.js';
import { pdfForStoredSnapshot } from './documentRoutes.js';
import { constructionPageBreakdown } from './pdf.js';

export function registerExportRoutes(
  app: FastifyInstance, db: Database, access: ReturnType<typeof createAccess>, origin: string,
  storage: FileStorage, renderPdf: (snapshot: ConstructionSnapshot) => Promise<Buffer>,
) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const path = '/api/workspaces/:workspaceId/scenes/:sceneId/exports';
  const params = workspaceParamsSchema.extend({ sceneId: z.uuid() });
  const item = params.extend({ exportId: z.uuid() });
  const errors = { 400: errorSchema, 401: errorSchema, 403: errorSchema, 404: errorSchema, 409: errorSchema };
  function asRevision(row: typeof constructionPlanRevision.$inferSelect): ExportRevision {
    const stored = row.snapshot as { schemaVersion?: number; paper?: 'A4' | 'A3'; scale?: 25 | 50 | 100 };
    if (stored?.schemaVersion === 2 && stored.paper && stored.scale) {
      return { id: row.id, name: row.name, paper: stored.paper, scale: stored.scale, status: row.status, createdAt: row.createdAt.toISOString() };
    }
    const snapshot = constructionSnapshotSchema.parse(row.snapshot);
    return { id: row.id, name: row.name, paper: snapshot.paper, scale: snapshot.scale, status: row.status, createdAt: row.createdAt.toISOString() };
  }
  async function loadScene(workspaceId: string, sceneId: string) {
    const [record] = await db.select({
      id: scene.id, name: scene.name, productionName: production.name, venueName: venue.name,
      productionId: production.id, venueId: venue.id,
      revision: scene.revision, venueVersionId: venueVersion.id, venue: venueVersion.geometry, layout: scene.layout,
    }).from(scene).innerJoin(adaptation, eq(scene.adaptationId, adaptation.id))
      .innerJoin(production, eq(adaptation.productionId, production.id))
      .innerJoin(venueVersion, eq(adaptation.venueVersionId, venueVersion.id))
      .innerJoin(venue, eq(venueVersion.venueId, venue.id))
      .where(and(eq(scene.workspaceId, workspaceId), eq(scene.id, sceneId)));
    if (!record) throw new AccessError(404, 'Bühnenbild nicht verfügbar.');
    if ((record.layout as { schemaVersion?: unknown }).schemaVersion === 1) {
      const index = await layoutIndex(workspaceId);
      record.layout = migrateLayout(record.layout, index);
      await db.update(scene).set({ layout: record.layout }).where(and(eq(scene.workspaceId, workspaceId), eq(scene.id, sceneId)));
    }
    return sceneSchema.parse({ ...record, lease: null });
  }
  async function layoutIndex(workspaceId: string) {
    const [revisions, materials] = await Promise.all([loadAllRevisions(db, workspaceId), loadMaterials(db, workspaceId)]);
    return createLayoutPartIndex({
      parts: [...revisions.values()].flatMap(items => [...items.values()]),
      materials: [...materials.values()],
    });
  }
  async function stockLabels(workspaceId: string, itemIds: string[]) {
    const ids = [...new Set(itemIds)];
    if (!ids.length) return {};
    const rows = await db.select({ id: stockItem.id, label: stockItem.label })
      .from(stockItem).where(and(eq(stockItem.workspaceId, workspaceId), inArray(stockItem.id, ids)));
    return Object.fromEntries(rows.map(row => [row.id, row.label]));
  }
  async function loadRevision(workspaceId: string, sceneId: string, exportId: string) {
    const [row] = await db.select().from(constructionPlanRevision)
      .where(and(eq(constructionPlanRevision.workspaceId, workspaceId), eq(constructionPlanRevision.sceneId, sceneId), eq(constructionPlanRevision.id, exportId)));
    if (!row) throw new AccessError(404, 'Fassung nicht verfügbar.');
    return row;
  }
  async function produce(row: typeof constructionPlanRevision.$inferSelect) {
    try {
      const storageKey = `${row.workspaceId}/${row.id}.pdf`;
      const issued = await pdfForStoredSnapshot(row.snapshot);
      await storage.put(storageKey, issued ?? await renderPdf(row.snapshot));
      await db.update(constructionPlanRevision).set({ status: 'ready', storageKey })
        .where(and(eq(constructionPlanRevision.workspaceId, row.workspaceId), eq(constructionPlanRevision.id, row.id)));
    } catch {
      await db.update(constructionPlanRevision).set({ status: 'failed' })
        .where(and(eq(constructionPlanRevision.workspaceId, row.workspaceId), eq(constructionPlanRevision.id, row.id)));
    }
  }
  api.get(path, { schema: { params, response: { 200: exportListSchema, ...errors } } }, async request => {
    await access(request, request.params.workspaceId);
    await loadScene(request.params.workspaceId, request.params.sceneId);
    const rows = await db.select().from(constructionPlanRevision)
      .where(and(eq(constructionPlanRevision.workspaceId, request.params.workspaceId), eq(constructionPlanRevision.sceneId, request.params.sceneId)))
      .orderBy(desc(constructionPlanRevision.createdAt));
    return rows.map(asRevision);
  });
  api.post(path, { schema: { params, body: freezeExportSchema, response: { 201: exportRevisionSchema, ...errors } } }, async (request, reply) => {
    if (request.headers.origin !== origin) throw new AccessError(403, 'Ungültiger Ursprung.');
    await access(request, request.params.workspaceId, 'exports');
    const loaded = await loadScene(request.params.workspaceId, request.params.sceneId);
    const id = randomUUID();
    const issuedAt = new Date();
    const index = await layoutIndex(request.params.workspaceId);
    const objects = resolveLayoutObjects(loaded.layout, index);
    const snapshot = freezeSnapshot(loaded, {
      id, name: request.body.name, issuedAt, paper: request.body.paper, scale: request.body.scale,
      elevationGroupIds: request.body.elevationGroupIds, layers: request.body.layers,
    }, await stockLabels(
      request.params.workspaceId, loaded.layout.objects.flatMap(object => object.stockItemId ? [object.stockItemId] : []),
    ), objects);
    await db.insert(constructionPlanRevision).values({
      id, workspaceId: request.params.workspaceId, sceneId: request.params.sceneId, name: request.body.name,
      scale: snapshot.scale, status: 'pending', snapshot, createdAt: issuedAt,
    });
    await produce({ id, workspaceId: request.params.workspaceId, sceneId: request.params.sceneId, name: request.body.name,
      scale: snapshot.scale, status: 'pending', snapshot, storageKey: null, createdAt: issuedAt });
    return reply.code(201).send(asRevision(await loadRevision(request.params.workspaceId, request.params.sceneId, id)));
  });
  api.post(`${path}/preview`, { schema: { params, body: exportPreviewSchema, response: { 200: exportPreviewResultSchema, ...errors } } }, async request => {
    await access(request, request.params.workspaceId);
    const loaded = await loadScene(request.params.workspaceId, request.params.sceneId);
    const index = await layoutIndex(request.params.workspaceId);
    const objects = resolveLayoutObjects(loaded.layout, index);
    const snapshot = freezeSnapshot(loaded, {
      id: randomUUID(), name: 'Vorschau', issuedAt: new Date(),
      paper: request.body.paper, scale: request.body.scale,
      elevationGroupIds: request.body.elevationGroupIds, layers: request.body.layers,
    }, await stockLabels(
      request.params.workspaceId, loaded.layout.objects.flatMap(object => object.stockItemId ? [object.stockItemId] : []),
    ), objects);
    return constructionPageBreakdown(snapshot);
  });
  api.post(`${path}/:exportId/retry`, { schema: { params: item, response: { 200: exportRevisionSchema, ...errors } } }, async (request, reply) => {
    if (request.headers.origin !== origin) throw new AccessError(403, 'Ungültiger Ursprung.');
    await access(request, request.params.workspaceId, 'exports');
    const row = await loadRevision(request.params.workspaceId, request.params.sceneId, request.params.exportId);
    if (row.status === 'ready') return reply.code(409).send({ message: 'Diese Fassung ist bereits erzeugt.' });
    await produce(row);
    return asRevision(await loadRevision(request.params.workspaceId, request.params.sceneId, request.params.exportId));
  });
  api.get(`${path}/:exportId/file`, { schema: { params: item, hide: true } }, async (request, reply) => {
    await access(request, request.params.workspaceId);
    const row = await loadRevision(request.params.workspaceId, request.params.sceneId, request.params.exportId);
    if (row.status !== 'ready' || !row.storageKey) return reply.code(409).send({ message: 'Diese Fassung ist noch nicht als PDF verfügbar.' });
    return reply.type('application/pdf')
      .header('Content-Disposition', `attachment; filename="${safeDownloadName(row.name, row.id)}.pdf"`)
      .send(await storage.get(row.storageKey));
  });
  api.delete(`${path}/:exportId`, { schema: { params: item, response: { 204: z.undefined(), ...errors } } }, async (request, reply) => {
    if (request.headers.origin !== origin) throw new AccessError(403, 'Ungültiger Ursprung.');
    await access(request, request.params.workspaceId, 'exports');
    const row = await loadRevision(request.params.workspaceId, request.params.sceneId, request.params.exportId);
    if (row.storageKey) await storage.remove?.(row.storageKey);
    await db.delete(constructionPlanRevision)
      .where(and(eq(constructionPlanRevision.workspaceId, request.params.workspaceId), eq(constructionPlanRevision.id, row.id)));
    return reply.code(204).send();
  });
}

function safeDownloadName(name: string, id: string) {
  const base = name.replace(/[^\wÄÖÜäöüß\-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  return `konstruktionsplan-${base || id.slice(0, 8)}`;
}
