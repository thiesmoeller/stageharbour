import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localDatabaseName, scopedStorageKey, storageScope } from '../src/client/local/storageScope.js';

test('storage scope follows the Vite base path of each Pages deployment', () => {
  assert.equal(storageScope('/'), '');
  assert.equal(storageScope('/stageharbour/'), 'stageharbour');
  assert.equal(storageScope('/stageharbour/preview/'), 'stageharbour-preview');
});

test('each Pages path gets its own IndexedDB name so demos do not share a snapshot', () => {
  assert.equal(localDatabaseName('/'), 'stageharbour-local');
  assert.equal(localDatabaseName('/stageharbour/'), 'stageharbour-local-stageharbour');
  assert.equal(localDatabaseName('/stageharbour/preview/'), 'stageharbour-local-stageharbour-preview');
  assert.notEqual(localDatabaseName('/stageharbour/'), localDatabaseName('/stageharbour/preview/'));
});

test('preference keys stay readable on localhost and are namespaced on Pages', () => {
  assert.equal(scopedStorageKey('stage-planner.editor.view', '/'), 'stage-planner.editor.view');
  assert.equal(scopedStorageKey('stage-planner.editor.view', '/stageharbour/preview/'), 'stage-planner.editor.view:stageharbour-preview');
});
