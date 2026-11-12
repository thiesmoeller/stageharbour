import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { ACESFilmicToneMapping, PCFShadowMap, SRGBColorSpace } from 'three';
import {
  STAGE_OUTPUT_COLOR_SPACE, STAGE_QUALITY, STAGE_TONE_MAPPING, pixelRatioRange, prefersCoarsePointer, shadowMapConfig,
} from '../src/client/stage/renderer.js';

test('simple quality renders without shadows at CSS pixels', () => {
  assert.equal(STAGE_QUALITY.simple.shadows, false);
  assert.equal(shadowMapConfig('simple'), false);
  assert.deepEqual(pixelRatioRange('simple', false), [1, 1]);
  assert.deepEqual(pixelRatioRange('simple', true), [1, 1]);
});

test('enhanced quality enables PCF shadows and Pascal\'s pixel-ratio caps', () => {
  assert.equal(STAGE_QUALITY.enhanced.shadows, true);
  assert.deepEqual(shadowMapConfig('enhanced'), { enabled: true, type: PCFShadowMap });
  assert.deepEqual(pixelRatioRange('enhanced', false), [1, 1.5]);
  assert.deepEqual(pixelRatioRange('enhanced', true), [1, 1.25]);
});

test('every quality keeps the pixel ratio at least 1 and within the desktop cap on touch', () => {
  for (const settings of Object.values(STAGE_QUALITY)) {
    assert.ok(settings.maxPixelRatio >= 1);
    assert.ok(settings.coarsePointerMaxPixelRatio >= 1 && settings.coarsePointerMaxPixelRatio <= settings.maxPixelRatio);
    assert.equal(settings.shadowMapType, PCFShadowMap);
  }
});

test('the renderer outputs sRGB with ACES filmic tone mapping, as Pascal does', () => {
  assert.equal(STAGE_OUTPUT_COLOR_SPACE, SRGBColorSpace);
  assert.equal(STAGE_TONE_MAPPING, ACESFilmicToneMapping);
  assert.equal(prefersCoarsePointer(), false);
});

test('src/client/stage stays on the WebGL renderer and off Pascal', async () => {
  const directory = new URL('../src/client/stage/', import.meta.url);
  const files = (await readdir(directory)).filter(name => /\.tsx?$/.test(name));
  assert.ok(files.includes('StageCanvas.tsx') && files.includes('renderer.ts'));
  for (const name of files) {
    const source = await readFile(new URL(name, directory), 'utf8');
    for (const specifier of source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      assert.doesNotMatch(specifier[1]!, /^@pascal-app\/|^three\/(webgpu|tsl)$/, `${name} imports ${specifier[1]}`);
    }
  }
});