import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron } from '@playwright/test';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const mainEntry = join(root, 'out', 'main', 'index.js');
const rendererEntry = join(root, 'out', 'renderer', 'index.html');
const TEST_EMAIL = 'toolbar-e2e@infinite.test';

function seedProfile(home: string): void {
  const base = join(home, '.infinite-ai');
  mkdirSync(base, { recursive: true });
  const user = {
    id: 'toolbar-e2e-user',
    email: TEST_EMAIL,
    name: 'Toolbar E2E',
    createdAt: Date.now(),
    hasCompletedOnboarding: true,
    profile: {
      name: 'Toolbar E2E',
      workspaceTheme: 'dark',
      notificationsEnabled: false,
      aiMemoryEnabled: false,
    },
  };
  writeFileSync(join(base, 'auth.json'), JSON.stringify({ [TEST_EMAIL]: { user, password: 'toolbar-e2e' } }), 'utf8');
  writeFileSync(join(base, 'auth-session.json'), JSON.stringify({ user, isAuthenticated: true }), 'utf8');
}

test('intensity and until done collapse with the activity panel', async () => {
  expect(existsSync(mainEntry) && existsSync(rendererEntry)).toBe(true);
  const tmp = mkdtempSync(join(tmpdir(), 'infinite-os-toolbar-'));
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
    await page.locator('[data-nav="chats"]').first().click();
    await page.waitForTimeout(800);

    const activityButton = page.locator('button[aria-label*="notifications"]').first();
    await activityButton.click();
    await page.waitForTimeout(500);

    const snapshot = () => page.evaluate(() => {
      const all = [...document.querySelectorAll<HTMLElement>('button')];
      const intensity = all.find((el) => /Intensity/.test(el.textContent ?? ''));
      const until = all.find((el) => /Until done/.test(el.textContent ?? ''));
      const wrap = intensity?.closest('.os-toolbar-collapse') as HTMLElement | null;
      const measure = (el: HTMLElement | undefined | null) => el ? ({
        width: Math.round(el.getBoundingClientRect().width),
        opacity: getComputedStyle(el).opacity,
        pointerEvents: getComputedStyle(el).pointerEvents,
        collapsed: el.classList.contains('is-collapsed'),
      }) : null;
      return { intensity: measure(wrap), untilDone: measure(until) };
    });

    // The collapse is animated; under a cold Electron start the compositor can
    // begin the transition late. Wait for the end state instead of guessing a
    // fixed delay, then assert the final values.
    await expect.poll(async () => (await snapshot()).untilDone?.width, { timeout: 10_000 }).toBe(0);
    await expect.poll(async () => (await snapshot()).intensity?.width, { timeout: 10_000 }).toBe(0);
    const finalSnapshot = await snapshot();
    console.log('TOOLBAR_SNAPSHOT', JSON.stringify(finalSnapshot));
    expect(finalSnapshot.intensity?.width).toBe(0);
    expect(finalSnapshot.untilDone?.width).toBe(0);
    expect(finalSnapshot.intensity?.pointerEvents).toBe('none');
    expect(finalSnapshot.untilDone?.pointerEvents).toBe('none');
    expect(finalSnapshot.intensity?.opacity).toBe('0');
    expect(finalSnapshot.untilDone?.opacity).toBe('0');
    await page.screenshot({ path: test.info().outputPath('toolbar-collapsed.png') });
  } finally {
    await app.close().catch(() => undefined);
    rmSync(tmp, { recursive: true, force: true });
  }
});
