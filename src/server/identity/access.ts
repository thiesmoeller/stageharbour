import { and, eq } from 'drizzle-orm';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyRequest } from 'fastify';
import type { Role } from '../../shared/contracts.js';
import { can, type Capability } from '../../shared/permissions.js';
import type { Database } from '../db/connection.js';
import { membership, workspace } from '../db/schema.js';
import type { Auth } from './auth.js';

export class AccessError extends Error {
  constructor(public statusCode: 400 | 401 | 403 | 404 | 409 | 503, message: string) { super(message); }
}

export function createAccess(db: Database, auth: Auth) {
  return async (request: FastifyRequest, workspaceId: string, roles?: readonly Role[] | Capability) => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) throw new AccessError(401, 'Bitte melden Sie sich an.');
    const [record] = await db.select({ id: workspace.id, name: workspace.name, role: membership.role })
      .from(membership).innerJoin(workspace, eq(membership.workspaceId, workspace.id))
      .where(and(eq(membership.userId, session.user.id), eq(membership.workspaceId, workspaceId)));
    // Do not reveal whether a workspace exists to non-members.
    if (!record) throw new AccessError(404, 'Arbeitsbereich nicht verfügbar.');
    if (roles && !(typeof roles === 'string' ? can(record.role, roles) : roles.includes(record.role))) throw new AccessError(403, 'Dafür fehlen Ihnen die Berechtigungen.');
    return { user: { id: session.user.id, name: session.user.name, email: session.user.email }, workspace: record };
  };
}
