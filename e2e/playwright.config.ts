import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * E2E harness (PM scaffold). Starts the built API on :3100 with a fresh SQLite file and the web dev
 * server on :4300 proxying to it. One worker and one shared server, so specs must not rely on another
 * spec's floor: reset with a CREATE_FLOOR at the start of each test. Step only, never Play timing.
 * Retries are off on purpose: a flaky test should fail loudly.
 */
const API_PORT = 3100;
const WEB_PORT = 4300;
const dbPath = join(import.meta.dirname, '.tmp', `e2e-${Date.now()}.db`);

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env['CI'],
  reporter: process.env['CI'] ? 'line' : 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node ../apps/api/dist/main.js',
      url: `http://localhost:${API_PORT}/api/floors/main`,
      env: { PORT: String(API_PORT), FLEET_DB: dbPath },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `npx ng serve --port ${WEB_PORT} --proxy-config ../../e2e/proxy.e2e.json`,
      cwd: '../apps/web',
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
