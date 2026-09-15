import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { assetListSchema, assetSchema, createAssetSchema } from '../../shared/assets.js';
import { errorSchema, workspaceParamsSchema } from '../../shared/contracts.js';
import type { Database } from '../db/connection.js';
import { assetFile, inventoryAsset } from '../db/schema.js';
import type { FileStorage } from '../exports/storage.js';
import { AccessError, type createAccess } from '../identity/access.js';
import { MAX_MODEL_BYTES, validateGlb } from './glb.js';

export function registerAssetRoutes(app: FastifyInstance, db: Database, access: ReturnType<typeof createAccess>, origin: string, storage: FileStorage) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const path = '/api/workspaces/:workspaceId/assets';
  const params = workspaceParamsSchema.extend({ assetId: z.uuid() });
  const fileParams = workspaceParamsSchema.extend({ fileId: z.uuid() });
  const errors = { 400: errorSchema, 401: errorSchema, 403: errorSchema, 404: errorSchema };
  const fields = { id: inventoryAsset.id, name: inventoryAsset.name, definition: inventoryAsset.definition, archived: inventoryAsset.archived };
  async function editor(request: Parameters<typeof access>[0], workspaceId: string) {
    if (request.headers.origin !== origin) throw new AccessError(403, 'Ungültiger Ursprung.');
    return access(request, workspaceId, ['administrator', 'editor']);
  }
  app.addContentTypeParser('model/gltf-binary', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
  api.get(path, { schema: { params: workspaceParamsSchema, response: { 200: assetListSchema, ...errors } } }, async request => {
    await access(request, request.params.workspaceId);
    // Archived definitions remain available to existing scene instances.
    return db.select(fields).from(inventoryAsset).where(eq(inventoryAsset.workspaceId, request.params.workspaceId)).orderBy(inventoryAsset.name);
  });
  api.post(path, { schema: { params: workspaceParamsSchema, body: createAssetSchema, response: { 201: assetSchema, ...errors } } }, async (request, reply) => {
    const { workspaceId } = request.params;
    await editor(request, workspaceId);
    const definition = request.body.definition;
    if (definition.kind === 'model' && definition.source.kind === 'upload') {
      const [file] = await db.select().from(assetFile).where(and(eq(assetFile.workspaceId, workspaceId), eq(assetFile.id, definition.source.fileId)));
      if (!file) throw new AccessError(400, 'Modelldatei nicht verfügbar.');
    }
    const [asset] = await db.insert(inventoryAsset).values({ id: randomUUID(), workspaceId, ...request.body }).returning(fields);
    return reply.code(201).send(asset!);
  });
  api.delete(`${path}/:assetId`, { schema: { params, response: { 200: z.object({ ok: z.literal(true) }), ...errors } } }, async request => {
    await editor(request, request.params.workspaceId);
    const rows = await db.update(inventoryAsset).set({ archived: true }).where(and(eq(inventoryAsset.workspaceId, request.params.workspaceId), eq(inventoryAsset.id, request.params.assetId))).returning({ id: inventoryAsset.id });
    if (!rows.length) throw new AccessError(404, 'Inventarobjekt nicht verfügbar.');
    return { ok: true as const };
  });
  api.post(`${path}/files`, { bodyLimit: MAX_MODEL_BYTES, schema: { params: workspaceParamsSchema, response: { 201: z.object({ fileId: z.uuid() }), ...errors } } }, async (request, reply) => {
    const { workspaceId } = request.params;
    await editor(request, workspaceId);
    if (!Buffer.isBuffer(request.body)) throw new AccessError(400, 'Bitte eine GLB-Datei hochladen.');
    try { validateGlb(request.body); } catch (cause) {
      const detail = cause instanceof Error ? cause.message : '';
      if (detail.includes('MB')) throw new AccessError(400, detail.replace(/^GLB exceeds /, 'Die Datei darf höchstens ').replace(/ MB$/, ' MB groß sein.'));
      throw new AccessError(400, 'Ungültige GLB-Datei. Texturen und Geometrie müssen in der Datei eingebettet sein.');
    }
    const fileId = randomUUID(), storageKey = `${workspaceId}/models/${fileId}.glb`;
    await storage.put(storageKey, request.body);
    await db.insert(assetFile).values({ id: fileId, workspaceId, storageKey });
    return reply.code(201).send({ fileId });
  });
  api.get(`${path}/files/:fileId`, { schema: { params: fileParams } }, async (request, reply) => {
    await access(request, request.params.workspaceId);
    const [file] = await db.select().from(assetFile).where(and(eq(assetFile.workspaceId, request.params.workspaceId), eq(assetFile.id, request.params.fileId)));
    if (!file) throw new AccessError(404, 'Modelldatei nicht verfügbar.');
    return reply.type('model/gltf-binary').send(await storage.get(file.storageKey));
  });
}
