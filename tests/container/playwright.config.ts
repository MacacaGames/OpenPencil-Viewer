import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: '.',
  testMatch: 'remote.spec.ts',
  workers: 1,
  timeout: 180000,
  use: {
    viewport: { width: 1440, height: 960 },
    testIdAttribute: 'data-test-id',
    launchOptions: process.env.REMOTE_TEST_BROWSER
      ? { executablePath: process.env.REMOTE_TEST_BROWSER }
      : {},
    trace: 'off',
    video: 'off',
    screenshot: 'off'
  },
  reporter: [['list']]
})
