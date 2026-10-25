import { defineConfig } from '@playwright/test';

// Port dédié aux tests de bout en bout (surchargeable si occupé).
const PORT = Number(process.env.E2E_PORT ?? 3210);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    viewport: { width: 390, height: 844 },
    // Repli si la recherche du navigateur intégré échoue (voir README, section Tests).
    launchOptions: process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {},
  },
  webServer: {
    // Build de production puis `next start` ; sans NOTION_TOKEN et avec WOS_DEMO=1, l'app utilise FakeRepo.
    command: `npm run build && npx next start -p ${PORT}`,
    url: `${BASE_URL}/login`,
    timeout: 300_000,
    reuseExistingServer: false,
    env: {
      APP_PASSWORD: 'test',
      SESSION_SECRET: 'e2e-session-secret-at-least-32-characters-long',
      NOTION_TOKEN: '',
      WOS_DEMO: '1',
      CRON_SECRET: '',
    },
  },
});
