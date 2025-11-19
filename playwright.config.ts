import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'test/webview',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'list',
  
  use: {
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    // Base URL for test harness
    baseURL: 'http://localhost:8080',
    // Chromium launch arguments for CI stability
    // Prevents "Target crashed" errors in Docker/GitHub Actions
    launchOptions: {
      args: [
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-setuid-sandbox',
        '--no-sandbox',
      ]
    }
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    },
    // Add more browsers only if needed for specific testing
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] }
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] }
    // }
  ],

  // Run local dev server from repo root to serve real compiled assets
  webServer: {
    command: 'npx http-server . -p 8080 --silent',
    port: 8080,
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000
  }
});