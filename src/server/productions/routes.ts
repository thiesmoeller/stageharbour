import { snapshotPanelAssignments } from '../../shared/inventory.js';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorSchema, okSchema, workspaceParamsSchema } from '../../shared/contracts.js';
import { layoutSchema, captureTemplateSchema, createSceneSchema, copySceneSchema, duplicateSceneSchema, instantiateTemplateSchema, renameProductionSchema, renameSceneSchema, renameSceneTemplateSchema, saveLayoutSchema, sceneSchema, sceneListSchema, sceneTemplateListSchema, sceneTemplateSchema, sceneTemplateSummarySchema, venueGeometrySchema, wallCorners } from '../../shared/layout.js';
import { stripLayoutReportTemplates } from '../../shared/reportTemplate.js';
import { captureTemplateLayout, copiedSceneName, copyLayoutIntoVenue, duplicateLayout } from '../../shared/scenes.js';
import { overheadClearance, overheadWarningSchema } from '../../shared/overhead.js';
import { keepClearWarningSchema, keepClearWarnings } from '../../shared/keepClear.js';
import { leaseHolderSchema } from '../../shared/leases.js';
import { resolveWall } from '../../shared/wall-types.js';
import type { Database } from '../db/connection.js';
import {
  adaptation, constructionPackage, constructionPlanRevision, editingLease, inventoryAsset, inventoryPanel, production, scene, sceneTemplate, venue, venueVersion,
} from '../db/schema.js';
import { AccessError, type createAccess } from '../identity/access.js';
import { LeaseError, type Leases } from './leases.js';

