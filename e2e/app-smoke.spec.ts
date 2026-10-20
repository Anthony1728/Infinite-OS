import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const mainEntry = join(root, 'out', 'main', 'index.js');
const rendererEntry = join(root, 'out', 'renderer', 'index.html');

test.describe('Infinite OS boot smoke', () => {
  let app: ElectronApplication | null = null;
  let userDataDir: string | null = null;

  test.afterEach(async () => {
    if (app) {
      await app.close().catch(() => {});
      app = null;
    }
    if (userDataDir) {
      rmSync(userDataDir, { recursive: true, force: true });
      userDataDir = null;
    }
  });

  test('built app boots, renders the workspace, and does not crash', async () => {
    expect(
      existsSync(mainEntry) && existsSync(rendererEntry),
      'Build output missing — run `npm run build` before `npm run test:e2e`.',
    ).toBe(true);

    // Isolated profile so the smoke run never touches the user's live
    // settings/memory and never fights the real app for the single-instance lock.
    userDataDir = mkdtempSync(join(tmpdir(), 'infinite-os-e2e-'));

    app = await electron.launch({
      args: [mainEntry, `--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        INFINITE_DISABLE_GPU: '1',
      },
      timeout: 60_000,
    });

    const proc = app.process();
    let mainLog = '';
    proc.stdout?.on('data', (chunk: Buffer) => {
      mainLog += chunk.toString();
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      mainLog += chunk.toString();
    });

    const window = await app.firstWindow({ timeout: 60_000 });

    const pageErrors: string[] = [];
    window.on('pageerror', (error) => pageErrors.push(String(error)));

    // The static boot splash must paint (never a blank window)…
    await expect(window.locator('#boot-splash')).toBeVisible({ timeout: 30_000 });

    // …and React must hydrate the real workspace on top of it.
    await window.waitForFunction(
      () => {
        const rootEl = document.getElementById('root');
        return Boolean(rootEl && rootEl.childElementCount > 0);
      },
      undefined,
      { timeout: 60_000 },
    );

    // Give background subsystems a beat to run their startup path.
    await window.waitForTimeout(2_000);

    // Main process must still be alive after boot (no synchronous startup throw).
    expect(proc.exitCode, `Main process exited during boot.\n${mainLog}`).toBeNull();

    // No renderer crash / load failure anywhere in the boot log.
    expect(mainLog, 'Renderer crashed during boot').not.toContain('[renderer] CRASH');
    expect(mainLog, 'Renderer failed to load').not.toContain('did-fail-load');

    // No uncaught exceptions in the renderer.
    expect(pageErrors, 'Uncaught renderer exceptions').toEqual([]);

    // Workspace chrome is actually interactive, not a dead document.
    await expect(window).toHaveTitle(/Infinite OS/i, { timeout: 15_000 });
    const interactive = await window.evaluate(() => {
      const rootEl = document.getElementById('root');
      return Boolean(rootEl && rootEl.querySelector('button, input, textarea, [role="button"]'));
    });
    expect(interactive, 'Workspace rendered no interactive controls').toBe(true);
  });
});
