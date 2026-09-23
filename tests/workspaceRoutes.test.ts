import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkspaceLocation, workspaceHash } from '../src/client/workspaceRoutes.js';

test('parseWorkspaceLocation maps list and document hashes', () => {
  assert.deepEqual(parseWorkspaceLocation(''), { section: 'plans' });
  assert.deepEqual(parseWorkspaceLocation('/'), { section: 'plans' });
  assert.deepEqual(parseWorkspaceLocation('/produktionen'), { section: 'plans' });
  assert.deepEqual(parseWorkspaceLocation('/szenen/abc'), { section: 'plans', sceneId: 'abc' });
  assert.deepEqual(parseWorkspaceLocation('/spielstaetten'), { section: 'venues' });
  assert.deepEqual(parseWorkspaceLocation('/spielstaetten/v1'), { section: 'venues', venueId: 'v1' });
  assert.equal(parseWorkspaceLocation('/einladung/x'), undefined);
});

test('workspaceHash round-trips document locations', () => {
  assert.equal(workspaceHash({ section: 'plans' }), '#/produktionen');
  assert.equal(workspaceHash({ section: 'plans', sceneId: 's1' }), '#/szenen/s1');
  assert.equal(workspaceHash({ section: 'venues' }), '#/spielstaetten');
  assert.equal(workspaceHash({ section: 'venues', venueId: 'v1' }), '#/spielstaetten/v1');
  assert.deepEqual(parseWorkspaceLocation(workspaceHash({ section: 'plans', sceneId: 'a/b' }).slice(1)), {
    section: 'plans', sceneId: 'a/b',
  });
});
