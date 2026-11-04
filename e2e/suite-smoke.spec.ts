import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const mainEntry = join(root, 'out', 'main', 'index.js');
const rendererEntry = join(root, 'out', 'renderer', 'index.html');
const TEST_EMAIL = 'suite-e2e@infinite.test';

interface TestUser {
  id: string;
  email: string;
  name: string;
  createdAt: number;
  hasCompletedOnboarding: boolean;
  profile: {
    name: string;
    workspaceTheme: 'dark';
    notificationsEnabled: boolean;
    aiMemoryEnabled: boolean;
  };
}

function seedProfile(home: string): void {
  const base = join(home, '.infinite-ai');
  mkdirSync(base, { recursive: true });
  const user: TestUser = {
    id: 'suite-e2e-user',
    email: TEST_EMAIL,
    name: 'Suite E2E',
    createdAt: Date.now(),
    hasCompletedOnboarding: true,
    profile: {
      name: 'Suite E2E',
      workspaceTheme: 'dark',
      notificationsEnabled: false,
      aiMemoryEnabled: false,
    },
  };
  writeFileSync(
    join(base, 'auth.json'),
    JSON.stringify({ [TEST_EMAIL]: { user, password: 'suite-e2e' } }),
    'utf8',
  );
  writeFileSync(
    join(base, 'auth-session.json'),
    JSON.stringify({ user, isAuthenticated: true }),
    'utf8',
  );
}

async function launchApp(): Promise<{
  app: ElectronApplication;
  page: Page;
  cleanups: Array<() => void>;
}> {
  expect(
    existsSync(mainEntry) && existsSync(rendererEntry),
    'Build output missing — run `npm run build` before `npm run test:e2e`.',
  ).toBe(true);

  const tmp = mkdtempSync(join(tmpdir(), 'infinite-os-suite-'));
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

  const page = await app.firstWindow({ timeout: 60_000 });
  await page.waitForFunction(
    () => Boolean(document.querySelector('[data-nav="studio"]')),
    undefined,
    { timeout: 60_000 },
  );

  return {
    app,
    page,
    cleanups: [
      () => app.close().catch(() => undefined),
      () => rmSync(tmp, { recursive: true, force: true }),
    ],
  };
}

async function closeApp(app: ElectronApplication | null, cleanups: Array<() => void>): Promise<void> {
  if (app) await app.close().catch(() => undefined);
  for (const cleanup of cleanups) {
    try {
      cleanup();
    } catch {
      // Best-effort cleanup of an isolated temp directory on Windows.
    }
  }
}

