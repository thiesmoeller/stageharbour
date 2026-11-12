import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorSchema, workspaceParamsSchema } from '../../shared/contracts.js';
import { exportRevisionSchema, freezeSnapshot } from '../../shared/export.js';
import { documentDraftSchema, exportDocumentSpecSchema, prepareDocumentBodySchema, decodeViewImages, type ExportDocumentSpec, type FrozenScene } from '../../shared/exportDocument.js';
import { sceneSchema, type Scene } from '../../shared/layout.js';
import { migrateLayout } from '../../shared/layoutMigrate.js';
import type { Database } from '../db/connection.js';
import {
  adaptation, constructionPackage, constructionPlanRevision, documentDraft, exportPreparation, production, scene, venue, venueVersion,
} from '../db/schema.js';
import { AccessError, type createAccess } from '../identity/access.js';
import {
  cancelPreparation, enqueuePreparation, expirePreparations, isIssuedDocument, newPreparationId,
  preparationExpiry, renderIssuedDocument, sourceFingerprint, type IssuedDocument,
} from './documentJobs.js';
import { freezeSource, workspacePartIndex } from './freezeSource.js';
import type { FileStorage } from './storage.js';

const jobSchema = z.strictObject({
  id: z.uuid(),
  status: z.enum(['queued', 'rendering', 'ready', 'failed', 'cancelled', 'issued', 'expired']),
  stage: z.string(),
  pageCount: z.number().int().nullable(),
  error: z.string().nullable(),
  manifest: z.unknown().nullable(),
  expiresAt: z.string(),
  issuedRevisionId: z.uuid().nullable(),
});