export function registerProductionRoutes(app: FastifyInstance, db: Database, access: ReturnType<typeof createAccess>, origin: string, leases: Leases) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const path = '/api/workspaces/:workspaceId/scenes';
  const templatesPath = '/api/workspaces/:workspaceId/scene-templates';
  const params = workspaceParamsSchema.extend({ sceneId: z.uuid() });
  const templateParams = workspaceParamsSchema.extend({ templateId: z.uuid() });
  const errors = { 400: errorSchema, 401: errorSchema, 403: errorSchema, 404: errorSchema, 409: errorSchema, 423: errorSchema };
  api.post(`${path}/:sceneId/recover`, { bodyLimit: 128 * 1024, schema: {
    params, body: z.object({ name: z.string().trim().min(1).max(120), layout: layoutSchema,
      sourceSurfaces: z.array(z.object({ id: z.string(), label: z.string().max(120) })).max(250) }).strict(),
    response: { 201: sceneTemplateSchema, ...errors },
  } }, async (request, reply) => {
    const { workspaceId, sceneId } = request.params;
    await requireEditor(request, workspaceId);
    if (!(await loadScenes(workspaceId, sceneId)).length) throw new AccessError(404, 'Szene nicht verfügbar.');
    const assetIds = [...new Set((request.body.layout.placeholders ?? []).flatMap(item => item.assetId ? [item.assetId] : []))];
    if (assetIds.length) {
      const assets = await db.select().from(inventoryAsset).where(and(eq(inventoryAsset.workspaceId, workspaceId), inArray(inventoryAsset.id, assetIds)));
      if (assets.length !== assetIds.length || assets.some(asset => asset.definition.kind !== 'model')) throw new AccessError(400, 'Ein Modell ist in dieser Theatergruppe nicht verfügbar.');
    }
    const id = randomUUID();
    const record = { id, workspaceId, ...request.body, layout: captureTemplateLayout(request.body.layout) };
    await db.insert(sceneTemplate).values(record);
    return reply.code(201).send(record);
  });
  function readScenes(workspaceId: string, sceneId?: string) {
    return db.select({
      id: scene.id, name: scene.name, productionName: production.name, venueName: venue.name,
      productionId: production.id, venueId: venue.id, revision: scene.revision,
      venueVersionId: venueVersion.id, pinnedCreatedAt: venueVersion.createdAt,
      venue: venueVersion.geometry, layout: scene.layout,
    })
      .from(scene).innerJoin(adaptation, eq(scene.adaptationId, adaptation.id))
      .innerJoin(production, eq(adaptation.productionId, production.id))
      .innerJoin(venueVersion, eq(adaptation.venueVersionId, venueVersion.id))
      .innerJoin(venue, eq(venueVersion.venueId, venue.id))
      .where(and(eq(scene.workspaceId, workspaceId), sceneId ? eq(scene.id, sceneId) : undefined)).orderBy(production.name, scene.name);
  }
  function readTemplates(workspaceId: string, templateId?: string) {
    return db.select({
      id: sceneTemplate.id, name: sceneTemplate.name,
      layout: sceneTemplate.layout, sourceSurfaces: sceneTemplate.sourceSurfaces,
    }).from(sceneTemplate)
      .where(and(eq(sceneTemplate.workspaceId, workspaceId), templateId ? eq(sceneTemplate.id, templateId) : undefined))
      .orderBy(sceneTemplate.name);
  }
  async function withVenueUpdate<T extends { venueId: string; pinnedCreatedAt: Date }>(workspaceId: string, records: T[]) {
    if (!records.length) return [];
    const latest = await db.select({
      venueId: venueVersion.venueId,
      createdAt: sql<string>`max(${venueVersion.createdAt})`.as('createdAt'),
    }).from(venueVersion)
      .where(and(
        eq(venueVersion.workspaceId, workspaceId),
        inArray(venueVersion.venueId, [...new Set(records.map(record => record.venueId))]),
      ))
      .groupBy(venueVersion.venueId);
    const newest = new Map(latest.map(row => [row.venueId, new Date(row.createdAt).getTime()]));
    return records.map(({ pinnedCreatedAt, ...record }) => ({
      ...record,
      venueUpdateAvailable: (newest.get(record.venueId) ?? 0) > pinnedCreatedAt.getTime(),
    }));
  }
  async function loadScenes(workspaceId: string, sceneId?: string) {
    return withVenueUpdate(workspaceId, await readScenes(workspaceId, sceneId));
  }
  async function withLease<T extends { id: string }>(workspaceId: string, record: T) {
    return { ...record, lease: await leases.read(workspaceId, 'scene', record.id) };
  }
  async function requireEditor(request: Parameters<typeof access>[0], workspaceId: string) {
    if (request.headers.origin !== origin) throw new AccessError(403, 'Ungültiger Ursprung.');
    return access(request, workspaceId, 'scenes');
  }
  api.get(path, { schema: { params: workspaceParamsSchema, response: { 200: sceneListSchema, ...errors } } }, async request => {
    await access(request, request.params.workspaceId);
    const holders = await leases.holders(request.params.workspaceId, 'scene');
    return (await loadScenes(request.params.workspaceId)).map(record => {
      const venue = venueGeometrySchema.parse(record.venue);
      const layout = record.layout;
      return {
        id: record.id, name: record.name, productionName: record.productionName, venueName: record.venueName,
        productionId: record.productionId, venueId: record.venueId, venueVersionId: record.venueVersionId,
        venueUpdateAvailable: record.venueUpdateAvailable,
        lease: holders.get(record.id) ?? null,
        preview: {
          width: venue.width, depth: venue.depth,
          walls: (layout.walls ?? []).map(wall => ({
            corners: wallCorners(resolveWall(wall, layout.wallTypes ?? [])),
          })),
          platforms: [...(venue.platforms ?? []), ...(layout.platforms ?? [])].map(platform => ({ outline: platform.outline })),
        },
      };
    });
  });
  api.get(`${path}/:sceneId`, { schema: { params, response: { 200: sceneSchema, ...errors } } }, async request => {
    await access(request, request.params.workspaceId);
    const [record] = await loadScenes(request.params.workspaceId, request.params.sceneId);
    if (!record) throw new AccessError(404, 'Szene nicht verfügbar.');
    return withLease(request.params.workspaceId, record);
  });
  // Rename is metadata-only (like venues): no scene lease required.
  api.patch(`${path}/:sceneId`, { schema: { params, body: renameSceneSchema, response: { 200: sceneSchema, ...errors } } }, async request => {
    const { workspaceId, sceneId } = request.params;
    await requireEditor(request, workspaceId);
    const [updated] = await db.update(scene).set({ name: request.body.name })
      .where(and(eq(scene.workspaceId, workspaceId), eq(scene.id, sceneId)))
      .returning({ id: scene.id });
    if (!updated) throw new AccessError(404, 'Szene nicht verfügbar.');
    const [record] = await loadScenes(workspaceId, sceneId);
    return withLease(workspaceId, record!);
  });
  api.patch('/api/workspaces/:workspaceId/productions/:productionId', {
    schema: {
      params: workspaceParamsSchema.extend({ productionId: z.uuid() }),
      body: renameProductionSchema,
      response: { 200: z.object({ id: z.uuid(), name: z.string() }), ...errors },
    },
  }, async request => {
    const { workspaceId, productionId } = request.params;
    await requireEditor(request, workspaceId);
    const [updated] = await db.update(production).set({ name: request.body.name })
      .where(and(eq(production.workspaceId, workspaceId), eq(production.id, productionId)))
      .returning({ id: production.id, name: production.name });
    if (!updated) throw new AccessError(404, 'Produktion nicht verfügbar.');
    return updated;
  });
  api.post(path, { schema: { params: workspaceParamsSchema, body: createSceneSchema, response: { 201: sceneSchema, ...errors } } }, async (request, reply) => {
    const { workspaceId } = request.params;
    await requireEditor(request, workspaceId);
    const input = request.body;
    const ids: Record<'venue' | 'version' | 'production' | 'adaptation' | 'scene', string> = { venue: randomUUID(), version: randomUUID(), production: randomUUID(), adaptation: randomUUID(), scene: randomUUID() };
    await db.transaction(async tx => {
      if ('productionId' in input) {
        const [destProduction] = await tx.select({ id: production.id }).from(production)
          .where(and(eq(production.workspaceId, workspaceId), eq(production.id, input.productionId)));
        if (!destProduction) throw new AccessError(404, 'Produktion nicht verfügbar.');
        const [destVersion] = await tx.select({
          id: venueVersion.id, venueId: venueVersion.venueId,
        }).from(venueVersion)
          .where(and(eq(venueVersion.workspaceId, workspaceId), eq(venueVersion.id, input.venueVersionId)));
        if (!destVersion) throw new AccessError(404, 'Spielstätte nicht verfügbar.');
        const [existingAdaptation] = await tx.select({ id: adaptation.id }).from(adaptation)
          .innerJoin(venueVersion, eq(adaptation.venueVersionId, venueVersion.id))
          .where(and(
            eq(adaptation.workspaceId, workspaceId),
            eq(adaptation.productionId, destProduction.id),
            eq(venueVersion.venueId, destVersion.venueId),
          ));
        const adaptationId = existingAdaptation?.id ?? randomUUID();
        if (!existingAdaptation) {
          await tx.insert(adaptation).values({
            id: adaptationId, workspaceId, productionId: destProduction.id, venueVersionId: destVersion.id,
          });
        }
        await tx.insert(scene).values({
          id: ids.scene, workspaceId, adaptationId, name: input.sceneName,
          layout: { schemaVersion: 1, walls: [], braces: [] },
        });
        return;
      }
      if ('venueVersionId' in input) {
        const [selected] = await tx.select({ id: venueVersion.id }).from(venueVersion)
          .where(and(eq(venueVersion.workspaceId, workspaceId), eq(venueVersion.id, input.venueVersionId)));
        if (!selected) throw new AccessError(404, 'Spielstätte nicht verfügbar.');
        ids.version = selected.id;
      } else {
        await tx.insert(venue).values({ id: ids.venue, workspaceId, name: input.venueName });
        await tx.insert(venueVersion).values({ id: ids.version, workspaceId, venueId: ids.venue, geometry: { schemaVersion: 1, width: input.width, depth: input.depth } });
      }
      await tx.insert(production).values({ id: ids.production, workspaceId, name: input.productionName });
      await tx.insert(adaptation).values({ id: ids.adaptation, workspaceId, productionId: ids.production, venueVersionId: ids.version });
      await tx.insert(scene).values({ id: ids.scene, workspaceId, adaptationId: ids.adaptation, name: input.sceneName, layout: { schemaVersion: 1, walls: [], braces: [] } });
    });
    const [record] = await loadScenes(workspaceId, ids.scene);
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
    const [record] = await loadScenes(workspaceId, copyId);
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
      const [destVersion] = await tx.select({
        id: venueVersion.id, venueId: venueVersion.venueId, geometry: venueVersion.geometry,
      }).from(venueVersion)
        .where(and(eq(venueVersion.workspaceId, workspaceId), eq(venueVersion.id, request.body.venueVersionId)));
      if (!destVersion) throw new AccessError(404, 'Spielstätte nicht verfügbar.');
      const [existingAdaptation] = await tx.select({ id: adaptation.id }).from(adaptation)
        .innerJoin(venueVersion, eq(adaptation.venueVersionId, venueVersion.id))
        .where(and(
          eq(adaptation.workspaceId, workspaceId),
          eq(adaptation.productionId, destProduction.id),
          eq(venueVersion.venueId, destVersion.venueId),
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
    const [record] = await loadScenes(workspaceId, copyId);
    return reply.code(201).send({ ...record!, lease: null });
  });
  // Capturing reads the source without acquiring its lease: the source is only
  // snapshotted. Layout PUT still requires POST .../lease first; freeze does not.
  // Stored layout JSON includes wallTypes so later millimetre edits cannot change it.
  api.post(`${path}/:sceneId/templates`, { schema: { params, body: captureTemplateSchema, response: { 201: sceneTemplateSchema, ...errors } } }, async (request, reply) => {
    const { workspaceId, sceneId } = request.params;
    await requireEditor(request, workspaceId);
    const [existing] = await readScenes(workspaceId, sceneId);
    if (!existing) throw new AccessError(404, 'Szene nicht verfügbar.');
    const id = randomUUID();
    const layout = captureTemplateLayout(existing.layout);
    const sourceSurfaces = (existing.venue.platforms ?? []).map(platform => ({ id: platform.id, label: platform.label }));
    await db.insert(sceneTemplate).values({ id, workspaceId, name: request.body.name, layout, sourceSurfaces });
    return reply.code(201).send({ id, name: request.body.name, layout, sourceSurfaces });
  });
  api.get(templatesPath, { schema: { params: workspaceParamsSchema, response: { 200: sceneTemplateListSchema, ...errors } } }, async request => {
    await access(request, request.params.workspaceId);
    return (await readTemplates(request.params.workspaceId)).map(({ id, name }) => ({ id, name }));
  });
  api.get(`${templatesPath}/:templateId`, { schema: { params: templateParams, response: { 200: sceneTemplateSchema, ...errors } } }, async request => {
    await access(request, request.params.workspaceId);
    const [record] = await readTemplates(request.params.workspaceId, request.params.templateId);
    if (!record) throw new AccessError(404, 'Szenenvorlage nicht verfügbar.');
    return record;
  });
  api.patch(`${templatesPath}/:templateId`, {
    schema: { params: templateParams, body: renameSceneTemplateSchema, response: { 200: sceneTemplateSummarySchema, ...errors } },
  }, async request => {
    await requireEditor(request, request.params.workspaceId);
    const [updated] = await db.update(sceneTemplate).set({ name: request.body.name })
      .where(and(eq(sceneTemplate.workspaceId, request.params.workspaceId), eq(sceneTemplate.id, request.params.templateId)))
      .returning({ id: sceneTemplate.id, name: sceneTemplate.name });
    if (!updated) throw new AccessError(404, 'Szenenvorlage nicht verfügbar.');
    return updated;
  });
  // Instantiating reads the template without a lease. The new scene starts
  // unleased on the destination adaptation; panel assignments are cleared.
  api.post(`${templatesPath}/:templateId/instantiate`, { schema: { params: templateParams, body: instantiateTemplateSchema, response: { 201: sceneSchema, ...errors } } }, async (request, reply) => {
    const { workspaceId, templateId } = request.params;
    await requireEditor(request, workspaceId);
    const copyId = randomUUID();
    await db.transaction(async tx => {
      const [existing] = await tx.select({
        id: sceneTemplate.id, name: sceneTemplate.name, layout: sceneTemplate.layout,
      }).from(sceneTemplate).where(and(eq(sceneTemplate.workspaceId, workspaceId), eq(sceneTemplate.id, templateId)));
      if (!existing) throw new AccessError(404, 'Szenenvorlage nicht verfügbar.');
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
        name: request.body.sceneName ?? existing.name,
        layout: copyLayoutIntoVenue(
          existing.layout, venueGeometrySchema.parse(destVersion.geometry), request.body.surfaceMap ?? {}, randomUUID,
        ).layout,
      });
    });
    const [record] = await loadScenes(workspaceId, copyId);
    return reply.code(201).send({ ...record!, lease: null });
  });
  api.post(`${path}/:sceneId/lease`, { schema: { params, response: { 200: leaseHolderSchema, ...errors } } }, async request => {
    const { user } = await requireEditor(request, request.params.workspaceId);
    const [record] = await loadScenes(request.params.workspaceId, request.params.sceneId);
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
      const [existing] = await tx.select({ id: scene.id, layout: scene.layout, venue: venueVersion.geometry }).from(scene)
        .innerJoin(adaptation, eq(scene.adaptationId, adaptation.id))
        .innerJoin(venueVersion, eq(adaptation.venueVersionId, venueVersion.id))
        .where(and(eq(scene.workspaceId, workspaceId), eq(scene.id, sceneId)));
      if (!existing) throw new AccessError(404, 'Szene nicht verfügbar.');
      await leases.requireHeld(tx, workspaceId, 'scene', sceneId, user.id);
      const assetIds = [...new Set((request.body.layout.placeholders ?? []).flatMap(item => item.assetId ? [item.assetId] : []))];
      if (assetIds.length) {
        const assets = await tx.select().from(inventoryAsset).where(and(eq(inventoryAsset.workspaceId, workspaceId), inArray(inventoryAsset.id, assetIds)));
        if (assets.length !== assetIds.length || assets.some(asset => asset.definition.kind !== 'model')) throw new AccessError(400, 'Ein Modell ist in dieser Theatergruppe nicht verfügbar.');
      }
      const panelIds = [...new Set(request.body.layout.walls.flatMap(wall => wall.panelId ? [wall.panelId] : []))];
      if (panelIds.length) {
        await tx.select({ id: inventoryPanel.id }).from(inventoryPanel)
          .where(and(eq(inventoryPanel.workspaceId, workspaceId), inArray(inventoryPanel.id, panelIds))).for('share');
      }
      const layout = snapshotPanelAssignments(existing.layout, stripLayoutReportTemplates(request.body.layout), randomUUID);
      const [updated] = await tx.update(scene).set({ layout, revision: sql`${scene.revision} + 1` })
        .where(and(eq(scene.workspaceId, workspaceId), eq(scene.id, sceneId), eq(scene.revision, request.body.revision)))
        .returning({ revision: scene.revision });
      if (!updated) return undefined;
      const venue = venueGeometrySchema.parse(existing.venue);
      return {
        revision: updated.revision,
        warnings: [...overheadClearance(layout, venue), ...keepClearWarnings(venue, layout)],
      };
    });
    if (result) return result;
    return reply.code(409).send({ message: 'Die Szene wurde inzwischen geändert. Ihre lokalen Änderungen bleiben erhalten.' });
  });
  api.delete(`${path}/:sceneId`, { schema: { params, response: { 200: okSchema, ...errors } } }, async request => {
    const { workspaceId, sceneId } = request.params;
    const { user } = await requireEditor(request, workspaceId);
    await db.transaction(async tx => {
      await leases.requireAvailable(tx, workspaceId, 'scene', sceneId, user.id);
      const [existing] = await tx.select({
        id: scene.id, adaptationId: scene.adaptationId, productionId: production.id,
      }).from(scene).innerJoin(adaptation, eq(scene.adaptationId, adaptation.id))
        .innerJoin(production, eq(adaptation.productionId, production.id))
        .where(and(eq(scene.workspaceId, workspaceId), eq(scene.id, sceneId)));
      if (!existing) throw new AccessError(404, 'Szene nicht verfügbar.');
      await tx.delete(constructionPlanRevision)
        .where(and(eq(constructionPlanRevision.workspaceId, workspaceId), eq(constructionPlanRevision.sceneId, sceneId)));
      await tx.delete(editingLease).where(and(
        eq(editingLease.workspaceId, workspaceId),
        eq(editingLease.resourceKind, 'scene'),
        eq(editingLease.resourceId, sceneId),
      ));
      await tx.delete(scene).where(and(eq(scene.workspaceId, workspaceId), eq(scene.id, sceneId)));
      const remainingScenes = await tx.select({ id: scene.id }).from(scene)
        .where(and(eq(scene.workspaceId, workspaceId), eq(scene.adaptationId, existing.adaptationId)));
      if (!remainingScenes.length) {
        await tx.delete(adaptation)
          .where(and(eq(adaptation.workspaceId, workspaceId), eq(adaptation.id, existing.adaptationId)));
      }
      const remainingAdaptations = await tx.select({ id: adaptation.id }).from(adaptation)
        .where(and(eq(adaptation.workspaceId, workspaceId), eq(adaptation.productionId, existing.productionId)));
      if (!remainingAdaptations.length) {
        await tx.delete(constructionPackage)
          .where(and(eq(constructionPackage.workspaceId, workspaceId), eq(constructionPackage.productionId, existing.productionId)));
        await tx.delete(production)
          .where(and(eq(production.workspaceId, workspaceId), eq(production.id, existing.productionId)));
      }
    });
    return { ok: true as const };
  });
  api.delete(`${templatesPath}/:templateId`, { schema: { params: templateParams, response: { 200: okSchema, ...errors } } }, async request => {
    await requireEditor(request, request.params.workspaceId);
    const deleted = await db.delete(sceneTemplate)
      .where(and(eq(sceneTemplate.workspaceId, request.params.workspaceId), eq(sceneTemplate.id, request.params.templateId)))
      .returning({ id: sceneTemplate.id });
    if (!deleted.length) throw new AccessError(404, 'Szenenvorlage nicht verfügbar.');
    return { ok: true as const };
  });
}
