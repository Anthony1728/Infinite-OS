import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron } from '@playwright/test';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const mainEntry = join(root, 'out', 'main', 'index.js');
const rendererEntry = join(root, 'out', 'renderer', 'index.html');
const TEST_EMAIL = 'layering-e2e@infinite.test';

function seedProfile(home: string): void {
  const base = join(home, '.infinite-ai');
  mkdirSync(base, { recursive: true });
  const user = {
    id: 'layering-e2e-user',
    email: TEST_EMAIL,
    name: 'Layering E2E',
    createdAt: Date.now(),
    hasCompletedOnboarding: true,
    profile: {
      name: 'Layering E2E',
      workspaceTheme: 'dark',
      notificationsEnabled: false,
      aiMemoryEnabled: false,
    },
  };
  writeFileSync(join(base, 'auth.json'), JSON.stringify({ [TEST_EMAIL]: { user, password: 'layering-e2e' } }), 'utf8');
  writeFileSync(join(base, 'auth-session.json'), JSON.stringify({ user, isAuthenticated: true }), 'utf8');
}

test('settings modal paints above the top bar', async () => {
  expect(existsSync(mainEntry) && existsSync(rendererEntry)).toBe(true);
  const tmp = mkdtempSync(join(tmpdir(), 'infinite-os-layering-'));
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
      () => Boolean(document.querySelector('[data-nav="studio"]')),
      undefined,
      { timeout: 60_000 },
    );

    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('infinite:open-personalization', { detail: 'profile' }));
    });
    await page.waitForSelector('.os-modal-backdrop', { timeout: 15_000 });

    const z = await page.evaluate(() => {
      const topbar = document.querySelector('.os-topbar') as HTMLElement | null;
      const modal = document.querySelector('.os-modal-backdrop') as HTMLElement | null;
      return {
        topbar: topbar ? getComputedStyle(topbar).zIndex : null,
        modal: modal ? getComputedStyle(modal).zIndex : null,
        modalVisible: modal ? modal.getBoundingClientRect().top >= 0 : false,
      };
    });
    console.log('LAYERING_Z', JSON.stringify(z));
    expect(Number(z.modal)).toBeGreaterThan(Number(z.topbar));
    await page.screenshot({ path: test.info().outputPath('settings-layering.png') });
  } finally {
    await app.close().catch(() => undefined);
    rmSync(tmp, { recursive: true, force: true });
  }
});
