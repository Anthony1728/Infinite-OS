import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

/**
 * The three Settings cards added this pass, in the packaged build.
 *
 * Each exists because the feature behind it was finished but unreachable: the
 * self-evolution engine had seven registered handlers and no UI at all; the
 * background-build feature had five and no UI, and its progress events had no
 * subscriber, so a rebuild could finish or fail with the app looking idle; and
 * conversation cost was parsed by every provider and priced, then discarded.
 *
 * What is asserted here is that each card is *present and readable* — that it
 * renders in the real packaged app rather than only passing typecheck. Driving
 * a genuine rebuild or evolution cycle would take minutes and depend on model
 * access, which would make this a flaky test rather than a useful one.
 *
 * Needs `npm run build:win` first; skips without it.
 */

const exe = resolve('dist/win-unpacked/Infinite OS.exe');
const hasPackagedBuild = existsSync(exe);

test.describe('packaged feature surfaces', () => {
  let app: ElectronApplication | null = null;

  test.afterEach(async () => {
    if (app) {
      await app.close().catch(() => {});
      app = null;
    }
  });

  async function openSettings(): Promise<Page> {
    app = await electron.launch({
      executablePath: exe,
      args: [`--user-data-dir=${process.env.TEMP}\\infinite-os-features-smoke`],
      env: { ...process.env, INFINITE_DISABLE_GPU: '1' },
      timeout: 90_000,
    });
    const win = await app.firstWindow({ timeout: 60_000 });
    await win.waitForLoadState('domcontentloaded');
    await win.waitForTimeout(2500);

    // The sidebar "Settings" item swaps the main view to SettingsView, which is
    // the settings surface users actually reach. It is NOT the SettingsModal
    // variant — only a control with aria-label "Open settings" opens that, and
    // no such control is rendered in the packaged build, so cards added to the
    // modals are invisible here.
    await win.getByRole('button', { name: 'Settings', exact: true }).first().click({ timeout: 30_000 });
    await win.waitForTimeout(1500);

    // The modal variant, when reachable, has a section nav; the view does not.
    const features = win.getByRole('button', { name: /feature stack/i }).first();
    if (await features.count()) {
      await features.click({ timeout: 15_000 });
      await win.waitForTimeout(800);
    }
    return win;
  }

  test('the evolve, build and usage cards all render', async () => {
    test.skip(!hasPackagedBuild, 'run `npm run build:win` first');
    test.setTimeout(180_000);

    const win = await openSettings();

    // Matched on the visible text a user reads, so a card that silently failed
    // to render fails here instead of looking like an empty settings page.
    await expect(win.getByText('Evolve continuously').first()).toBeVisible({ timeout: 30_000 });
    await expect(win.getByText('Background builds').first()).toBeVisible();
    await expect(win.getByText('Usage and cost').first()).toBeVisible();
  });

  test('the usage card says so when nothing has been recorded', async () => {
    test.skip(!hasPackagedBuild, 'run `npm run build:win` first');
    test.setTimeout(180_000);

    const win = await openSettings();

    // Usage totals live in the real profile, so this machine may already have
    // requests. Both the empty state and a populated card prove the surface;
    // asserting only the empty state made the test depend on local data.
    const empty = win.getByText(/nothing recorded yet|totals appear after/i);
    const populated = win.getByText('Estimated cost', { exact: true });
    await expect(empty.or(populated).first()).toBeVisible({ timeout: 30_000 });
  });

  test('the preload bridge exposes the three new calls', async () => {
    test.skip(!hasPackagedBuild, 'run `npm run build:win` first');
    test.setTimeout(180_000);

    app = await electron.launch({
      executablePath: exe,
      args: [`--user-data-dir=${process.env.TEMP}\\infinite-os-features-smoke`],
      env: { ...process.env, INFINITE_DISABLE_GPU: '1' },
      timeout: 90_000,
    });
    const win = await app.firstWindow({ timeout: 60_000 });
    await win.waitForLoadState('domcontentloaded');

    const shape = await win.evaluate(async () => {
      const api = (window as unknown as Record<string, unknown>).api as Record<string, unknown>;
      return {
        hasUsageGet: typeof api.usageGet === 'function',
        hasUsageReset: typeof api.usageReset === 'function',
        hasBuildStart: typeof api.buildStart === 'function',
        hasBuildStatus: typeof api.buildStatus === 'function',
        hasOnBuildStatus: typeof api.onBuildStatus === 'function',
        hasSelfEvolveSuggestions: typeof api.selfEvolveSuggestions === 'function',
        // Computer control IS exposed, on the `computer:*` channels from
        // ipc/computer-automation.ts — the renderer drives the mouse through it.
        // What must stay absent is the duplicate `COMPUTER_*` constant family,
        // which had no implementation behind it on this bridge.
        hasComputerControl: Object.keys(api).some((k) => /^computer(Move|Click|Type|Press)/i.test(k)),
        hasDuplicateComputerChannel: Object.keys(api).some((k) => /^computer(Stats)$/i.test(k)),
      };
    });

    expect(shape.hasUsageGet).toBe(true);
    expect(shape.hasUsageReset).toBe(true);
    expect(shape.hasBuildStart).toBe(true);
    expect(shape.hasBuildStatus).toBe(true);
    expect(shape.hasOnBuildStatus).toBe(true);
    expect(shape.hasSelfEvolveSuggestions).toBe(true);
    expect(shape.hasComputerControl).toBe(true);
    expect(shape.hasDuplicateComputerChannel).toBe(false);
  });
});