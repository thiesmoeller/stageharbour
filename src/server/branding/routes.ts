import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  brandingSchema, DEFAULT_BRANDING, errorSchema, updateBrandingSchema, workspaceParamsSchema,
} from '../../shared/contracts.js';
import { AccessError, type createAccess } from '../identity/access.js';
import type { Database } from '../db/connection.js';
import { workspace } from '../db/schema.js';
import type { FileStorage } from '../exports/storage.js';
import { inspectReference } from '../venues/files.js';

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

function asBranding(row: {
  productName: string; tagline: string; footerText: string; logoStorageKey: string | null;
}) {
  return brandingSchema.parse({
    productName: row.productName,
    tagline: row.tagline,
    footerText: row.footerText,
    hasLogo: !!row.logoStorageKey,
  });
}

export function registerBrandingRoutes(
  app: FastifyInstance,
  db: Database,
  access: ReturnType<typeof createAccess>,
  origin: string,
  workspaceId: string,
  storage: FileStorage,
) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const errors = { 400: errorSchema, 401: errorSchema, 403: errorSchema, 404: errorSchema };

  for (const type of ['image/png', 'image/jpeg', 'image/jpg'] as const) {
    if (!app.hasContentTypeParser(type)) {
      app.addContentTypeParser(type, { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
    }
  }

  async function requireAdmin(request: Parameters<typeof access>[0], id: string) {
    if (request.headers.origin !== origin) throw new AccessError(403, 'Ungültiger Ursprung.');
    return access(request, id, 'branding');
  }

  api.get('/api/branding', {
    schema: { response: { 200: brandingSchema } },
  }, async () => {
    const [row] = await db.select({
      productName: workspace.productName, tagline: workspace.tagline,
      footerText: workspace.footerText, logoStorageKey: workspace.logoStorageKey,
    }).from(workspace).where(eq(workspace.id, workspaceId));
    return row ? asBranding(row) : DEFAULT_BRANDING;
  });

  api.get('/api/branding/logo', { schema: { hide: true } }, async (_request, reply) => {
    const [row] = await db.select({
      logoStorageKey: workspace.logoStorageKey, logoMediaType: workspace.logoMediaType,
    }).from(workspace).where(eq(workspace.id, workspaceId));
    if (!row?.logoStorageKey || !row.logoMediaType) throw new AccessError(404, 'Logo nicht verfügbar.');
    return reply.type(row.logoMediaType).header('Cache-Control', 'public, max-age=300')
      .send(await storage.get(row.logoStorageKey));
  });

  api.put('/api/workspaces/:workspaceId/branding', {
    schema: {
      params: workspaceParamsSchema, body: updateBrandingSchema,
      response: { 200: brandingSchema, ...errors },
    },
  }, async request => {
    await requireAdmin(request, request.params.workspaceId);
    const [row] = await db.update(workspace).set({
      productName: request.body.productName,
      tagline: request.body.tagline,
      footerText: request.body.footerText,
    }).where(eq(workspace.id, request.params.workspaceId)).returning({
      productName: workspace.productName, tagline: workspace.tagline,
      footerText: workspace.footerText, logoStorageKey: workspace.logoStorageKey,
    });
    if (!row) throw new AccessError(404, 'Arbeitsbereich nicht verfügbar.');
    return asBranding(row);
  });

  api.post('/api/workspaces/:workspaceId/branding/logo', {
    bodyLimit: MAX_LOGO_BYTES,
    schema: {
      params: workspaceParamsSchema, hide: true,
      response: { 200: brandingSchema, ...errors },
    },
  }, async request => {
    await requireAdmin(request, request.params.workspaceId);
    const bytes = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
    if (!bytes.length || bytes.length > MAX_LOGO_BYTES) {
      throw new AccessError(400, 'Das Logo ist zu groß oder leer.');
    }
    let inspected;
    try { inspected = await inspectReference(bytes, request.headers['content-type'] ?? ''); }
    catch { throw new AccessError(400, 'Nur PNG- oder JPEG-Logos werden unterstützt.'); }
    if (inspected.kind !== 'image') throw new AccessError(400, 'Nur PNG- oder JPEG-Logos werden unterstützt.');
    const storageKey = `${request.params.workspaceId}/branding/logo`;
    await storage.put(storageKey, bytes);
    const [row] = await db.update(workspace).set({
      logoStorageKey: storageKey, logoMediaType: inspected.mediaType,
    }).where(eq(workspace.id, request.params.workspaceId)).returning({
      productName: workspace.productName, tagline: workspace.tagline,
      footerText: workspace.footerText, logoStorageKey: workspace.logoStorageKey,
    });
    if (!row) throw new AccessError(404, 'Arbeitsbereich nicht verfügbar.');
    return asBranding(row);
  });

  api.delete('/api/workspaces/:workspaceId/branding/logo', {
    schema: { params: workspaceParamsSchema, response: { 200: brandingSchema, ...errors } },
  }, async request => {
    await requireAdmin(request, request.params.workspaceId);
    const [row] = await db.update(workspace).set({
      logoStorageKey: null, logoMediaType: null,
    }).where(eq(workspace.id, request.params.workspaceId)).returning({
      productName: workspace.productName, tagline: workspace.tagline,
      footerText: workspace.footerText, logoStorageKey: workspace.logoStorageKey,
    });
    if (!row) throw new AccessError(404, 'Arbeitsbereich nicht verfügbar.');
    return asBranding(row);
  });
}
