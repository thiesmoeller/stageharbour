import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorSchema, workspaceParamsSchema } from '../../shared/contracts.js';
import { createSceneSchema, saveLayoutSchema, sceneSchema, sceneListSchema } from '../../shared/layout.js';
import type { Database } from '../db/connection.js';
import { adaptation, production, scene, venue, venueVersion } from '../db/schema.js';
import { AccessError, type createAccess } from '../identity/access.js';

export function registerProductionRoutes(app: FastifyInstance, db: Database, access: ReturnType<typeof createAccess>, origin: string) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const path = '/api/workspaces/:workspaceId/scenes';
  const params = workspaceParamsSchema.extend({ sceneId: z.uuid() });
  const errors = { 400: errorSchema, 401: errorSchema, 403: errorSchema, 404: errorSchema, 409: errorSchema };
  function readScenes(workspaceId: string, sceneId?: string) {
    return db.select({ id: scene.id, name: scene.name, productionName: production.name, venueName: venue.name,
      revision: scene.revision, venueVersionId: venueVersion.id, venue: venueVersion.geometry, layout: scene.layout })
      .from(scene).innerJoin(adaptation, eq(scene.adaptationId, adaptation.id))
      .innerJoin(production, eq(adaptation.productionId, production.id))
      .innerJoin(venueVersion, eq(adaptation.venueVersionId, venueVersion.id))
      .innerJoin(venue, eq(venueVersion.venueId, venue.id))
      .where(and(eq(scene.workspaceId, workspaceId), sceneId ? eq(scene.id, sceneId) : undefined)).orderBy(production.name, scene.name);
  }
  api.get(path, { schema: { params: workspaceParamsSchema, response: { 200: sceneListSchema, ...errors } } }, async request => {
    await access(request, request.params.workspaceId);
    return readScenes(request.params.workspaceId);
  });
  api.get(`${path}/:sceneId`, { schema: { params, response: { 200: sceneSchema, ...errors } } }, async request => {
    await access(request, request.params.workspaceId);
    const [record] = await readScenes(request.params.workspaceId, request.params.sceneId);
    if (!record) throw new AccessError(404, 'Szene nicht verfügbar.');
    return record;
  });
  api.post(path, { schema: { params: workspaceParamsSchema, body: createSceneSchema, response: { 201: sceneSchema, ...errors } } }, async (request, reply) => {
    if (request.headers.origin !== origin) throw new AccessError(403, 'Ungültiger Ursprung.');
    const { workspaceId } = request.params;
    await access(request, workspaceId, ['administrator', 'editor']);
    const input = request.body;
    const ids = { venue: randomUUID(), version: randomUUID(), production: randomUUID(), adaptation: randomUUID(), scene: randomUUID() };
    await db.transaction(async tx => {
      await tx.insert(venue).values({ id: ids.venue, workspaceId, name: input.venueName });
      await tx.insert(venueVersion).values({ id: ids.version, workspaceId, venueId: ids.venue, geometry: { schemaVersion: 1, width: input.width, depth: input.depth } });
      await tx.insert(production).values({ id: ids.production, workspaceId, name: input.productionName });
      await tx.insert(adaptation).values({ id: ids.adaptation, workspaceId, productionId: ids.production, venueVersionId: ids.version });
      await tx.insert(scene).values({ id: ids.scene, workspaceId, adaptationId: ids.adaptation, name: input.sceneName, layout: { schemaVersion: 1, walls: [] } });
    });
    const [record] = await readScenes(workspaceId, ids.scene);
    return reply.code(201).send(record!);
  });
  api.put(`${path}/:sceneId/layout`, { bodyLimit: 128 * 1024, schema: { params, body: saveLayoutSchema,
    response: { 200: z.object({ revision: z.number().int() }), ...errors } } }, async (request, reply) => {
    if (request.headers.origin !== origin) throw new AccessError(403, 'Ungültiger Ursprung.');
    const { workspaceId, sceneId } = request.params;
    await access(request, workspaceId, ['administrator', 'editor']);
    const [updated] = await db.update(scene).set({ layout: request.body.layout, revision: sql`${scene.revision} + 1` })
      .where(and(eq(scene.workspaceId, workspaceId), eq(scene.id, sceneId), eq(scene.revision, request.body.revision)))
      .returning({ revision: scene.revision });
    if (updated) return updated;
    const [existing] = await db.select({ id: scene.id }).from(scene).where(and(eq(scene.workspaceId, workspaceId), eq(scene.id, sceneId)));
    if (!existing) throw new AccessError(404, 'Szene nicht verfügbar.');
    return reply.code(409).send({ message: 'Die Szene wurde inzwischen geändert. Ihre lokalen Änderungen bleiben erhalten.' });
  });
}
