import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorSchema, okSchema, venueReferenceSchema, workspaceParamsSchema } from '../../shared/contracts.js';
import {
  applyVenueResultSchema, saveVenueResultSchema, saveVenueSchema, venueGeometrySchema, type Layout, type VenueGeometry,
} from '../../shared/layout.js';
import { saveReportTemplatesSchema } from '../../shared/reportTemplate.js';
import { applyVenueVersion } from '../../shared/scenes.js';
import { createVenueSchema, publishVenueSchema, renameVenueSchema, venueListSchema, venuePlanPreview, venueRecordSchema } from '../../shared/venueLibrary.js';
import { boundsFromOutline } from '../../shared/venue.js';
import type { Database } from '../db/connection.js';
import { adaptation, editingLease, production, scene, venue, venueReference, venueVersion } from '../db/schema.js';
import type { FileStorage } from '../exports/storage.js';
import { AccessError, type createAccess } from '../identity/access.js';
import { type Leases } from '../productions/leases.js';
import { inspectReference, MAX_REFERENCE_BYTES, originalFileName } from './files.js';
import { requireRegistrySurfaces } from '../surfaces/validate.js';

export class VenueError extends Error {
  constructor(public statusCode: 400, message: string) { super(message); }
}

type Store = Pick<Database, 'select' | 'insert' | 'update' | 'execute'>;

