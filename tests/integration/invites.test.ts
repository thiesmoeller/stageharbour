import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import { createApp } from '../../src/server/app.js';
import { bootstrapAdministrator } from '../../src/server/identity/bootstrap.js';
import { account, invitation, membership, passwordReset, user } from '../../src/server/db/schema.js';
import { createFakeMailTransport } from '../../src/server/mail/transport.js';
import { testAdministrator, testDatabase } from '../helpers/database.js';

let fixture: Awaited<ReturnType<typeof testDatabase>>;
let app: Awaited<ReturnType<typeof createApp>>;
let mail: ReturnType<typeof createFakeMailTransport>;
let cookie: string;
let origin: string;
let members: string;
const editor = { email: 'editor@example.test', name: 'Editorin Beispiel' };

before(async () => {
  fixture = await testDatabase();
  origin = fixture.config.APP_ORIGIN;
  members = `/api/workspaces/${fixture.config.WORKSPACE_ID}/members`;
  mail = createFakeMailTransport();
  await bootstrapAdministrator(fixture.db, fixture.config, testAdministrator);
  app = await createApp(fixture.db, fixture.config, { mail });
  cookie = await login(testAdministrator.email);
});
after(async () => { await app?.close(); await fixture?.dispose(); });

async function login(email: string, password = testAdministrator.password) {
  const response = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email',
    headers: { origin }, payload: { email, password, rememberMe: false },
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.cookies.map(value => `${value.name}=${value.value}`).join('; ');
}
function auth(extra: Record<string, string> = {}) {
  return { cookie, origin, ...extra };
}
function tokenFrom(text: string, kind: 'einladung' | 'passwort') {
  const match = text.match(new RegExp(`#/${kind}/([A-Za-z0-9_-]+)`));
  assert(match, text);
  return match[1]!;
}
async function addMember(email: string, role: 'editor' | 'viewer' | 'administrator') {
  const id = randomUUID();
  await fixture.db.insert(user).values({ id, name: email, email });
  await fixture.db.insert(account).values({ id: randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword(testAdministrator.password) });
  await fixture.db.insert(membership).values({ workspaceId: fixture.config.WORKSPACE_ID, userId: id, role });
  return id;
}

