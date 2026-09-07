import Fastify, { type FastifyError } from 'fastify';
import swagger from '@fastify/swagger';
import fastifyStatic from '@fastify/static';
import { fromNodeHeaders } from 'better-auth/node';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { validatorCompiler, serializerCompiler, jsonSchemaTransform, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { errorSchema, loginOptionsSchema, meSchema, membersSchema, workspaceParamsSchema, workspaceSchema } from '../shared/contracts.js';
import type { Config } from './config.js';
import { oidcEnabled } from './config.js';
import type { Database } from './db/connection.js';
import { membership, user } from './db/schema.js';
import { createAuth, pocketIdProvider } from './identity/auth.js';
import { AccessError, createAccess } from './identity/access.js';
import { registerProductionRoutes } from './productions/routes.js';

export async function createApp(db: Database, config: Config, options: { staticRoot?: string; logger?: boolean } = {}) {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 16 * 1024 });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(swagger, {
    openapi: { info: { title: 'Bühnenplaner API', version: '0.1.0' } },
    transform: jsonSchemaTransform,
  });
  const api = app.withTypeProvider<ZodTypeProvider>();
  const auth = createAuth(db, config);
  await auth.$context;
  const access = createAccess(db, auth);
  registerProductionRoutes(app, db, access, config.APP_ORIGIN);
  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
  });
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error instanceof AccessError) return reply.code(error.statusCode).send({ message: error.message });
    if (error.validation) return reply.code(400).send({ message: 'Ungültige Anfrage.' });
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ message: 'Anfrage konnte nicht verarbeitet werden.' });
    }
    request.log.error({ name: error.name, code: error.code }, 'Request failed');
    return reply.code(500).send({ message: 'Ein Serverfehler ist aufgetreten. Bitte versuchen Sie es erneut.' });
  });

  // Expose only the identity operations implemented in this slice.
  const oidc = oidcEnabled(config);
  app.route({
    method: ['GET', 'POST'], url: '/api/auth/*', schema: { hide: true },
    handler: async (request, reply) => {
      const url = new URL(request.raw.url ?? '/', config.APP_ORIGIN);
      const allowed = (request.method === 'POST' && ['/api/auth/sign-in/email', '/api/auth/sign-out'].includes(url.pathname))
        || (request.method === 'GET' && url.pathname === '/api/auth/get-session')
        || (oidc && request.method === 'POST' && ['/api/auth/sign-in/social', '/api/auth/link-social', '/api/auth/unlink-account'].includes(url.pathname))
        || (oidc && request.method === 'GET' && [ `/api/auth/callback/${pocketIdProvider}`, '/api/auth/list-accounts'].includes(url.pathname));
      if (!allowed) return reply.code(404).send({ message: 'Diese Anmeldung ist nicht verfügbar.' });
      if (request.method === 'POST' && ['/api/auth/sign-in/social', '/api/auth/link-social'].includes(url.pathname)
        && request.headers.origin !== config.APP_ORIGIN) {
        return reply.code(403).send({ message: 'Diese Anmeldung ist nicht verfügbar.' });
      }
      const headers = fromNodeHeaders(request.headers);
      // Fastify trusts only the socket peer until a deployment configures a proxy.
      // Overwrite this header so clients cannot bypass authentication throttling.
      headers.set('x-stage-client-ip', request.ip);
      // Use the configured origin, never an untrusted Host / forwarded header.
      const response = await auth.handler(new Request(url, {
        method: request.method,
        headers,
        ...(request.method === 'POST' ? { body: JSON.stringify(request.body ?? {}) } : {}),
      }));
      reply.code(response.status);
      response.headers.forEach((value, key) => { if (key !== 'set-cookie') reply.header(key, value); });
      const cookies = response.headers.getSetCookie();
      if (cookies.length) reply.header('set-cookie', cookies);
      return reply.send(await response.text());
    },
  });

  const errors = { 401: errorSchema, 403: errorSchema, 404: errorSchema };
  api.get('/api/health', { schema: { response: { 200: z.object({ status: z.literal('ok') }) } } }, async () => ({ status: 'ok' as const }));
  api.get('/api/login-options', { schema: { response: { 200: loginOptionsSchema } } }, async () => ({ oidc }));
  api.get('/api/me', { schema: { response: { 200: meSchema, ...errors } } }, async request => access(request, config.WORKSPACE_ID));
  api.get('/api/workspaces/:workspaceId', {
    schema: { params: workspaceParamsSchema, response: { 200: workspaceSchema, ...errors } },
  }, async request => (await access(request, request.params.workspaceId)).workspace);
  api.get('/api/workspaces/:workspaceId/members', {
    schema: { params: workspaceParamsSchema, response: { 200: membersSchema, ...errors } },
  }, async request => {
    await access(request, request.params.workspaceId, ['administrator']);
    return db.select({ userId: user.id, name: user.name, email: user.email, role: membership.role })
      .from(membership).innerJoin(user, eq(membership.userId, user.id))
      .where(eq(membership.workspaceId, request.params.workspaceId)).orderBy(user.name);
  });
  app.get('/api/openapi.json', { schema: { hide: true } }, async request => {
    await access(request, config.WORKSPACE_ID);
    return app.swagger();
  });
  if (options.staticRoot) await app.register(fastifyStatic, { root: options.staticRoot });
  return app;
}
