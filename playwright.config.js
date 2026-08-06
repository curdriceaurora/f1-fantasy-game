import { defineConfig, devices } from '@playwright/test';

// Specs live in a folder named for the audience they describe, and each project
// picks up only the folders that apply to it. Nothing is guarded at runtime, so
// a full run has no expected skips. See e2e/README.md for the mapping.
const SHARED = '**/shared/*.spec.js';
const DESKTOP = '**/desktop/*.spec.js';
const MOBILE = '**/mobile/*.spec.js';
const IPHONE = '**/iphone/*.spec.js';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3456',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      testMatch: [SHARED, DESKTOP],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-iphone-14',
      testMatch: [SHARED, MOBILE, IPHONE],
      use: {
        ...devices['iPhone 14 Pro'],
        browserName: 'chromium',
      },
    },
    {
      name: 'mobile-pixel-7',
      testMatch: [SHARED, MOBILE],
      use: {
        ...devices['Pixel 7'],
        browserName: 'chromium',
      },
    },
  ],
  webServer: [
    {
      command: 'SITE_MODE=season PORT=3456 node server.js',
      url: 'http://127.0.0.1:3456/dashboard.html',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'SITE_MODE=preseason PORT=3457 node server.js',
      url: 'http://127.0.0.1:3457/index.html',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
