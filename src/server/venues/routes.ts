import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorSchema, venueReferenceSchema, workspaceParamsSchema } from '../../shared/contracts.js';
import { saveVenueSchema, venueGeometrySchema } from '../../shared/layout.js';
import { boundsFromOutline } from '../../shared/venue.js';
import type { Database } from '../db/connection.js';
import { adaptation, scene, venueReference, venueVersion } from '../db/schema.js';
import type { FileStorage } from '../exports/storage.js';
import { AccessError, type createAccess } from '../identity/access.js';
import { type Leases } from '../productions/leases.js';
import { inspectReference, MAX_REFERENCE_BYTES, originalFileName } from './files.js';

export class VenueError extends Error {
  constructor(public statusCode: 400, message: string) { super(message); }
}

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
    return access(request, workspaceId, ['administrator', 'editor']);
  }
  async function loadPinnedVersion(workspaceId: string, sceneId: string) {
    const [record] = await db.select({
      sceneId: scene.id, venueVersionId: venueVersion.id, geometry: venueVersion.geometry,
    }).from(scene).innerJoin(adaptation, eq(scene.adaptationId, adaptation.id))
      .innerJoin(venueVersion, eq(adaptation.venueVersionId, venueVersion.id))
      .where(and(eq(scene.workspaceId, workspaceId), eq(scene.id, sceneId)));
    if (!record) throw new AccessError(404, 'Szene nicht verfügbar.');
    return record;
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
  api.put('/api/workspaces/:workspaceId/scenes/:sceneId/venue', {
    schema: { params: sceneParams, body: saveVenueSchema, response: { 200: z.object({ venue: venueGeometrySchema }), ...errors } },
  }, async request => {
    const { workspaceId, sceneId } = request.params;
    const { user } = await requireEditor(request, workspaceId);
    const input = request.body.venue;
    if (input.trace) {
      const [file] = await db.select().from(venueReference)
        .where(and(eq(venueReference.workspaceId, workspaceId), eq(venueReference.id, input.trace.fileId)));
      if (!file) throw new VenueError(400, 'Die Vorlage ist nicht verfügbar.');
      if (file.kind === 'image' && input.trace.page !== undefined) throw new VenueError(400, 'Bilder haben keine PDF-Seite.');
      if (file.kind === 'pdf' && input.trace.page !== undefined && file.pageCount && input.trace.page > file.pageCount) {
        throw new VenueError(400, 'Diese PDF-Seite ist nicht vorhanden.');
      }
    }
    const geometry = input.outline ? { ...input, ...boundsFromOutline(input.outline) } : input;
    const updated = await db.transaction(async tx => {
      const pinned = await loadPinnedVersion(workspaceId, sceneId);
      await leases.requireHeld(tx, workspaceId, 'scene', sceneId, user.id);
      await tx.update(venueVersion).set({ geometry })
        .where(and(eq(venueVersion.workspaceId, workspaceId), eq(venueVersion.id, pinned.venueVersionId)));
      return geometry;
    });
    return { venue: updated };
  });
}
