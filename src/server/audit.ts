import { randomUUID } from 'node:crypto';
import { auditEvent } from './db/schema.js';
import type { Database } from './db/connection.js';

export async function audit(store: Pick<Database, 'insert'>, workspaceId: string, actorId: string, action: string, resourceId: string) {
  await store.insert(auditEvent).values({ id: randomUUID(), workspaceId, actorId, action, resourceId });
}

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Set to false on routes that use a write method but only read, so no audit entry is written. */
    audit?: boolean;
  }
}
