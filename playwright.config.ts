import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.WISPLOC_E2E_PORT ?? 3140)
const host = '127.0.0.1'
const baseURL = `http://${host}:${port}`

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `WISPLOC_E2E_PORT=${port} tsx scripts/start-e2e-server.ts`,
    url: `${baseURL}/api/health`,
    timeout: 60_000,
    reuseExistingServer: false,
  },
})
