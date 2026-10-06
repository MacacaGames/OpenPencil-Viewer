import { defineConfig, devices } from '@playwright/test'
const origin = 'http://127.0.0.1:3212'
export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  fullyParallel: false,
  timeout: 90000,
  snapshotPathTemplate: '{testDir}/snapshots/{testFilePath}/{arg}{ext}',
  use: {
    baseURL: origin,
    testIdAttribute: 'data-test-id',
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 960 }
      }
    }
  ],
  webServer: [
    {
      command: 'npm run dev:mock',
      cwd: import.meta.dirname,
      url: origin + '/health/ready',
      reuseExistingServer: false,
      timeout: 120000,
      env: {
        PORT: '3212',
        PORTAL_ORIGIN: origin,
        STATE_PATH: '.work/e2e-state.sqlite',
        MOCK_ROOT: '.work/e2e-nas'
      }
    },
    {
      command: 'node --import tsx tests/e2e/google-mount-server.ts',
      cwd: import.meta.dirname,
      url: 'http://127.0.0.1:3213/health/ready',
      reuseExistingServer: false,
      timeout: 30000
    },
    {
      command: 'node --import tsx tests/e2e/raster-server.ts',
      cwd: import.meta.dirname,
      url: 'http://127.0.0.1:3214/health/ready',
      reuseExistingServer: false,
      timeout: 30000
    },
    {
      command: 'node --import tsx tests/e2e/remote-server.ts',
      cwd: import.meta.dirname,
      url: 'http://127.0.0.1:3215/health/ready',
      reuseExistingServer: false,
      timeout: 30000
    },
    {
      command: 'node --import tsx tests/e2e/remote-server.ts',
      cwd: import.meta.dirname,
      url: 'http://127.0.0.1:3216/health/ready',
      reuseExistingServer: false,
      timeout: 30000,
      env: { PORTAL_TEST_REMOTE_PORT: '3216' }
    }
  ],
  reporter: [['list'], ['json', { outputFile: 'test-results/report.json' }]]
})
