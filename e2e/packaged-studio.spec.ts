import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';

/**
 * Studio and Planner in the real packaged app.
 *
 * The source-build smoke test cannot catch an Office library that was left out
 * of the asar. This test creates one of each Studio item, exports all three
 * Office formats through the actual IPC bridge, and proves the Planner store
 * answers from inside the packaged application.
 *
 * It needs `npm run build:win` first and skips cleanly when no package exists.
 */

const exe = resolve('dist/win-unpacked/Infinite OS.exe');
const hasPackagedBuild = existsSync(exe);
const TEST_EMAIL = 'packaged-studio@infinite.test';

function seedProfile(home: string): void {
  const base = join(home, '.infinite-ai');
  mkdirSync(base, { recursive: true });
  const user = {
    id: 'packaged-studio-user',
    email: TEST_EMAIL,
    name: 'Packaged Studio',
    createdAt: Date.now(),
    hasCompletedOnboarding: true,
    profile: {
      name: 'Packaged Studio',
      workspaceTheme: 'dark',
      notificationsEnabled: false,
      aiMemoryEnabled: false,
    },
  };
  writeFileSync(join(base, 'auth.json'), JSON.stringify({ [TEST_EMAIL]: { user, password: 'packaged-studio' } }), 'utf8');
  writeFileSync(join(base, 'auth-session.json'), JSON.stringify({ user, isAuthenticated: true }), 'utf8');
  // The packaged app re-homes profiles when the session's sanitized uid does
  // not match active-profile.json. Seed the pointer so auth restore does not
  // relaunch the app underneath the test.
  const uid = TEST_EMAIL.toLowerCase().replace(/[^a-zA-Z0-9-_]/g, '').slice(0, 64);
  writeFileSync(join(base, 'active-profile.json'), JSON.stringify({ uid }), 'utf8');
}

