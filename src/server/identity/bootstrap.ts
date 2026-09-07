import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import { z } from 'zod';
import type { Database } from '../db/connection.js';
import type { Config } from '../config.js';
import { account, membership, user, workspace } from '../db/schema.js';

const administratorSchema = z.object({
  email: z.email().transform(value => value.toLowerCase()),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(12).max(128),
});

export async function bootstrapAdministrator(db: Database, config: Config, input: unknown) {
  const parsed = administratorSchema.safeParse(input);
  if (!parsed.success) throw new Error('Administrator name, email and a 12–128 character password are required');
  const admin = parsed.data;
  const password = await hashPassword(admin.password);
  return db.transaction(async tx => {
    // Serialize first-run provisioning; every row is committed together.
    await tx.execute(sql`select pg_advisory_xact_lock(749318201)`);
    const existing = await tx.select().from(workspace);
    if (existing.length) {
      const [current] = await tx.select().from(membership).innerJoin(user, eq(membership.userId, user.id))
        .where(and(eq(membership.workspaceId, config.WORKSPACE_ID), eq(user.email, admin.email), eq(membership.role, 'administrator')));
      if (!current) throw new Error('Workspace already initialized; bootstrap cannot add or promote accounts');
      return 'already-initialized' as const;
    }
    const [existingIdentity] = await tx.select({ id: user.id }).from(user).where(eq(user.email, admin.email));
    if (existingIdentity) throw new Error('Bootstrap cannot take over an existing identity');
    const userId = randomUUID();
    await tx.insert(user).values({ id: userId, name: admin.name, email: admin.email, emailVerified: false });
    await tx.insert(account).values({ id: randomUUID(), userId, accountId: userId, providerId: 'credential', password });
    await tx.insert(workspace).values({ id: config.WORKSPACE_ID, name: config.WORKSPACE_NAME });
    await tx.insert(membership).values({ workspaceId: config.WORKSPACE_ID, userId, role: 'administrator' });
    return 'created' as const;
  });
}
