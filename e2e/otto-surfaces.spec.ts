import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron } from '@playwright/test';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const mainEntry = join(root, 'out', 'main', 'index.js');
const rendererEntry = join(root, 'out', 'renderer', 'index.html');
const TEST_EMAIL = 'otto-surfaces-e2e@infinite.test';

function seedProfile(home: string): void {
  const base = join(home, '.infinite-ai');
  mkdirSync(base, { recursive: true });
  const user = {
    id: 'otto-surfaces-e2e-user',
    email: TEST_EMAIL,
    name: 'Otto Surfaces E2E',
    createdAt: Date.now(),
    hasCompletedOnboarding: true,
    profile: {
      name: 'Otto Surfaces E2E',
      workspaceTheme: 'dark',
      notificationsEnabled: false,
      aiMemoryEnabled: false,
    },
  };
  writeFileSync(join(base, 'auth.json'), JSON.stringify({ [TEST_EMAIL]: { user, password: 'otto-surfaces-e2e' } }), 'utf8');
  writeFileSync(join(base, 'auth-session.json'), JSON.stringify({ user, isAuthenticated: true }), 'utf8');
}

test('Otto-parity surfaces are reachable and functional', async () => {
  expect(existsSync(mainEntry) && existsSync(rendererEntry)).toBe(true);
  const tmp = mkdtempSync(join(tmpdir(), 'infinite-os-otto-'));
  const home = join(tmp, 'home');
  const appData = join(tmp, 'appdata');
  const localAppData = join(tmp, 'localappdata');
  const userData = join(tmp, 'userdata');
  mkdirSync(home, { recursive: true });
  mkdirSync(appData, { recursive: true });
  mkdirSync(localAppData, { recursive: true });
  seedProfile(home);

  const pinFile = join(home, 'pin-note.md');
  writeFileSync(pinFile, '# Pin note\n\nRemember the milk. Buy two cartons.', 'utf8');

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

    // Home: pinned cards + getting-started tour.
    await expect(page.getByText('Pinned', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Getting started', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '+ Pin a file' }).click();
    const pinInput = page.getByLabel('File path to pin');
    await expect(pinInput).toBeVisible();
    await pinInput.fill(pinFile);
    await pinInput.press('Enter');
    await expect(page.getByText('pin-note.md', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Remember the milk/).first()).toBeVisible({ timeout: 15_000 });

    // Seed the real memory store so the graph has something honest to read.
    await page.evaluate(async () => {
      const api = (window as unknown as {
        api: { createMemory: (args: Record<string, unknown>) => Promise<unknown> };
      }).api;
      await api.createMemory({
        type: 'preference',
        title: 'preferred-theme',
        content: 'Dark mode with quiet accents.',
        tags: ['ui'],
        importance: 0.9,
      });
      await api.createMemory({
        type: 'project',
        title: 'current-project',
        content: 'Infinite OS — one desktop workspace for chat, agents, automations, and local files.',
        tags: ['work'],
        importance: 0.95,
      });
    });

    // Activity inbox: digest + raw stream.
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('infinite:navigate', { detail: 'activity' }));
    });
    await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Digest' })).toBeVisible();
    await page.getByRole('button', { name: 'Raw stream' }).click();
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();

    // Memory graph: layers, search, mode switch.
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('infinite:navigate', { detail: 'memory' }));
    });
    await expect(page.getByRole('heading', { name: 'Memory graph' })).toBeVisible({ timeout: 15_000 });
    await page.getByPlaceholder('Search keys and values…').fill('preferred');
    await expect(page.getByText('preferred-theme', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await expect(page.getByText(/Dark mode with quiet accents/).first()).toBeVisible();

    // Command palette searches keywords and reaches the new inbox.
    await page.keyboard.press('Control+k');
    const paletteInput = page.getByPlaceholder('Search commands and modules...');
    await expect(paletteInput).toBeVisible({ timeout: 10_000 });
    await paletteInput.fill('inbox failures');
    await expect(page.getByText('Activity Inbox', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');

    await page.screenshot({ path: test.info().outputPath('otto-surfaces.png') });
  } finally {
    await app.close().catch(() => undefined);
    rmSync(tmp, { recursive: true, force: true });
  }
});
