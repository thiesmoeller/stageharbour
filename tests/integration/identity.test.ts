import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import { createApp } from '../../src/server/app.js';
import { bootstrapAdministrator } from '../../src/server/identity/bootstrap.js';
import { account, membership, session, user, workspace } from '../../src/server/db/schema.js';
import { testAdministrator, testDatabase } from '../helpers/database.js';

let fixture: Awaited<ReturnType<typeof testDatabase>>;
let app: Awaited<ReturnType<typeof createApp>>;
let cookie: string;
before(async () => {
  fixture = await testDatabase();
  const outcomes = await Promise.all([
    bootstrapAdministrator(fixture.db, fixture.config, testAdministrator),
    bootstrapAdministrator(fixture.db, fixture.config, testAdministrator),
  ]);
  assert.deepEqual(outcomes.sort(), ['already-initialized', 'created']);
  app = await createApp(fixture.db, fixture.config);
  cookie = await login(testAdministrator.email);
});
after(async () => { await app?.close(); await fixture?.dispose(); });

async function login(email: string) {
  const response = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email',
    headers: { origin: fixture.config.APP_ORIGIN }, payload: { email, password: testAdministrator.password },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert(response.cookies.some(value => value.httpOnly));
  assert(response.cookies.some(value => value.sameSite === 'Lax'));
  return response.cookies.map(value => `${value.name}=${value.value}`).join('; ');
}
async function addIdentity(email: string) {
  const id = randomUUID();
  await fixture.db.insert(user).values({ id, name: 'Testkonto', email });
  await fixture.db.insert(account).values({ id: randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword(testAdministrator.password) });
  return id;
}

test('public registration is closed, unauthenticated access is denied, and errors stay generic', async () => {
  assert.equal((await app.inject('/api/me')).statusCode, 401);
  assert.deepEqual((await app.inject('/api/login-options')).json(), { oidc: false, version: fixture.config.APP_VERSION });
  const signUp = await app.inject({ method: 'POST', url: '/api/auth/sign-up/email', payload: { ...testAdministrator, email: 'uninvited@example.test' } });
  assert.equal(signUp.statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/sign-in/social', payload: { provider: 'pocket-id' } })).statusCode, 404);
  assert.equal((await fixture.db.select().from(user)).length, 1);
  const wrongPassword = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: { email: testAdministrator.email, password: 'incorrect-password' } });
  assert.equal(wrongPassword.statusCode, 401);
  const crossOrigin = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', headers: { origin: 'https://other.example' }, payload: testAdministrator });
  assert.equal(crossOrigin.statusCode, 403);
});

test('administrator can reopen the workspace and read only its member directory', async () => {
  const me = await app.inject({ url: '/api/me', headers: { cookie } });
  assert.equal(me.statusCode, 200, me.body);
  assert.equal(me.json().workspace.id, fixture.config.WORKSPACE_ID);
  assert.equal(me.json().workspace.role, 'administrator');
  assert.equal(me.headers['cache-control'], 'no-store');
  const directory = await app.inject({ url: `/api/workspaces/${fixture.config.WORKSPACE_ID}/members`, headers: { cookie } });
  assert.equal(directory.statusCode, 200);
  assert.equal(directory.json()[0].email, testAdministrator.email);
  const contract = await app.inject({ url: '/api/openapi.json', headers: { cookie } });
  assert.equal(contract.statusCode, 200);
  assert(contract.json().paths['/api/me']);
});

test('substituting another workspace identifier cannot reveal it or its members', async () => {
  const foreignId = randomUUID();
  await fixture.db.insert(workspace).values({ id: foreignId, name: 'Foreign private workspace' });
  for (const suffix of ['', '/members']) {
    const response = await app.inject({ url: `/api/workspaces/${foreignId}${suffix}`, headers: { cookie } });
    assert.equal(response.statusCode, 404);
    assert(!response.body.includes('Foreign'));
  }
  assert.equal((await app.inject({ url: '/api/workspaces/not-a-uuid', headers: { cookie } })).statusCode, 400);
});

test('authentication alone grants no membership; role changes are checked on every request', async () => {
  const id = await addIdentity('member@example.test');
  const memberCookie = await login('member@example.test');
  const read = () => app.inject({ url: '/api/me', headers: { cookie: memberCookie } });
  const directory = () => app.inject({ url: `/api/workspaces/${fixture.config.WORKSPACE_ID}/members`, headers: { cookie: memberCookie } });
  assert.equal((await read()).statusCode, 404);
  await fixture.db.insert(membership).values({ workspaceId: fixture.config.WORKSPACE_ID, userId: id, role: 'viewer' });
  assert.equal((await read()).json().workspace.role, 'viewer');
  assert.equal((await directory()).statusCode, 403);
  await fixture.db.update(membership).set({ role: 'editor' }).where(eq(membership.userId, id));
  assert.equal((await read()).json().workspace.role, 'editor');
  assert.equal((await directory()).statusCode, 403);
  await fixture.db.delete(membership).where(eq(membership.userId, id));
  assert.equal((await read()).statusCode, 404);
});

test('bootstrap cannot reset a password or add a second administrator', async () => {
  assert.equal(await bootstrapAdministrator(fixture.db, fixture.config, { ...testAdministrator, password: 'different-password-123' }), 'already-initialized');
  await login(testAdministrator.email);
  await assert.rejects(bootstrapAdministrator(fixture.db, fixture.config, { ...testAdministrator, email: 'takeover@example.test' }), /cannot add or promote/);
});

test('expired sessions and signed-out cookies cannot reopen private data', async () => {
  const expiringCookie = await login(testAdministrator.email);
  await fixture.db.update(session).set({ expiresAt: new Date(0) });
  assert.equal((await app.inject({ url: '/api/me', headers: { cookie: expiringCookie } })).statusCode, 401);
  const freshCookie = await login(testAdministrator.email);
  const logout = await app.inject({ method: 'POST', url: '/api/auth/sign-out', headers: { cookie: freshCookie, origin: fixture.config.APP_ORIGIN }, payload: {} });
  assert.equal(logout.statusCode, 200);
  assert.equal((await app.inject({ url: '/api/me', headers: { cookie: freshCookie } })).statusCode, 401);
});

test('forged forwarding headers cannot bypass login rate limits', async () => {
  for (let attempt = 0; attempt < 11; attempt++) {
    const response = await app.inject({
      method: 'POST', url: '/api/auth/sign-in/email', remoteAddress: '192.0.2.10',
      headers: { 'x-stage-client-ip': `192.0.2.${attempt + 20}`, 'x-forwarded-for': `192.0.2.${attempt + 40}` },
      payload: { email: testAdministrator.email, password: 'invalid-password' },
    });
    assert.equal(response.statusCode, attempt < 10 ? 401 : 429);
  }
});
