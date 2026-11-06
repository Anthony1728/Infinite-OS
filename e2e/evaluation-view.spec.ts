import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron } from '@playwright/test';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const mainEntry = join(root, 'out', 'main', 'index.js');
const rendererEntry = join(root, 'out', 'renderer', 'index.html');
const TEST_EMAIL = 'evaluation-view-e2e@infinite.test';

function seedProfile(home: string): void {
  const base = join(home, '.infinite-ai');
  mkdirSync(base, { recursive: true });
  const user = {
    id: 'evaluation-view-e2e-user',
    email: TEST_EMAIL,
    name: 'Evaluation View E2E',
    createdAt: Date.now(),
    hasCompletedOnboarding: true,
    profile: {
      name: 'Evaluation View E2E',
      workspaceTheme: 'dark',
      notificationsEnabled: false,
      aiMemoryEnabled: false,
    },
  };
  writeFileSync(
    join(base, 'auth.json'),
    JSON.stringify({ [TEST_EMAIL]: { user, password: 'evaluation-view-e2e' } }),
    'utf8',
  );
  writeFileSync(
    join(base, 'auth-session.json'),
    JSON.stringify({ user, isAuthenticated: true }),
    'utf8',
  );
}

test('the evaluation view lists the built-in suite and reports its empty history honestly', async () => {
  expect(existsSync(mainEntry) && existsSync(rendererEntry)).toBe(true);
  const tmp = mkdtempSync(join(tmpdir(), 'infinite-os-evaluation-'));
  const home = join(tmp, 'home');
  const appData = join(tmp, 'appdata');
  const localAppData = join(tmp, 'localappdata');
  const userData = join(tmp, 'userdata');
  mkdirSync(home, { recursive: true });
  mkdirSync(appData, { recursive: true });
  mkdirSync(localAppData, { recursive: true });
  seedProfile(home);

  const app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${userData}`],
    env: {
      ...process.env,
      USERPROFILE: home,
      HOME: home,
      APPDATA: appData,
      LOCALAPPDATA: localAppData,
      INFINITE_TEST_HOME: join(home, '.infinite-ai'),
      INFINITE_DISABLE_GPU: '1',
    },
    timeout: 60_000,
  });

  try {
    const page = await app.firstWindow({ timeout: 60_000 });
    await page.waitForFunction(
      () => Boolean(document.querySelector('[data-nav="evaluation"]')),
      undefined,
      { timeout: 60_000 },
    );

    await page.locator('[data-nav="evaluation"]').click();
    await expect(page.getByRole('heading', { name: 'Evaluation' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Mechanical proof that agents complete tasks/)).toBeVisible();

    // The CLI contract is shown, not hidden behind a button that could run an
    // approval-bypassing benchmark inside the app process.
    await expect(page.getByText('npm run eval', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('npm run eval:list', { exact: true })).toBeVisible();

    // Catalog comes from the real fixture registry through IPC.
    await expect(page.getByText('Core task completion', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/5 built-in tasks cover/)).toBeVisible();

    // A fresh profile has no reports; the page must say so instead of faking one.
    await expect(page.getByText(/No evaluation runs yet/)).toBeVisible();
  } finally {
    await app.close().catch(() => undefined);
    rmSync(tmp, { recursive: true, force: true });
  }
});
