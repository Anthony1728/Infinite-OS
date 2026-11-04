import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, _electron as electron } from '@playwright/test';

const exe = resolve('dist/win-unpacked/Infinite OS.exe');
const shotDir = resolve('test-results/live-thinking');
const MODEL = process.env.INFINITE_LIVE_THINKING_MODEL ?? 'opencode::beam-free';

test.describe('Live reasoning visibility', () => {
  test.skip(!process.env.INFINITE_LIVE, 'Set INFINITE_LIVE=1 to run against the real profile/provider.');
  test.skip(!existsSync(exe), 'Build dist/win-unpacked before running.');

  test('streams model reasoning into the transcript ThinkingPanel', async () => {
    test.setTimeout(300_000);
    mkdirSync(shotDir, { recursive: true });

    const app = await electron.launch({ executablePath: exe, timeout: 120_000 });
    try {
      const page = await app.firstWindow({ timeout: 120_000 });
      await page.waitForFunction(
        () => Boolean(document.querySelector('[data-nav="studio"]')),
        undefined,
        { timeout: 120_000 },
      );

      const newChat = page.getByRole('button', { name: /New Chat/i }).first();
      await newChat.waitFor({ state: 'visible', timeout: 30_000 });
      await newChat.click();
      await page.waitForTimeout(800);

      const composer = page.locator('textarea[aria-label="Message Infinite OS"]');
      await composer.waitFor({ state: 'visible', timeout: 60_000 });

      await page.evaluate(
        async ({ model }) => {
          const cur = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
          cur.provider = 'opencode';
          cur.model = model;
          cur.modelLabel = 'Beam Free';
          localStorage.setItem('infinite:current', JSON.stringify(cur));
          window.dispatchEvent(new Event('storage'));
          const api = (window as unknown as {
            api?: {
              setSetting?: (args: unknown) => Promise<unknown>;
              onAgentEvent?: (cb: (e: unknown) => void) => () => void;
            };
          }).api;
          await api?.setSetting?.({ scope: 'user', key: 'showModelThinking', value: true, cwd: cur.cwd ?? '.' });
          await api?.setSetting?.({ scope: 'user', key: 'provider', value: 'opencode', cwd: cur.cwd ?? '.' });
          await api?.setSetting?.({ scope: 'user', key: 'model', value: model, cwd: cur.cwd ?? '.' });
        },
        { model: MODEL },
      );

      // Capture the raw agent events so the test proves reasoning was streamed,
      // not merely present in a final summary.
      await page.evaluate(() => {
        const w = window as unknown as {
          __thinkingEvents: unknown[];
          api?: { onAgentEvent?: (cb: (e: unknown) => void) => () => void };
        };
        w.__thinkingEvents = [];
        w.api?.onAgentEvent?.((ev: unknown) => {
          w.__thinkingEvents.push({ ...(ev as Record<string, unknown>), _t: Date.now() });
        });
      });

      const prompt =
        'Think through this step by step before answering: A train travels 60 miles in 1.5 hours. What is its average speed? Show your reasoning, then give the final answer.';
      await composer.fill(prompt);
      await page.waitForTimeout(400);

      const started = Date.now();
      await composer.press('Enter');
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
        const w = window as unknown as { __thinkingEvents?: unknown[] };
        return w.__thinkingEvents ?? [];
      })) as Array<Record<string, unknown>>;
      const thinkingEvents = events.filter(
        (event) => event.type === 'thinking_delta' && typeof event.text === 'string' && event.text.trim(),
      );
      const thinkingChars = thinkingEvents.reduce(
        (total, event) => total + String(event.text).length,
        0,
      );
      const thinkingText = thinkingEvents.map((event) => String(event.text)).join('');

      const bodyText = await page.locator('body').innerText();
      const panelText = await page
        .locator('button[aria-expanded]')
        .allTextContents()
        .then((texts) => texts.filter((text) => /Thought about it|Thinking|Working it out/.test(text)));

      console.log('LIVE_THINKING_MODEL', MODEL);
      console.log('LIVE_THINKING_ELAPSED_MS', Date.now() - started);
      console.log('LIVE_THINKING_EVENT_COUNT', thinkingEvents.length);
      console.log('LIVE_THINKING_CHARS', thinkingChars);
      console.log('LIVE_THINKING_TEXT', JSON.stringify(thinkingText.slice(0, 600)));
      console.log('LIVE_THINKING_PANEL', JSON.stringify(panelText.slice(0, 5)));
      console.log('LIVE_THINKING_BODY_TAIL_START');
      console.log(bodyText.slice(-5000));
      console.log('LIVE_THINKING_BODY_TAIL_END');

      await page.screenshot({ path: resolve(shotDir, 'final.png'), fullPage: false });

      expect(thinkingEvents.length, 'The provider streamed no thinking_delta events').toBeGreaterThan(0);
      expect(thinkingChars, 'The reasoning trace was empty').toBeGreaterThan(20);
      expect(bodyText, 'The final answer is missing').toMatch(/40|forty/i);
      expect(
        bodyText.includes('Thought about it') || bodyText.includes('Thinking'),
        'The transcript never rendered a ThinkingPanel',
      ).toBe(true);
    } finally {
      await app.close().catch(() => undefined);
    }
  });
});
