import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import {
  DEFAULT_LIGHT_THEME_ID, LIGHT_THEMES, LIGHT_THEME_IDS, isLightThemeId, keyLightDirection, lightTheme,
} from '../src/client/stage/lightThemes.js';

const hex = /^#[0-9a-f]{6}$/;
const pascalThemes = new URL('../node_modules/@pascal-app/viewer/dist/lib/scene-themes.js', import.meta.url);

test('every light theme id has complete, well-formed data', () => {
  assert.deepEqual(Object.keys(LIGHT_THEMES).sort(), [...LIGHT_THEME_IDS].sort());
  for (const id of LIGHT_THEME_IDS) {
    const theme = LIGHT_THEMES[id];
    assert.equal(theme.id, id);
    assert.ok(theme.label.length > 0);
    for (const color of [theme.background, theme.backgroundSky, theme.ground, theme.ambient.color, theme.hemisphere.sky, theme.hemisphere.ground, theme.key.color, theme.fill.color]) {
      assert.match(color, hex, `${id}: ${color}`);
    }
    for (const intensity of [theme.ambient.intensity, theme.hemisphere.intensity, theme.key.intensity, theme.fill.intensity]) {
      assert.ok(Number.isFinite(intensity) && intensity >= 0, `${id}: intensity ${intensity}`);
    }
    for (const vector of [theme.key.position, theme.key.target, theme.fill.position, theme.fill.target]) {
      assert.equal(vector.length, 3);
      assert.ok(vector.every(Number.isFinite));
    }
    assert.ok(theme.key.position[1] > 0, `${id}: key light must be above the stage`);
    assert.ok(theme.toneMappingExposure > 0);
    assert.ok(theme.shadow.intensity > 0 && theme.shadow.intensity <= 1);
    assert.ok(theme.shadow.bias < 0 && theme.shadow.normalBias > 0 && theme.shadow.radius > 0);
    assert.ok(Number.isInteger(Math.log2(theme.shadow.mapSize)));
  }
});

test('labels match the Raumsicht Umgebung picker', () => {
  assert.deepEqual(LIGHT_THEME_IDS.map(id => LIGHT_THEMES[id].label), ['Studio', 'Warm', 'Abend']);
});

test('theme backgrounds differ so a theme change is visible', () => {
  assert.equal(new Set(LIGHT_THEME_IDS.map(id => LIGHT_THEMES[id].background)).size, LIGHT_THEME_IDS.length);
});

test('unknown theme ids fall back to the default', () => {
  assert.equal(DEFAULT_LIGHT_THEME_ID, 'studio');
  assert.equal(lightTheme('paper').id, 'paper');
  assert.equal(lightTheme('midnight').id, 'studio');
  assert.equal(lightTheme(undefined).id, 'studio');
  assert.equal(isLightThemeId('sunset'), true);
  assert.equal(isLightThemeId('Sunset'), false);
  assert.equal(isLightThemeId(3), false);
});

test('key light direction is a unit vector towards the light', () => {
  for (const id of LIGHT_THEME_IDS) {
    const direction = keyLightDirection(LIGHT_THEMES[id]);
    assert.ok(Math.abs(Math.hypot(...direction) - 1) < 1e-9);
    assert.ok(direction[1] > 0);
  }
  const studio = keyLightDirection(LIGHT_THEMES.studio);
  assert.ok(studio.every(value => Math.abs(value - 1 / Math.sqrt(3)) < 1e-9));
});

test('theme data matches @pascal-app/viewer SCENE_THEMES while Pascal is installed', { skip: !existsSync(pascalThemes) && 'Pascal is not installed' }, async () => {
  type PascalTheme = {
    id: string; background: string; backgroundSky: string; ground: string; toneMappingExposure: number;
    ambient: { color: string; intensity: number }; hemi: { sky: string; ground: string; intensity: number };
    lights: { position: number[]; color: string; intensity: number; castShadow?: boolean }[];
  };
  const { SCENE_THEMES } = await import(pascalThemes.href) as { SCENE_THEMES: PascalTheme[] };
  for (const id of LIGHT_THEME_IDS) {
    const pascal = SCENE_THEMES.find(theme => theme.id === id);
    assert.ok(pascal, `Pascal has no theme ${id}`);
    const ours = LIGHT_THEMES[id];
    assert.deepEqual(
      { background: ours.background, backgroundSky: ours.backgroundSky, ground: ours.ground, exposure: ours.toneMappingExposure, ambient: ours.ambient, hemisphere: ours.hemisphere },
      { background: pascal.background, backgroundSky: pascal.backgroundSky, ground: pascal.ground, exposure: pascal.toneMappingExposure, ambient: pascal.ambient, hemisphere: pascal.hemi },
    );
    const [key, fill] = pascal.lights;
    assert.ok(key && fill && pascal.lights.length === 2);
    assert.equal(key.castShadow, true);
    assert.deepEqual([...ours.key.position], key.position);
    assert.equal(ours.key.color, key.color);
    assert.equal(ours.key.intensity, key.intensity);
    assert.deepEqual([...ours.fill.position], fill.position);
    assert.equal(ours.fill.color, fill.color);
    assert.equal(ours.fill.intensity, fill.intensity);
  }
});
