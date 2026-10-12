import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  PENDING_DISCARD_CONFIRM, adjustPendingCount, confirmDiscardPending,
} from '../src/client/editor/usePendingApplyForm.js';
import { askConfirm, askPrompt } from '../src/client/ConfirmDialog.js';

const here = dirname(fileURLToPath(import.meta.url));
const client = join(here, '../src/client');

test('confirmDiscardPending skips the dialog when nothing is pending', async () => {
  assert.equal(await confirmDiscardPending(false), true);
});

test('confirmDiscardPending routes pending discards through askConfirm', () => {
  const source = readFileSync(join(client, 'editor/usePendingApplyForm.ts'), 'utf8');
  assert.match(source, /askConfirm/);
  assert.match(source, new RegExp(PENDING_DISCARD_CONFIRM.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(source, /async function confirmDiscardPending/);
});

test('adjustPendingCount ref-counts subscribe(+1) and cleanup(−1) without going negative', () => {
  let count = 0;
  count = adjustPendingCount(count, true);
  assert.equal(count, 1);
  count = adjustPendingCount(count, true);
  assert.equal(count, 2);
  count = adjustPendingCount(count, false);
  assert.equal(count, 1);
  assert.equal(count > 0, true);
  count = adjustPendingCount(count, false);
  assert.equal(count, 0);
  count = adjustPendingCount(count, false);
  assert.equal(count, 0);
});

test('adjustPendingCount treats clear-then-unmount as a single release (no stuck pending)', () => {
  let count = 0;
  count = adjustPendingCount(count, true);
  count = adjustPendingCount(count, false);
  count = adjustPendingCount(count, false);
  assert.equal(count, 0);
});

test('app-styled confirm replaces every former window.confirm and window.prompt call site', () => {
  const files = [
    'main.tsx',
    'editor/Editor.tsx',
    'editor/Plans.tsx',
    'editor/Venues.tsx',
    'editor/RecipientDocumentWorkspace.tsx',
    'editor/usePendingApplyForm.ts',
  ];
  for (const file of files) {
    const source = readFileSync(join(client, file), 'utf8');
    assert.doesNotMatch(source, /window\.confirm\s*\(/, `${file} still uses window.confirm`);
    assert.doesNotMatch(source, /window\.prompt\s*\(/, `${file} still uses window.prompt`);
    assert.doesNotMatch(source, /globalThis\.confirm\s*\(/, `${file} still uses globalThis.confirm`);
  }
  const dialog = readFileSync(join(client, 'ConfirmDialog.tsx'), 'utf8');
  assert.match(dialog, /export function askConfirm/);
  assert.match(dialog, /export function askPrompt/);
  assert.match(dialog, /export function ConfirmHost/);
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /className=\{job\.danger \? 'danger'/);
  assert.equal(typeof askConfirm, 'function');
  assert.equal(typeof askPrompt, 'function');
  const main = readFileSync(join(client, 'main.tsx'), 'utf8');
  assert.match(main, /<ConfirmHost\s*\/>/);
});
