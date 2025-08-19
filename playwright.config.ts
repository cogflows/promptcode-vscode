import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'test/webview',
  reporter: process.env.CI ? 'line' : 'list',
  retries: process.env.CI ? 2 : 0,
  use: { 
    headless: true, 
    trace: 'retain-on-failure' 
  },
});