import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldBlockDirtyRouteChange, UNSAVED_ROUTE_LEAVE_CONFIRM } from '../src/client/dirtyRouteChange.js';

test('shouldBlockDirtyRouteChange only when dirty and the hash target changed', () => {
  assert.equal(shouldBlockDirtyRouteChange(false, '#/szenen/a', '#/spielstaetten'), false);
  assert.equal(shouldBlockDirtyRouteChange(true, '#/szenen/a', '#/szenen/a'), false);
  assert.equal(shouldBlockDirtyRouteChange(true, '#/szenen/a', '#/spielstaetten'), true);
});

test('UNSAVED_ROUTE_LEAVE_CONFIRM is the German leave prompt', () => {
  assert.match(UNSAVED_ROUTE_LEAVE_CONFIRM, /Nicht gespeicherte/);
});
