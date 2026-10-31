import type { Plugin } from 'vite';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Belt-and-suspenders with scripts/patch-pascal-webgl.mjs: if the viewer
 * renderer initialization is loaded as source, inject forceWebGL so native WebGPU
 * createBuffer failures do not spam the console every frame.
 */
function pascalForceWebGlBackend(): Plugin {
  const needle = 'forceWebGL: immersiveActive,';
  const replacement = 'forceWebGL: true, // StageHarbour: keep the WebGL backend';
  return {
    name: 'pascal-force-webgl-backend',
    transform(code, id) {
      if (!id.includes('@pascal-app/viewer') || !code.includes(needle)) return;
      return { code: code.replaceAll(needle, replacement), map: null };
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const webPort = Number(env.WEB_PORT || 5173);
  const apiPort = Number(env.PORT || 3000);
  return {
    plugins: [pascalForceWebGlBackend(), react()],
    // Pascal's published viewer uses this Next-style constant even outside Next.
    define: { 'process.env.NEXT_PUBLIC_ASSETS_CDN_URL': JSON.stringify('https://editor.pascal.app') },
    build: { outDir: 'dist/web', emptyOutDir: true },
    server: { port: webPort, strictPort: true, proxy: { '/api': `http://127.0.0.1:${apiPort}` } },
  };
});
