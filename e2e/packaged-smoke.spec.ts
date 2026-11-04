import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, expect, _electron as electron } from '@playwright/test';

const exe = resolve('dist/win-unpacked/Infinite OS.exe');
const TEST_EMAIL = 'packaged-e2e@infinite.test';

function seedAuth(home: string): void {
  const base = join(home, '.infinite-ai');
  mkdirSync(base, { recursive: true });
  const user = {
    id: 'packaged-e2e-user',
    email: TEST_EMAIL,
    name: 'Packaged E2E',
    createdAt: Date.now(),
    hasCompletedOnboarding: true,
    profile: {
      name: 'Packaged E2E',
      workspaceTheme: 'dark',
      notificationsEnabled: false,
      aiMemoryEnabled: false,
    },
  };
  writeFileSync(
    join(base, 'auth.json'),
    JSON.stringify({ [TEST_EMAIL]: { user, password: 'packaged-e2e' } }),
    'utf8',
  );
  writeFileSync(
    join(base, 'auth-session.json'),
    JSON.stringify({ user, isAuthenticated: true }),
    'utf8',
  );
  // Mark this profile active before boot. Without it the packaged app treats
  // the restored session as an account switch and relaunches itself.
  const uid = TEST_EMAIL.toLowerCase().replace(/[^a-zA-Z0-9-_]/g, '');
  writeFileSync(join(base, 'active-profile.json'), JSON.stringify({ uid }), 'utf8');
}

test.describe('Packaged Windows build', () => {
  test.skip(!existsSync(exe), 'Build dist/win-unpacked before running the packaged smoke test.');

  test('boots with an isolated profile and serves Pages, tools, and PCLiveMap assets', async () => {
    test.setTimeout(240_000);
    const tmp = mkdtempSync(join(tmpdir(), 'infinite-os-packaged-'));
    const home = join(tmp, 'home');
    const appData = join(tmp, 'appdata');
    const localAppData = join(tmp, 'localappdata');
    const userData = join(tmp, 'userdata');
    for (const dir of [home, appData, localAppData, userData]) mkdirSync(dir, { recursive: true });
    seedAuth(home);

    const app = await electron.launch({
      executablePath: exe,
      args: [`--user-data-dir=${userData}`],
      env: {
        ...process.env,
        USERPROFILE: home,
        HOME: home,
        APPDATA: appData,
        LOCALAPPDATA: localAppData,
        INFINITE_TEST_HOME: join(home, '.infinite-ai'),
        INFINITE_DISABLE_GPU: '1',
      },
      timeout: 90_000,
    });
    app.process().stdout?.on('data', (chunk) => console.log(`[packaged stdout] ${chunk}`));
    app.process().stderr?.on('data', (chunk) => console.log(`[packaged stderr] ${chunk}`));

    try {
      let page = await app.firstWindow({ timeout: 90_000 });
      page.on('crash', () => console.log('[packaged renderer] page crashed'));
      await page.waitForFunction(
        () => Boolean(document.querySelector('[data-nav="studio"]')),
        undefined,
        { timeout: 90_000 },
      );

      // A packaged cold start can replace the renderer once while background
      // services initialize; follow the live window instead of a stale target.
      await page.waitForTimeout(4_000);
      const live = app.windows().filter((candidate) => !candidate.isClosed());
      for (const candidate of live) {
        if (await candidate.locator('[data-nav="studio"]').count().catch(() => 0)) {
          page = candidate;
          break;
        }
      }
      await page.waitForFunction(
        () => Boolean(document.querySelector('[data-nav="studio"]')),
        undefined,
        { timeout: 60_000 },
      );

      const build = await app.evaluate(({ app: electronApp }) => ({
        packaged: electronApp.isPackaged,
        version: electronApp.getVersion(),
        resources: process.resourcesPath,
      }));
      expect(build.packaged).toBe(true);
      expect(build.version).toBe('0.1.1');
      expect(existsSync(join(build.resources, 'pc-live-map', 'executor.ps1'))).toBe(true);
      expect(existsSync(join(build.resources, 'pc-live-map', 'tracker.ps1'))).toBe(true);

      const surfaces = await page.evaluate(async () => {
        const api = (window as unknown as {
          api: {
            listTools: () => Promise<Array<{ name: string }>>;
            computerGetScreenSize: () => Promise<{ ok: boolean; width: number; height: number }>;
            bridgeStatus: () => Promise<{ ok: boolean; status: { port: number; tokenConfigured: boolean } }>;
          };
        }).api;
        const [tools, screen, bridge] = await Promise.all([
          api.listTools(),
          api.computerGetScreenSize(),
          api.bridgeStatus(),
        ]);
        return { tools, screen, bridge };
      });
      expect(surfaces.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
        'Computer',
        'PCLiveMap',
        'browser_extension',
        'Operator',
        'Pages',
      ]));
      expect(surfaces.screen).toMatchObject({ ok: true });
      expect(surfaces.screen.width).toBeGreaterThan(0);
      expect(surfaces.screen.height).toBeGreaterThan(0);
      expect(surfaces.bridge.ok).toBe(true);
      expect(surfaces.bridge.status.tokenConfigured).toBe(true);

      await page.locator('[data-nav="pages"]').click();
      await expect(page.getByRole('heading', { name: 'A home for every thought.' })).toBeVisible();
      await page.locator('.pages-landing-actions .pages-primary-button').click();
      await page.locator('.pages-title').fill('Packaged build check');
      await page.locator('.pages-blocks .pages-text-block').first().click();
      await page.keyboard.type('The packaged app can write and save a page.');
      await expect
        .poll(
          async () =>
            page.evaluate(async () => {
              const api = (window as unknown as {
                api: {
                  pagesList: () => Promise<Array<{ id: string; title: string }>>;
                  pagesGet: (args: { id: string }) => Promise<{ blocks: Array<{ html: string }> } | null>;
                };
              }).api;
              const list = await api.pagesList();
              const summary = list.find((item) => item.title === 'Packaged build check');
              if (!summary) return null;
              const record = await api.pagesGet({ id: summary.id });
              return record?.blocks.map((block) => block.html).join(' ') ?? null;
            }),
          { timeout: 20_000 },
        )
        .toContain('The packaged app can write and save a page.');

      await page.screenshot({ path: test.info().outputPath('packaged-pages.png') });
    } finally {
      await app.close().catch(() => undefined);
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
