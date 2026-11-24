import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/offline-browser',
  timeout: 120_000,
  outputDir: 'test-results/offline',
  retries: 0,
  workers: 1,
  use: { actionTimeout: 10000, baseURL: 'http://127.0.0.1:5288', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox-asyncify', use: { browserName: 'firefox', launchOptions: { firefoxUserPrefs: { 'javascript.options.wasm_js_promise_integration': false } } } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit-narrow', use: { browserName: 'webkit', viewport: { width: 390, height: 844 }, hasTouch: true } },
  ],
  webServer: {
    command: 'npm run preview -w apps/orbrun -- --host 127.0.0.1 --port 5288 --strictPort',
    url: 'http://127.0.0.1:5288', reuseExistingServer: false,
  },
})
