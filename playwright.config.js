import { defineConfig, devices } from '@playwright/test';

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
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-iphone-14',
      use: {
        ...devices['iPhone 14 Pro'],
        browserName: 'chromium',
      },
    },
    {
      name: 'mobile-pixel-7',
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
