import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorSchema, workspaceParamsSchema } from '../../shared/contracts.js';
import { createSceneSchema, copySceneSchema, duplicateSceneSchema, saveLayoutSchema, sceneSchema, sceneListSchema, venueGeometrySchema } from '../../shared/layout.js';
import { copiedSceneName, copyLayoutIntoVenue, duplicateLayout } from '../../shared/scenes.js';
import { overheadClearance, overheadWarningSchema } from '../../shared/overhead.js';
import { keepClearWarningSchema, keepClearWarnings } from '../../shared/keepClear.js';
import { leaseHolderSchema } from '../../shared/leases.js';
import type { Database } from '../db/connection.js';
import { adaptation, production, scene, venue, venueVersion } from '../db/schema.js';
import { AccessError, type createAccess } from '../identity/access.js';
import { LeaseError, type Leases } from './leases.js';

export function registerProductionRoutes(app: FastifyInstance, db: Database, access: ReturnType<typeof createAccess>, origin: string, leases: Leases) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const path = '/api/workspaces/:workspaceId/scenes';
  const params = workspaceParamsSchema.extend({ sceneId: z.uuid() });
  const errors = { 400: errorSchema, 401: errorSchema, 403: errorSchema, 404: errorSchema, 409: errorSchema, 423: errorSchema };
  function readScenes(workspaceId: string, sceneId?: string) {
    return db.select({
      id: scene.id, name: scene.name, productionName: production.name, venueName: venue.name,
      productionId: production.id, venueId: venue.id, revision: scene.revision,
      venueVersionId: venueVersion.id, venue: venueVersion.geometry, layout: scene.layout,
    })
      .from(scene).innerJoin(adaptation, eq(scene.adaptationId, adaptation.id))
      .innerJoin(production, eq(adaptation.productionId, production.id))
      .innerJoin(venueVersion, eq(adaptation.venueVersionId, venueVersion.id))
      .innerJoin(venue, eq(venueVersion.venueId, venue.id))
      .where(and(eq(scene.workspaceId, workspaceId), sceneId ? eq(scene.id, sceneId) : undefined)).orderBy(production.name, scene.name);
  }
  async function withLease<T extends { id: string }>(workspaceId: string, record: T) {
    return { ...record, lease: await leases.read(workspaceId, 'scene', record.id) };
  }
  async function requireEditor(request: Parameters<typeof access>[0], workspaceId: string) {
    if (request.headers.origin !== origin) throw new AccessError(403, 'Ungültiger Ursprung.');
    return access(request, workspaceId, ['administrator', 'editor']);
  }
  api.get(path, { schema: { params: workspaceParamsSchema, response: { 200: sceneListSchema, ...errors } } }, async request => {
    await access(request, request.params.workspaceId);
    const holders = await leases.holders(request.params.workspaceId, 'scene');
    return (await readScenes(request.params.workspaceId)).map(record => ({ ...record, lease: holders.get(record.id) ?? null }));
  });
  api.get(`${path}/:sceneId`, { schema: { params, response: { 200: sceneSchema, ...errors } } }, async request => {
    await access(request, request.params.workspaceId);
    const [record] = await readScenes(request.params.workspaceId, request.params.sceneId);
    if (!record) throw new AccessError(404, 'Szene nicht verfügbar.');
    return withLease(request.params.workspaceId, record);
  });
  api.post(path, { schema: { params: workspaceParamsSchema, body: createSceneSchema, response: { 201: sceneSchema, ...errors } } }, async (request, reply) => {
    const { workspaceId } = request.params;
    await requireEditor(request, workspaceId);
    const input = request.body;
    const ids = { venue: randomUUID(), version: randomUUID(), production: randomUUID(), adaptation: randomUUID(), scene: randomUUID() };
    await db.transaction(async tx => {
      await tx.insert(venue).values({ id: ids.venue, workspaceId, name: input.venueName });
      await tx.insert(venueVersion).values({ id: ids.version, workspaceId, venueId: ids.venue, geometry: { schemaVersion: 1, width: input.width, depth: input.depth } });
      await tx.insert(production).values({ id: ids.production, workspaceId, name: input.productionName });
      await tx.insert(adaptation).values({ id: ids.adaptation, workspaceId, productionId: ids.production, venueVersionId: ids.version });
      await tx.insert(scene).values({ id: ids.scene, workspaceId, adaptationId: ids.adaptation, name: input.sceneName, layout: { schemaVersion: 1, walls: [], braces: [] } });
    });
    const [record] = await readScenes(workspaceId, ids.scene);
    return reply.code(201).send({ ...record!, lease: null });
  });
  // Duplicating reads the source without acquiring its lease: the source is only
  // copied. Layout PUT still requires POST .../lease first; freeze does not.
  // The copy starts unleased; later edits acquire a lease on the new scene id.
  api.post(`${path}/:sceneId/duplicate`, { schema: { params, body: duplicateSceneSchema, response: { 201: sceneSchema, ...errors } } }, async (request, reply) => {
    const { workspaceId, sceneId } = request.params;
    await requireEditor(request, workspaceId);
    const [existing] = await db.select({
      id: scene.id, name: scene.name, adaptationId: scene.adaptationId, layout: scene.layout,
    }).from(scene).where(and(eq(scene.workspaceId, workspaceId), eq(scene.id, sceneId)));
    if (!existing) throw new AccessError(404, 'Szene nicht verfügbar.');
    const copyId = randomUUID();
    await db.insert(scene).values({
      id: copyId, workspaceId, adaptationId: existing.adaptationId,
      name: request.body.sceneName ?? copiedSceneName(existing.name),
      layout: duplicateLayout(existing.layout, randomUUID),
    });
    const [record] = await readScenes(workspaceId, copyId);
    return reply.code(201).send({ ...record!, lease: null });
  });
  // Copying reads the source without acquiring its lease: the source is only
  // copied into a destination venue. Layout PUT still requires POST .../lease
  // first; freeze does not. The copy starts unleased on the destination
  // adaptation. Source venue outlines, permanent equipment and constraints stay
  // behind; movable pieces transfer and panel assignments are cleared.
  api.post(`${path}/:sceneId/copy`, { schema: { params, body: copySceneSchema, response: { 201: sceneSchema, ...errors } } }, async (request, reply) => {
    const { workspaceId, sceneId } = request.params;
    await requireEditor(request, workspaceId);
    const copyId = randomUUID();
    await db.transaction(async tx => {
      const [existing] = await tx.select({
        id: scene.id, name: scene.name, layout: scene.layout,
      }).from(scene).where(and(eq(scene.workspaceId, workspaceId), eq(scene.id, sceneId)));
      if (!existing) throw new AccessError(404, 'Szene nicht verfügbar.');
      const [destProduction] = await tx.select({ id: production.id }).from(production)
        .where(and(eq(production.workspaceId, workspaceId), eq(production.id, request.body.productionId)));
      if (!destProduction) throw new AccessError(404, 'Produktion nicht verfügbar.');
      const [destVersion] = await tx.select({ id: venueVersion.id, geometry: venueVersion.geometry }).from(venueVersion)
        .where(and(eq(venueVersion.workspaceId, workspaceId), eq(venueVersion.id, request.body.venueVersionId)));
      if (!destVersion) throw new AccessError(404, 'Spielstätte nicht verfügbar.');
      const [existingAdaptation] = await tx.select({ id: adaptation.id }).from(adaptation).where(and(
        eq(adaptation.workspaceId, workspaceId),
        eq(adaptation.productionId, destProduction.id),
        eq(adaptation.venueVersionId, destVersion.id),
      ));
      const adaptationId = existingAdaptation?.id ?? randomUUID();
      if (!existingAdaptation) {
        await tx.insert(adaptation).values({
          id: adaptationId, workspaceId, productionId: destProduction.id, venueVersionId: destVersion.id,
        });
      }
      await tx.insert(scene).values({
        id: copyId, workspaceId, adaptationId,
        name: request.body.sceneName ?? copiedSceneName(existing.name),
        layout: copyLayoutIntoVenue(
          existing.layout, venueGeometrySchema.parse(destVersion.geometry), request.body.surfaceMap ?? {}, randomUUID,
        ).layout,
      });
    });
    const [record] = await readScenes(workspaceId, copyId);
    return reply.code(201).send({ ...record!, lease: null });
  });
  api.post(`${path}/:sceneId/lease`, { schema: { params, response: { 200: leaseHolderSchema, ...errors } } }, async request => {
    const { user } = await requireEditor(request, request.params.workspaceId);
    const [record] = await readScenes(request.params.workspaceId, request.params.sceneId);
    if (!record) throw new AccessError(404, 'Szene nicht verfügbar.');
    const result = await leases.acquire(request.params.workspaceId, 'scene', request.params.sceneId, { id: user.id, name: user.name });
    if (!result.acquired) throw new LeaseError(423, `Wird bereits von ${result.lease.holderName} bearbeitet.`);
    return result.lease;
  });
  api.post(`${path}/:sceneId/lease/heartbeat`, { schema: { params, response: { 200: z.object({ ok: z.literal(true) }), ...errors } } }, async request => {
    const { user } = await requireEditor(request, request.params.workspaceId);
    await leases.heartbeat(request.params.workspaceId, 'scene', request.params.sceneId, user.id);
    return { ok: true as const };
  });
  api.post(`${path}/:sceneId/lease/release`, { schema: { params, response: { 200: z.object({ ok: z.literal(true) }), ...errors } } }, async request => {
    const { user } = await requireEditor(request, request.params.workspaceId);
    await leases.release(request.params.workspaceId, 'scene', request.params.sceneId, user.id);
    return { ok: true as const };
  });
  api.put(`${path}/:sceneId/layout`, { bodyLimit: 128 * 1024, schema: { params, body: saveLayoutSchema,
    response: { 200: z.object({ revision: z.number().int(), warnings: z.array(z.union([overheadWarningSchema, keepClearWarningSchema])) }), ...errors } } }, async (request, reply) => {
    const { workspaceId, sceneId } = request.params;
    const { user } = await requireEditor(request, workspaceId);
    const result = await db.transaction(async tx => {
      const [existing] = await tx.select({ id: scene.id, venue: venueVersion.geometry }).from(scene)
        .innerJoin(adaptation, eq(scene.adaptationId, adaptation.id))
        .innerJoin(venueVersion, eq(adaptation.venueVersionId, venueVersion.id))
        .where(and(eq(scene.workspaceId, workspaceId), eq(scene.id, sceneId)));
      if (!existing) throw new AccessError(404, 'Szene nicht verfügbar.');
      await leases.requireHeld(tx, workspaceId, 'scene', sceneId, user.id);
      const [updated] = await tx.update(scene).set({ layout: request.body.layout, revision: sql`${scene.revision} + 1` })
        .where(and(eq(scene.workspaceId, workspaceId), eq(scene.id, sceneId), eq(scene.revision, request.body.revision)))
        .returning({ revision: scene.revision });
      if (!updated) return undefined;
      const venue = venueGeometrySchema.parse(existing.venue);
      return {
        revision: updated.revision,
        warnings: [...overheadClearance(request.body.layout, venue), ...keepClearWarnings(venue, request.body.layout)],
      };
    });
    if (result) return result;
    return reply.code(409).send({ message: 'Die Szene wurde inzwischen geändert. Ihre lokalen Änderungen bleiben erhalten.' });
  });
}
