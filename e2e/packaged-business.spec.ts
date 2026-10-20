import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';

/**
 * The packaged build, not the source build.
 *
 * `app-smoke.spec.ts` runs `out/main/index.js` from the working tree. That
 * cannot catch anything the packager gets wrong — a preload bridge that is not
 * exposed, an IPC channel missing from the asar, a renderer asset that never
 * made it in. This runs the real `Infinite OS.exe` and drives the Business
 * section inside it.
 *
 * It needs `npm run build:win` first. Without that it skips rather than failing,
 * so `npx playwright test` on a fresh checkout still works.
 */

const exe = resolve('dist/win-unpacked/Infinite OS.exe');
const hasPackagedBuild = existsSync(exe);

test.describe('packaged build', () => {
  let app: ElectronApplication | null = null;

  test.afterEach(async () => {
    if (app) {
      await app.close().catch(() => {});
      app = null;
    }
  });

  async function launch(): Promise<ElectronApplication> {
    app = await electron.launch({
      executablePath: exe,
      // A separate profile so this never fights a running instance for the lock
      // or writes over the user's live settings.
      args: [`--user-data-dir=${process.env.TEMP}\\infinite-os-packaged-smoke`],
      env: { ...process.env, INFINITE_DISABLE_GPU: '1' },
      timeout: 90_000,
    });
    return app;
  }

  test('every business surface answers through the asar', async () => {
    test.skip(!hasPackagedBuild, 'run `npm run build:win` first');
    test.setTimeout(150_000);

    const running = await launch();
    const win = await running.firstWindow({ timeout: 60_000 });
    expect(await win.title()).toBe('Infinite OS');

    const probe = await win.evaluate(async () => {
      const api = (window as unknown as { api: Record<string, (...a: unknown[]) => Promise<unknown>> }).api;
      const checks: [string, () => Promise<unknown>][] = [
        ['contacts', () => api.businessListContacts()],
        ['leads', () => api.businessListLeads()],
        ['deals', () => api.businessListDeals()],
        ['invoices', () => api.businessListInvoices()],
        ['tasks', () => api.businessListTasks()],
        ['emails', () => api.businessListEmails()],
        ['activities', () => api.businessActivities({ limit: 5 })],
        ['attention', () => api.businessAttention()],
        ['analytics', () => api.businessAnalytics()],
        ['stats', () => api.businessStats()],
        ['search', () => api.businessSearch({ query: 'nothing-matches-this' })],
        ['overview', () => api.businessOverview()],
      ];
      const out: Record<string, string> = {};
      for (const [name, run] of checks) {
        try {
          const r = await run();
          out[name] = Array.isArray(r) ? `array:${r.length}` : typeof r;
        } catch (e) {
          out[name] = `ERR ${(e as Error).message.slice(0, 80)}`;
        }
      }
      return out;
    });

    expect(Object.keys(probe).length).toBe(12);
    for (const [name, result] of Object.entries(probe)) {
      expect(result, `${name} did not answer`).not.toContain('ERR');
    }
  });

  test('the Business section renders, with a tab per record type', async () => {
    test.skip(!hasPackagedBuild, 'run `npm run build:win` first');
    test.setTimeout(150_000);

    const running = await launch();
    const win = await running.firstWindow({ timeout: 60_000 });
    const pageErrors: string[] = [];
    win.on('pageerror', (e) => pageErrors.push(String(e)));

    await win.getByText('Business', { exact: false }).first().click();
    await win.waitForTimeout(2500);
    expect(await win.getByText('Business Command Center').count()).toBeGreaterThan(0);

    // Leads is the one that was missing entirely: the store had the records and
    // the agent could operate them, but the section had no tab for them.
    for (const tab of ['Overview', 'CRM', 'Leads', 'Email', 'Analytics', 'Tasks', 'Invoices']) {
      const button = win.getByRole('button', { name: tab, exact: true });
      expect(await button.count(), `no ${tab} tab`).toBeGreaterThan(0);
      await button.first().click();
      await win.waitForTimeout(400);
    }

    expect(await win.getByPlaceholder('Search everything...').count()).toBeGreaterThan(0);
    expect(pageErrors, 'page errors in the packaged renderer').toHaveLength(0);
  });

  test('a primary button is not a white block on the dark app', async () => {
    test.skip(!hasPackagedBuild, 'run `npm run build:win` first');
    test.setTimeout(150_000);

    const running = await launch();
    const win = await running.firstWindow({ timeout: 60_000 });
    await win.getByText('Business', { exact: false }).first().click();
    await win.waitForTimeout(2000);

    // The Leads tab has a "New Lead" primary button, so this reads a button that
    // is definitely on screen rather than passing vacuously on an empty tab.
    await win.getByRole('button', { name: 'Leads', exact: true }).first().click();
    await win.waitForTimeout(800);

    const probe = await win.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('.btn-premium')) as HTMLElement[];
      return {
        bodyBg: getComputedStyle(document.body).backgroundColor,
        samples: buttons.slice(0, 4).map((b) => {
          const cs = getComputedStyle(b);
          return { bg: cs.backgroundImage === 'none' ? cs.backgroundColor : cs.backgroundImage, color: cs.color };
        }),
      };
    });

    const bodyLum = Number(probe.bodyBg.match(/\d+/)?.[0] ?? '255');
    expect(bodyLum, 'the app background is dark').toBeLessThan(40);
    expect(probe.samples.length, 'no primary button found to check').toBeGreaterThan(0);

    for (const sample of probe.samples) {
      const rgb = sample.bg.match(/\d+/g);
      // A gradient has no flat fill to measure; it cannot be the old white
      // button, which was a solid colour.
      if (!rgb) continue;
      const brightest = Math.max(...rgb.slice(0, 3).map(Number));
      expect(brightest, `primary button renders light (${sample.bg}) on a dark app`).toBeLessThan(200);
    }
  });
});