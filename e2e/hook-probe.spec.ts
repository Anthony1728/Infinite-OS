import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, _electron as electron } from '@playwright/test';

const exe = resolve('dist/win-unpacked/Infinite OS.exe');

test.describe('IPC channel probe', () => {
  test.skip(!existsSync(exe), 'Build dist/win-unpacked before running.');

  test('a test chat:stream-event reaches both the main hook and the renderer listener', async () => {
    test.setTimeout(120_000);
    const app = await electron.launch({ executablePath: exe, timeout: 120_000 });
    try {
      const page = await app.firstWindow({ timeout: 120_000 });
      await page.waitForFunction(() => Boolean(document.querySelector('[data-nav="studio"]')), undefined, {
        timeout: 120_000,
      });

      const windowInfo = await app.evaluate(({ BrowserWindow, app: electronApp }) => {
        const w = globalThis as unknown as {
          __probeMainEvents: unknown[];
          __probeHooked?: WeakSet<object>;
        };
        w.__probeMainEvents = [];
        w.__probeHooked = w.__probeHooked ?? new WeakSet<object>();
        const hook = (win: Electron.BrowserWindow) => {
          if (w.__probeHooked!.has(win)) return;
          w.__probeHooked!.add(win);
          const original = win.webContents.send.bind(win.webContents);
          win.webContents.send = ((channel: string, ...args: unknown[]) => {
            if (channel === 'chat:stream-event') {
              w.__probeMainEvents.push({ _t: Date.now(), payload: args[0] });
            }
            return original(channel, ...args);
          }) as typeof win.webContents.send;
        };
        BrowserWindow.getAllWindows().forEach(hook);
        electronApp.on('browser-window-created', (_event, win) => hook(win));
        return BrowserWindow.getAllWindows().map((win) => ({
          title: win.getTitle(),
          url: win.webContents.getURL(),
          visible: win.isVisible(),
          id: win.webContents.id,
        }));
      });
      console.log('PROBE_WINDOWS', JSON.stringify(windowInfo));

      const apiInfo = await page.evaluate(() => {
        const api = (window as unknown as { api?: Record<string, unknown> }).api;
        return {
          hasApi: Boolean(api),
          streamType: typeof api?.onStreamEvent,
          keyCount: api ? Object.keys(api).length : 0,
        };
      });
      console.log('PROBE_API', JSON.stringify(apiInfo));

      await page.evaluate(() => {
        const w = window as unknown as {
          __probeRendererEvents: unknown[];
          api?: { onStreamEvent?: (cb: (e: unknown) => void) => () => void };
        };
        w.__probeRendererEvents = [];
        w.api?.onStreamEvent?.((ev: unknown) => {
          w.__probeRendererEvents.push(ev);
        });
      });

      const sent = await app.evaluate(({ BrowserWindow }) => {
        const wins = BrowserWindow.getAllWindows();
        wins.forEach((win) => {
          win.webContents.send('chat:stream-event', {
            sessionId: 'probe-session',
            type: 'provider_status',
            status: 'HOOK_TEST',
          });
        });
        return wins.length;
      });
      await page.waitForTimeout(800);

      const rendererEvents = await page.evaluate(() => {
        const w = window as unknown as { __probeRendererEvents?: unknown[] };
        return w.__probeRendererEvents ?? [];
      });
      const mainEvents = await app.evaluate(() => {
        const w = globalThis as unknown as { __probeMainEvents?: unknown[] };
        return w.__probeMainEvents ?? [];
      });
      console.log('PROBE_SENT_WINDOWS', sent);
      console.log('PROBE_RENDERER_EVENTS', JSON.stringify(rendererEvents));
      console.log('PROBE_MAIN_EVENTS', JSON.stringify(mainEvents));
    } finally {
      await app.close().catch(() => undefined);
    }
  });
});
