import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStageCanvasHarnessRoute } from '../src/client/stage/harnessRoute.js';

test('the StageCanvas harness route is dev-only unless explicitly flagged', () => {
  const hash = '#/__stage-canvas';
  assert.equal(isStageCanvasHarnessRoute({ hash, search: '' }, true), true);
  assert.equal(isStageCanvasHarnessRoute({ hash, search: '' }, false), false);
  assert.equal(isStageCanvasHarnessRoute({ hash, search: '?stage-harness' }, false), true);
  assert.equal(isStageCanvasHarnessRoute({ hash, search: '?other=1' }, false), false);
  assert.equal(isStageCanvasHarnessRoute({ hash: '#/produktionen', search: '?stage-harness' }, true), false);
  assert.equal(isStageCanvasHarnessRoute({ hash: '', search: '?stage-harness' }, false), false);
});
