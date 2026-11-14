import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  acceptInvitationResultSchema, acceptInvitationSchema, changeRoleSchema, completePasswordResetSchema, errorSchema,
  invitationPreviewSchema, invitationSchema, inviteMemberSchema, memberParamsSchema, memberSchema, okSchema,
  passwordResetPreviewSchema, requestPasswordResetSchema, tokenParamsSchema, workspaceParamsSchema,
} from '../../shared/contracts.js';
import { AccessError, type createAccess } from './access.js';
import type { Auth } from './auth.js';
import type { Membership } from './membership.js';
import { attachSessionCookie } from './sessionCookie.js';

export function registerIdentityRoutes(
  app: FastifyInstance,
  access: ReturnType<typeof createAccess>,
  membership: Membership,
  origin: string,
  auth: Auth,
) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const errors = { 400: errorSchema, 401: errorSchema, 403: errorSchema, 404: errorSchema, 409: errorSchema, 503: errorSchema };
  function requireOrigin(request: FastifyRequest) {
    if (request.headers.origin !== origin) throw new AccessError(403, 'Ungültiger Ursprung.');
  }

  api.post('/api/workspaces/:workspaceId/invitations', {
    schema: { params: workspaceParamsSchema, body: inviteMemberSchema, response: { 201: invitationSchema, ...errors } },
  }, async (request, reply) => {
    requireOrigin(request);
    await access(request, request.params.workspaceId, 'members');
    return reply.code(201).send(await membership.invite(request.params.workspaceId, request.body));
  });
  api.get('/api/invitations/:token', {
    schema: { params: tokenParamsSchema, response: { 200: invitationPreviewSchema, ...errors } },
  }, async request => membership.previewInvitation(request.params.token));
  api.post('/api/invitations/:token/accept', {
    schema: {
      params: tokenParamsSchema, body: acceptInvitationSchema,
      response: { 201: acceptInvitationResultSchema, ...errors },
    },
  }, async (request, reply) => {
    requireOrigin(request);
    const accepted = await membership.acceptInvitation(request.params.token);
    await attachSessionCookie(auth, accepted.user.id, reply);
    return reply.code(201).send(accepted);
  });
  api.patch('/api/workspaces/:workspaceId/members/:userId', {
    schema: { params: memberParamsSchema, body: changeRoleSchema, response: { 200: memberSchema, ...errors } },
  }, async request => {
    requireOrigin(request);
    await access(request, request.params.workspaceId, 'members');
    return membership.changeRole(request.params.workspaceId, request.params.userId, request.body.role);
  });
  api.delete('/api/workspaces/:workspaceId/members/:userId', {
    schema: { params: memberParamsSchema, response: { 200: okSchema, ...errors } },
  }, async request => {
    requireOrigin(request);
    await access(request, request.params.workspaceId, 'members');
    return membership.revoke(request.params.workspaceId, request.params.userId);
  });
  api.post('/api/password-resets', {
    schema: { body: requestPasswordResetSchema, response: { 200: okSchema, ...errors } },
  }, async request => {
    requireOrigin(request);
    return membership.requestPasswordReset(request.body.email);
  });
  api.get('/api/password-resets/:token', {
    schema: { params: tokenParamsSchema, response: { 200: passwordResetPreviewSchema, ...errors } },
  }, async request => membership.previewPasswordReset(request.params.token));
  api.post('/api/password-resets/:token', {
    schema: { params: tokenParamsSchema, body: completePasswordResetSchema, response: { 200: okSchema, ...errors } },
  }, async request => {
    requireOrigin(request);
    return membership.completePasswordReset(request.params.token, request.body.password);
  });
}
