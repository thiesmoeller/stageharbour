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
  assert.deepEqual(parseWorkspaceLocation('/konto'), { section: 'account' });
  assert.deepEqual(parseWorkspaceLocation('/verwaltung'), { section: 'admin' });
  assert.deepEqual(parseWorkspaceLocation('/hilfe'), { section: 'help' });
  assert.deepEqual(parseWorkspaceLocation('/hilfe/oberflaechen'), { section: 'help', topic: 'oberflaechen' });
  assert.deepEqual(parseWorkspaceLocation('/bestand'), { section: 'bestand' });
  assert.equal(parseWorkspaceLocation('/einladung/x'), undefined);
});

test('workspaceHash round-trips document locations', () => {
  assert.equal(workspaceHash({ section: 'plans' }), '#/produktionen');
  assert.equal(workspaceHash({ section: 'plans', sceneId: 's1' }), '#/szenen/s1');
  assert.equal(workspaceHash({ section: 'venues' }), '#/spielstaetten');
  assert.equal(workspaceHash({ section: 'venues', venueId: 'v1' }), '#/spielstaetten/v1');
  assert.equal(workspaceHash({ section: 'account' }), '#/konto');
  assert.equal(workspaceHash({ section: 'admin' }), '#/verwaltung');
  assert.equal(workspaceHash({ section: 'help' }), '#/hilfe');
  assert.equal(workspaceHash({ section: 'help', topic: 'oberflaechen' }), '#/hilfe/oberflaechen');
  assert.equal(workspaceHash({ section: 'bestand' }), '#/bestand');
  assert.deepEqual(parseWorkspaceLocation(workspaceHash({ section: 'plans', sceneId: 'a/b' }).slice(1)), {
    section: 'plans', sceneId: 'a/b',
  });
});

test('designer routes open the page and a part by id', () => {
  const partId = '5a17e9a0-0000-4000-8000-000000000005';
  assert.deepEqual(parseWorkspaceLocation('/designer'), { section: 'designer' });
  assert.deepEqual(parseWorkspaceLocation('#/designer'), { section: 'designer' });
  assert.deepEqual(parseWorkspaceLocation(`/designer/${partId}`), { section: 'designer', partId });
  assert.equal(parseWorkspaceLocation('/designer/a/b'), undefined);
  assert.equal(parseWorkspaceLocation('/designer/'), undefined);
  assert.equal(workspaceHash({ section: 'designer' }), '#/designer');
  assert.equal(workspaceHash({ section: 'designer', partId }), `#/designer/${partId}`);
  assert.deepEqual(parseWorkspaceLocation(workspaceHash({ section: 'designer', partId: 'x y' })), { section: 'designer', partId: 'x y' });
});
