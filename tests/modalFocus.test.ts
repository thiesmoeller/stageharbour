import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const wallTool = readFileSync(join(here, '../src/client/editor/WallToolButton.tsx'), 'utf8');
const underlay = readFileSync(join(here, '../src/client/editor/VenueUnderlayDialog.tsx'), 'utf8');
const modalFocus = readFileSync(join(here, '../src/client/editor/useModalFocus.ts'), 'utf8');

test('wall tool exposes a visible keyboard-accessible type menu control', () => {
  assert.match(wallTool, /aria-label="Wandtypen wählen"/);
  assert.match(wallTool, /wall-tool-menu/);
  assert.match(wallTool, /useModalFocus/);
  assert.match(wallTool, /aria-modal="true"/);
});

test('underlay dialog uses shared modal focus behaviour', () => {
  assert.match(underlay, /useModalFocus/);
  assert.match(underlay, /aria-modal="true"/);
  assert.match(modalFocus, /Escape/);
  assert.match(modalFocus, /Tab/);
  assert.match(modalFocus, /previous\.current\?\.focus/);
});
