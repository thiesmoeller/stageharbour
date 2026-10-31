/**
 * Pascal Viewer initializes THREE.WebGPURenderer through initializeGpuRenderer. On some GPUs the native
 * WebGPU path fails every frame (createBuffer / mappedAtCreation), spamming
 * "[viewer/post-processing] Fallback render failed". forceWebGL keeps the node
 * renderer but uses the WebGL2 backend.
 *
 * Run from postinstall so Vite's prebundle of @pascal-app/viewer picks this up.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const target = resolve('node_modules/@pascal-app/viewer/dist/components/viewer/index.js');
const needle = 'forceWebGL: immersiveActive,';
const replacement = 'forceWebGL: true, // StageHarbour: keep the WebGL backend';

let source;
try {
  source = readFileSync(target, 'utf8');
} catch (error) {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
    console.warn('[patch-pascal-webgl] viewer package missing; skip');
    process.exit(0);
  }
  throw error;
}

if (source.includes(replacement)) {
  console.log('[patch-pascal-webgl] already applied');
  process.exit(0);
}
if (!source.includes(needle)) {
  throw new Error('[patch-pascal-webgl] renderer initialization changed; review the WebGL fallback before updating Pascal');
}

writeFileSync(target, source.replaceAll(needle, replacement));
console.log('[patch-pascal-webgl] applied forceWebGL');
