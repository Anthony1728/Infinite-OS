import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, _electron as electron } from '@playwright/test';

const exe = resolve('dist/win-unpacked/Infinite OS.exe');
const outDir = resolve('test-results/live-diagnose');

test.describe('Live stream diagnosis', () => {
  test.skip(!process.env.INFINITE_LIVE, 'Set INFINITE_LIVE=1 to run against the real profile/provider.');
  test.skip(!existsSync(exe), 'Build dist/win-unpacked before running.');

  test('captures event sequence for a real tool turn', async () => {
    test.setTimeout(300_000);
    mkdirSync(outDir, { recursive: true });

    const app = await electron.launch({
      executablePath: exe,
      timeout: 120_000,
      env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
    });
    const mainLogs: string[] = [];
    app.process().stdout?.on('data', (d) => mainLogs.push(d.toString()));
    app.process().stderr?.on('data', (d) => mainLogs.push(d.toString()));

    try {
      const page = await app.firstWindow({ timeout: 120_000 });
      const rendererLogs: string[] = [];
      page.on('console', (msg) => rendererLogs.push(`[${msg.type()}] ${msg.text()}`));
      page.on('pageerror', (err) => rendererLogs.push(`[pageerror] ${err.message}`));

      await page.waitForFunction(
        () => Boolean(document.querySelector('[data-nav="studio"]')),
        undefined,
        { timeout: 120_000 },
      );

      // Capture the exact IPC event stream from the main process. This is the
      // source of truth for what the renderer is given, independent of whether
      // a renderer-side listener happened to attach in time. Hook every window
      // (and future ones): the chat window is not guaranteed to be [0].
      const windowInfo = await app.evaluate(({ BrowserWindow, app: electronApp }) => {
        const w = globalThis as unknown as {
          __infiniteMainEvents: unknown[];
          __infiniteHooked?: WeakSet<object>;
        };
        w.__infiniteMainEvents = [];
        w.__infiniteHooked = w.__infiniteHooked ?? new WeakSet<object>();
        const hook = (win: Electron.BrowserWindow) => {
          if (w.__infiniteHooked!.has(win)) return;
          w.__infiniteHooked!.add(win);
          const original = win.webContents.send.bind(win.webContents);
          win.webContents.send = ((channel: string, ...args: unknown[]) => {
            if (channel === 'chat:stream-event' || channel === 'agent:event') {
              w.__infiniteMainEvents.push({ _t: Date.now(), channel, payload: args[0] });
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
        }));
      });
      console.log('DIAG_WINDOWS', JSON.stringify(windowInfo));

      const newChat = page.getByRole('button', { name: /New Chat/i }).first();
      await newChat.waitFor({ state: 'visible', timeout: 30_000 });
      await newChat.click();
      await page.waitForTimeout(800);

      const composer = page.locator('textarea[aria-label="Message Infinite OS"]');
      await composer.waitFor({ state: 'visible', timeout: 60_000 });

      const apiInfo = await page.evaluate(() => {
        const api = (window as unknown as { api?: Record<string, unknown> }).api;
        return {
          hasApi: Boolean(api),
          streamType: typeof api?.onStreamEvent,
          keyCount: api ? Object.keys(api).length : 0,
        };
      });
      console.log('DIAG_API', JSON.stringify(apiInfo));

      await page.evaluate(() => {
        const w = window as unknown as {
          __infiniteEvents: unknown[];
          __infiniteAgentEvents: unknown[];
          api?: {
            onStreamEvent?: (cb: (e: unknown) => void) => () => void;
            onAgentEvent?: (cb: (e: unknown) => void) => () => void;
          };
        };
        w.__infiniteEvents = [];
        w.__infiniteAgentEvents = [];
        w.api?.onStreamEvent?.((ev: unknown) => {
          w.__infiniteEvents.push({ ...(ev as Record<string, unknown>), _t: Date.now() });
        });
        w.api?.onAgentEvent?.((ev: unknown) => {
          w.__infiniteAgentEvents.push({ ...(ev as Record<string, unknown>), _t: Date.now() });
        });
      });

      const prompt =
        'Use the Bash tool to run this exact command: echo infinite-stream-ok. Then reply with the output in one sentence. Do not change any files.';
      await composer.fill(prompt);
      const started = Date.now();
      await composer.press('Enter');

      // Wait for a completed assistant turn: the "Answered by" badge exists and
      // the Stop button is gone. The user's prompt itself contains the echoed
      // string, so matching body text alone returns immediately.
      await page
        .waitForFunction(
          () => {
            const answered = document.querySelector('[aria-label^="Answered by"]');
            const stop = document.querySelector('[aria-label="Stop generating"]');
            return Boolean(answered) && !stop;
          },
          undefined,
          { timeout: 240_000 },
        )
        .catch(() => undefined);
      await page.waitForTimeout(3_000);

      const events = (await page.evaluate(() => {
        const w = window as unknown as { __infiniteEvents?: unknown[] };
        return w.__infiniteEvents ?? [];
      })) as Array<Record<string, unknown>>;
      const agentEvents = (await page.evaluate(() => {
        const w = window as unknown as { __infiniteAgentEvents?: unknown[] };
        return w.__infiniteAgentEvents ?? [];
      })) as Array<Record<string, unknown>>;
      const mainEvents = (await app.evaluate(() => {
        const w = globalThis as unknown as { __infiniteMainEvents?: unknown[] };
        return w.__infiniteMainEvents ?? [];
      })) as Array<{ _t: number; channel: string; payload: Record<string, unknown> }>;

      writeFileSync(resolve(outDir, 'events.json'), JSON.stringify(events, null, 2));
      writeFileSync(resolve(outDir, 'agent-events.json'), JSON.stringify(agentEvents, null, 2));
      writeFileSync(resolve(outDir, 'main-events.json'), JSON.stringify(mainEvents, null, 2));
      writeFileSync(resolve(outDir, 'main.log'), mainLogs.join(''));
      writeFileSync(resolve(outDir, 'renderer.log'), rendererLogs.join('\n'));

      console.log('DIAG_ELAPSED_MS', Date.now() - started);
      console.log(
        'DIAG_EVENT_COUNT',
        events.length,
        'AGENT_EVENT_COUNT',
        agentEvents.length,
        'MAIN_EVENT_COUNT',
        mainEvents.length,
      );
      const describe = (ev: Record<string, unknown>) =>
        [
          String(ev.type),
          ev.runId ? `run=${String(ev.runId).slice(0, 8)}` : '',
          ev.message_id ? `msg=${String(ev.message_id).slice(0, 8)}` : '',
          ev.tool_use_id ? `tool=${String(ev.tool_use_id).slice(0, 14)}` : '',
          ev.name ? `name=${String(ev.name)}` : '',
          ev.toolName ? `toolName=${String(ev.toolName)}` : '',
          ev.status ? `status=${String(ev.status)}` : '',
          typeof ev.text === 'string' ? `text=${JSON.stringify(String(ev.text).slice(0, 80))}` : '',
          typeof ev.partial_json === 'string' ? `json=${JSON.stringify(String(ev.partial_json).slice(0, 80))}` : '',
          typeof ev.detail === 'string' ? `detail=${JSON.stringify(String(ev.detail).slice(0, 100))}` : '',
          typeof ev.result === 'string' ? `result=${JSON.stringify(String(ev.result).slice(0, 80))}` : '',
          typeof ev.stop_reason === 'string' ? `stop=${String(ev.stop_reason)}` : '',
        ]
          .filter(Boolean)
          .join(' ');
      for (const ev of events) console.log('DIAG_EVENT', describe(ev));
      for (const ev of agentEvents) console.log('DIAG_AGENT_EVENT', describe(ev));
      for (const entry of mainEvents) {
        console.log('DIAG_MAIN', entry.channel, describe(entry.payload as Record<string, unknown>));
      }

      const cards = await page.locator('button[aria-expanded]').allTextContents();
      console.log('DIAG_CARDS', JSON.stringify(cards.slice(0, 40)));
      const transcriptHtml = await page.locator('body').evaluate((body) => {
        const assistant = Array.from(body.querySelectorAll('div')).find((node) =>
          node.textContent?.includes('The command output was'),
        );
        return assistant?.parentElement?.innerHTML.slice(0, 6000) ?? '';
      });
      writeFileSync(resolve(outDir, 'transcript.html'), transcriptHtml);
      console.log('DIAG_TRANSCRIPT_HAS_TOOL_CARD', /Running|Bash|infinite-stream-ok|done/i.test(transcriptHtml));
      const bodyTail = await page.locator('body').innerText();
      console.log('DIAG_BODY_TAIL_START');
      console.log(bodyTail.slice(-3500));
      console.log('DIAG_BODY_TAIL_END');

      await page.screenshot({ path: resolve(outDir, 'final.png'), fullPage: false });
    } finally {
      writeFileSync(resolve(outDir, 'main.log'), mainLogs.join(''));
      await app.close().catch(() => undefined);
    }
  });
});
