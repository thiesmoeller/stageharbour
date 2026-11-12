import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAPTURE_MAX_EDGE, FEEDBACK_CAPTURE_MAX_EDGE, captureSize } from '../src/client/editor/StageCapture.js';

test('captures keep the print and feedback output dimensions', () => {
  assert.equal(CAPTURE_MAX_EDGE, 2400);
  assert.equal(FEEDBACK_CAPTURE_MAX_EDGE, 1200);
  assert.deepEqual(captureSize(16 / 9, CAPTURE_MAX_EDGE), { width: 2400, height: 1350 });
  assert.deepEqual(captureSize(4 / 3, CAPTURE_MAX_EDGE), { width: 2400, height: 1800 });
  assert.deepEqual(captureSize(1, CAPTURE_MAX_EDGE), { width: 2400, height: 2400 });
  assert.deepEqual(captureSize(16 / 9, FEEDBACK_CAPTURE_MAX_EDGE), { width: 1200, height: 675 });
});

test('the long edge is the maximum for landscape and portrait viewports alike', () => {
  assert.deepEqual(captureSize(0.5, 2400), { width: 1200, height: 2400 });
  assert.deepEqual(captureSize(3 / 4, 1200), { width: 900, height: 1200 });
  for (const aspect of [0.3, 0.75, 1, 1.5, 2.2, 4]) {
    const { width, height } = captureSize(aspect, 2400);
    assert.equal(Math.max(width, height), 2400);
    assert.ok(Math.abs(width / height - aspect) < 0.002, `aspect ${aspect}`);
  }
});

test('extreme aspects are clamped so a collapsed pane cannot ask for a sliver or a huge image', () => {
  assert.deepEqual(captureSize(50, 2400), { width: 2400, height: 480 });
  assert.deepEqual(captureSize(0.001, 2400), { width: 480, height: 2400 });
  assert.deepEqual(captureSize(5, 4), { width: 4, height: 1 });
});
