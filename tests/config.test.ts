import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../src/server/config.js';

const env = {
  DATABASE_URL: 'postgresql://localhost/example', APP_ORIGIN: 'http://localhost:5173',
  BETTER_AUTH_SECRET: 'a-test-secret-that-is-at-least-32-characters',
  WORKSPACE_ID: '2e9f08ac-373c-4aa9-8f5f-3cf994181ee8', WORKSPACE_NAME: 'Testgruppe',
};
test('requires valid origins, private configuration and production HTTPS', () => {
  assert.equal(readConfig(env).PORT, 3000);
  assert.throws(() => readConfig({ ...env, APP_ORIGIN: 'http://localhost:5173/path' }), /APP_ORIGIN/);
  assert.throws(() => readConfig({ ...env, NODE_ENV: 'production' }), /HTTPS/);
  assert.throws(() => readConfig({ ...env, BETTER_AUTH_SECRET: 'secret-value' }), error => {
    assert(error instanceof Error);
    assert(!error.message.includes('secret-value'));
    return true;
  });
  assert.throws(() => readConfig({ ...env, WORKSPACE_ID: 'bad-id' }), /WORKSPACE_ID/);
});
