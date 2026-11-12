import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { createApp } from '../../src/server/app.js';
import { account, membership, user, workspace } from '../../src/server/db/schema.js';
import { bootstrapAdministrator } from '../../src/server/identity/bootstrap.js';
import { ensureStarterLibrary } from '../../src/server/parts/starter.js';
import type { PartDefinition } from '../../src/shared/parts/definition.js';
import { testAdministrator, testDatabase } from './database.js';

export type Role = 'administrator' | 'editor' | 'viewer';
export type Reply<T = any> = { status: number; body: T };

/** A running app on a fresh database with one user per role and a login for each. */
export async function startCatalogApp() {
  const fixture = await testDatabase();
  await bootstrapAdministrator(fixture.db, fixture.config, testAdministrator);
  const ids: Record<Role, string> = { administrator: '', editor: randomUUID(), viewer: randomUUID() };
  ids.administrator = (await fixture.db.select().from(user))[0]!.id;
  for (const role of ['editor', 'viewer'] as const) {
    await fixture.db.insert(user).values({ id: ids[role], email: `${role}@example.test`, name: `Nutzer ${role}` });
    await fixture.db.insert(account).values({
      id: randomUUID(), userId: ids[role], accountId: ids[role], providerId: 'credential', password: await hashPassword(testAdministrator.password),
    });
    await fixture.db.insert(membership).values({ workspaceId: fixture.config.WORKSPACE_ID, userId: ids[role], role });
  }
  const app = await createApp(fixture.db, fixture.config);
  const headers = {} as Record<Role, { cookie: string; origin: string }>;
  for (const role of ['administrator', 'editor', 'viewer'] as const) {
    const response = await app.inject({
      method: 'POST', url: '/api/auth/sign-in/email',
      payload: { email: role === 'administrator' ? testAdministrator.email : `${role}@example.test`, password: testAdministrator.password },
    });
    assert.equal(response.statusCode, 200, response.body);
    headers[role] = { cookie: response.cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; '), origin: fixture.config.APP_ORIGIN };
  }
  const workspaceId = fixture.config.WORKSPACE_ID;

  async function send<T = any>(role: Role | 'anonymous', method: string, url: string, payload?: unknown): Promise<Reply<T>> {
    const response = await app.inject({
      method: method as 'GET', url,
      headers: role === 'anonymous' ? { origin: fixture.config.APP_ORIGIN } : headers[role],
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
    return { status: response.statusCode, body: response.body ? JSON.parse(response.body) : undefined };
  }

  /** A second workspace the administrator and editor belong to; the viewer does not. */
  async function addWorkspace(name: string, options: { starter?: boolean } = {}) {
    const id = randomUUID();
    await fixture.db.insert(workspace).values({ id, name });
    await fixture.db.insert(membership).values([
      { workspaceId: id, userId: ids.administrator, role: 'administrator' }, { workspaceId: id, userId: ids.editor, role: 'editor' },
    ]);
    if (options.starter) await ensureStarterLibrary(fixture.db, id);
    return id;
  }

  return {
    fixture, app, headers, ids, workspaceId, base: `/api/workspaces/${workspaceId}`, send, addWorkspace,
    close: async () => { await app.close(); await fixture.dispose(); },
  };
}
export type CatalogApp = Awaited<ReturnType<typeof startCatalogApp>>;

export const testId = (serial: number) => `c47a1090-0000-4000-8000-${String(serial).padStart(12, '0')}`;

/** Small part of one beam with two variants, stocked as labelled pieces. */
export function crate(serial: number, name = `Kiste ${serial}`, overrides: Partial<PartDefinition> = {}): PartDefinition {
  return {
    id: testId(serial), revision: 1, name, category: 'Test',
    parameters: [{ key: 'B', label: 'Breite', type: 'length', default: 600, scope: 'variant', range: { min: 300, max: 1200 } }],
    variants: [{ key: 'klein', label: 'Klein', values: { B: 400 } }, { key: 'gross', label: 'Groß', values: { B: 900 } }],
    bodies: [{ kind: 'beam', key: 'latte', material: 'latte-40x40', from: [0, 0, 0], to: ['B', 0, 0] }],
    traits: { stock: 'item' },
    ...overrides,
  };
}
