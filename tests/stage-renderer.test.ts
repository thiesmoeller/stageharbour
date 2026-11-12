import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { ACESFilmicToneMapping, Color, PCFShadowMap, SRGBColorSpace } from 'three';
import {
  STAGE_OUTPUT_COLOR_SPACE, STAGE_QUALITY, STAGE_TONE_MAPPING, announceStageRenderer, onStageRenderer, pixelRatioRange, prefersCoarsePointer,
  shadowMapConfig, toneMapStageColor, type StageRenderer,
} from '../src/client/stage/renderer.js';

test('simple quality renders without shadows at CSS pixels', () => {
  assert.equal(STAGE_QUALITY.simple.shadows, false);
  assert.equal(shadowMapConfig('simple'), false);
  assert.deepEqual(pixelRatioRange('simple', false), [1, 1]);
  assert.deepEqual(pixelRatioRange('simple', true), [1, 1]);
});

test('enhanced quality enables PCF shadows and keeps the pixel-ratio caps the Raumsicht always had', () => {
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

test('the renderer outputs sRGB with ACES filmic tone mapping', () => {
  assert.equal(STAGE_OUTPUT_COLOR_SPACE, SRGBColorSpace);
  assert.equal(STAGE_TONE_MAPPING, ACESFilmicToneMapping);
  assert.equal(prefersCoarsePointer(), false);
});

test('the public quality seam stays limited to simple and enhanced', () => {
  assert.deepEqual(Object.keys(STAGE_QUALITY).sort(), ['enhanced', 'simple']);
});

test('loaders learn about every renderer, and about the latest one when they subscribe late', () => {
  const first = {} as StageRenderer, second = {} as StageRenderer;
  const early: StageRenderer[] = [], late: StageRenderer[] = [];
  const stopEarly = onStageRenderer(renderer => early.push(renderer));
  announceStageRenderer(first);
  const stopLate = onStageRenderer(renderer => late.push(renderer));
  assert.deepEqual(late, [first]);
  announceStageRenderer(second);
  assert.deepEqual(early, [first, second]);
  assert.deepEqual(late, [first, second]);
  stopEarly();
  stopLate();
  announceStageRenderer(first);
  assert.equal(early.length, 2);
  assert.equal(late.length, 2);
});

test('a tone-mapped backdrop is the colour the Pascal viewer drew behind the stage', () => {
  // Measured in docs/measurements/raumsicht-port/before: theme background and exposure -> pixel.
  const measured = [
    { background: '#fbfbfa', exposure: 0.9, pixel: [0xde, 0xde, 0xde] },
    { background: '#ede9df', exposure: 1, pixel: [0xdd, 0xdc, 0xd8] },
    { background: '#f6e8d4', exposure: 1, pixel: [0xe0, 0xdb, 0xd4] },
  ];
  for (const { background, exposure, pixel } of measured) {
    const mapped = toneMapStageColor(new Color(background), exposure);
    const srgb = new Color().copy(mapped).convertLinearToSRGB();
    const bytes = [srgb.r, srgb.g, srgb.b].map(value => Math.round(value * 255));
    bytes.forEach((value, channel) => assert.ok(Math.abs(value - pixel[channel]!) <= 1, `${background}: ${bytes} vs ${pixel}`));
  }
});

test('tone mapping keeps black black, never leaves the displayable range and darkens with exposure', () => {
  assert.deepEqual(toneMapStageColor(new Color(0, 0, 0), 1).toArray(), [0, 0, 0]);
  const bright = toneMapStageColor(new Color(50, 50, 50), 1);
  assert.ok(bright.r <= 1 && bright.g <= 1 && bright.b <= 1 && bright.r > 0.95);
  const dim = toneMapStageColor(new Color(0.5, 0.5, 0.5), 0.5), full = toneMapStageColor(new Color(0.5, 0.5, 0.5), 1);
  assert.ok(dim.r < full.r);
  const color = new Color('#336699');
  assert.equal(toneMapStageColor(color, 1), color, 'maps in place');
});

async function sourceFiles(directory: URL): Promise<URL[]> {
  const files: URL[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) files.push(...await sourceFiles(new URL(`${entry.name}/`, directory)));
    else if (/\.(ts|tsx|mts|js|jsx|mjs)$/.test(entry.name)) files.push(new URL(entry.name, directory));
  }
  return files;
}

const src = new URL('../src/', import.meta.url);
const FORBIDDEN_IMPORT = /^@pascal-app(\/|$)|^three\/(webgpu|tsl)(\/|$|\.)/;
const IMPORT_SPECIFIER = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"`]([^'"`]+)['"`]/g;