test.describe('Infinite OS Studio, Planner, and wallpaper', () => {
  let app: ElectronApplication | null = null;
  let cleanups: Array<() => void> = [];

  test.afterEach(async () => {
    await closeApp(app, cleanups);
    app = null;
    cleanups = [];
  });

  test('Studio and Planner survive a full create/edit/reload cycle', async () => {
    test.setTimeout(300_000);
    const launched = await launchApp();
    app = launched.app;
    cleanups = launched.cleanups;
    const page = launched.page;

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));

    // ── Studio: document ────────────────────────────────────────────────
    await page.locator('[data-nav="studio"]').click();
    await expect(page.getByText('Documents · Sheets · Decks')).toBeVisible();

    await page.getByRole('button', { name: 'Create new Studio item' }).click();
    // The empty state repeats the same three cards as the New menu; the
    // dropdown entry is first in DOM order.
    await page.locator('button').filter({ hasText: 'Write, edit, and export Word files' }).first().click();
    await expect(page.getByLabel('Document title')).toHaveValue('Untitled document');

    await page.getByLabel('Document title').fill('E2E launch plan');
    await page.getByLabel('Document body').click();
    await page.keyboard.type('Infinite OS keeps work close.');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('The suite saves to this computer.');

    // The AI panel must open with document actions and never apply on its own.
    await page.getByRole('button', { name: 'AI', exact: true }).click();
    await expect(page.getByText('Writing inside your document')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Grammar' })).toBeVisible();
    await page.getByRole('button', { name: 'Close AI panel' }).click();

    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const items = (await (window as unknown as { api: { studioList: () => Promise<Array<{ title: string; html?: string }>> } }).api.studioList());
            const doc = items.find((item) => item.title === 'E2E launch plan');
            return doc?.html?.includes('Infinite OS keeps work close.') ?? false;
          }),
        { timeout: 15_000 },
      )
      .toBe(true);

    // ── Studio: spreadsheet + safe formula ──────────────────────────────
    await page.getByRole('button', { name: 'Create new Studio item' }).click();
    await page.locator('button').filter({ hasText: 'Formulas, CSV import, Excel export' }).first().click();
    const formulaBar = page.getByLabel('Formula bar');
    await page.locator('[data-cell="A1"]').click();
    await formulaBar.fill('10');
    await formulaBar.press('Enter');
    await page.locator('[data-cell="A2"]').click();
    await formulaBar.fill('20');
    await formulaBar.press('Enter');
    await page.locator('[data-cell="A3"]').click();
    await formulaBar.fill('=SUM(A1:A2)');
    await formulaBar.press('Enter');
    await expect(page.locator('[data-cell="A3"]')).toHaveText('30');

    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const planner = (window as unknown as { api: { studioList: () => Promise<Array<{ kind: string; sheet?: { cells: Record<string, string> } }>> } }).api;
            const items = await planner.studioList();
            const sheet = items.find((item) => item.kind === 'sheet');
            return sheet?.sheet?.cells.A3 ?? null;
          }),
        { timeout: 15_000 },
      )
      .toBe('=SUM(A1:A2)');

    // ── Studio: deck ────────────────────────────────────────────────────
    await page.getByRole('button', { name: 'Create new Studio item' }).click();
    await page.locator('button').filter({ hasText: 'Build and present slide decks' }).first().click();
    await page.getByPlaceholder('Slide title').fill('The first slide');
    await page.getByPlaceholder(/Write the point of this slide/).fill('• One idea\n• One clear line');
    await page.getByRole('button', { name: 'Add slide' }).click();
    await page.getByPlaceholder('Slide title').last().fill('The second slide');
    await page.getByPlaceholder(/Write the point of this slide/).last().fill('A deck that presents.');

    await page.getByRole('button', { name: /Present/ }).click();
    await expect(page.locator('.present-stage')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.present-stage')).toBeHidden();

    await page.waitForTimeout(1_200);
    await page.reload();
    await page.waitForFunction(
      () => Boolean(document.querySelector('[data-nav="studio"]')),
      undefined,
      { timeout: 60_000 },
    );

    const persisted = await page.evaluate(async () => {
      const items = (await (window as unknown as { api: { studioList: () => Promise<Array<{ title: string; kind: string; html?: string; deck?: { slides: Array<{ title: string }> } }>> } }).api.studioList());
      return {
        doc: items.find((item) => item.title === 'E2E launch plan'),
        deckTitles: items.find((item) => item.kind === 'slides')?.deck?.slides.map((slide) => slide.title) ?? [],
        sheetCount: items.filter((item) => item.kind === 'sheet').length,
      };
    });
    expect(persisted.doc?.html).toContain('The suite saves to this computer.');
    expect(persisted.deckTitles).toEqual(['The first slide', 'The second slide']);
    expect(persisted.sheetCount).toBe(1);

    // ── Planner: task and event ─────────────────────────────────────────
    await page.locator('[data-nav="planner"]').click();
    await expect(page.getByPlaceholder(/Add a task/)).toBeVisible();
    await page.getByPlaceholder(/Add a task/).fill('E2E task: verify planner');
    await page.keyboard.press('Enter');
    await expect(page.getByText('E2E task: verify planner')).toBeVisible();
    await page.getByLabel('Mark done').first().click();

    await page.getByRole('button', { name: /New event/ }).click();
    await page.getByPlaceholder('Design review').fill('E2E event');
    await page.getByRole('button', { name: 'Add event' }).click();
    // The event renders in both the day list and the "Today" upcoming card,
    // so match the first instance rather than relying on a unique hit.
    await expect(page.getByText('E2E event').first()).toBeVisible();

    const planner = await page.evaluate(async () => {
      const data = (await (window as unknown as {
        api: { plannerGet: () => Promise<{ tasks: Array<{ title: string; done: boolean }>; events: Array<{ title: string }> }> };
      }).api.plannerGet());
      return {
        task: data.tasks.find((task) => task.title === 'E2E task: verify planner'),
        event: data.events.find((event) => event.title === 'E2E event'),
      };
    });
    expect(planner.task?.done).toBe(true);
    expect(planner.event).toBeTruthy();

    // Calendar and upcoming views render without crashing.
    await page.getByRole('button', { name: 'calendar', exact: true }).click();
    await expect(page.getByRole('heading', { level: 2 })).toBeVisible();
    await page.getByRole('button', { name: 'upcoming', exact: true }).click();
    await expect(page.getByText('E2E task: verify planner')).toHaveCount(0); // completed tasks leave the open list

    // Reminders are an OS-level promise: one must still fire after the user
    // leaves Planner, without waiting for that view to remount.
    await page.evaluate(async () => {
      const api = (window as unknown as {
        api: { plannerReminderCreate: (input: { title: string; at: number }) => Promise<unknown> };
      }).api;
      await api.plannerReminderCreate({ title: 'E2E reminder while away', at: Date.now() + 1_500 });
    });
    await page.locator('[data-nav="studio"]').click();
    await expect(page.getByText('E2E reminder while away')).toBeVisible({ timeout: 20_000 });

    expect(pageErrors, 'Uncaught renderer exceptions').toEqual([]);
  });

  test('Studio AI changes the document only when the writer applies it', async () => {
    test.setTimeout(180_000);
    const launched = await launchApp();
    app = launched.app;
    cleanups = launched.cleanups;
    const page = launched.page;

    // Keep the test deterministic: model output is replaced with a fixed
    // response so the editor apply bridge can be checked on its own.
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('studio:ai');
      ipcMain.handle('studio:ai', () => ({
        text: 'The corrected cat sat on the mat.',
        provider: 'test',
        model: 'test',
      }));
    });

    await page.locator('[data-nav="studio"]').click();
    await page.getByRole('button', { name: 'Create new Studio item' }).click();
    await page.locator('button').filter({ hasText: 'Write, edit, and export Word files' }).first().click();
    await expect(page.getByLabel('Document title')).toHaveValue('Untitled document');

    const body = page.getByLabel('Document body');
    await body.click();
    await page.keyboard.type('teh cat sat on teh mat.');
    await page.keyboard.press('Control+a');

    await page.getByRole('button', { name: 'AI', exact: true }).click();
    await expect(page.getByText(/chars selected/)).toBeVisible();
    await page.getByRole('button', { name: 'Grammar', exact: true }).click();
    await page.getByRole('button', { name: /Generate/ }).click();
    await expect(page.getByText('The corrected cat sat on the mat.')).toBeVisible();

    // Generated text is a proposal until the writer explicitly applies it.
    await expect(body).toContainText('teh cat sat on teh mat.');

    await page.getByRole('button', { name: 'Replace selection' }).click();
    await expect(body).toContainText('The corrected cat sat on the mat.');
    await expect(body).not.toContainText('teh cat sat on teh mat.');
    await expect(page.getByText('Replaced selection')).toBeVisible();
  });

  test('wallpaper presets, custom image, and persistence work', async () => {
    test.setTimeout(240_000);
    const launched = await launchApp();
    app = launched.app;
    cleanups = launched.cleanups;
    const page = launched.page;

    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('infinite:open-personalization', { detail: 'appearance' }));
    });
    await expect(page.getByRole('dialog', { name: 'Infinite OS settings' })).toBeVisible();

    await page.locator('.os-wallpaper-tile[data-id="aurora"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-wallpaper', 'on');
    await expect(page.locator('.os-wallpaper')).toBeVisible();

    const dim = page.locator('.os-control input[type="range"]').first();
    await dim.fill('70');
    await expect(page.getByText('Wallpaper dim 70%')).toBeVisible();

    // Generate a real PNG in the renderer, then upload it through the same
    // file input a user picks from. prepareWallpaperImage re-encodes it as JPEG.
    const pngBase64 = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 36;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas unavailable');
      const gradient = context.createLinearGradient(0, 0, 64, 36);
      gradient.addColorStop(0, '#1d4ed8');
      gradient.addColorStop(1, '#db2777');
      context.fillStyle = gradient;
      context.fillRect(0, 0, 64, 36);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await page.locator('input[type="file"][accept*="image"]').setInputFiles({
      name: 'suite-wallpaper.png',
      mimeType: 'image/png',
      buffer: Buffer.from(pngBase64, 'base64'),
    });

    await expect(page.locator('.os-wallpaper-tile[data-id="custom"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Using suite-wallpaper.png')).toBeVisible();
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const raw = localStorage.getItem('infinite:appearance-v2');
            if (!raw) return null;
            const state = JSON.parse(raw)?.state as { wallpaper?: string; wallpaperImage?: string; wallpaperDim?: number } | undefined;
            return {
              wallpaper: state?.wallpaper,
              hasImage: Boolean(state?.wallpaperImage?.startsWith('data:image/jpeg;base64,')),
              dim: state?.wallpaperDim,
            };
          }),
        { timeout: 15_000 },
      )
      .toMatchObject({ wallpaper: 'custom', hasImage: true, dim: 70 });

    await page.screenshot({ path: test.info().outputPath('wallpaper-appearance.png') });
    await page.getByRole('button', { name: 'Close settings' }).click();
    await page.locator('[data-nav="studio"]').click();
    await page.screenshot({ path: test.info().outputPath('wallpaper-studio.png') });

    await page.reload();
    await page.waitForFunction(
      () => Boolean(document.querySelector('[data-nav="studio"]')),
      undefined,
      { timeout: 60_000 },
    );
    await expect(page.locator('html')).toHaveAttribute('data-wallpaper', 'on');
    await expect(page.locator('.os-wallpaper-media')).toBeVisible();

    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('infinite:open-personalization', { detail: 'appearance' }));
    });
    await expect(page.locator('.os-wallpaper-tile[data-id="custom"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Wallpaper dim 70%')).toBeVisible();

    // A saved photo is one click away; selecting it must not reopen the picker.
    await page.locator('.os-wallpaper-tile[data-id="aurora"]').click();
    await expect(page.locator('.os-wallpaper-tile[data-id="custom"]')).toHaveAttribute('aria-pressed', 'false');
    await page.locator('.os-wallpaper-tile[data-id="custom"]').click();
    await expect(page.locator('.os-wallpaper-tile[data-id="custom"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Using suite-wallpaper.png')).toBeVisible();
  });

  test('Pages writes, searches, applies AI, manages database rows, and survives reload', async () => {
    test.setTimeout(300_000);
    const launched = await launchApp();
    app = launched.app;
    cleanups = launched.cleanups;
    const page = launched.page;

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));

    // Deterministic model output: database generation gets CSV, everything
    // else gets a closing paragraph. The UI must not apply either on its own.
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('studio:ai');
      ipcMain.handle('studio:ai', (_event, args?: { kind?: string }) => {
        if (args?.kind === 'sheet') {
          return {
            text: [
              'Name,Status,Owner,Date',
              'Plan the launch,Not started,Ada,2026-11-02',
              'Draft the announcement,In progress,Grace,2026-11-05',
            ].join('\n'),
            provider: 'test',
            model: 'test',
          };
        }
        return {
          text: 'A closing line written by Pages AI.',
          provider: 'test',
          model: 'test',
        };
      });
    });

    await page.locator('[data-nav="pages"]').click();
    await expect(page.getByRole('heading', { name: 'A home for every thought.' })).toBeVisible();

    // -- Database ----------------------------------------------------------
    await page.locator('.pages-landing-actions .pages-secondary-button').click();
    await expect(page.locator('.pages-title')).toHaveValue('Untitled database');
    await page.locator('.pages-title').fill('E2E database');

    await page.locator('.pages-db-new-row').click();
    await expect(page.locator('.pages-title-cell input')).toHaveCount(1);
    await page.locator('.pages-title-cell input').first().fill('First launch task');

    await page.locator('.pages-ai-trigger').click();
    await expect(page.locator('.pages-ai-panel')).toBeVisible();
    await page.locator('#pages-ai-prompt-input').fill('Realistic launch tasks');
    await page.locator('.pages-ai-run').click();
    await expect(page.getByText('2 rows ready to add')).toBeVisible();
    await page.locator('.pages-ai-apply').click();
    await expect(page.locator('.pages-title-cell input')).toHaveCount(3);
    await expect(page.locator('.pages-title-cell input').nth(1)).toHaveValue('Plan the launch');
    // Applying rows closes the panel so the database is immediately usable.
    await expect(page.locator('.pages-ai-panel')).toBeHidden();

    // Every shipped view renders this database without crashing.
    await page.locator('.pages-view-tab').filter({ hasText: 'Board' }).click();
    await expect(page.locator('.pages-database-body')).toBeVisible();
    await page.locator('.pages-view-tab').filter({ hasText: 'Calendar' }).click();
    await expect(page.locator('.pages-database-body')).toBeVisible();
    await page.locator('.pages-view-tab').filter({ hasText: 'Table' }).click();
    await expect(page.locator('.pages-title-cell input')).toHaveCount(3);

    // Deleting a row asks first. Cancel keeps it, confirm removes it.
    await page.locator('.pages-db-row-menu').first().click();
    await page.locator('.pages-popover').getByText('Delete row', { exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Delete this row?' })).toBeVisible();
    await page.locator('.pages-confirm-modal').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.pages-confirm-modal')).toBeHidden();
    await expect(page.locator('.pages-title-cell input')).toHaveCount(3);

    await page.locator('.pages-db-row-menu').first().click();
    await page.locator('.pages-popover').getByText('Delete row', { exact: true }).click();
    await page.locator('.pages-confirm-modal').getByRole('button', { name: 'Delete row' }).click();
    await expect(page.locator('.pages-title-cell input')).toHaveCount(2);
    await expect(page.locator('.pages-title-cell input').first()).toHaveValue('Plan the launch');
    await page.screenshot({ path: test.info().outputPath('pages-database.png') });

    // -- Document ----------------------------------------------------------
    await page.locator('.pages-sidebar-actions .pages-primary-button').click();
    await expect(page.locator('.pages-title')).toHaveValue('Untitled');
    await page.locator('.pages-title').fill('E2E knowledge page');
    const firstBlock = page.locator('.pages-blocks .pages-text-block').first();
    await firstBlock.click();
    await page.keyboard.type('Pages keep the plan and the proof together.');
    await page.keyboard.press('Enter');
    await page.keyboard.type('A second line stays linked.');

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
            const summary = list.find((item) => item.title === 'E2E knowledge page');
            if (!summary) return null;
            const record = await api.pagesGet({ id: summary.id });
            return record?.blocks.map((block) => block.html).join(' ') ?? null;
          }),
        { timeout: 15_000 },
      )
      .toContain('A second line stays linked.');

    // The generated paragraph is a proposal until the writer applies it.
    await page.locator('.pages-ai-trigger').click();
    await page.locator('#pages-ai-prompt-input').fill('Add a closing line.');
    await page.locator('.pages-ai-run').click();
    await expect(page.locator('.pages-ai-preview')).toContainText('A closing line written by Pages AI.');
    await expect(page.locator('.pages-blocks')).not.toContainText('A closing line written by Pages AI.');
    await page.getByRole('button', { name: 'Append to page' }).click();
    await expect(page.locator('.pages-blocks')).toContainText('A closing line written by Pages AI.');
    await expect(page.locator('.pages-ai-panel')).toBeHidden();
    await page.screenshot({ path: test.info().outputPath('pages-document.png') });

    // Search spans titles and flattened body text.
    await page.getByLabel('Search pages').fill('knowledge');
    await expect(page.locator('.pages-search-result-title').filter({ hasText: 'E2E knowledge page' })).toBeVisible();
    await page.getByLabel('Clear search').click();

    // Trash is recoverable, not a dead end.
    const treeRow = page.locator('.pages-tree-row').filter({
      has: page.locator('.pages-tree-title', { hasText: 'E2E knowledge page' }),
    });
    await treeRow.locator('button[title="Page options"]').click();
    await page.locator('.pages-popover').getByText('Move to trash', { exact: true }).click();
    await page.locator('.pages-sidebar-link').filter({ hasText: 'Trash' }).click();
    await expect(page.getByRole('heading', { name: 'Trash' })).toBeVisible();
    await page.locator('.pages-trash-row').filter({ hasText: 'E2E knowledge page' })
      .getByRole('button', { name: 'Restore' }).click();
    await expect(page.locator('.pages-title')).toHaveValue('E2E knowledge page');

    // -- Reload: the files on disk must be the source of truth ------------
    await page.waitForTimeout(1_200);
    await page.reload();
    await page.waitForFunction(
      () => Boolean(document.querySelector('[data-nav="studio"]')),
      undefined,
      { timeout: 60_000 },
    );
    await page.locator('[data-nav="pages"]').click();
    // The last opened page is restored, including its saved body.
    await expect(page.locator('.pages-title')).toHaveValue('E2E knowledge page');
    await expect(page.locator('.pages-blocks')).toContainText('A closing line written by Pages AI.');

    const persisted = await page.evaluate(async () => {
      const api = (window as unknown as {
        api: {
          pagesList: () => Promise<Array<{ id: string; title: string; kind: string }>>;
          pagesGet: (args: { id: string }) => Promise<{
            blocks: Array<{ html: string }>;
            database?: { rows: Array<{ values: Record<string, unknown> }> };
          } | null>;
        };
      }).api;
      const list = await api.pagesList();
      const docSummary = list.find((item) => item.title === 'E2E knowledge page');
      const databaseSummary = list.find((item) => item.title === 'E2E database');
      const doc = docSummary ? await api.pagesGet({ id: docSummary.id }) : null;
      const database = databaseSummary ? await api.pagesGet({ id: databaseSummary.id }) : null;
      return {
        docText: doc?.blocks.map((block) => block.html).join(' ') ?? '',
        rows: (database?.database?.rows ?? []).map((row) => (
          Object.values(row.values).filter((value) => typeof value === 'string').join(' ')
        )),
      };
    });
    expect(persisted.docText).toContain('Pages keep the plan and the proof together.');
    expect(persisted.docText).toContain('A closing line written by Pages AI.');
    expect(persisted.rows).toHaveLength(2);
    expect(persisted.rows.some((row) => row.includes('Plan the launch'))).toBe(true);
    expect(persisted.rows.some((row) => row.includes('Draft the announcement'))).toBe(true);

    // Reopen through the UI, not just the API.
    await page.locator('.pages-tree-label[title="E2E database"]').click();
    await expect(page.locator('.pages-title-cell input')).toHaveCount(2);
    await expect(page.locator('.pages-title-cell input').first()).toHaveValue('Plan the launch');
    await page.locator('.pages-tree-label[title="E2E knowledge page"]').click();
    await expect(page.locator('.pages-blocks')).toContainText('A closing line written by Pages AI.');

    expect(pageErrors, 'Uncaught renderer exceptions').toEqual([]);
  });

  test('agent-control surfaces are wired for computer, browser, and tools', async () => {
    test.setTimeout(180_000);
    const launched = await launchApp();
    app = launched.app;
    cleanups = launched.cleanups;
    const page = launched.page;

    const surfaces = await page.evaluate(async () => {
      const api = (window as unknown as {
        api: {
          listTools: () => Promise<Array<{ name: string; description: string; input_schema: unknown }>>;
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

    const names = surfaces.tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining([
      'Computer',
      'PCLiveMap',
      'browser_extension',
      'Operator',
      'Pages',
      'Studio',
      'Planner',
      'Bash',
      'Email',
    ]));

    const computer = surfaces.tools.find((tool) => tool.name === 'Computer');
    const schema = computer?.input_schema as { properties?: { action?: { enum?: string[] } } } | undefined;
    expect(schema?.properties?.action?.enum).toEqual(expect.arrayContaining([
      'mouse_click',
      'type_text',
      'key_press',
      'hotkey',
      'screenshot',
      'launch_app',
      'focus_window',
      'list_processes',
      'get_clipboard',
      'set_clipboard',
    ]));

    const liveMap = surfaces.tools.find((tool) => tool.name === 'PCLiveMap');
    const liveSchema = liveMap?.input_schema as { properties?: { action?: { enum?: string[] } } } | undefined;
    expect(liveSchema?.properties?.action?.enum).toEqual(expect.arrayContaining([
      'status',
      'live',
      'changes',
      'agent',
      'elements',
      'health',
      'events',
      'click_name',
      'type',
      'keys',
      'focus',
      'start',
    ]));

    expect(surfaces.screen.ok).toBe(true);
    expect(surfaces.screen.width).toBeGreaterThan(0);
    expect(surfaces.screen.height).toBeGreaterThan(0);

    // The bridge generates its own token in a fresh profile instead of
    // shipping a hardcoded secret with the extension.
    expect(surfaces.bridge.ok).toBe(true);
    expect(surfaces.bridge.status.port).toBeGreaterThan(0);
    expect(surfaces.bridge.status.tokenConfigured).toBe(true);
  });
});
