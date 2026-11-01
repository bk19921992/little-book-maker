import { defineConfig } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

export default defineConfig({
  testDir: here,
  timeout: 90000,
  retries: 0,
  use: { baseURL: 'http://127.0.0.1:5199', screenshot: 'only-on-failure' },
  webServer: {
    command: 'npx vite --config verify/e2e/vite.stub.config.ts',
    cwd: root,
    port: 5199,
    reuseExistingServer: true,
    timeout: 120000,
  },
});