test.describe('packaged Studio and Planner', () => {
  let app: ElectronApplication | null = null;
  let tmp = '';

  test.afterEach(async () => {
    if (app) {
      await app.close().catch(() => {});
      app = null;
    }
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = '';
    }
  });

  test('creates and exports real Office files through the asar', async () => {
    test.skip(!hasPackagedBuild, 'run `npm run build:win` first');
    test.setTimeout(180_000);

    tmp = mkdtempSync(join(tmpdir(), 'infinite-os-packaged-studio-'));
    const home = join(tmp, 'home');
    const userData = join(tmp, 'userdata');
    mkdirSync(home, { recursive: true });
    seedProfile(home);

    app = await electron.launch({
      executablePath: exe,
      args: [`--user-data-dir=${userData}`],
      env: {
        ...process.env,
        USERPROFILE: home,
        HOME: home,
        APPDATA: join(tmp, 'appdata'),
        LOCALAPPDATA: join(tmp, 'localappdata'),
        INFINITE_TEST_HOME: join(home, '.infinite-ai'),
        INFINITE_DISABLE_GPU: '1',
      },
      timeout: 90_000,
    });

    const win = await app.firstWindow({ timeout: 60_000 });
    const mainLog: string[] = [];
    app.process().stdout?.on('data', (chunk: Buffer) => mainLog.push(chunk.toString()));
    app.process().stderr?.on('data', (chunk: Buffer) => mainLog.push(chunk.toString()));
    win.on('close', () => mainLog.push('[renderer window closed]'));
    win.on('crash', () => mainLog.push('[renderer crashed]'));
    app.on('close', () => mainLog.push('[electron application closed]'));
    await win.waitForFunction(() => Boolean(document.querySelector('[data-nav="studio"]')), undefined, { timeout: 60_000 });

    const paths = {
      docx: join(tmp, 'packaged-proof.docx'),
      xlsx: join(tmp, 'packaged-proof.xlsx'),
      pptx: join(tmp, 'packaged-proof.pptx'),
    };

    // A save dialog would block the test. Replace it in the main process with
    // a queue of real destination paths; exportStudioItem still does all of
    // its own work, including loading the Office libraries from the asar.
    await app.evaluate(({ dialog }, queue) => {
      const destinations = [...queue];
      (dialog as unknown as {
        showSaveDialog: (...args: unknown[]) => Promise<{ canceled: boolean; filePath?: string }>;
      }).showSaveDialog = async () => {
        const filePath = destinations.shift();
        if (!filePath) throw new Error('No export destination queued.');
        return { canceled: false, filePath };
      };
    }, [paths.docx, paths.xlsx, paths.pptx]);

    const ids = await win.evaluate(async () => {
      const api = (window as unknown as {
        api: {
          studioCreate: (input: { kind: string; title: string }) => Promise<{ id: string }>;
          studioUpdate: (input: { id: string; patch: Record<string, unknown> }) => Promise<unknown>;
          plannerTaskCreate: (input: { title: string; due?: number }) => Promise<unknown>;
          plannerEventCreate: (input: { title: string; start: number }) => Promise<unknown>;
          plannerReminderCreate: (input: { title: string; at: number }) => Promise<unknown>;
          plannerGet: () => Promise<{ tasks: Array<{ title: string }>; events: Array<{ title: string }>; reminders: Array<{ title: string }> }>;
        };
      }).api;

      const doc = await api.studioCreate({ kind: 'document', title: 'Packaged proof' });
      await api.studioUpdate({ id: doc.id, patch: { html: '<h1>Packaged proof</h1><p>This file crossed the asar boundary.</p>' } });

      const sheet = await api.studioCreate({ kind: 'sheet', title: 'Packaged sheet' });
      await api.studioUpdate({
        id: sheet.id,
        patch: { sheet: { columns: 3, rows: 2, cells: { A1: 'Task', B1: 'Done', A2: 'Export', B2: 'Yes' } } },
      });

      const slides = await api.studioCreate({ kind: 'slides', title: 'Packaged deck' });
      await api.studioUpdate({
        id: slides.id,
        patch: {
          deck: {
            slides: [
              { id: 'one', title: 'Packaged deck', body: 'Built inside the asar' },
              { id: 'two', title: 'Real files', body: 'Not renamed HTML' },
            ],
          },
        },
      });

      const now = Date.now();
      await api.plannerTaskCreate({ title: 'Packaged task', due: now + 60_000 });
      await api.plannerEventCreate({ title: 'Packaged event', start: now + 3_600_000 });
      await api.plannerReminderCreate({ title: 'Packaged reminder', at: now + 7_200_000 });
      const planner = await api.plannerGet();

      return {
        doc: doc.id,
        sheet: sheet.id,
        slides: slides.id,
        planner: {
          tasks: planner.tasks.map((task) => task.title),
          events: planner.events.map((event) => event.title),
          reminders: planner.reminders.map((reminder) => reminder.title),
        },
      };
    });

    const exports = await win.evaluate(async (itemIds) => {
      const api = (window as unknown as {
        api: {
          studioExport: (input: { id: string; format?: string }) => Promise<{ canceled: boolean; path?: string }>;
        };
      }).api;
      return {
        docx: await api.studioExport({ id: itemIds.doc }),
        xlsx: await api.studioExport({ id: itemIds.sheet }),
        pptx: await api.studioExport({ id: itemIds.slides }),
      };
    }, ids).catch((error: unknown) => {
      throw new Error(`${String(error)}\n--- packaged app output ---\n${mainLog.join('')}`);
    });

    expect(exports.docx.canceled).toBe(false);
    expect(exports.xlsx.canceled).toBe(false);
    expect(exports.pptx.canceled).toBe(false);

    for (const [format, file] of Object.entries(paths)) {
      expect(existsSync(file), `${format} was not written`).toBe(true);
      expect(statSync(file).size, `${format} is too small to be a real document`).toBeGreaterThan(5_000);
    }
    expect(ids.planner.tasks).toContain('Packaged task');
    expect(ids.planner.events).toContain('Packaged event');
    expect(ids.planner.reminders).toContain('Packaged reminder');

    // Open Studio and Planner in the packaged renderer so the lazy chunks and
    // navigation are covered too, not just the IPC surface.
    await win.locator('[data-nav="studio"]').click();
    await expect(win.getByText('Documents · Sheets · Decks')).toBeVisible({ timeout: 30_000 });
    await win.locator('[data-nav="planner"]').click();
    await expect(win.getByText('Packaged task')).toBeVisible({ timeout: 30_000 });
  });
});