export function registerVenueRoutes(
  app: FastifyInstance, db: Database, access: ReturnType<typeof createAccess>, origin: string, storage: FileStorage, leases: Leases,
) {
  for (const type of ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf']) {
    if (!app.hasContentTypeParser(type)) {
      app.addContentTypeParser(type, { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
    }
  }
  const api = app.withTypeProvider<ZodTypeProvider>();
  const path = '/api/workspaces/:workspaceId/venue-references';
  const item = workspaceParamsSchema.extend({ fileId: z.uuid() });
  const sceneParams = workspaceParamsSchema.extend({ sceneId: z.uuid() });
  const errors = { 400: errorSchema, 401: errorSchema, 403: errorSchema, 404: errorSchema, 409: errorSchema, 423: errorSchema };
  function asReference(row: typeof venueReference.$inferSelect) {
    return {
      id: row.id, kind: row.kind, mediaType: row.mediaType, originalName: row.originalName,
      pageCount: row.pageCount, pixelWidth: row.pixelWidth, pixelHeight: row.pixelHeight,
    };
  }
  async function requireEditor(request: Parameters<typeof access>[0], workspaceId: string) {
    if (request.headers.origin !== origin) throw new AccessError(403, 'Ungültiger Ursprung.');
    return access(request, workspaceId, 'venues');
  }
  async function loadPinned(store: Pick<Database, 'select'>, workspaceId: string, sceneId: string) {
    const [record] = await store.select({
      sceneId: scene.id, adaptationId: adaptation.id, venueId: venueVersion.venueId,
      venueVersionId: venueVersion.id, geometry: venueVersion.geometry,
      layout: scene.layout, revision: scene.revision,
    }).from(scene).innerJoin(adaptation, eq(scene.adaptationId, adaptation.id))
      .innerJoin(venueVersion, eq(adaptation.venueVersionId, venueVersion.id))
      .where(and(eq(scene.workspaceId, workspaceId), eq(scene.id, sceneId)));
    if (!record) throw new AccessError(404, 'Bühnenbild nicht verfügbar.');
    return record;
  }
  async function retargetAdaptation(
    tx: Store, workspaceId: string, adaptationId: string, nextVersionId: string, geometry: VenueGeometry, userId: string,
  ) {
    await tx.update(adaptation).set({ venueVersionId: nextVersionId })
      .where(and(eq(adaptation.workspaceId, workspaceId), eq(adaptation.id, adaptationId)));
    const rows = await tx.select({ id: scene.id, layout: scene.layout, revision: scene.revision })
      .from(scene).where(and(eq(scene.workspaceId, workspaceId), eq(scene.adaptationId, adaptationId))).orderBy(scene.id);
    const applied = new Map<string, { layout: Layout; revision: number }>();
    for (const candidate of rows) {
      await leases.requireAvailable(tx, workspaceId, 'scene', candidate.id, userId);
      const [row] = await tx.select({ id: scene.id, layout: scene.layout, revision: scene.revision })
        .from(scene).where(and(eq(scene.workspaceId, workspaceId), eq(scene.id, candidate.id)));
      if (!row) continue;
      const next = applyVenueVersion(row.layout, geometry);
      if (JSON.stringify(next.layout) === JSON.stringify(row.layout)) {
        applied.set(row.id, { layout: row.layout, revision: row.revision });
        continue;
      }
      const [updated] = await tx.update(scene)
        .set({ layout: next.layout, revision: sql`${scene.revision} + 1` })
        .where(and(eq(scene.workspaceId, workspaceId), eq(scene.id, row.id)))
        .returning({ revision: scene.revision });
      applied.set(row.id, { layout: next.layout, revision: updated!.revision });
    }
    return applied;
  }
  async function loadSceneRecord(workspaceId: string, sceneId: string) {
    const [record] = await db.select({
      id: scene.id, name: scene.name, productionName: production.name, venueName: venue.name,
      productionId: production.id, venueId: venue.id, revision: scene.revision,
      venueVersionId: venueVersion.id, pinnedCreatedAt: venueVersion.createdAt,
      venue: venueVersion.geometry, layout: scene.layout,
    }).from(scene).innerJoin(adaptation, eq(scene.adaptationId, adaptation.id))
      .innerJoin(production, eq(adaptation.productionId, production.id))
      .innerJoin(venueVersion, eq(adaptation.venueVersionId, venueVersion.id))
      .innerJoin(venue, eq(venueVersion.venueId, venue.id))
      .where(and(eq(scene.workspaceId, workspaceId), eq(scene.id, sceneId)));
    if (!record) throw new AccessError(404, 'Bühnenbild nicht verfügbar.');
    const [newest] = await db.select({ createdAt: sql<string>`max(${venueVersion.createdAt})`.as('createdAt') })
      .from(venueVersion)
      .where(and(eq(venueVersion.workspaceId, workspaceId), eq(venueVersion.venueId, record.venueId)));
    const { pinnedCreatedAt, ...rest } = record;
    return {
      ...rest,
      venueUpdateAvailable: (newest?.createdAt ? new Date(newest.createdAt).getTime() : 0) > pinnedCreatedAt.getTime(),
    };
  }
  api.post(path, { bodyLimit: MAX_REFERENCE_BYTES, schema: { params: workspaceParamsSchema, hide: true, response: { 201: venueReferenceSchema, ...errors } } },
    async (request, reply) => {
      const { workspaceId } = request.params;
      await requireEditor(request, workspaceId);
      const bytes = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
      let inspected;
      try { inspected = await inspectReference(bytes, request.headers['content-type'] ?? ''); }
      catch { throw new VenueError(400, 'Diese Datei kann nicht als Vorlage verwendet werden.'); }
      const id = randomUUID();
      const storageKey = `${workspaceId}/venue-references/${id}`;
      await storage.put(storageKey, bytes);
      const [row] = await db.insert(venueReference).values({
        id, workspaceId, kind: inspected.kind, mediaType: inspected.mediaType,
        originalName: originalFileName(request.headers['x-file-name']), storageKey,
        pageCount: inspected.pageCount, pixelWidth: inspected.pixelWidth, pixelHeight: inspected.pixelHeight,
      }).returning();
      return reply.code(201).send(asReference(row!));
    });
  api.get(`${path}/:fileId`, { schema: { params: item, response: { 200: venueReferenceSchema, ...errors } } }, async request => {
    await access(request, request.params.workspaceId);
    const [row] = await db.select().from(venueReference)
      .where(and(eq(venueReference.workspaceId, request.params.workspaceId), eq(venueReference.id, request.params.fileId)));
    if (!row) throw new AccessError(404, 'Vorlage nicht verfügbar.');
    return asReference(row);
  });
  api.get(`${path}/:fileId/file`, { schema: { params: item, hide: true } }, async (request, reply) => {
    await access(request, request.params.workspaceId);
    const [row] = await db.select().from(venueReference)
      .where(and(eq(venueReference.workspaceId, request.params.workspaceId), eq(venueReference.id, request.params.fileId)));
    if (!row) throw new AccessError(404, 'Vorlage nicht verfügbar.');
    return reply.type(row.mediaType)
      .header('Content-Disposition', `inline; filename="${row.originalName.replaceAll('"', '')}"`)
      .send(await storage.get(row.storageKey));
  });
  async function validateReference(workspaceId: string, input: VenueGeometry) {
    await requireRegistrySurfaces(db, workspaceId, null, input);
    if (input.trace) {
      const [file] = await db.select().from(venueReference)
        .where(and(eq(venueReference.workspaceId, workspaceId), eq(venueReference.id, input.trace.fileId)));
      if (!file) throw new VenueError(400, 'Die Vorlage ist nicht verfügbar.');
      if (file.kind === 'image' && input.trace.page !== undefined) throw new VenueError(400, 'Bilder haben keine PDF-Seite.');
      if (file.kind === 'pdf' && input.trace.page !== undefined && file.pageCount && input.trace.page > file.pageCount) {
        throw new VenueError(400, 'Diese PDF-Seite ist nicht vorhanden.');
      }
    }
  }
  const venuesPath = '/api/workspaces/:workspaceId/venues';
  const venueParams = workspaceParamsSchema.extend({ venueId: z.uuid() });
  for (const operation of ['acquire', 'heartbeat', 'release'] as const) {
    const suffix = operation === 'acquire' ? '' : `/${operation}`;
    api.post(`${venuesPath}/:venueId/lease${suffix}`, { schema: { params: venueParams } }, async (request, reply) => {
      const { workspaceId, venueId } = request.params;
      const { user } = await requireEditor(request, workspaceId);
      await loadVenue(db, workspaceId, venueId);
      if (operation === 'acquire') {
        const result = await leases.acquire(workspaceId, 'venue', venueId, user);
        if (!result.acquired) return reply.code(423).send({ message: `Wird bereits von ${result.lease.holderName} bearbeitet.` });
        return result.lease;
      }
      await leases[operation](workspaceId, 'venue', venueId, user.id);
      return { ok: true };
    });
  }
  async function loadVenue(store: Pick<Database, 'select'>, workspaceId: string, venueId: string, versionId?: string) {
    const [row] = await store.select({ id: venue.id, name: venue.name, venueVersionId: venueVersion.id, venue: venueVersion.geometry })
      .from(venue).innerJoin(venueVersion, eq(venueVersion.venueId, venue.id))
      .where(and(eq(venue.workspaceId, workspaceId), eq(venue.id, venueId), versionId ? eq(venueVersion.id, versionId) : undefined))
      .orderBy(desc(venueVersion.createdAt), desc(venueVersion.id)).limit(1);
    if (!row) throw new AccessError(404, 'Spielstätte nicht verfügbar.');
    return { ...row, width: row.venue.width, depth: row.venue.depth };
  }
  api.get(venuesPath, { schema: { params: workspaceParamsSchema, response: { 200: venueListSchema, ...errors } } }, async request => {
    const { workspaceId } = request.params;
    await access(request, workspaceId);
    const rows = await db.selectDistinctOn([venue.id], { id: venue.id, name: venue.name, venueVersionId: venueVersion.id, geometry: venueVersion.geometry })
      .from(venue).innerJoin(venueVersion, eq(venueVersion.venueId, venue.id))
      .where(eq(venue.workspaceId, workspaceId))
      .orderBy(venue.id, desc(venueVersion.createdAt), desc(venueVersion.id));
    return rows.map(row => {
      const geometry = venueGeometrySchema.parse(row.geometry);
      return {
        id: row.id, name: row.name, venueVersionId: row.venueVersionId,
        width: geometry.width, depth: geometry.depth, preview: venuePlanPreview(geometry),
      };
    }).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  });
  api.get(`${venuesPath}/:venueId`, { schema: { params: venueParams, response: { 200: venueRecordSchema, ...errors } } }, async request => {
    await access(request, request.params.workspaceId);
    return loadVenue(db, request.params.workspaceId, request.params.venueId);
  });
  api.get(`${venuesPath}/:venueId/versions/:venueVersionId`, {
    schema: { params: venueParams.extend({ venueVersionId: z.uuid() }), response: { 200: venueRecordSchema, ...errors } },
  }, async request => {
    const { workspaceId, venueId, venueVersionId } = request.params;
    await access(request, workspaceId);
    return loadVenue(db, workspaceId, venueId, venueVersionId);
  });
  api.post(venuesPath, { schema: { params: workspaceParamsSchema, body: createVenueSchema, response: { 201: venueRecordSchema, ...errors } } }, async (request, reply) => {
    const { workspaceId } = request.params;
    await requireEditor(request, workspaceId);
    const { name, width, depth } = request.body;
    const id = randomUUID(), versionId = randomUUID();
    await db.transaction(async tx => {
      await tx.insert(venue).values({ id, workspaceId, name });
      await tx.insert(venueVersion).values({ id: versionId, workspaceId, venueId: id, geometry: { schemaVersion: 1, width, depth } });
    });
    return reply.code(201).send(await loadVenue(db, workspaceId, id));
  });
  api.patch(`${venuesPath}/:venueId`, {
    schema: { params: venueParams, body: renameVenueSchema, response: { 200: venueRecordSchema, ...errors } },
  }, async request => {
    const { workspaceId, venueId } = request.params;
    await requireEditor(request, workspaceId);
    const [updated] = await db.update(venue).set({ name: request.body.name })
      .where(and(eq(venue.workspaceId, workspaceId), eq(venue.id, venueId)))
      .returning({ id: venue.id });
    if (!updated) throw new AccessError(404, 'Spielstätte nicht verfügbar.');
    return loadVenue(db, workspaceId, venueId);
  });
  api.put(`${venuesPath}/:venueId`, {
    bodyLimit: 256 * 1024,
    schema: { params: venueParams, body: publishVenueSchema, response: { 200: venueRecordSchema, ...errors } },
  }, async request => {
    const { workspaceId, venueId } = request.params;
    const { user } = await requireEditor(request, workspaceId);
    await validateReference(workspaceId, request.body.venue);
    return db.transaction(async tx => {
      await leases.requireHeld(tx, workspaceId, 'venue', venueId, user.id);
      await tx.select({ id: venue.id }).from(venue).where(and(eq(venue.workspaceId, workspaceId), eq(venue.id, venueId))).for('update');
      const current = await loadVenue(tx, workspaceId, venueId);
      if (current.venueVersionId !== request.body.venueVersionId) throw new AccessError(409, 'Eine neuere Spielstättenfassung ist vorhanden. Bitte sichern Sie Ihren Entwurf und laden Sie die Spielstätte neu.');
      const input = request.body.venue;
      const geometry = input.outline ? { ...input, ...boundsFromOutline(input.outline) } : input;
      await tx.insert(venueVersion).values({ id: randomUUID(), workspaceId, venueId, geometry, createdAt: sql`clock_timestamp()` });
      // Independent publication deliberately leaves all production adaptations pinned.
      return loadVenue(tx, workspaceId, venueId);
    });
  });
  api.put('/api/workspaces/:workspaceId/scenes/:sceneId/venue', {
    bodyLimit: 256 * 1024,
    schema: { params: sceneParams, body: saveVenueSchema, response: { 200: saveVenueResultSchema, ...errors } },
  }, async request => {
    const { workspaceId, sceneId } = request.params;
    const { user } = await requireEditor(request, workspaceId);
    const input = request.body.venue;
    await validateReference(workspaceId, input);
    const geometry = input.outline ? { ...input, ...boundsFromOutline(input.outline) } : input;
    return db.transaction(async tx => {
      const pinned = await loadPinned(tx, workspaceId, sceneId);
      await leases.requireAvailable(tx, workspaceId, 'venue', pinned.venueId, user.id);
      await leases.requireHeld(tx, workspaceId, 'scene', sceneId, user.id);
      await tx.select({ id: venue.id }).from(venue).where(eq(venue.id, pinned.venueId)).for('update');
      const nextId = randomUUID();
      // Auto-apply the issuing adaptation so VenuePanel reload after save shows
      // the new version. Sibling adaptations remain on the previous pin.
      await tx.insert(venueVersion).values({ id: nextId, workspaceId, venueId: pinned.venueId, geometry, createdAt: sql`clock_timestamp()` });
      const applied = await retargetAdaptation(tx, workspaceId, pinned.adaptationId, nextId, geometry, user.id);
      const state = applied.get(sceneId)!;
      return { venue: geometry, venueVersionId: nextId, layout: state.layout, revision: state.revision };
    });
  });
  api.patch('/api/workspaces/:workspaceId/scenes/:sceneId/venue/report-templates', {
    schema: {
      params: sceneParams,
      body: saveReportTemplatesSchema,
      response: { 200: saveVenueResultSchema, ...errors },
    },
  }, async request => {
    const { workspaceId, sceneId } = request.params;
    const { user } = await requireEditor(request, workspaceId);
    return db.transaction(async tx => {
      const pinned = await loadPinned(tx, workspaceId, sceneId);
      await leases.requireAvailable(tx, workspaceId, 'venue', pinned.venueId, user.id);
      await leases.requireHeld(tx, workspaceId, 'scene', sceneId, user.id);
      await tx.select({ id: venue.id }).from(venue).where(eq(venue.id, pinned.venueId)).for('update');
      const latest = await loadVenue(tx, workspaceId, pinned.venueId);
      if (latest.venueVersionId !== pinned.venueVersionId) {
        throw new AccessError(409, 'Eine neuere Spielstättenfassung ist vorhanden. Bitte übernehmen Sie diese ausdrücklich im Bühnenbild, bevor Sie eine Blattvorlage speichern.');
      }
      if (request.body.venueVersionId && request.body.venueVersionId !== pinned.venueVersionId) {
        throw new AccessError(409, 'Die Blattvorlagen wurden inzwischen geändert. Bitte laden Sie das Bühnenbild neu.');
      }
      const templates = new Map((latest.venue.reportTemplates ?? []).map(template => [template.id, template]));
      for (const template of request.body.reportTemplates) templates.set(template.id, template);
      const geometry = venueGeometrySchema.parse({
        ...latest.venue,
        reportTemplates: [...templates.values()],
      });
      const nextId = randomUUID();
      await tx.insert(venueVersion).values({ id: nextId, workspaceId, venueId: pinned.venueId, geometry, createdAt: sql`clock_timestamp()` });
      const applied = await retargetAdaptation(tx, workspaceId, pinned.adaptationId, nextId, geometry, user.id);
      const state = applied.get(sceneId)!;
      return { venue: geometry, venueVersionId: nextId, layout: state.layout, revision: state.revision };
    });
  });
  api.post('/api/workspaces/:workspaceId/scenes/:sceneId/venue-apply', {
    schema: { params: sceneParams, body: z.object({}).strict(), response: { 200: applyVenueResultSchema, ...errors } },
  }, async request => {
    const { workspaceId, sceneId } = request.params;
    const { user } = await requireEditor(request, workspaceId);
    await db.transaction(async tx => {
      const pinned = await loadPinned(tx, workspaceId, sceneId);
      await leases.requireAvailable(tx, workspaceId, 'venue', pinned.venueId, user.id);
      await leases.requireHeld(tx, workspaceId, 'scene', sceneId, user.id);
      const [latest] = await tx.select().from(venueVersion)
        .where(and(eq(venueVersion.workspaceId, workspaceId), eq(venueVersion.venueId, pinned.venueId)))
        .orderBy(desc(venueVersion.createdAt), desc(venueVersion.id)).limit(1);
      if (!latest) throw new AccessError(404, 'Spielstätte nicht verfügbar.');
      if (latest.id === pinned.venueVersionId) return;
      await retargetAdaptation(tx, workspaceId, pinned.adaptationId, latest.id, venueGeometrySchema.parse(latest.geometry), user.id);
    });
    const record = await loadSceneRecord(workspaceId, sceneId);
    const diagnostics = applyVenueVersion(record.layout, record.venue);
    return {
      ...record, lease: await leases.read(workspaceId, 'scene', sceneId),
      unresolvedSupport: diagnostics.unresolvedSupport,
      warnings: diagnostics.warnings,
      unresolvedWarnings: diagnostics.unresolvedWarnings,
    };
  });
  api.delete(`${venuesPath}/:venueId`, { schema: { params: venueParams, response: { 200: okSchema, ...errors } } }, async request => {
    const { workspaceId, venueId } = request.params;
    const { user } = await requireEditor(request, workspaceId);
    await db.transaction(async tx => {
      await leases.requireAvailable(tx, workspaceId, 'venue', venueId, user.id);
      const [existing] = await tx.select({ id: venue.id }).from(venue)
        .where(and(eq(venue.workspaceId, workspaceId), eq(venue.id, venueId)));
      if (!existing) throw new AccessError(404, 'Spielstätte nicht verfügbar.');
      const versions = await tx.select({ id: venueVersion.id }).from(venueVersion)
        .where(and(eq(venueVersion.workspaceId, workspaceId), eq(venueVersion.venueId, venueId)));
      if (versions.length) {
        const inUse = await tx.select({ id: adaptation.id }).from(adaptation)
          .where(and(
            eq(adaptation.workspaceId, workspaceId),
            inArray(adaptation.venueVersionId, versions.map(item => item.id)),
          )).limit(1);
        if (inUse.length) {
          throw new AccessError(409, 'Diese Spielstätte wird noch von Produktionen verwendet. Löschen Sie zuerst die zugehörigen Bühnenbilder.');
        }
      }
      await tx.delete(editingLease).where(and(
        eq(editingLease.workspaceId, workspaceId),
        eq(editingLease.resourceKind, 'venue'),
        eq(editingLease.resourceId, venueId),
      ));
      await tx.delete(venueVersion).where(and(eq(venueVersion.workspaceId, workspaceId), eq(venueVersion.venueId, venueId)));
      await tx.delete(venue).where(and(eq(venue.workspaceId, workspaceId), eq(venue.id, venueId)));
    });
    return { ok: true as const };
  });
}
