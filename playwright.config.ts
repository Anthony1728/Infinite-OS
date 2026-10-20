import { defineConfig } from '@playwright/test';

// Electron end-to-end smoke tests. Kept in its own `e2e/` tree so the
// vitest unit tests (`*.test.ts` under src/) are never picked up by
// Playwright's default testMatch — that collision made `npm run test:e2e`
// load vitest specs inside the Playwright runner and fail instantly.
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env['CI'],
  reporter: [['list']],
  outputDir: 'test-results/e2e',
});
