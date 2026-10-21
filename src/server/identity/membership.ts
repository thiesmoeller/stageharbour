import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import type { Role } from '../../shared/contracts.js';
import type { Database } from '../db/connection.js';
import { account, invitation, membership, passwordReset, session, user, workspace, editingLease } from '../db/schema.js';
import type { MailTransport } from '../mail/transport.js';
import { AccessError } from './access.js';

const roleNames: Record<Role, string> = { administrator: 'Administration', editor: 'Bearbeitung', viewer: 'Ansicht' };
const inviteTtlMs = 7 * 24 * 60 * 60 * 1000;
const resetTtlMs = 60 * 60 * 1000;

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
function issueToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

export function createMembership(db: Database, mail: MailTransport, origin: string) {
  async function loadWorkspace(workspaceId: string) {
    const [record] = await db.select().from(workspace).where(eq(workspace.id, workspaceId));
    if (!record) throw new AccessError(404, 'Arbeitsbereich nicht verfügbar.');
    return record;
  }
  async function administratorCount(store: Pick<Database, 'select'>, workspaceId: string) {
    const rows = await store.select({ userId: membership.userId }).from(membership)
      .where(and(eq(membership.workspaceId, workspaceId), eq(membership.role, 'administrator')));
    return rows.length;
  }
  async function protectLastAdministrator(store: Pick<Database, 'select'>, workspaceId: string, userId: string, next: Role | null) {
    const [current] = await store.select().from(membership)
      .where(and(eq(membership.workspaceId, workspaceId), eq(membership.userId, userId)));
    if (!current) throw new AccessError(404, 'Arbeitsbereich nicht verfügbar.');
    if (current.role === 'administrator' && next !== 'administrator' && await administratorCount(store, workspaceId) < 2) {
      throw new AccessError(409, 'Die letzte Administration kann nicht entfernt oder herabgestuft werden.');
    }
    return current;
  }

  return {
    async invite(workspaceId: string, input: { email: string; name: string; role: Role }) {
      const email = input.email.toLowerCase();
      const space = await loadWorkspace(workspaceId);
      const [already] = await db.select({ userId: user.id }).from(user)
        .innerJoin(membership, eq(membership.userId, user.id))
        .where(and(eq(user.email, email), eq(membership.workspaceId, workspaceId)));
      if (already) throw new AccessError(409, 'Diese Person gehört bereits zum Arbeitsbereich.');
      const { token, tokenHash } = issueToken();
      const record = await db.transaction(async tx => {
        await tx.delete(invitation).where(and(
          eq(invitation.workspaceId, workspaceId), eq(invitation.email, email), isNull(invitation.consumedAt),
        ));
        const [created] = await tx.insert(invitation).values({
          id: randomUUID(), workspaceId, email, name: input.name, role: input.role, tokenHash,
          expiresAt: new Date(Date.now() + inviteTtlMs),
        }).returning();
        return created!;
      });
      try {
        await mail.send({
          to: email,
          subject: `Einladung zum Arbeitsbereich ${space.name}`,
          text: `Sie wurden als ${roleNames[input.role]} zum Arbeitsbereich „${space.name}“ eingeladen.\n\nÖffnen Sie diesen Link, um Ihr Konto einzurichten:\n${origin}/#/einladung/${token}\n\nDer Link ist sieben Tage gültig und kann nur einmal verwendet werden.`,
        });
      } catch {
        throw new AccessError(503, 'Die E-Mail konnte nicht gesendet werden. Bitte versuchen Sie es erneut.');
      }
      return { email: record.email, name: record.name, role: record.role };
    },

    async previewInvitation(token: string) {
      const [record] = await db.select({
        email: invitation.email, name: invitation.name, role: invitation.role,
        workspaceName: workspace.name, expiresAt: invitation.expiresAt, consumedAt: invitation.consumedAt,
      }).from(invitation).innerJoin(workspace, eq(invitation.workspaceId, workspace.id))
        .where(eq(invitation.tokenHash, hashToken(token)));
      if (!record || record.consumedAt || record.expiresAt <= new Date()) {
        throw new AccessError(404, 'Diese Einladung ist nicht mehr gültig.');
      }
      return { email: record.email, name: record.name, role: record.role, workspaceName: record.workspaceName };
    },

    async acceptInvitation(token: string, password: string) {
      const passwordHash = await hashPassword(password);
      await db.transaction(async tx => {
        const [record] = await tx.select().from(invitation)
          .where(eq(invitation.tokenHash, hashToken(token))).for('update');
        if (!record || record.consumedAt || record.expiresAt <= new Date()) {
          throw new AccessError(404, 'Diese Einladung ist nicht mehr gültig.');
        }
        const [existing] = await tx.select().from(user).where(eq(user.email, record.email));
        const userId = existing?.id ?? randomUUID();
        if (existing) {
          const [existingMembership] = await tx.select().from(membership)
            .where(and(eq(membership.workspaceId, record.workspaceId), eq(membership.userId, existing.id)));
          if (existingMembership) throw new AccessError(409, 'Diese Person gehört bereits zum Arbeitsbereich.');
        } else {
          await tx.insert(user).values({ id: userId, name: record.name, email: record.email });
        }
        const [credential] = await tx.select().from(account)
          .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')));
        if (credential) await tx.update(account).set({ password: passwordHash }).where(eq(account.id, credential.id));
        else await tx.insert(account).values({ id: randomUUID(), userId, accountId: userId, providerId: 'credential', password: passwordHash });
        await tx.insert(membership).values({ workspaceId: record.workspaceId, userId, role: record.role });
        await tx.update(invitation).set({ consumedAt: new Date() }).where(eq(invitation.id, record.id));
      });
      return { ok: true as const };
    },

    async changeRole(workspaceId: string, userId: string, role: Role) {
      await db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${workspaceId}), 19471)`);
        await protectLastAdministrator(tx, workspaceId, userId, role);
        const [updated] = await tx.update(membership).set({ role })
          .where(and(eq(membership.workspaceId, workspaceId), eq(membership.userId, userId))).returning();
        if (!updated) throw new AccessError(404, 'Arbeitsbereich nicht verfügbar.');
        if (role === 'viewer') await tx.delete(editingLease).where(and(eq(editingLease.workspaceId, workspaceId), eq(editingLease.holderUserId, userId)));
      });
      const [member] = await db.select({ userId: user.id, name: user.name, email: user.email, role: membership.role })
        .from(membership).innerJoin(user, eq(membership.userId, user.id))
        .where(and(eq(membership.workspaceId, workspaceId), eq(membership.userId, userId)));
      return member!;
    },

    async revoke(workspaceId: string, userId: string) {
      await db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${workspaceId}), 19471)`);
        await protectLastAdministrator(tx, workspaceId, userId, null);
        const deleted = await tx.delete(membership)
          .where(and(eq(membership.workspaceId, workspaceId), eq(membership.userId, userId))).returning();
        if (!deleted.length) throw new AccessError(404, 'Arbeitsbereich nicht verfügbar.');
        await tx.delete(editingLease).where(and(eq(editingLease.workspaceId, workspaceId), eq(editingLease.holderUserId, userId)));
      });
      return { ok: true as const };
    },

    async requestPasswordReset(email: string) {
      const normalized = email.toLowerCase();
      const [identity] = await db.select({ id: user.id }).from(user).innerJoin(account, eq(account.userId, user.id))
        .where(and(eq(user.email, normalized), eq(account.providerId, 'credential')));
      if (!identity) return { ok: true as const };
      const { token, tokenHash } = issueToken();
      await db.transaction(async tx => {
        await tx.delete(passwordReset).where(and(eq(passwordReset.userId, identity.id), isNull(passwordReset.consumedAt)));
        await tx.insert(passwordReset).values({
          id: randomUUID(), userId: identity.id, tokenHash, expiresAt: new Date(Date.now() + resetTtlMs),
        });
      });
      try {
        await mail.send({
          to: normalized,
          subject: 'Passwort für StageHarbour zurücksetzen',
          text: `Sie können ein neues Passwort für StageHarbour festlegen.\n\nÖffnen Sie diesen Link:\n${origin}/#/passwort/${token}\n\nDer Link ist eine Stunde gültig und kann nur einmal verwendet werden. Wenn Sie diese E-Mail nicht angefordert haben, ignorieren Sie sie.`,
        });
      } catch {
        throw new AccessError(503, 'Die E-Mail konnte nicht gesendet werden. Bitte versuchen Sie es erneut.');
      }
      return { ok: true as const };
    },

    async previewPasswordReset(token: string) {
      const [record] = await db.select({ email: user.email, expiresAt: passwordReset.expiresAt, consumedAt: passwordReset.consumedAt })
        .from(passwordReset).innerJoin(user, eq(passwordReset.userId, user.id))
        .where(eq(passwordReset.tokenHash, hashToken(token)));
      if (!record || record.consumedAt || record.expiresAt <= new Date()) {
        throw new AccessError(404, 'Dieser Link zum Zurücksetzen ist nicht mehr gültig.');
      }
      return { email: record.email };
    },

    async completePasswordReset(token: string, password: string) {
      const passwordHash = await hashPassword(password);
      await db.transaction(async tx => {
        const [record] = await tx.select().from(passwordReset)
          .where(eq(passwordReset.tokenHash, hashToken(token))).for('update');
        if (!record || record.consumedAt || record.expiresAt <= new Date()) {
          throw new AccessError(404, 'Dieser Link zum Zurücksetzen ist nicht mehr gültig.');
        }
        const updated = await tx.update(account).set({ password: passwordHash })
          .where(and(eq(account.userId, record.userId), eq(account.providerId, 'credential'))).returning({ id: account.id });
        if (!updated.length) throw new AccessError(404, 'Dieser Link zum Zurücksetzen ist nicht mehr gültig.');
        await tx.update(passwordReset).set({ consumedAt: new Date() }).where(eq(passwordReset.id, record.id));
        await tx.delete(session).where(eq(session.userId, record.userId));
      });
      return { ok: true as const };
    },
  };
}
export type Membership = ReturnType<typeof createMembership>;
