import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  // Hosted runners render WebGL in software; multi-gesture journeys need more
  // total time. Keep individual assertion deadlines and local limits unchanged.
  timeout: process.env.CI ? 90_000 : 30_000,
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  webServer: {
    command: 'node --import tsx tests/helpers/browser-server.ts',
    url: 'http://127.0.0.1:4173/api/health',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