test('invitation mail is queued, failed delivery can be retried, and reset mail is delivered', async () => {
  const invitations = `/api/workspaces/${fixture.config.WORKSPACE_ID}/invitations`;
  mail.failNext();
  const failed = await app.inject({ method: 'POST', url: invitations, headers: auth(),
    payload: { email: editor.email, name: editor.name, role: 'editor' } });
  assert.equal(failed.statusCode, 503, failed.body);
  assert.equal(mail.messages.length, 0);
  const retry = await app.inject({ method: 'POST', url: invitations, headers: auth(),
    payload: { email: editor.email, name: editor.name, role: 'editor' } });
  assert.equal(retry.statusCode, 201, retry.body);
  assert.equal(retry.json().email, editor.email);
  assert.equal(mail.messages.length, 1);
  assert.equal(mail.messages[0]?.to, editor.email);
  assert.match(mail.messages[0]?.subject ?? '', /Einladung/);
  assert.match(mail.messages[0]?.text ?? '', /Bearbeitung/);
  assert.match(mail.messages[0]?.text ?? '', /#\/einladung\//);

  const reset = await app.inject({ method: 'POST', url: '/api/password-resets', headers: { origin }, payload: { email: testAdministrator.email } });
  assert.equal(reset.statusCode, 200, reset.body);
  assert.equal(mail.messages.length, 2);
  assert.equal(mail.messages[1]?.to, testAdministrator.email);
  assert.match(mail.messages[1]?.subject ?? '', /Passwort/);
  assert.match(mail.messages[1]?.text ?? '', /#\/passwort\//);
  const unknown = await app.inject({ method: 'POST', url: '/api/password-resets', headers: { origin }, payload: { email: 'nobody@example.test' } });
  assert.equal(unknown.statusCode, 200);
  assert.equal(mail.messages.length, 2);
});

test('only administrators invite; accept creates membership and session; expired and replayed tokens are rejected; CSRF holds', async () => {
  const inviteUrl = `/api/workspaces/${fixture.config.WORKSPACE_ID}/invitations`;
  assert.equal((await app.inject({ method: 'POST', url: inviteUrl, headers: { cookie }, payload: { email: 'csrf@example.test', name: 'CSRF', role: 'viewer' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: inviteUrl, headers: { cookie, origin: 'https://other.example' }, payload: { email: 'csrf@example.test', name: 'CSRF', role: 'viewer' } })).statusCode, 403);

  await addMember('viewer@example.test', 'viewer');
  const viewerCookie = await login('viewer@example.test');
  assert.equal((await app.inject({ method: 'POST', url: inviteUrl, headers: { cookie: viewerCookie, origin }, payload: { email: 'uninvited@example.test', name: 'Nein', role: 'editor' } })).statusCode, 403);
  await addMember('existing-editor@example.test', 'editor');
  const editorCookie = await login('existing-editor@example.test');
  assert.equal((await app.inject({ method: 'POST', url: inviteUrl, headers: { cookie: editorCookie, origin }, payload: { email: 'uninvited@example.test', name: 'Nein', role: 'viewer' } })).statusCode, 403);

  const duplicate = await app.inject({ method: 'POST', url: inviteUrl, headers: auth(), payload: { email: 'existing-editor@example.test', name: 'Doppelt', role: 'viewer' } });
  assert.equal(duplicate.statusCode, 409, duplicate.body);

  mail.clear();
  const invited = await app.inject({ method: 'POST', url: inviteUrl, headers: auth(), payload: { email: 'neu@example.test', name: 'Neues Mitglied', role: 'editor' } });
  assert.equal(invited.statusCode, 201, invited.body);
  assert.match(mail.messages[0]?.text ?? '', /ohne Passwort/);
  const token = tokenFrom(mail.messages[0]!.text, 'einladung');
  const preview = await app.inject({ url: `/api/invitations/${token}` });
  assert.equal(preview.statusCode, 200, preview.body);
  assert.equal(preview.json().email, 'neu@example.test');
  assert.equal(preview.json().role, 'editor');
  assert.equal((await app.inject({ method: 'POST', url: `/api/invitations/${token}/accept`, payload: {} })).statusCode, 403);
  const accepted = await app.inject({ method: 'POST', url: `/api/invitations/${token}/accept`, headers: { origin }, payload: {} });
  assert.equal(accepted.statusCode, 201, accepted.body);
  assert.equal(accepted.json().user.email, 'neu@example.test');
  const createdCookie = accepted.cookies.map(value => `${value.name}=${value.value}`).join('; ');
  assert(createdCookie.includes('session_token') || createdCookie.includes('better-auth'), createdCookie);
  const me = await app.inject({ url: '/api/me', headers: { cookie: createdCookie } });
  assert.equal(me.statusCode, 200, me.body);
  assert.equal(me.json().workspace.role, 'editor');
  assert.equal(me.json().user.name, 'Neues Mitglied');
  assert.equal((await app.inject({ url: members, headers: { cookie: createdCookie } })).statusCode, 403);
  assert.equal((await fixture.db.select().from(user)).filter(row => row.email === 'neu@example.test').length, 1);
  const replay = await app.inject({ method: 'POST', url: `/api/invitations/${token}/accept`, headers: { origin }, payload: {} });
  assert.equal(replay.statusCode, 404);

  mail.clear();
  const expiring = await app.inject({ method: 'POST', url: inviteUrl, headers: auth(), payload: { email: 'spaet@example.test', name: 'Zu spät', role: 'viewer' } });
  assert.equal(expiring.statusCode, 201, expiring.body);
  const expiredToken = tokenFrom(mail.messages[0]!.text, 'einladung');
  await fixture.db.update(invitation).set({ expiresAt: new Date(0) }).where(eq(invitation.email, 'spaet@example.test'));
  assert.equal((await app.inject({ url: `/api/invitations/${expiredToken}` })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: `/api/invitations/${expiredToken}/accept`, headers: { origin }, payload: {} })).statusCode, 404);
});

test('magic link signs in an existing member and rejects unknown addresses', async () => {
  mail.clear();
  const unknown = await app.inject({
    method: 'POST', url: '/api/auth/sign-in/magic-link', headers: { origin },
    payload: { email: 'nobody@example.test', callbackURL: '/' },
  });
  assert.equal(unknown.statusCode, 200, unknown.body);
  assert.equal(mail.messages.length, 1);
  const verifyUnknown = mail.messages[0]!.text.match(/magic-link\/verify\?[^\s]+/);
  assert(verifyUnknown, mail.messages[0]!.text);
  const bad = await app.inject({ url: `/api/auth/${verifyUnknown![0]!}` });
  assert.equal(bad.statusCode, 302, bad.body);
  assert.match(String(bad.headers.location ?? ''), /error=/);

  mail.clear();
  const invited = await app.inject({
    method: 'POST', url: `/api/workspaces/${fixture.config.WORKSPACE_ID}/invitations`, headers: auth(),
    payload: { email: 'magie@example.test', name: 'Magie Mitglied', role: 'viewer' },
  });
  assert.equal(invited.statusCode, 201, invited.body);
  const inviteToken = tokenFrom(mail.messages[0]!.text, 'einladung');
  assert.equal((await app.inject({
    method: 'POST', url: `/api/invitations/${inviteToken}/accept`, headers: { origin }, payload: {},
  })).statusCode, 201);

  mail.clear();
  const requested = await app.inject({
    method: 'POST', url: '/api/auth/sign-in/magic-link', headers: { origin },
    payload: { email: 'magie@example.test', callbackURL: '/' },
  });
  assert.equal(requested.statusCode, 200, requested.body);
  assert.equal(mail.messages.length, 1);
  const link = mail.messages[0]!.text.match(/https?:\/\/[^\s]+\/api\/auth\/magic-link\/verify\?[^\s]+/);
  assert(link, mail.messages[0]!.text);
  const verifyUrl = new URL(link![0]!);
  const verified = await app.inject({ url: `${verifyUrl.pathname}${verifyUrl.search}` });
  assert.equal(verified.statusCode, 302, verified.body);
  assert.equal(verified.headers.location, `${origin}/`);
  const sessionCookie = verified.cookies.map(value => `${value.name}=${value.value}`).join('; ');
  const me = await app.inject({ url: '/api/me', headers: { cookie: sessionCookie } });
  assert.equal(me.statusCode, 200, me.body);
  assert.equal(me.json().user.email, 'magie@example.test');
  assert.equal(me.json().workspace.role, 'viewer');
});

test('administrators can change roles and revoke access; the last administrator is protected', async () => {
  const id = await addMember('rolle@example.test', 'editor');
  const memberCookie = () => login('rolle@example.test');
  const patch = `${members}/${id}`;
  assert.equal((await app.inject({ method: 'PATCH', url: patch, headers: { cookie }, payload: { role: 'viewer' } })).statusCode, 403);
  const changed = await app.inject({ method: 'PATCH', url: patch, headers: auth(), payload: { role: 'viewer' } });
  assert.equal(changed.statusCode, 200, changed.body);
  assert.equal((await app.inject({ url: '/api/me', headers: { cookie: await memberCookie() } })).json().workspace.role, 'viewer');
  assert.equal((await app.inject({ method: 'PATCH', url: patch, headers: auth(), payload: { role: 'administrator' } })).statusCode, 200);
  assert.equal((await app.inject({ url: '/api/me', headers: { cookie: await memberCookie() } })).json().workspace.role, 'administrator');

  const [admin] = await fixture.db.select().from(membership).innerJoin(user, eq(membership.userId, user.id))
    .where(eq(user.email, testAdministrator.email));
  assert.equal((await app.inject({ method: 'DELETE', url: `${members}/${admin!.membership.userId}`, headers: auth() })).statusCode, 200);
  assert.equal((await app.inject({ url: '/api/me', headers: { cookie } })).statusCode, 404);
  cookie = await memberCookie();
  assert.equal((await app.inject({ method: 'DELETE', url: `${members}/${id}`, headers: auth() })).statusCode, 409);
  assert.equal((await app.inject({ method: 'PATCH', url: `${members}/${id}`, headers: auth(), payload: { role: 'editor' } })).statusCode, 409);

  const extra = await addMember('zweite-admin@example.test', 'administrator');
  const revoked = await app.inject({ method: 'DELETE', url: `${members}/${extra}`, headers: auth() });
  assert.equal(revoked.statusCode, 200, revoked.body);
  assert.equal((await app.inject({ url: '/api/me', headers: { cookie: await login('zweite-admin@example.test') } })).statusCode, 404);
});

test('password reset tokens are single-use and cannot change another account', async () => {
  await addMember('andere@example.test', 'viewer');
  mail.clear();
  assert.equal((await app.inject({ method: 'POST', url: '/api/password-resets', payload: { email: 'rolle@example.test' } })).statusCode, 403);
  const requested = await app.inject({ method: 'POST', url: '/api/password-resets', headers: { origin }, payload: { email: 'rolle@example.test' } });
  assert.equal(requested.statusCode, 200, requested.body);
  const token = tokenFrom(mail.messages[0]!.text, 'passwort');
  const preview = await app.inject({ url: `/api/password-resets/${token}` });
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.json().email, 'rolle@example.test');
  await fixture.db.update(passwordReset).set({ expiresAt: new Date(0) });
  assert.equal((await app.inject({ url: `/api/password-resets/${token}` })).statusCode, 404);
  await fixture.db.update(passwordReset).set({ expiresAt: new Date(Date.now() + 60_000) });

  const completed = await app.inject({ method: 'POST', url: `/api/password-resets/${token}`, headers: { origin }, payload: { password: 'new-password-7319' } });
  assert.equal(completed.statusCode, 200, completed.body);
  const replay = await app.inject({ method: 'POST', url: `/api/password-resets/${token}`, headers: { origin }, payload: { password: 'hijack-password-7319' } });
  assert.equal(replay.statusCode, 404);
  await login('rolle@example.test', 'new-password-7319');
  await login('andere@example.test', testAdministrator.password);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', headers: { origin }, remoteAddress: '192.0.2.90',
    payload: { email: 'rolle@example.test', password: testAdministrator.password } })).statusCode, 401);
});
