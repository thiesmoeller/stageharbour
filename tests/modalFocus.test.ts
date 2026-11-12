import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const underlay = readFileSync(join(here, '../src/client/editor/VenueUnderlayDialog.tsx'), 'utf8');
const modalFocus = readFileSync(join(here, '../src/client/editor/useModalFocus.ts'), 'utf8');

test('underlay dialog uses shared modal focus behaviour', () => {
  assert.match(underlay, /useModalFocus/);
  assert.match(underlay, /aria-modal="true"/);
  assert.match(modalFocus, /Escape/);
  assert.match(modalFocus, /Tab/);
  assert.match(modalFocus, /previous\.current\?\.focus/);
});

test('modal focus effect depends only on open so onClose identity churn does not steal focus', () => {
  assert.match(modalFocus, /onCloseRef/);
  assert.match(modalFocus, /onCloseRef\.current\s*=\s*onClose/);
  assert.match(modalFocus, /onCloseRef\.current\(\)/);
  assert.match(modalFocus, /},\s*\[open\]\s*\);/);
  assert.doesNotMatch(modalFocus, /},\s*\[open,\s*onClose\]\s*\);/);
});
