import { defineConfig } from '@playwright/test';

// Uses the locally installed Edge on Windows (no browser download needed).
// Override with PW_CHANNEL=chrome, or PW_CHANNEL= (empty) to use Playwright's Chromium.
const channel = process.env.PW_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5179',
    channel: channel || undefined,
    viewport: { width: 1280, height: 800 },
    launchOptions: { args: ['--enable-gpu', '--ignore-gpu-blocklist'] },
  },
  webServer: {
    command: 'npx vite --port 5179 --strictPort',
    url: 'http://localhost:5179',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
