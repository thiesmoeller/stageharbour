import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAppVersion } from '../src/shared/appVersion.js';

test('resolveAppVersion prefers APP_VERSION over git', () => {
  assert.equal(resolveAppVersion({ APP_VERSION: '1.0.0-ci' }), '1.0.0-ci');
  assert.equal(resolveAppVersion({ APP_VERSION: '  tagged  ' }), 'tagged');
});

test('resolveAppVersion falls back to git describe when unset', () => {
  const version = resolveAppVersion({});
  assert.ok(version.length >= 1);
  assert.notEqual(version, '');
});
