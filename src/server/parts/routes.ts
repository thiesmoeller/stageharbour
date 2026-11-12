import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorSchema, okSchema, workspaceParamsSchema } from '../../shared/contracts.js';
import {
  createPartSchema, exportLibrarySchema, favouriteSchema, importLibrarySchema, importReportSchema, includesArchived,
  libraryExportSchema, listPartsQuerySchema, materialListSchema, materialParamsSchema, partDetailSchema, partIdParamsSchema,
  partRevisionParamsSchema, partRevisionSchema, partSummarySchema, resolvePartsSchema, resolvedPartsSchema, savePartSchema,
  unprocessableSchema, type ResolvedParts,
} from '../../shared/parts/catalog.js';
import {
  compareNames, planCreatePart, planDuplicatePart, planMaterialDelete, planMaterialUpsert, planSavePart,
} from '../../shared/parts/catalogPlans.js';
import { materialSchema, partLibraryJsonSchema, partRefKey, type PartDefinition } from '../../shared/parts/definition.js';
import {
  buildLibraryExport, libraryFilename, planLibraryImport,
} from '../../shared/parts/libraryExchange.js';
import type { Database } from '../db/connection.js';
import { material, partDefinition, partRevision } from '../db/schema.js';
import { AccessError, type createAccess } from '../identity/access.js';
import {
  addLatestRevision, contextFor, findPart, insertNewPart, loadAllRevisions, loadLatestDefinitions, loadMaterials, readDetail,
  readRevision, readSummaries, readSummary,
} from './data.js';
import { onConflict, unwrap } from './errors.js';

const DEFINITION_BODY_LIMIT = 1024 * 1024;
const LIBRARY_BODY_LIMIT = 8 * 1024 * 1024;
export const PART_LIBRARY_SCHEMA_PATH = '/api/schemas/part-library.schema.json';

