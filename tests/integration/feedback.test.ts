import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { createApp } from '../../src/server/app.js';
import { createFakeMailTransport } from '../../src/server/mail/transport.js';
import { bootstrapAdministrator } from '../../src/server/identity/bootstrap.js';
import { account, auditEvent, membership, user } from '../../src/server/db/schema.js';
import { testAdministrator, testDatabase } from '../helpers/database.js';
import { pngBytes } from '../helpers/references.js';

let fixture: Awaited<ReturnType<typeof testDatabase>>;
let app: Awaited<ReturnType<typeof createApp>>;
let url: string;
let headers: { cookie: string; origin: string };
let clock = Date.now();
const mail = createFakeMailTransport();
const payload = () => ({ category: 'issue', message: 'Eine Wand verschwindet.', capturedAt: new Date(clock).toISOString(), page: { section: 'plans' }, browser: 'Test Browser', viewport: { width: 1200, height: 800 } });
before(async () => {
  fixture = await testDatabase(undefined, { FEEDBACK_TO_EMAIL: 'maintainer@example.test' });
  await bootstrapAdministrator(fixture.db, fixture.config, testAdministrator);
  const id = randomUUID();
  await fixture.db.insert(user).values({ id, name: 'Viewer', email: 'viewer@example.test' });
  await fixture.db.insert(account).values({ id: randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword(testAdministrator.password) });
  await fixture.db.insert(membership).values({ userId: id, workspaceId: fixture.config.WORKSPACE_ID, role: 'viewer' });
  app = await createApp(fixture.db, fixture.config, { mail, clock: () => new Date(clock) });
  const login = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: { email: 'viewer@example.test', password: testAdministrator.password } });
  assert.equal(login.statusCode, 200);
  headers = { cookie: login.cookies.map(c => `${c.name}=${c.value}`).join('; '), origin: fixture.config.APP_ORIGIN };
  url = `/api/workspaces/${fixture.config.WORKSPACE_ID}/feedback`;
});
after(async () => { await app?.close(); await fixture?.dispose(); });

test('viewer can report with server-controlled identity and attachments', async () => {
  const options = await app.inject({ url: '/api/feedback-options', headers });
  assert.equal(options.json().enabled, true);
  assert(!options.body.includes('maintainer@'));
  const auditBefore = await fixture.db.select({ id: auditEvent.id }).from(auditEvent);
  const response = await app.inject({ method: 'POST', url, headers, payload: { ...payload(),
    images: [{ type: 'image/png', base64: pngBytes(16, 16).toString('base64') }],
    snapshot: JSON.stringify({ version: 1, kind: 'layout', layout: { schemaVersion: 2, objects: [], joints: [] }, venue: { schemaVersion: 1, width: 8000, depth: 6000 } }),
  } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(mail.messages.length, 1);
  assert.equal((await fixture.db.select({ id: auditEvent.id }).from(auditEvent)).length, auditBefore.length, 'feedback content and submissions are not stored in the app database');
  const sent = mail.messages[0]!;
  assert.equal(sent.to, 'maintainer@example.test');
  assert.equal(sent.replyTo, 'viewer@example.test');
  assert.equal(sent.attachments?.length, 3);
  const context = JSON.parse(sent.attachments![0]!.content.toString());
  assert.equal(context.sender.email, 'viewer@example.test');
  assert.equal(context.version, fixture.config.APP_VERSION);
  assert.equal(context.url, fixture.config.APP_ORIGIN + '#/produktionen');
  assert.deepEqual(sent.attachments![1]!.content, pngBytes(16, 16));
});

test('feedback enforces authentication, origin, membership and strict input', async () => {
  assert.equal((await app.inject({ url: '/api/feedback-options' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url, payload: payload() })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url, headers: { ...headers, origin: 'https://evil.example' }, payload: payload() })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: `/api/workspaces/${randomUUID()}/feedback`, headers, payload: payload() })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url, headers, payload: { ...payload(), to: 'other@example.test' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url, headers, payload: { ...payload(), images: [{ type: 'image/png', base64: Buffer.from('not an image').toString('base64') }] } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url, headers, payload: { ...payload(), snapshot: '{bad json}' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url, headers, payload: { ...payload(), message: 'x'.repeat(4001) } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url, headers, payload: { ...payload(), images: [{ type: 'image/png', base64: Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64') }] } })).statusCode, 400);
  assert.equal(mail.messages.length, 1);
});

test('mail failures surface for retry; attempts are limited and expire', async () => {
  clock += 60_001; mail.clear(); mail.failNext();
  const failure = await app.inject({ method: 'POST', url, headers, payload: payload() });
  assert.equal(failure.statusCode, 503); assert.equal(mail.messages.length, 0);
  for (let i = 0; i < 4; i++) assert.equal((await app.inject({ method: 'POST', url, headers, payload: { ...payload(), category: 'feature' } })).statusCode, 200);
  const limited = await app.inject({ method: 'POST', url, headers, payload: payload() });
  assert.equal(limited.statusCode, 429); assert(limited.headers['retry-after']);
  clock += 60_001;
  assert.equal((await app.inject({ method: 'POST', url, headers, payload: payload() })).statusCode, 200);
});

test('missing configuration disables feedback and prevents sending', async () => {
  const disabled = await createApp(fixture.db, { ...fixture.config, FEEDBACK_TO_EMAIL: undefined }, { mail });
  try {
    assert.equal((await disabled.inject({ url: '/api/feedback-options', headers })).json().enabled, false);
    assert.equal((await disabled.inject({ method: 'POST', url, headers, payload: payload() })).statusCode, 503);
  } finally { await disabled.close(); }
});
