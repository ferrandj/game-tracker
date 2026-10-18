import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const PORT = 4173;
const UPSTREAM = 4174;
// Fresh, empty data folder for every run. The real server talks to a fake Steam / psthc.fr (e2e/fakeUpstream.mjs), never to the internet.
const dataDir = mkdtempSync(join(tmpdir(), 'game-tracker-e2e-'));
process.env.E2E_DATA_DIR = dataDir;
process.env.E2E_PORT = String(PORT);
const upstream = `http://127.0.0.1:${UPSTREAM}`;

export default defineConfig({
  testDir: 'e2e', // files run in name order: 01 creates the games the others look at
  fullyParallel: false,
  workers: 1,                       // one shared server and data folder
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath: process.env.CHROME_PATH || undefined }
  },
  projects: [
    { name: 'desktop', testIgnore: /03-mobile\.spec\.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
    { name: 'phone', testMatch: /03-mobile\.spec\.ts/, use: { ...devices['Pixel 7'] } }
  ],
  webServer: [
    {
      command: 'node e2e/fakeUpstream.mjs',
      url: `${upstream}/api/storesearch/?term=hades`,
      reuseExistingServer: false,
      timeout: 15_000,
      env: { FAKE_UPSTREAM_PORT: String(UPSTREAM) }
    },
    {
      command: 'node ../server/index.js',
      url: `http://127.0.0.1:${PORT}/healthz`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        DATA_DIR: dataDir, PORT: String(PORT), PUBLIC_DIR: join(here, 'dist'), SNAPSHOT_INTERVAL_SEC: '0',
        STEAM_STORE_BASE: upstream, STEAM_COMMUNITY_BASE: upstream, STEAM_CDN_BASE: upstream, PSTHC_BASE: upstream, IMAGE_ALLOW_PREFIXES: upstream + '/'
      }
    }
  ]
});
