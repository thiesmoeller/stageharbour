import { and, eq, gt, sql } from 'drizzle-orm';
import { LEASE_TTL_MS, type LeaseHolder, type LeaseKind } from '../../shared/leases.js';
import type { Database } from '../db/connection.js';
import { editingLease, user } from '../db/schema.js';
import { audit } from '../audit.js';

export class LeaseError extends Error {
  constructor(public statusCode: 409 | 423, message: string) { super(message); }
}

export type LeaseResult = { acquired: boolean; lease: LeaseHolder };

/** Exclusive editing leases with heartbeat expiry. Callers must check the holder on every write. */
export function createLeases(db: Database, clock: () => Date = () => new Date()) {
  function lock(workspaceId: string, kind: LeaseKind, resourceId: string) {
    return sql`select pg_advisory_xact_lock(hashtext(${workspaceId}), hashtext(${`${kind}:${resourceId}`}))`;
  }
  function expiry(from = clock()) { return new Date(from.getTime() + LEASE_TTL_MS); }
  function key(workspaceId: string, kind: LeaseKind, resourceId: string) {
    return and(eq(editingLease.workspaceId, workspaceId), eq(editingLease.resourceKind, kind), eq(editingLease.resourceId, resourceId));
  }
  async function holderName(userId: string) {
    const [record] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId));
    return record?.name ?? 'Unbekannt';
  }
  async function read(workspaceId: string, kind: LeaseKind, resourceId: string): Promise<LeaseHolder | null> {
    const [row] = await db.select({ holderUserId: editingLease.holderUserId, holderName: user.name })
      .from(editingLease).innerJoin(user, eq(user.id, editingLease.holderUserId))
      .where(and(key(workspaceId, kind, resourceId), gt(editingLease.expiresAt, clock())));
    return row ?? null;
  }
  async function holders(workspaceId: string, kind: LeaseKind) {
    const rows = await db.select({ resourceId: editingLease.resourceId, holderUserId: editingLease.holderUserId, holderName: user.name })
      .from(editingLease).innerJoin(user, eq(user.id, editingLease.holderUserId))
      .where(and(eq(editingLease.workspaceId, workspaceId), eq(editingLease.resourceKind, kind), gt(editingLease.expiresAt, clock())));
    return new Map(rows.map(row => [row.resourceId, { holderUserId: row.holderUserId, holderName: row.holderName }]));
  }
  async function acquire(workspaceId: string, kind: LeaseKind, resourceId: string, holder: { id: string; name: string }): Promise<LeaseResult> {
    return db.transaction(async tx => {
      await tx.execute(lock(workspaceId, kind, resourceId));
      const [row] = await tx.select().from(editingLease).where(key(workspaceId, kind, resourceId));
      const now = clock();
      if (row && row.expiresAt > now && row.holderUserId !== holder.id) {
        return { acquired: false, lease: { holderUserId: row.holderUserId, holderName: await holderName(row.holderUserId) } };
      }
      const expiresAt = expiry(now);
      if (row) await tx.update(editingLease).set({ holderUserId: holder.id, expiresAt }).where(key(workspaceId, kind, resourceId));
      else await tx.insert(editingLease).values({ workspaceId, resourceKind: kind, resourceId, holderUserId: holder.id, expiresAt });
      if (!row || row.expiresAt <= now) await audit(tx, workspaceId, holder.id, `lease.${row ? 'takeover' : 'acquire'}.${kind}`, resourceId);
      return { acquired: true, lease: { holderUserId: holder.id, holderName: holder.name } };
    });
  }
  async function heartbeat(workspaceId: string, kind: LeaseKind, resourceId: string, userId: string) {
    const [row] = await db.update(editingLease).set({ expiresAt: expiry() })
      .where(and(key(workspaceId, kind, resourceId), eq(editingLease.holderUserId, userId), gt(editingLease.expiresAt, clock())))
      .returning({ holderUserId: editingLease.holderUserId });
    if (!row) throw new LeaseError(423, 'Die Bearbeitungsberechtigung ist abgelaufen.');
  }
  async function release(workspaceId: string, kind: LeaseKind, resourceId: string, userId: string) {
    await db.transaction(async tx => {
      await tx.execute(lock(workspaceId, kind, resourceId));
      const removed = await tx.delete(editingLease).where(and(key(workspaceId, kind, resourceId), eq(editingLease.holderUserId, userId))).returning();
      if (removed.length) await audit(tx, workspaceId, userId, `lease.release.${kind}`, resourceId);
    });
  }
  async function requireHeld(store: Pick<Database, 'execute' | 'select'>, workspaceId: string, kind: LeaseKind, resourceId: string, userId: string) {
    await store.execute(lock(workspaceId, kind, resourceId));
    const [row] = await store.select().from(editingLease).where(and(key(workspaceId, kind, resourceId), eq(editingLease.holderUserId, userId), gt(editingLease.expiresAt, clock())));
    if (!row) throw new LeaseError(423, 'Die Bearbeitungsberechtigung ist abgelaufen oder gehört jemand anderem. Ihre Änderungen wurden nicht gespeichert.');
  }
  async function requireAvailable(store: Pick<Database, 'execute' | 'select'>, workspaceId: string, kind: LeaseKind, resourceId: string, userId: string) {
    await store.execute(lock(workspaceId, kind, resourceId));
    const [row] = await store.select().from(editingLease).where(and(key(workspaceId, kind, resourceId), gt(editingLease.expiresAt, clock())));
    if (row && row.holderUserId !== userId) throw new LeaseError(423, `Wird bereits von ${await holderName(row.holderUserId)} bearbeitet.`);
  }
  return { acquire, heartbeat, release, requireHeld, requireAvailable, read, holders };
}
export type Leases = ReturnType<typeof createLeases>;
