import assert from 'node:assert/strict';
import { test } from 'node:test';
import { visibleParameters } from '../src/shared/parts/visibleParameters.js';
import { STARTER_BRACE, STARTER_WALL } from '../src/shared/parts/starter/index.js';

const keys = (variant?: string) => visibleParameters(STARTER_WALL, variant).map(parameter => parameter.key);

test('Glattwand shows only the wall size, not door, window or arch parameters', () => {
  assert.deepEqual(keys('plain'), ['B', 'H', 'D']);
  assert.deepEqual(keys('half'), ['B', 'H', 'D']);
});

test('each wall variant shows the opening it actually cuts', () => {
  assert.deepEqual(keys('doorLeft'), ['B', 'H', 'D', 'tuerLeft', 'tuerSill', 'tuerB', 'tuerH', 'open']);
  assert.deepEqual(keys('doorRight'), ['B', 'H', 'D', 'tuer_hrechtsLeft', 'tuer_hrechtsSill', 'tuer_hrechtsB', 'tuer_hrechtsH', 'open']);
  assert.deepEqual(keys('window'), ['B', 'H', 'D', 'fensterLeft', 'fensterSill', 'fensterB', 'fensterH']);
  assert.deepEqual(keys('arch'), ['B', 'H', 'D', 'bogenLeft', 'bogenSill', 'bogenB', 'bogenH']);
});

test('a parameter that turns a feature on stays visible while that feature is off', () => {
  const shown = visibleParameters(STARTER_BRACE, 'standard').map(parameter => parameter.key);
  assert.deepEqual(shown, ['B', 'TO', 'HO', 'ballast']);
});