test('the import guard recognises every way of importing a forbidden module', () => {
  const forbidden = [
    "import { Viewer } from '@pascal-app/viewer';",
    'import type { AnyNode } from "@pascal-app/core";',
    "export * from '@pascal-app/editor/catalog';",
    "const viewer = await import('@pascal-app/viewer');",
    "import '@pascal-app/viewer/styles.css';",
    "import { MeshStandardNodeMaterial } from 'three/webgpu';",
    "import { color } from 'three/tsl';",
    "const tsl = require('three/tsl');",
    "import { x } from 'three/webgpu.js';",
  ];
  for (const line of forbidden) {
    const specifiers = [...line.matchAll(IMPORT_SPECIFIER)].map(match => match[1]!);
    assert.ok(specifiers.some(specifier => FORBIDDEN_IMPORT.test(specifier)), line);
  }
  const allowed = [
    "import { WebGLRenderer } from 'three';",
    "import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';",
    "import { Canvas } from '@react-three/fiber';",
    "import { x } from './pascalNotes.js';",
  ];
  for (const line of allowed) {
    const specifiers = [...line.matchAll(IMPORT_SPECIFIER)].map(match => match[1]!);
    assert.ok(specifiers.length > 0 && !specifiers.some(specifier => FORBIDDEN_IMPORT.test(specifier)), line);
  }
});

test('nothing under src/ imports Pascal, three/webgpu or three/tsl', async () => {
  const files = await sourceFiles(src);
  assert.ok(files.length > 150, `scanned ${files.length} source files`);
  assert.ok(files.some(file => file.pathname.endsWith('/client/stage/renderer.ts')));
  assert.ok(files.some(file => file.pathname.endsWith('/client/editor/RaumsichtCanvas.tsx')));
  assert.ok(files.some(file => file.pathname.endsWith('/server/main.ts')));
  const offenders: string[] = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(IMPORT_SPECIFIER)) {
      if (FORBIDDEN_IMPORT.test(match[1]!)) offenders.push(`${file.pathname.slice(src.pathname.length)} imports ${match[1]}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('the build configuration no longer patches or defines anything for Pascal', async () => {
  const config = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(config, /pascal|NEXT_PUBLIC|forceWebGL/i);
});

test('decoders are served by the app: no decoder path and no CDN host anywhere under src/', async () => {
  const decoders = await readFile(new URL('client/stage/decoders.ts', src), 'utf8');
  assert.doesNotMatch(decoders, /setTranscoderPath|setDecoderPath/, 'three resolves its decoder binaries next to the loaders; the build bundles them');
  assert.match(decoders, /new KTX2Loader\(/);
  assert.match(decoders, /new DRACOLoader\(/);
  assert.match(decoders, /setMeshoptDecoder\(/);
  for (const loader of ['KTX2Loader.js', 'DRACOLoader.js']) {
    const source = await readFile(new URL(`../node_modules/three/examples/jsm/loaders/${loader}`, import.meta.url), 'utf8');
    assert.match(source, /new URL\( '\.\.\/libs\/(basis|draco)\/[^']+\.wasm', import\.meta\.url \)/, `${loader} resolves its decoder relative to itself`);
  }
  for (const file of await sourceFiles(src)) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /gstatic\.com|jsdelivr\.net|unpkg\.com|cdnjs\./, file.pathname.slice(src.pathname.length));
  }
});
