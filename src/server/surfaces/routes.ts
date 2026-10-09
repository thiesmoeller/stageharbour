import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createSurfaceSchema, importCatalogSurfaceSchema, surfaceCatalogSchema, surfaceFileResultSchema,
  surfaceListSchema, surfaceRecordSchema, updateSurfaceSchema, type SurfaceDefinition,
} from '../../shared/surfaceRegistry.js';
import { errorSchema, workspaceParamsSchema } from '../../shared/contracts.js';
import type { Database } from '../db/connection.js';
import { production, surfaceDefinition as surfaceTable, surfaceTextureFile } from '../db/schema.js';
import type { FileStorage } from '../exports/storage.js';
import { AccessError, type createAccess } from '../identity/access.js';
import { originalFileName } from '../venues/files.js';
import { inspectSurfaceTexture, MAX_SURFACE_TEXTURE_BYTES } from './files.js';
import { createPolyHavenClient, type SurfaceCatalogClient } from './polyHaven.js';

export function registerSurfaceRoutes(
  app: FastifyInstance,
  db: Database,
  access: ReturnType<typeof createAccess>,
  origin: string,
  storage: FileStorage,
  catalog: SurfaceCatalogClient = createPolyHavenClient(),
) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const path = '/api/workspaces/:workspaceId/surfaces';
  const itemParams = workspaceParamsSchema.extend({ surfaceId: z.uuid() });
  const fileParams = workspaceParamsSchema.extend({ fileId: z.uuid() });
  const query = z.object({ productionId: z.uuid().optional() });
  const errors = { 400: errorSchema, 401: errorSchema, 403: errorSchema, 404: errorSchema, 503: errorSchema };
  for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
    if (!app.hasContentTypeParser(type)) {
      app.addContentTypeParser(type, { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
    }
  }
  const record = (row: typeof surfaceTable.$inferSelect) => ({
    id: row.id,
    workspaceId: row.workspaceId,
    productionId: row.productionId,
    scope: row.productionId ? 'production' as const : 'workspace' as const,
    name: row.name,
    description: row.description,
    definition: row.definition,
    archived: row.archived,
  });
  async function editor(request: Parameters<typeof access>[0], workspaceId: string) {
    if (request.headers.origin !== origin) throw new AccessError(403, 'Ungültiger Ursprung.');
    return access(request, workspaceId, 'inventory');
  }
  async function requireProduction(workspaceId: string, productionId: string | undefined) {
    if (!productionId) return;
    const [found] = await db.select({ id: production.id }).from(production)
      .where(and(eq(production.workspaceId, workspaceId), eq(production.id, productionId)));
    if (!found) throw new AccessError(400, 'Produktion nicht verfügbar.');
  }
  async function requireFiles(workspaceId: string, definition: SurfaceDefinition) {
    const ids = [...new Set(Object.values(definition.maps).filter((id): id is string => !!id))];
    const files = await db.select({ id: surfaceTextureFile.id }).from(surfaceTextureFile)
      .where(and(eq(surfaceTextureFile.workspaceId, workspaceId), inArray(surfaceTextureFile.id, ids)));
    if (files.length !== ids.length) throw new AccessError(400, 'Mindestens eine Texturdatei ist nicht verfügbar.');
  }

  api.get(`${path}/catalog/poly-haven`, {
    schema: {
      params: workspaceParamsSchema,
      querystring: z.object({ q: z.string().trim().max(80).default('') }),
      response: { 200: surfaceCatalogSchema, ...errors },
    },
  }, async request => {
    await access(request, request.params.workspaceId);
    try {
      return await catalog.search(request.query.q);
    } catch {
      throw new AccessError(503, 'Poly Haven ist vorübergehend nicht erreichbar.');
    }
  });

  api.post(`${path}/import/poly-haven`, {
    schema: {
      params: workspaceParamsSchema,
      body: importCatalogSurfaceSchema,
      response: { 201: surfaceRecordSchema, ...errors },
    },
  }, async (request, reply) => {
    await editor(request, request.params.workspaceId);
    await requireProduction(request.params.workspaceId, request.body.productionId);
    let imported;
    try {
      imported = await catalog.download(request.body.assetId, request.body.resolution);
    } catch {
      throw new AccessError(503, 'Das Material konnte nicht von Poly Haven importiert werden.');
    }
    const stored: Array<{ kind: string; id: string; key: string }> = [];
    try {
      for (const [kind, texture] of Object.entries(imported.maps)) {
        if (!texture) continue;
        const fileId = randomUUID();
        const extension = texture.mediaType === 'image/png' ? 'png' : texture.mediaType === 'image/webp' ? 'webp' : 'jpg';
        const storageKey = `${request.params.workspaceId}/surfaces/${fileId}.${extension}`;
        await storage.put(storageKey, texture.bytes);
        await db.insert(surfaceTextureFile).values({
          id: fileId,
          workspaceId: request.params.workspaceId,
          mediaType: texture.mediaType,
          originalName: `${request.body.assetId}_${kind}_${request.body.resolution}.${extension}`,
          storageKey,
          pixelWidth: texture.pixelWidth,
          pixelHeight: texture.pixelHeight,
        });
        stored.push({ kind, id: fileId, key: storageKey });
      }
      const maps = Object.fromEntries(stored.map(file => [file.kind, file.id]));
      const [created] = await db.insert(surfaceTable).values({
        id: randomUUID(),
        workspaceId: request.params.workspaceId,
        productionId: request.body.scope === 'production' ? request.body.productionId! : null,
        name: imported.item.name,
        description: (`Poly Haven · CC0 · https://polyhaven.com/a/${imported.item.id}\n${imported.item.description}`).slice(0, 500),
        definition: {
          workflow: 'metallic-roughness',
          tileWidthMm: imported.item.tileWidthMm,
          tileHeightMm: imported.item.tileHeightMm,
          maps: maps as SurfaceDefinition['maps'],
          baseColorFactor: '#ffffff',
          roughnessFactor: 1,
          metallicFactor: imported.maps.orm || imported.maps.metalness ? 1 : 0,
          normalScale: 1,
          displacementScaleMm: 0,
          normalConvention: 'opengl',
        },
      }).returning();
      return reply.code(201).send(record(created!));
    } catch (error) {
      if (stored.length) {
        await db.delete(surfaceTextureFile).where(inArray(surfaceTextureFile.id, stored.map(file => file.id)));
        await Promise.all(stored.map(file => storage.remove?.(file.key)));
      }
      throw error;
    }
  });

  api.get(path, {
    schema: { params: workspaceParamsSchema, querystring: query, response: { 200: surfaceListSchema, ...errors } },
  }, async request => {
    await access(request, request.params.workspaceId);
    const scope = request.query.productionId
      ? or(isNull(surfaceTable.productionId), eq(surfaceTable.productionId, request.query.productionId))
      : isNull(surfaceTable.productionId);
    const rows = await db.select().from(surfaceTable).where(and(
      eq(surfaceTable.workspaceId, request.params.workspaceId),
      scope,
    )).orderBy(surfaceTable.name);
    return rows.map(record);
  });

  api.post(path, {
    schema: { params: workspaceParamsSchema, body: createSurfaceSchema, response: { 201: surfaceRecordSchema, ...errors } },
  }, async (request, reply) => {
    await editor(request, request.params.workspaceId);
    await requireProduction(request.params.workspaceId, request.body.productionId);
    await requireFiles(request.params.workspaceId, request.body.definition);
    const [created] = await db.insert(surfaceTable).values({
      id: randomUUID(),
      workspaceId: request.params.workspaceId,
      productionId: request.body.scope === 'production' ? request.body.productionId! : null,
      name: request.body.name,
      description: request.body.description,
      definition: request.body.definition,
    }).returning();
    return reply.code(201).send(record(created!));
  });

  api.patch(`${path}/:surfaceId`, {
    schema: { params: itemParams, body: updateSurfaceSchema, response: { 200: surfaceRecordSchema, ...errors } },
  }, async request => {
    await editor(request, request.params.workspaceId);
    if (request.body.definition) await requireFiles(request.params.workspaceId, request.body.definition);
    const rows = await db.update(surfaceTable).set({ ...request.body, updatedAt: new Date() }).where(and(
      eq(surfaceTable.workspaceId, request.params.workspaceId),
      eq(surfaceTable.id, request.params.surfaceId),
      eq(surfaceTable.archived, false),
    )).returning();
    if (!rows.length) throw new AccessError(404, 'Oberfläche nicht verfügbar.');
    return record(rows[0]!);
  });

  api.delete(`${path}/:surfaceId`, {
    schema: { params: itemParams, response: { 200: z.object({ ok: z.literal(true) }), ...errors } },
  }, async request => {
    await editor(request, request.params.workspaceId);
    const rows = await db.update(surfaceTable).set({ archived: true, updatedAt: new Date() }).where(and(
      eq(surfaceTable.workspaceId, request.params.workspaceId),
      eq(surfaceTable.id, request.params.surfaceId),
      eq(surfaceTable.archived, false),
    )).returning({ id: surfaceTable.id });
    if (!rows.length) throw new AccessError(404, 'Oberfläche nicht verfügbar.');
    return { ok: true as const };
  });

  api.post(`${path}/files`, {
    bodyLimit: MAX_SURFACE_TEXTURE_BYTES,
    schema: { params: workspaceParamsSchema, response: { 201: surfaceFileResultSchema, ...errors } },
  }, async (request, reply) => {
    await editor(request, request.params.workspaceId);
    if (!Buffer.isBuffer(request.body)) throw new AccessError(400, 'Bitte eine PNG-, JPEG- oder WebP-Textur hochladen.');
    let inspected;
    try {
      inspected = inspectSurfaceTexture(request.body, request.headers['content-type'] ?? '');
    } catch {
      throw new AccessError(400, 'Ungültige Textur. Erlaubt sind PNG, JPEG und WebP bis 16 MB und 16.384 px.');
    }
    const fileId = randomUUID();
    const extension = inspected.mediaType === 'image/png' ? 'png' : inspected.mediaType === 'image/webp' ? 'webp' : 'jpg';
    const storageKey = `${request.params.workspaceId}/surfaces/${fileId}.${extension}`;
    await storage.put(storageKey, request.body);
    await db.insert(surfaceTextureFile).values({
      id: fileId,
      workspaceId: request.params.workspaceId,
      mediaType: inspected.mediaType,
      originalName: originalFileName(request.headers['x-file-name']),
      storageKey,
      pixelWidth: inspected.pixelWidth,
      pixelHeight: inspected.pixelHeight,
    });
    return reply.code(201).send({ fileId, ...inspected });
  });

  api.get(`${path}/files/:fileId`, {
    schema: { params: fileParams, hide: true },
  }, async (request, reply) => {
    await access(request, request.params.workspaceId);
    const [file] = await db.select().from(surfaceTextureFile).where(and(
      eq(surfaceTextureFile.workspaceId, request.params.workspaceId),
      eq(surfaceTextureFile.id, request.params.fileId),
    ));
    if (!file) throw new AccessError(404, 'Texturdatei nicht verfügbar.');
    return reply.type(file.mediaType).header('Cache-Control', 'private, max-age=31536000, immutable')
      .send(await storage.get(file.storageKey));
  });
}
