import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oidcEnabled, readConfig } from '../src/server/config.js';

const env = {
  DATABASE_URL: 'postgresql://localhost/example', APP_ORIGIN: 'http://localhost:5173',
  BETTER_AUTH_SECRET: 'a-test-secret-that-is-at-least-32-characters',
  WORKSPACE_ID: '2e9f08ac-373c-4aa9-8f5f-3cf994181ee8', WORKSPACE_NAME: 'Testgruppe',
};
const oidc = {
  OIDC_ISSUER: 'http://127.0.0.1:9988', OIDC_CLIENT_ID: 'planner', OIDC_CLIENT_SECRET: 'oidc-test-secret',
};
test('requires valid origins, private configuration and production HTTPS', () => {
  assert.equal(readConfig(env).PORT, 3000);
  assert.equal(oidcEnabled(readConfig(env)), false);
  assert.throws(() => readConfig({ ...env, APP_ORIGIN: 'http://localhost:5173/path' }), /APP_ORIGIN/);
  assert.throws(() => readConfig({ ...env, NODE_ENV: 'production' }), /HTTPS/);
  assert.throws(() => readConfig({ ...env, BETTER_AUTH_SECRET: 'secret-value' }), error => {
    assert(error instanceof Error);
    assert(!error.message.includes('secret-value'));
    return true;
  });
  assert.throws(() => readConfig({ ...env, WORKSPACE_ID: 'bad-id' }), /WORKSPACE_ID/);
});

test('APP_VERSION uses APP_VERSION env or falls back via git describe', () => {
  assert.equal(readConfig({ ...env, APP_VERSION: '1.2.3-test' }).APP_VERSION, '1.2.3-test');
  assert.match(readConfig(env).APP_VERSION, /^[0-9a-f]{7,}|^v?\d|dev/);
});

test('OIDC is optional together and rejects incomplete or secret-leaking configuration', () => {
  const configured = readConfig({ ...env, ...oidc, OIDC_REDIRECT_URI: 'http://localhost:5173/api/auth/callback/pocket-id' });
  assert.equal(oidcEnabled(configured), true);
  assert.equal(configured.OIDC_ISSUER, oidc.OIDC_ISSUER);
  assert.equal(oidcEnabled(readConfig({ ...env, OIDC_ISSUER: '', OIDC_CLIENT_ID: '', OIDC_CLIENT_SECRET: '' })), false);
  assert.throws(() => readConfig({ ...env, OIDC_ISSUER: oidc.OIDC_ISSUER }), /OIDC_/);
  assert.throws(() => readConfig({ ...env, OIDC_CLIENT_ID: oidc.OIDC_CLIENT_ID, OIDC_CLIENT_SECRET: oidc.OIDC_CLIENT_SECRET }), /OIDC_/);
  assert.throws(() => readConfig({ ...env, OIDC_REDIRECT_URI: 'http://localhost:5173/api/auth/callback/pocket-id' }), /OIDC_/);
  assert.throws(() => readConfig({ ...env, ...oidc, OIDC_ISSUER: 'not-a-url' }), /OIDC_ISSUER/);
  assert.throws(() => readConfig({ ...env, OIDC_CLIENT_SECRET: 'leaked-oidc-secret' }), error => {
    assert(error instanceof Error);
    assert(!error.message.includes('leaked-oidc-secret'));
    return /OIDC_/.test(error.message);
  });
});

test('optional mail SMTP and Brevo API env blanks are accepted', () => {
  const configured = readConfig({
    ...env,
    MAIL_HOST: 'smtp-relay.brevo.com',
    MAIL_PORT: '587',
    MAIL_USER: 'login@example.test',
    MAIL_PASS: 'smtp-key',
    MAIL_FROM: 'planer@example.test',
  });
  assert.equal(configured.MAIL_HOST, 'smtp-relay.brevo.com');
  assert.equal(configured.MAIL_PORT, 587);
  assert.equal(configured.MAIL_USER, 'login@example.test');
  assert.equal(readConfig({ ...env, MAIL_HOST: '', MAIL_USER: '', MAIL_PASS: '', MAIL_FROM: '', BREVO_API_KEY: '' }).MAIL_HOST, undefined);
});
