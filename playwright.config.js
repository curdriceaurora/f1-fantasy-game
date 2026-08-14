import { defineConfig, devices } from '@playwright/test';

// Applicability is declared in the filename suffix and selected here, rather than
// with `test.skip(testInfo.project.name !== …)` inside the specs. Runtime guards
// reported 32 skips on every run and, worse, put the project mapping somewhere it
// could only be discovered by reading each test.
//
// Files are organised by feature and suffixed by where they apply, so a spec's
// applicability is visible when adding it and a misplaced one is obvious in the
// directory listing:
//
//   *.shared.spec.js    every project
//   *.desktop.spec.js   chromium only
//   *.mobile.spec.js    both phone profiles
//   *.iphone.spec.js    iPhone only — touch/viewport behaviour specific to it
//
// A suffix that is not one of these matches no project and would run nowhere, so
// `test/e2e-applicability.test.mjs` fails the build if a spec is misnamed.
const SHARED = '**/*.shared.spec.js';
const DESKTOP = '**/*.desktop.spec.js';
const MOBILE = '**/*.mobile.spec.js';
const IPHONE = '**/*.iphone.spec.js';

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
