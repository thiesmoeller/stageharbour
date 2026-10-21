import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../src/server/app.js';
import { bootstrapAdministrator } from '../../src/server/identity/bootstrap.js';
import { testAdministrator, testDatabase } from '../helpers/database.js';
import { pngBytes } from '../helpers/references.js';

let fixture: Awaited<ReturnType<typeof testDatabase>>;
let app: Awaited<ReturnType<typeof createApp>>;
let base: string;
let headers: { cookie: string; origin: string };

before(async () => {
  fixture = await testDatabase();
  await bootstrapAdministrator(fixture.db, fixture.config, testAdministrator);
  app = await createApp(fixture.db, fixture.config);
  base = `/api/workspaces/${fixture.config.WORKSPACE_ID}`;
  const login = await app.inject({
    method: 'POST', url: '/api/auth/sign-in/email',
    payload: { email: testAdministrator.email, password: testAdministrator.password },
  });
  assert.equal(login.statusCode, 200);
  headers = {
    cookie: login.cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; '),
    origin: fixture.config.APP_ORIGIN,
  };
});
after(async () => { await app?.close(); await fixture?.dispose(); });

test('public branding defaults and administrators can set site branding with a logo', async () => {
  const defaults = await app.inject({ url: '/api/branding' });
  assert.equal(defaults.statusCode, 200);
  assert.deepEqual(defaults.json(), {
    productName: 'StageHarbour',
    tagline: 'GEMEINSAM THEATER MACHEN',
    footerText: 'Für die Bühne. Für die Menschen dahinter.',
    hasLogo: false,
  });
  assert.equal((await app.inject({ url: '/api/branding/logo' })).statusCode, 404);

  const updated = await app.inject({
    method: 'PUT', url: `${base}/branding`, headers,
    payload: {
      productName: 'Probebühne Planer',
      tagline: 'SELBST GEHOSTET',
      footerText: 'Für eure eigene Bühne.',
    },
  });
  assert.equal(updated.statusCode, 200, updated.body);
  assert.deepEqual(updated.json(), {
    productName: 'Probebühne Planer',
    tagline: 'SELBST GEHOSTET',
    footerText: 'Für eure eigene Bühne.',
    hasLogo: false,
  });

  const logo = await app.inject({
    method: 'POST', url: `${base}/branding/logo`,
    headers: { ...headers, 'content-type': 'image/png', 'x-file-name': 'logo.png' },
    payload: pngBytes(16, 16),
  });
  assert.equal(logo.statusCode, 200, logo.body);
  assert.equal(logo.json().hasLogo, true);

  const publicBranding = await app.inject({ url: '/api/branding' });
  assert.equal(publicBranding.json().productName, 'Probebühne Planer');
  assert.equal(publicBranding.json().hasLogo, true);

  const served = await app.inject({ url: '/api/branding/logo' });
  assert.equal(served.statusCode, 200);
  assert.equal(served.headers['content-type'], 'image/png');
  assert.deepEqual(Buffer.from(served.rawPayload), pngBytes(16, 16));

  const cleared = await app.inject({ method: 'DELETE', url: `${base}/branding/logo`, headers });
  assert.equal(cleared.statusCode, 200);
  assert.equal(cleared.json().hasLogo, false);
  assert.equal((await app.inject({ url: '/api/branding/logo' })).statusCode, 404);
});

test('editors cannot change site branding', async () => {
  const { randomUUID } = await import('node:crypto');
  const { hashPassword } = await import('better-auth/crypto');
  const { account, membership, user } = await import('../../src/server/db/schema.js');
  const editorId = randomUUID();
  await fixture.db.insert(user).values({ id: editorId, email: 'branding-editor@example.test', name: 'Editor' });
  await fixture.db.insert(account).values({
    id: randomUUID(), userId: editorId, accountId: editorId, providerId: 'credential',
    password: await hashPassword(testAdministrator.password),
  });
  await fixture.db.insert(membership).values({
    workspaceId: fixture.config.WORKSPACE_ID, userId: editorId, role: 'editor',
  });
  const login = await app.inject({
    method: 'POST', url: '/api/auth/sign-in/email',
    payload: { email: 'branding-editor@example.test', password: testAdministrator.password },
  });
  const editorHeaders = {
    cookie: login.cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; '),
    origin: fixture.config.APP_ORIGIN,
  };
  assert.equal((await app.inject({
    method: 'PUT', url: `${base}/branding`, headers: editorHeaders,
    payload: { productName: 'Hack', tagline: '', footerText: '' },
  })).statusCode, 403);
  assert.equal((await app.inject({
    method: 'POST', url: `${base}/branding/logo`,
    headers: { ...editorHeaders, 'content-type': 'image/png' },
    payload: pngBytes(),
  })).statusCode, 403);
});