export function registerPartRoutes(
  app: FastifyInstance, db: Database, access: ReturnType<typeof createAccess>, origin: string, clock: () => Date,
) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const base = '/api/workspaces/:workspaceId';
  const errors = { 400: errorSchema, 401: errorSchema, 403: errorSchema, 404: errorSchema, 409: errorSchema, 422: unprocessableSchema };

  async function requireEditor(request: FastifyRequest, workspaceId: string) {
    if (request.headers.origin !== origin) throw new AccessError(403, 'Ungültiger Ursprung.');
    return access(request, workspaceId, 'parts');
  }

  api.get(`${base}/parts`, {
    schema: { params: workspaceParamsSchema, querystring: listPartsQuerySchema, response: { 200: z.array(partSummarySchema), ...errors } },
  }, async request => {
    await access(request, request.params.workspaceId);
    return readSummaries(db, request.params.workspaceId, includesArchived(request.query));
  });

  api.post(`${base}/parts/resolve`, {
    config: { audit: false },
    schema: { params: workspaceParamsSchema, body: resolvePartsSchema, response: { 200: resolvedPartsSchema, ...errors } },
  }, async (request): Promise<ResolvedParts> => {
    const { workspaceId } = request.params;
    await access(request, workspaceId);
    const refs = [...new Map(request.body.refs.map(ref => [partRefKey(ref), ref])).values()];
    const rows = await db.select({ definition: partRevision.definition }).from(partRevision).where(and(
      eq(partRevision.workspaceId, workspaceId),
      inArray(partRevision.partId, [...new Set(refs.map(ref => ref.id))]),
      inArray(partRevision.revision, [...new Set(refs.map(ref => ref.revision))])));
    const byKey = new Map(rows.map(row => [partRefKey(row.definition), row.definition]));
    return {
      definitions: refs.flatMap(ref => byKey.get(partRefKey(ref)) ?? []),
      missing: refs.filter(ref => !byKey.has(partRefKey(ref))),
    };
  });

  api.get(`${base}/parts/:partId`, {
    schema: { params: partIdParamsSchema, response: { 200: partDetailSchema, ...errors } },
  }, async request => {
    await access(request, request.params.workspaceId);
    return readDetail(db, request.params.workspaceId, request.params.partId);
  });

  api.get(`${base}/parts/:partId/revisions/:revision`, {
    schema: { params: partRevisionParamsSchema, response: { 200: partRevisionSchema, ...errors } },
  }, async request => {
    const { workspaceId, partId, revision } = request.params;
    await access(request, workspaceId);
    const row = await readRevision(db, workspaceId, partId, revision);
    return { partId, revision, createdAt: row.createdAt.toISOString(), authorName: row.authorName, definition: row.definition };
  });

  api.post(`${base}/parts`, {
    bodyLimit: DEFINITION_BODY_LIMIT,
    schema: { params: workspaceParamsSchema, body: createPartSchema, response: { 201: partDetailSchema, ...errors } },
  }, async (request, reply) => {
    const { workspaceId } = request.params;
    const { user } = await requireEditor(request, workspaceId);
    const now = clock();
    const input = request.body.definition;
    const detail = await db.transaction(async tx => {
      const rawId = (input as { id?: unknown } | null)?.id;
      const [taken] = typeof rawId === 'string' && z.uuid().safeParse(rawId).success
        ? await tx.select({ id: partDefinition.id }).from(partDefinition)
          .where(and(eq(partDefinition.workspaceId, workspaceId), eq(partDefinition.id, rawId)))
        : [];
      const context = await contextFor(tx, workspaceId, input);
      const definition = unwrap(planCreatePart(input, context, id => taken?.id === id));
      await onConflict('Ein Bauteil mit dieser ID gibt es bereits.', () => insertNewPart(tx, workspaceId, definition, user.id, now));
      return readDetail(tx, workspaceId, definition.id);
    });
    return reply.code(201).send(detail);
  });

  api.post(`${base}/parts/:partId/revisions`, {
    bodyLimit: DEFINITION_BODY_LIMIT,
    schema: { params: partIdParamsSchema, body: savePartSchema, response: { 201: partDetailSchema, ...errors } },
  }, async (request, reply) => {
    const { workspaceId, partId } = request.params;
    const { user } = await requireEditor(request, workspaceId);
    const now = clock();
    const detail = await db.transaction(async tx => {
      const row = await findPart(tx, workspaceId, partId, true);
      const context = await contextFor(tx, workspaceId, request.body.definition);
      const definition = unwrap(planSavePart({
        partId, latestRevision: row.latestRevision, baseRevision: request.body.baseRevision, input: request.body.definition, context,
      }));
      await onConflict('Das Bauteil wurde inzwischen geändert. Bitte neu laden.', () => addLatestRevision(tx, workspaceId, definition, user.id, now));
      return readDetail(tx, workspaceId, partId);
    });
    return reply.code(201).send(detail);
  });

  for (const action of ['archive', 'unarchive'] as const) {
    api.post(`${base}/parts/:partId/${action}`, {
      schema: { params: partIdParamsSchema, response: { 200: partSummarySchema, ...errors } },
    }, async request => {
      const { workspaceId, partId } = request.params;
      await requireEditor(request, workspaceId);
      const now = clock();
      return db.transaction(async tx => {
        const row = await findPart(tx, workspaceId, partId, true);
        const archivedAt = action === 'archive' ? row.archivedAt ?? now : null;
        await tx.update(partDefinition).set({ archivedAt, updatedAt: now })
          .where(and(eq(partDefinition.workspaceId, workspaceId), eq(partDefinition.id, partId)));
        return readSummary(tx, workspaceId, partId);
      });
    });
  }

  api.put(`${base}/parts/:partId/favourite`, {
    schema: { params: partIdParamsSchema, body: favouriteSchema, response: { 200: partSummarySchema, ...errors } },
  }, async request => {
    const { workspaceId, partId } = request.params;
    await requireEditor(request, workspaceId);
    return db.transaction(async tx => {
      await findPart(tx, workspaceId, partId, true);
      await tx.update(partDefinition).set({ favourite: request.body.favourite, updatedAt: clock() })
        .where(and(eq(partDefinition.workspaceId, workspaceId), eq(partDefinition.id, partId)));
      return readSummary(tx, workspaceId, partId);
    });
  });

  api.post(`${base}/parts/:partId/duplicate`, {
    schema: { params: partIdParamsSchema, response: { 201: partDetailSchema, ...errors } },
  }, async (request, reply) => {
    const { workspaceId, partId } = request.params;
    const { user } = await requireEditor(request, workspaceId);
    const now = clock();
    const detail = await db.transaction(async tx => {
      const row = await findPart(tx, workspaceId, partId);
      const { definition: source } = await readRevision(tx, workspaceId, partId, row.latestRevision);
      const names = await tx.select({ name: partDefinition.name }).from(partDefinition).where(eq(partDefinition.workspaceId, workspaceId));
      const copy = planDuplicatePart(source, randomUUID(), names.map(item => item.name));
      await insertNewPart(tx, workspaceId, copy, user.id, now);
      return readDetail(tx, workspaceId, copy.id);
    });
    return reply.code(201).send(detail);
  });

  api.get(`${base}/materials`, {
    schema: { params: workspaceParamsSchema, response: { 200: materialListSchema, ...errors } },
  }, async request => {
    await access(request, request.params.workspaceId);
    const materials = [...(await loadMaterials(db, request.params.workspaceId)).values()];
    return materials.sort((a, b) => a.kind.localeCompare(b.kind) || compareNames(a.name, b.name));
  });

  api.put(`${base}/materials/:key`, {
    schema: { params: materialParamsSchema, body: materialSchema, response: { 200: materialSchema, ...errors } },
  }, async request => {
    const { workspaceId, key } = request.params;
    await requireEditor(request, workspaceId);
    if (request.body.key !== key) throw new AccessError(400, 'Der Schlüssel im Material stimmt nicht mit der Adresse überein.');
    const now = clock();
    await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${workspaceId}), hashtext('materials'))`);
      const existing = (await loadMaterials(tx, workspaceId)).get(key);
      unwrap(planMaterialUpsert(request.body, existing, await loadLatestDefinitions(tx, workspaceId)));
      await tx.insert(material).values({ workspaceId, key, definition: request.body, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({ target: [material.workspaceId, material.key], set: { definition: request.body, updatedAt: now } });
    });
    return request.body;
  });

  api.delete(`${base}/materials/:key`, {
    schema: { params: materialParamsSchema, response: { 200: okSchema, ...errors } },
  }, async request => {
    const { workspaceId, key } = request.params;
    await requireEditor(request, workspaceId);
    await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${workspaceId}), hashtext('materials'))`);
      const existing = (await loadMaterials(tx, workspaceId)).get(key);
      unwrap(planMaterialDelete(key, existing, await loadLatestDefinitions(tx, workspaceId)));
      await tx.delete(material).where(and(eq(material.workspaceId, workspaceId), eq(material.key, key)));
    });
    return { ok: true as const };
  });

  api.post(`${base}/library/export`, {
    config: { audit: false },
    schema: { params: workspaceParamsSchema, body: exportLibrarySchema, response: { 200: libraryExportSchema, ...errors } },
  }, async request => {
    const { workspaceId } = request.params;
    const { workspace } = await access(request, workspaceId);
    const revisions = await loadAllRevisions(db, workspaceId);
    const materials = await loadMaterials(db, workspaceId);
    const rows = await db.select({ id: partDefinition.id, latestRevision: partDefinition.latestRevision }).from(partDefinition)
      .where(and(eq(partDefinition.workspaceId, workspaceId), request.body.partIds ? undefined : isNull(partDefinition.archivedAt)));
    const wanted = request.body.partIds ? [...new Set(request.body.partIds)] : rows.map(row => row.id);
    const latest = new Map(rows.map(row => [row.id, row.latestRevision]));
    const roots: PartDefinition[] = wanted.map(id => {
      const definition = revisions.get(id)?.get(latest.get(id) ?? 0);
      if (!definition) throw new AccessError(404, 'Bauteil nicht verfügbar.');
      return definition;
    });
    const library = buildLibraryExport({
      roots, part: ref => revisions.get(ref.id)?.get(ref.revision), material: key => materials.get(key),
    });
    return { filename: libraryFilename(workspace.name, clock()), library };
  });

  api.post(`${base}/library/import`, {
    bodyLimit: LIBRARY_BODY_LIMIT,
    schema: { params: workspaceParamsSchema, body: importLibrarySchema, response: { 200: importReportSchema, ...errors } },
  }, async request => {
    const { workspaceId } = request.params;
    const { user } = await requireEditor(request, workspaceId);
    const now = clock();
    return db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${workspaceId}), hashtext('library-import'))`);
      const revisions = await loadAllRevisions(tx, workspaceId);
      const plan = unwrap(planLibraryImport({
        input: request.body.library,
        overwriteMaterials: request.body.overwriteMaterials ?? false,
        workspace: { materials: await loadMaterials(tx, workspaceId), revisions },
      }));
      for (const definition of [...plan.materials.create, ...plan.materials.overwrite]) {
        await tx.insert(material).values({ workspaceId, key: definition.key, definition, createdAt: now, updatedAt: now })
          .onConflictDoUpdate({ target: [material.workspaceId, material.key], set: { definition, updatedAt: now } });
      }
      const newest = new Map<string, PartDefinition>();
      for (const { definition, newPart } of plan.parts) {
        if (newPart) {
          await tx.insert(partDefinition).values({
            id: definition.id, workspaceId, name: definition.name, category: definition.category,
            latestRevision: definition.revision, createdBy: user.id, createdAt: now, updatedAt: now,
          });
        }
        await tx.insert(partRevision).values({ workspaceId, partId: definition.id, revision: definition.revision, definition, createdAt: now, createdBy: user.id });
        if ((newest.get(definition.id)?.revision ?? 0) < definition.revision) newest.set(definition.id, definition);
      }
      for (const definition of newest.values()) {
        await tx.update(partDefinition).set({
          name: definition.name, category: definition.category, latestRevision: definition.revision, updatedAt: now,
        }).where(and(eq(partDefinition.workspaceId, workspaceId), eq(partDefinition.id, definition.id)));
      }
      return plan.report;
    });
  });

  app.get(PART_LIBRARY_SCHEMA_PATH, { schema: { hide: true } }, async (_request, reply) =>
    reply.type('application/schema+json; charset=utf-8').send(partLibraryJsonSchema()));
}
