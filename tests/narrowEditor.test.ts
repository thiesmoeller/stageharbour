import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canvasModeForWidth, NARROW_EDITOR_QUERY } from '../src/client/editor/useNarrowEditor.js';

test('narrow editor query matches the tablet stacking breakpoint', () => {
  assert.equal(NARROW_EDITOR_QUERY, '(max-width: 1100px)');
});

test('canvasModeForWidth collapses split to a single canvas on narrow screens', () => {
  assert.equal(canvasModeForWidth('split', true), 'plan');
  assert.equal(canvasModeForWidth('split', true, 'stage'), 'stage');
  assert.equal(canvasModeForWidth('plan', true), 'plan');
  assert.equal(canvasModeForWidth('stage', true), 'stage');
});

test('canvasModeForWidth keeps split on desktop widths', () => {
  assert.equal(canvasModeForWidth('split', false), 'split');
  assert.equal(canvasModeForWidth('plan', false), 'plan');
  assert.equal(canvasModeForWidth('stage', false), 'stage');
});
