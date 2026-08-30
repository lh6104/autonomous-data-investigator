import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/browser',
  timeout: 120_000,
  workers: 1,
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 41739',
    url: 'http://127.0.0.1:41739',
    reuseExistingServer: false
  },
  use: {
    baseURL: 'http://127.0.0.1:41739',
    ...devices['Desktop Chrome']
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
})
