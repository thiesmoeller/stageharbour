import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { createApp } from '../../src/server/app.js';
import { bootstrapAdministrator } from '../../src/server/identity/bootstrap.js';
import { account, membership } from '../../src/server/db/schema.js';
import { testAdministrator, testDatabase } from '../helpers/database.js';
import { startOidcProvider } from '../helpers/oidc.js';

const cookies = new Map<string, string>();
function store(response: { cookies: Array<{ name: string; value: string; maxAge?: number }> }) {
  for (const cookie of response.cookies) {
    if (!cookie.value || cookie.maxAge === 0) cookies.delete(cookie.name);
    else cookies.set(cookie.name, cookie.value);
  }
}
function header() { return [...cookies].map(([name, value]) => `${name}=${value}`).join('; '); }

let oidc: Awaited<ReturnType<typeof startOidcProvider>>;
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let app: Awaited<ReturnType<typeof createApp>>;

before(async () => {
  oidc = await startOidcProvider();
  fixture = await testDatabase('http://localhost:5173', {
    OIDC_ISSUER: oidc.issuer, OIDC_CLIENT_ID: oidc.clientId, OIDC_CLIENT_SECRET: oidc.clientSecret,
  });
  await bootstrapAdministrator(fixture.db, fixture.config, testAdministrator);
  app = await createApp(fixture.db, fixture.config);
});
after(async () => { await app?.close(); await fixture?.dispose(); await oidc?.close(); });

async function completeOidc(path = '/api/auth/sign-in/social') {
  const start = await app.inject({
    method: 'POST', url: path, headers: { origin: fixture.config.APP_ORIGIN, cookie: header() },
    payload: { provider: 'pocket-id', callbackURL: '/', errorCallbackURL: '/', disableRedirect: true },
  });
  store(start);
  assert.equal(start.statusCode, 200, start.body);
  const location = new URL((start.json() as { url: string }).url);
  const redirected = await fetch(location, { redirect: 'manual' });
  assert.equal(redirected.status, 302);
  const callback = new URL(redirected.headers.get('location') ?? '');
  const done = await app.inject({ method: 'GET', url: `${callback.pathname}${callback.search}`, headers: { cookie: header() } });
  store(done);
  return { start, done, callback };
}

test('login options expose Pocket ID only when configured, and other auth routes stay closed', async () => {
  assert.deepEqual((await app.inject('/api/login-options')).json(), { oidc: true, version: fixture.config.APP_VERSION });
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/sign-up/email', payload: testAdministrator })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: '/api/auth/callback/other' })).statusCode, 404);
  const crossOrigin = await app.inject({
    method: 'POST', url: '/api/auth/sign-in/social', headers: { origin: 'https://other.example' },
    payload: { provider: 'pocket-id', callbackURL: '/' },
  });
  assert.equal(crossOrigin.statusCode, 403);
});

test('OIDC callback with state and nonce signs in without granting membership', async () => {
  cookies.clear();
  const { done, callback } = await completeOidc();
  assert.match(callback.search, /state=/);
  assert.equal(done.statusCode, 302, done.body);
  const session = await app.inject({ url: '/api/auth/get-session', headers: { cookie: header() } });
  assert.equal(session.statusCode, 200, session.body);
  assert.equal(session.json().user.email, 'oidc@example.test');
  const me = await app.inject({ url: '/api/me', headers: { cookie: header() } });
  assert.equal(me.statusCode, 404);
  await fixture.db.insert(membership).values({ workspaceId: fixture.config.WORKSPACE_ID, userId: session.json().user.id, role: 'editor' });
  assert.equal((await app.inject({ url: '/api/me', headers: { cookie: header() } })).json().workspace.role, 'editor');
  const logout = await app.inject({ method: 'POST', url: '/api/auth/sign-out', headers: { cookie: header(), origin: fixture.config.APP_ORIGIN }, payload: {} });
  assert.equal(logout.statusCode, 200);
  assert.equal((await app.inject({ url: '/api/me', headers: { cookie: header() } })).statusCode, 401);
});

test('forged OIDC state or missing nonce cannot establish a session', async () => {
  cookies.clear();
  const start = await app.inject({
    method: 'POST', url: '/api/auth/sign-in/social', headers: { origin: fixture.config.APP_ORIGIN },
    payload: { provider: 'pocket-id', callbackURL: '/', disableRedirect: true },
  });
  store(start);
  const authorize = await fetch((start.json() as { url: string }).url, { redirect: 'manual' });
  const callback = new URL(authorize.headers.get('location') ?? '');
  callback.searchParams.set('state', 'forged-state');
  const forged = await app.inject({ method: 'GET', url: `${callback.pathname}${callback.search}`, headers: { cookie: header() } });
  cookies.clear();
  store(forged);
  assert.notEqual((await app.inject({ url: '/api/auth/get-session', headers: { cookie: header() } })).json()?.user?.email, 'oidc@example.test');
  oidc.omitNonce(true);
  cookies.clear();
  await completeOidc();
  const session = await app.inject({ url: '/api/auth/get-session', headers: { cookie: header() } });
  assert.equal(session.json()?.user ?? null, null);
  oidc.omitNonce(false);
});

test('matching email does not merge identities; linking requires a signed-in local account and OIDC proof', async () => {
  cookies.clear();
  const password = await app.inject({
    method: 'POST', url: '/api/auth/sign-in/email', headers: { origin: fixture.config.APP_ORIGIN },
    payload: { email: testAdministrator.email, password: testAdministrator.password },
  });
  assert.equal(password.statusCode, 200);
  const adminCookie = password.cookies.map(value => `${value.name}=${value.value}`).join('; ');
  const before = await fixture.db.select({ providerId: account.providerId }).from(account)
    .where(eq(account.userId, (await app.inject({ url: '/api/auth/get-session', headers: { cookie: adminCookie } })).json().user.id));
  assert.deepEqual(before.map(row => row.providerId), ['credential']);
  cookies.clear();
  oidc.setUser({ sub: 'same-mail', email: testAdministrator.email, name: 'Andere Person', email_verified: true });
  await completeOidc();
  const merged = await app.inject({ url: '/api/auth/get-session', headers: { cookie: header() } });
  assert.equal(merged.json()?.user ?? null, null);
  const still = await fixture.db.select({ providerId: account.providerId }).from(account)
    .where(and(eq(account.userId, (await app.inject({ url: '/api/auth/get-session', headers: { cookie: adminCookie } })).json().user.id), eq(account.providerId, 'pocket-id')));
  assert.equal(still.length, 0);
  cookies.clear();
  store(password);
  oidc.setUser({ sub: 'linked-pocket', email: testAdministrator.email, name: testAdministrator.name, email_verified: true });
  const linked = await completeOidc('/api/auth/link-social');
  assert.equal(linked.done.statusCode, 302, linked.done.body);
  const accounts = await app.inject({ url: '/api/auth/list-accounts', headers: { cookie: header() } });
  assert.equal(accounts.statusCode, 200, accounts.body);
  assert(accounts.json().some((row: { providerId: string }) => row.providerId === 'pocket-id'));
  const logout = await app.inject({ method: 'POST', url: '/api/auth/sign-out', headers: { cookie: header(), origin: fixture.config.APP_ORIGIN }, payload: {} });
  assert.equal(logout.statusCode, 200);
  cookies.clear();
  await completeOidc();
  assert.equal((await app.inject({ url: '/api/me', headers: { cookie: header() } })).json().user.email, testAdministrator.email);
});
