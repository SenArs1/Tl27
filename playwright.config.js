import { defineConfig, devices } from '@playwright/test';

const PORT = 3210;
export default defineConfig({
  testDir: 'e2e',
  timeout: 30000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, locale: 'ru-RU', launchOptions: { executablePath: process.env.PW_CHROMIUM || undefined } },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: `rm -f data/e2e.db* && DB_FILE=data/e2e.db PORT=${PORT} node --no-warnings=ExperimentalWarning src/index.js`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
  },
});
