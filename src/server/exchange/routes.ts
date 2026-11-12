import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { workspaceParamsSchema } from '../../shared/contracts.js';
import { EXCHANGE_FORMATS, exportSceneFile } from '../../shared/exchange/index.js';
import { sceneSchema } from '../../shared/layout.js';
import { migrateLayout } from '../../shared/layoutMigrate.js';
import { createLayoutPartIndex } from '../../shared/layoutObjects.js';
import type { Database } from '../db/connection.js';
import { adaptation, production, scene, venue, venueVersion } from '../db/schema.js';
import { AccessError, type createAccess } from '../identity/access.js';
import { loadAllRevisions, loadMaterials } from '../parts/data.js';

/** `attachment; filename="…"` with an ASCII fallback and the real name as RFC 5987 `filename*`. */
export function attachmentHeader(filename: string): string {
  const ascii = filename.replace(/ß/g, 'ss').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * Exchange files of a Bühnenbild: `GET /api/workspaces/:workspaceId/scenes/:sceneId/export/gltf`
 * (binary glTF, `.glb`) and `.../export/mvr` (MVR archive). Any member of the workspace may
 * download, like the PDF of an issued revision. The file is built from the stored Bühnenbild.
 */
export function registerExchangeRoutes(
  app: FastifyInstance, db: Database, access: ReturnType<typeof createAccess>, providerVersion: string,
) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const params = workspaceParamsSchema.extend({ sceneId: z.uuid(), format: z.enum(['gltf', 'mvr']) });

  async function catalog(workspaceId: string) {
    const [revisions, materials] = await Promise.all([loadAllRevisions(db, workspaceId), loadMaterials(db, workspaceId)]);
    return createLayoutPartIndex({
      parts: [...revisions.values()].flatMap(items => [...items.values()]),
      materials: [...materials.values()],
    });
  }

  api.get('/api/workspaces/:workspaceId/scenes/:sceneId/export/:format', {
    schema: { params, tags: ['exchange'], summary: 'Bühnenbild als glTF (.glb) oder MVR herunterladen' },
  }, async (request, reply) => {
    const { workspaceId, sceneId, format } = request.params;
    await access(request, workspaceId);
    const [record] = await db.select({
      id: scene.id, name: scene.name, productionName: production.name, venueName: venue.name,
      productionId: production.id, venueId: venue.id, revision: scene.revision,
      venueVersionId: venueVersion.id, venue: venueVersion.geometry, layout: scene.layout,
    }).from(scene).innerJoin(adaptation, eq(scene.adaptationId, adaptation.id))
      .innerJoin(production, eq(adaptation.productionId, production.id))
      .innerJoin(venueVersion, eq(adaptation.venueVersionId, venueVersion.id))
      .innerJoin(venue, eq(venueVersion.venueId, venue.id))
      .where(and(eq(scene.workspaceId, workspaceId), eq(scene.id, sceneId)));
    if (!record) throw new AccessError(404, 'Bühnenbild nicht verfügbar.');
    const index = await catalog(workspaceId);
    const stored = sceneSchema.parse({ ...record, layout: migrateLayout(record.layout, index), lease: null });
    const file = await exportSceneFile({
      format, scene: stored, venue: stored.venue, layout: stored.layout, catalog: index, providerVersion,
    });
    return reply.type(EXCHANGE_FORMATS[format].contentType)
      .header('Content-Disposition', attachmentHeader(file.filename))
      .send(Buffer.from(file.data));
  });
}
