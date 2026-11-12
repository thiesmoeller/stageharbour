import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEGACY_THEME_STORAGE_KEY, THEME_STORAGE_KEY, readStoredTheme, storeTheme } from '../src/client/stage/themePreference.js';

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

/** What @pascal-app/viewer's zustand persist middleware wrote. */
const pascalPreferences = (sceneTheme: unknown) => JSON.stringify({ state: { sceneTheme, cameraMode: 'perspective', shadows: true }, version: 2 });

test('the theme is stored under an app-owned key, not Pascal\'s', () => {
  assert.equal(THEME_STORAGE_KEY, 'stage-planner.raumsicht.theme');
  assert.equal(LEGACY_THEME_STORAGE_KEY, 'viewer-preferences');
  const store = storage();
  storeTheme('sunset', store);
  assert.deepEqual([...store.values], [[THEME_STORAGE_KEY, 'sunset']]);
  assert.equal(readStoredTheme(store), 'sunset');
});

test('a device that only has Pascal\'s saved preference keeps its theme', () => {
  assert.equal(readStoredTheme(storage({ [LEGACY_THEME_STORAGE_KEY]: pascalPreferences('paper') })), 'paper');
  assert.equal(readStoredTheme(storage({ [LEGACY_THEME_STORAGE_KEY]: pascalPreferences('sunset') })), 'sunset');
});

test('the app\'s own value wins over the legacy one and the legacy value is left untouched', () => {
  const store = storage({ [LEGACY_THEME_STORAGE_KEY]: pascalPreferences('paper') });
  storeTheme('sunset', store);
  assert.equal(readStoredTheme(store), 'sunset');
  assert.equal(store.values.get(LEGACY_THEME_STORAGE_KEY), pascalPreferences('paper'));
});

test('missing, unknown and unreadable values fall back to Studio', () => {
  assert.equal(readStoredTheme(storage()), 'studio');
  assert.equal(readStoredTheme(storage({ [THEME_STORAGE_KEY]: 'neon' })), 'studio');
  assert.equal(readStoredTheme(storage({ [THEME_STORAGE_KEY]: 'neon', [LEGACY_THEME_STORAGE_KEY]: pascalPreferences('paper') })), 'paper');
  assert.equal(readStoredTheme(storage({ [LEGACY_THEME_STORAGE_KEY]: pascalPreferences('neon') })), 'studio');
  assert.equal(readStoredTheme(storage({ [LEGACY_THEME_STORAGE_KEY]: '{not json' })), 'studio');
  assert.equal(readStoredTheme(storage({ [LEGACY_THEME_STORAGE_KEY]: 'null' })), 'studio');
  assert.equal(readStoredTheme(storage({ [LEGACY_THEME_STORAGE_KEY]: JSON.stringify({ state: {} }) })), 'studio');
});

test('storage that throws (private browsing) neither breaks reading nor writing', () => {
  const broken = {
    getItem: () => { throw new Error('denied'); },
    setItem: () => { throw new Error('denied'); },
  };
  assert.equal(readStoredTheme(broken), 'studio');
  assert.doesNotThrow(() => storeTheme('paper', broken));
  assert.equal(readStoredTheme(undefined), 'studio', 'no storage at all (server, tests) reads as Studio');
});
