import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PENDING_DISCARD_CONFIRM, confirmDiscardPending } from '../src/client/editor/usePendingApplyForm.js';

test('confirmDiscardPending skips the dialog when nothing is pending', () => {
  assert.equal(confirmDiscardPending(false), true);
});

test('confirmDiscardPending asks before discarding pending inspector edits', () => {
  const original = globalThis.confirm;
  let asked = '';
  globalThis.confirm = (message?: string) => {
    asked = String(message ?? '');
    return false;
  };
  try {
    assert.equal(confirmDiscardPending(true), false);
    assert.equal(asked, PENDING_DISCARD_CONFIRM);
  } finally {
    globalThis.confirm = original;
  }
});

test('confirmDiscardPending proceeds when the user confirms', () => {
  const original = globalThis.confirm;
  globalThis.confirm = () => true;
  try {
    assert.equal(confirmDiscardPending(true), true);
  } finally {
    globalThis.confirm = original;
  }
});