export function registerDocumentRoutes(
  app: FastifyInstance, db: Database, access: ReturnType<typeof createAccess>, origin: string, storage: FileStorage,
) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const params = workspaceParamsSchema;
  const item = params.extend({ documentId: z.uuid() });
  const draftParams = params.extend({ productionId: z.uuid() });
  const errors = { 400: errorSchema, 401: errorSchema, 403: errorSchema, 404: errorSchema, 409: errorSchema };

  async function loadScenes(workspaceId: string, sceneIds: string[]) {
    const rows = await db.select({
      id: scene.id, name: scene.name, productionName: production.name, venueName: venue.name,
      productionId: production.id, venueId: venue.id,
      revision: scene.revision, venueVersionId: venueVersion.id, venue: venueVersion.geometry, layout: scene.layout,
    }).from(scene).innerJoin(adaptation, eq(scene.adaptationId, adaptation.id))
      .innerJoin(production, eq(adaptation.productionId, production.id))
      .innerJoin(venueVersion, eq(adaptation.venueVersionId, venueVersion.id))
      .innerJoin(venue, eq(venueVersion.venueId, venue.id))
      .where(and(eq(scene.workspaceId, workspaceId), inArray(scene.id, sceneIds)));
    const index = await layoutIndex(workspaceId);
    await Promise.all(rows.map(async row => {
      if ((row.layout as { schemaVersion?: unknown }).schemaVersion !== 1) return;
      row.layout = migrateLayout(row.layout, index);
      await db.update(scene).set({ layout: row.layout }).where(and(eq(scene.workspaceId, workspaceId), eq(scene.id, row.id)));
    }));
    const byId = new Map(rows.map(row => [row.id, sceneSchema.parse({ ...row, lease: null })]));
    const loaded = sceneIds.map(id => byId.get(id));
    if (loaded.some(item => !item)) throw new AccessError(404, 'Bühnenbild nicht verfügbar.');
    return loaded as Scene[];
  }

  const layoutIndex = (workspaceId: string) => workspacePartIndex(db, workspaceId);

  function asJob(row: typeof exportPreparation.$inferSelect) {
    return {
      id: row.id, status: row.status, stage: row.stage, pageCount: row.pageCount, error: row.error,
      manifest: row.manifest, expiresAt: row.expiresAt.toISOString(), issuedRevisionId: row.issuedRevisionId,
    };
  }

  async function loadJob(workspaceId: string, documentId: string) {
    const [row] = await db.select().from(exportPreparation)
      .where(and(eq(exportPreparation.workspaceId, workspaceId), eq(exportPreparation.id, documentId)));
    if (!row) throw new AccessError(404, 'Vorschau nicht verfügbar.');
    if (row.status === 'ready' && row.expiresAt.getTime() <= Date.now()) {
      if (row.storageKey) await storage.remove?.(row.storageKey);
      const [expired] = await db.update(exportPreparation).set({ status: 'expired', stage: 'expired', storageKey: null }).where(eq(exportPreparation.id, row.id)).returning();
      return expired ?? { ...row, status: 'expired' as const, storageKey: null };
    }
    return row;
  }

  api.get('/api/workspaces/:workspaceId/productions/:productionId/document-draft', {
    schema: { params: draftParams, response: { 200: documentDraftSchema.nullable(), ...errors } },
  }, async request => {
    await access(request, request.params.workspaceId);
    const [row] = await db.select({ draft: documentDraft.draft }).from(documentDraft).where(and(
      eq(documentDraft.workspaceId, request.params.workspaceId),
      eq(documentDraft.productionId, request.params.productionId),
    ));
    return row ? documentDraftSchema.parse(row.draft) : null;
  });

  api.put('/api/workspaces/:workspaceId/productions/:productionId/document-draft', {
    bodyLimit: 24 * 1024 * 1024,
    schema: { params: draftParams, body: documentDraftSchema, response: { 200: documentDraftSchema, ...errors } },
  }, async request => {
    if (request.headers.origin !== origin) throw new AccessError(403, 'Ungültiger Ursprung.');
    await access(request, request.params.workspaceId, 'exports');
    const draft = documentDraftSchema.parse(request.body);
    const now = new Date();
    await db.insert(documentDraft).values({
      id: randomUUID(), workspaceId: request.params.workspaceId, productionId: request.params.productionId,
      draft, createdAt: now, updatedAt: now,
    }).onConflictDoUpdate({
      target: [documentDraft.workspaceId, documentDraft.productionId],
      set: { draft, updatedAt: now },
    });
    return draft;
  });

  api.post('/api/workspaces/:workspaceId/documents', {
    bodyLimit: 24 * 1024 * 1024,
    schema: { params, body: prepareDocumentBodySchema, response: { 201: jobSchema, ...errors } },
  }, async (request, reply) => {
    if (request.headers.origin !== origin) throw new AccessError(403, 'Ungültiger Ursprung.');
    await access(request, request.params.workspaceId, 'exports');
    await expirePreparations(db, storage);
    const { viewImages, ...specFields } = request.body;
    const spec = exportDocumentSpecSchema.parse(specFields);
    const scenes = await loadScenes(request.params.workspaceId, spec.scenes.map(item => item.sceneId));
    const issuedAt = new Date();
    const source = await freezeSource(db, request.params.workspaceId);
    const frozenScenes = scenes.map(scene => {
      const selected = spec.scenes.find(item => item.sceneId === scene.id);
      const snapshot = freezeSnapshot(scene, {
        id: randomUUID(), name: spec.revisionName, issuedAt, paper: spec.paper,
        scale: spec.scale, elevationGroupIds: selected?.elevationGroupIds ?? [], layers: spec.layers,
      }, source);
      return { sceneId: scene.id, sceneName: scene.name, venueName: scene.venueName, snapshot };
    });
    const frozen: IssuedDocument = {
      schemaVersion: 2, paper: spec.paper, scale: spec.scale, spec, productionName: scenes[0]!.productionName,
      issuedAt: issuedAt.toISOString(), scenes: frozenScenes,
    };
    const id = newPreparationId();
    const row = {
      id, workspaceId: request.params.workspaceId, kind: spec.kind === 'package' || spec.scenes.length > 1 ? 'package' as const : 'scene' as const,
      sceneId: spec.scenes.length === 1 ? spec.scenes[0]!.sceneId : null,
      productionId: scenes[0]!.productionId, status: 'queued' as const, revisionName: spec.revisionName,
      spec, frozen, fingerprint: sourceFingerprint(spec, scenes.map(scene => ({ sceneId: scene.id, revision: scene.revision, venueVersionId: scene.venueVersionId, layout: scene.layout, venue: scene.venue }))), manifest: null, storageKey: null, error: null,
      stage: 'queued', pageCount: null, metrics: null, queuedAt: issuedAt, startedAt: null, finishedAt: null,
      expiresAt: preparationExpiry(issuedAt), issuedRevisionId: null,
    };
    await db.insert(exportPreparation).values(row);
    const captured = decodeViewImages(viewImages);
    enqueuePreparation(db, storage, id, async () => captured);
    return reply.code(201).send(asJob({ ...row, queuedAt: issuedAt, expiresAt: row.expiresAt }));
  });

  api.get('/api/workspaces/:workspaceId/documents/:documentId', {
    schema: { params: item, response: { 200: jobSchema, ...errors } },
  }, async request => {
    await access(request, request.params.workspaceId);
    return asJob(await loadJob(request.params.workspaceId, request.params.documentId));
  });

  api.get('/api/workspaces/:workspaceId/documents/:documentId/file', {
    schema: { params: item, hide: true },
  }, async (request, reply) => {
    await access(request, request.params.workspaceId);
    const row = await loadJob(request.params.workspaceId, request.params.documentId);
    if (row.status !== 'ready' && row.status !== 'issued' || !row.storageKey) {
      return reply.code(409).send({ message: 'Die Vorschau ist noch nicht als PDF verfügbar.' });
    }
    return reply.type('application/pdf').header('Content-Disposition', 'inline').send(await storage.get(row.storageKey));
  });

  api.post('/api/workspaces/:workspaceId/documents/:documentId/cancel', {
    schema: { params: item, response: { 200: jobSchema, ...errors } },
  }, async request => {
    if (request.headers.origin !== origin) throw new AccessError(403, 'Ungültiger Ursprung.');
    await access(request, request.params.workspaceId, 'exports');
    const row = await loadJob(request.params.workspaceId, request.params.documentId);
    cancelPreparation(row.id);
    if (row.status === 'queued' || row.status === 'rendering') {
      const [updated] = await db.update(exportPreparation).set({ status: 'cancelled', stage: 'cancelled', error: 'Die Vorbereitung wurde abgebrochen.' })
        .where(eq(exportPreparation.id, row.id)).returning();
      return asJob(updated ?? row);
    }
    return asJob(row);
  });

  api.post('/api/workspaces/:workspaceId/documents/:documentId/retry', {
    schema: { params: item, response: { 200: jobSchema, ...errors } },
  }, async request => {
    if (request.headers.origin !== origin) throw new AccessError(403, 'Ungültiger Ursprung.');
    await access(request, request.params.workspaceId, 'exports');
    const row = await loadJob(request.params.workspaceId, request.params.documentId);
    if (!isIssuedDocument(row.frozen)) throw new AccessError(409, 'Diese Vorbereitung kann nicht erneut gerendert werden.');
    await db.update(exportPreparation).set({ status: 'queued', stage: 'queued', error: null, queuedAt: new Date() }).where(eq(exportPreparation.id, row.id));
    enqueuePreparation(db, storage, row.id);
    return asJob(await loadJob(request.params.workspaceId, row.id));
  });

  api.post('/api/workspaces/:workspaceId/documents/:documentId/issue', {
    schema: { params: item, response: { 201: exportRevisionSchema, ...errors } },
  }, async (request, reply) => {
    if (request.headers.origin !== origin) throw new AccessError(403, 'Ungültiger Ursprung.');
    await access(request, request.params.workspaceId, 'exports');
    const row = await loadJob(request.params.workspaceId, request.params.documentId);
    if (row.status === 'issued' && row.issuedRevisionId) {
      return reply.code(201).send({
        id: row.issuedRevisionId, name: row.revisionName, paper: (row.frozen as IssuedDocument).paper,
        scale: (row.frozen as IssuedDocument).scale, status: 'ready' as const, createdAt: row.queuedAt.toISOString(),
      });
    }
    if (row.status === 'expired') throw new AccessError(409, 'Die Vorschau ist abgelaufen. Bitte erneut vorbereiten.');
    if (row.status !== 'ready' || !row.storageKey || !isIssuedDocument(row.frozen)) {
      throw new AccessError(409, 'Die Vorschau ist noch nicht fertig.');
    }
    const spec = exportDocumentSpecSchema.parse(row.spec);
    const scenes = await loadScenes(request.params.workspaceId, spec.scenes.map(item => item.sceneId));
    if (sourceFingerprint(spec, scenes.map(scene => ({ sceneId: scene.id, revision: scene.revision, venueVersionId: scene.venueVersionId, layout: scene.layout, venue: scene.venue }))) !== row.fingerprint) {
      throw new AccessError(409, 'Die Quelle hat sich geändert. Bitte die Vorschau aktualisieren.');
    }
    const issuedId = randomUUID();
    const pdf = await storage.get(row.storageKey);
    if (row.kind === 'package') {
      const storageKey = `${row.workspaceId}/packages/${issuedId}.pdf`;
      await storage.put(storageKey, pdf);
      await db.insert(constructionPackage).values({
        id: issuedId, workspaceId: row.workspaceId, productionId: row.productionId!, name: row.revisionName,
        scale: row.frozen.scale, status: 'ready', snapshot: row.frozen as never, storageKey, createdAt: new Date(row.frozen.issuedAt),
      });
    } else {
      const storageKey = `${row.workspaceId}/${issuedId}.pdf`;
      await storage.put(storageKey, pdf);
      await db.insert(constructionPlanRevision).values({
        id: issuedId, workspaceId: row.workspaceId, sceneId: row.sceneId!, name: row.revisionName,
        scale: row.frozen.scale, status: 'ready', snapshot: row.frozen as never, storageKey, createdAt: new Date(row.frozen.issuedAt),
      });
    }
    await db.update(exportPreparation).set({ status: 'issued', stage: 'issued', issuedRevisionId: issuedId, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) })
      .where(eq(exportPreparation.id, row.id));
    return reply.code(201).send({
      id: issuedId, name: row.revisionName, paper: row.frozen.paper, scale: row.frozen.scale,
      status: 'ready' as const, createdAt: row.frozen.issuedAt,
    });
  });
}

export async function pdfForStoredSnapshot(snapshot: unknown) {
  if (!isIssuedDocument(snapshot)) return undefined;
  return renderIssuedDocument(snapshot);
}
