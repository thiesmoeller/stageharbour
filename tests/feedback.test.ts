import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedbackSchema, feedbackHash } from '../src/shared/feedback.js';
import { enableFeedbackActivity, feedbackActivity, recordFeedbackActivity } from '../src/client/feedback/activity.js';
import { feedbackEnabled } from '../src/server/feedback/routes.js';
import { readConfig } from '../src/server/config.js';

test('feedback activity is bounded, expires, rejects unapproved data and clears at logout', () => {
  enableFeedbackActivity(true);
  const now = Date.now();
  recordFeedbackActivity({ action: 'editor.change', area: 'plans' }, now - 300_001);
  for (let i = 0; i < 35; i++) recordFeedbackActivity({ action: 'api.failure', status: 500 }, now + i);
  assert.equal(feedbackActivity(now + 40).length, 30);
  assert.equal(feedbackActivity(now + 300_040).length, 0);
  const unsafe = { action: 'api.failure' as const, status: 500, secret: 'must not collect' };
  recordFeedbackActivity(unsafe, now + 50);
  assert.equal(feedbackActivity(now + 60).length, 30);
  assert(!JSON.stringify(feedbackActivity(now + 60)).includes('secret'));
  enableFeedbackActivity(false);
  recordFeedbackActivity({ action: 'editor.change' });
  assert.deepEqual(feedbackActivity(), []);
});

test('feedback contracts reject recipient injection and sensitive routes', () => {
  const report = { category: 'issue', message: 'Problem', capturedAt: new Date().toISOString(), page: { section: 'plans' }, browser: 'test', viewport: { width: 1200, height: 800 } };
  assert(feedbackSchema.safeParse(report).success);
  assert(!feedbackSchema.safeParse({ ...report, to: 'attacker@example.test' }).success);
  assert(!feedbackSchema.safeParse({ ...report, page: { section: 'reset', token: 'secret' } }).success);
  assert(!feedbackSchema.safeParse({ ...report, message: ' '.repeat(10) }).success);
  assert(!feedbackSchema.safeParse({ ...report, images: [{ type: 'image/png', base64: 'not base64!' }] }).success);
  assert.equal(feedbackHash({ section: 'help' }), '#/hilfe');
});

test('feedback requires a valid server recipient and real production mail configuration', () => {
  const env = { DATABASE_URL: 'postgresql://localhost/test', APP_ORIGIN: 'https://example.test', BETTER_AUTH_SECRET: 'test-secret-with-at-least-32-characters', WORKSPACE_ID: '2e9f08ac-373c-4aa9-8f5f-3cf994181ee8', WORKSPACE_NAME: 'Test', NODE_ENV: 'production' };
  assert.equal(feedbackEnabled(readConfig(env)), false);
  assert.equal(feedbackEnabled(readConfig({ ...env, FEEDBACK_TO_EMAIL: 'maintainer@example.test' })), false);
  assert.equal(feedbackEnabled(readConfig({ ...env, FEEDBACK_TO_EMAIL: 'maintainer@example.test', MAIL_HOST: 'smtp.example.test', MAIL_USER: 'user', MAIL_PASS: 'password', MAIL_FROM: 'app@example.test' })), true);
  assert.equal(feedbackEnabled(readConfig({ ...env, FEEDBACK_TO_EMAIL: 'maintainer@example.test', BREVO_API_KEY: 'test', MAIL_FROM: 'app@example.test' })), true);
  assert.throws(() => readConfig({ ...env, FEEDBACK_TO_EMAIL: 'not an email' }), /FEEDBACK_TO_EMAIL/);
  assert.equal(readConfig({ ...env, FEEDBACK_TO_EMAIL: '' }).FEEDBACK_TO_EMAIL, undefined);
});
