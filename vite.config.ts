import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const webPort = Number(env.WEB_PORT || 5173);
  const apiPort = Number(env.PORT || 3000);
  const base = env.VITE_BASE || '/';
  return {
    base,
    plugins: [react()],
    build: { outDir: 'dist/web', emptyOutDir: true },
    server: { port: webPort, strictPort: true, proxy: { '/api': `http://127.0.0.1:${apiPort}` } },
  };
});
