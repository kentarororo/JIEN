import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  outputDir: '.playwright-results',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['line']],
  snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}-win32{ext}',
  expect: { timeout: 10_000 },
  timeout: 90_000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    colorScheme: 'light',
    locale: 'en-SG',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    viewport: { width: 390, height: 844 },
  },
  projects: [
    {
      name: 'edge-desktop',
      use: {
        browserName: 'chromium',
        channel: 'msedge',
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: 'android-chrome',
      use: {
        ...devices['Pixel 7'],
        browserName: 'chromium',
        channel: 'msedge',
      },
    },
    {
      name: 'ios-webkit',
      use: {
        ...devices['iPhone 13'],
        browserName: 'webkit',
      },
    },
  ],
  webServer: {
    command: 'pnpm e2e:serve',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
