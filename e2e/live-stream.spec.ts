import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, expect, _electron as electron } from '@playwright/test';

const exe = resolve('dist/win-unpacked/Infinite OS.exe');
const shotDir = resolve('test-results/live-stream');
const MODEL = process.env.INFINITE_LIVE_MODEL ?? 'opencode::beam-free';
const MODEL_LABEL = process.env.INFINITE_LIVE_MODEL_LABEL ?? 'Beam Free';

function newestSessionFiles(): string[] {
  const root = join(homedir(), '.infinite-ai', 'profiles');
  if (!existsSync(root)) return [];
  const files: Array<{ path: string; mtime: number }> = [];
  for (const profile of readdirSync(root)) {
    const sessions = join(root, profile, 'sessions');
    if (!existsSync(sessions)) continue;
    for (const name of readdirSync(sessions)) {
      if (!name.endsWith('.jsonl')) continue;
      const path = join(sessions, name);
      try {
        files.push({ path, mtime: statSync(path).mtimeMs });
      } catch {
        // Session being rewritten; ignore this pass.
      }
    }
  }
  return files.sort((a, b) => b.mtime - a.mtime).map((file) => file.path);
}


test.describe('Live model streaming', () => {
  test.skip(!process.env.INFINITE_LIVE, 'Set INFINITE_LIVE=1 to run against the real profile/provider.');
  test.skip(!existsSync(exe), 'Build dist/win-unpacked before running.');

  test('streams a real response and tool execution into chat', async () => {
    test.setTimeout(240_000);
    mkdirSync(shotDir, { recursive: true });

    const app = await electron.launch({
      executablePath: exe,
      timeout: 120_000,
    });

    try {
      const page = await app.firstWindow({ timeout: 120_000 });
      await page.waitForFunction(
        () => Boolean(document.querySelector('[data-nav="studio"]')),
        undefined,
        { timeout: 120_000 },
      );

      const composer = page.locator('textarea[aria-label="Message Infinite OS"]');
      // The app can restore Power Center / another workspace on boot. The
      // sidebar's New Chat button is the reliable way into a fresh chat.
      const newChat = page.getByRole('button', { name: /New Chat/i }).first();
      try {
        await newChat.waitFor({ state: 'visible', timeout: 30_000 });
        await newChat.click();
      } catch {
        // If the session is already a chat, the composer may already be here.
      }
      try {
        await composer.waitFor({ state: 'visible', timeout: 60_000 });
      } catch (err) {
        await page
          .screenshot({ path: resolve(shotDir, 'composer-missing.png'), fullPage: false, timeout: 10_000 })
          .catch(() => {});
        console.log('LIVE_COMPOSER_MISSING_TEXT_START');
        console.log((await page.locator('body').innerText()).slice(0, 4000));
        console.log('LIVE_COMPOSER_MISSING_TEXT_END');
        throw err;
      }

      // Never run this against the user's historical session: a long chat
      // makes the model prompt huge and is not what a new turn looks like.
      const beforeText = await page.locator('body').innerText().catch(() => '');
      const freshChat = !/nah nah nah nah/i.test(beforeText);
      await page.waitForTimeout(600);

      // Select the model under test through the same localStorage contract the
      // composer/settings use, and mirror it into main for background turns.
      await page.evaluate(
        async ({ model, label }) => {
          const cur = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
          cur.provider = 'opencode';
          cur.model = model;
          cur.modelLabel = label;
          localStorage.setItem('infinite:current', JSON.stringify(cur));
          window.dispatchEvent(new Event('storage'));
          const api = (window as unknown as { api?: { setSetting?: (args: unknown) => Promise<unknown> } }).api;
          await api?.setSetting?.({ scope: 'user', key: 'provider', value: 'opencode', cwd: cur.cwd ?? '.' });
          await api?.setSetting?.({ scope: 'user', key: 'model', value: model, cwd: cur.cwd ?? '.' });
        },
        { model: MODEL, label: MODEL_LABEL },
      );

      const prompt =
        'Use the Bash tool to run this exact command: echo infinite-stream-ok. Then reply with the output in one sentence. Do not change any files.';
      await composer.fill(prompt);
      await page.waitForTimeout(400);

      const started = Date.now();
      await composer.press('Enter');

      let sawStreaming = false;
      let sawTool = false;
      let sawAnswer = false;
      let shotIndex = 0;
      const deadline = Date.now() + 180_000;
      let lastShotAt = 0;

      while (Date.now() < deadline) {
        const stop = await page.locator('[aria-label="Stop generating"]').count();
        if (stop > 0) sawStreaming = true;

        const bodyText = await page.locator('body').innerText().catch(() => '');
        if (/infinite-stream-ok/i.test(bodyText)) sawAnswer = true;
        if (/\bBash\b/.test(bodyText)) sawTool = true;


        const now = Date.now();
        const shouldShot =
          shotIndex === 0 ||
          (sawTool && shotIndex === 1) ||
          (sawAnswer && shotIndex === 2) ||
          (stop === 0 && sawStreaming && shotIndex === 3) ||
          now - lastShotAt > 30_000;
        if (shouldShot && shotIndex < 5) {
          await page.screenshot({
            path: resolve(shotDir, `${String(shotIndex).padStart(2, '0')}-${now}.png`),
            fullPage: false,
          });
          lastShotAt = now;
          shotIndex++;
        }

        if (stop === 0 && sawStreaming && sawAnswer) break;
        await page.waitForTimeout(700);
      }

      await page.screenshot({ path: resolve(shotDir, 'final.png'), fullPage: false });
      const finalText = await page.locator('body').innerText();
      const cardTexts = await page.locator('button[aria-expanded]').allTextContents();
      const bashCard = cardTexts.find(
        (text) => /^bash/i.test(text.trim()) && /infinite-stream-ok/i.test(text),
      );
      console.log('LIVE_STREAM_FRESH_CHAT', freshChat);
      console.log('LIVE_STREAM_MODEL', MODEL);
      console.log('LIVE_STREAM_ELAPSED_MS', Date.now() - started);
      console.log('LIVE_STREAM_SAW_STREAMING', sawStreaming);
      console.log('LIVE_STREAM_SAW_TOOL', sawTool);
      console.log('LIVE_STREAM_SAW_ANSWER', sawAnswer);
      console.log('LIVE_STREAM_BASH_CARD', JSON.stringify(bashCard ?? null));

      // The card is not just a live render: reload the session from disk and
      // prove the tool_use block was persisted with the model's final answer.
      let persistedTool = false;
      for (let attempt = 0; attempt < 12 && !persistedTool; attempt++) {
        if (attempt > 0) await page.waitForTimeout(500);
        for (const file of newestSessionFiles().slice(0, 4)) {
          if (statSync(file).mtimeMs < started - 5_000) continue;
          const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
          for (const line of lines) {
            let entry: {
              type?: string;
              role?: string;
              content?: Array<{ type?: string; name?: string; input?: { command?: string } }>;
            };
            try {
              entry = JSON.parse(line);
            } catch {
              continue;
            }
            if (entry.type !== 'message' || entry.role !== 'assistant') continue;
            const tool = entry.content?.find((block) => block.type === 'tool_use' && block.name === 'bash');
            if (tool?.input?.command?.includes('infinite-stream-ok')) persistedTool = true;
          }
        }
      }
      console.log('LIVE_STREAM_PERSISTED_TOOL', persistedTool);

      console.log('LIVE_STREAM_FINAL_TEXT_START');
      console.log(finalText.slice(-6000));
      console.log('LIVE_STREAM_FINAL_TEXT_END');

      expect(freshChat, 'The test must run in a new chat, not the historical session').toBe(true);
      expect(sawStreaming, 'The stop button never appeared; no live stream').toBe(true);
      expect(finalText).toContain('infinite-stream-ok');
      expect(bashCard, 'The inline Bash tool card should render with its command').toBeTruthy();
      expect(bashCard).toMatch(/done/i);
      expect(persistedTool, 'The Bash tool_use block should persist in the session transcript').toBe(true);
    } finally {
      await app.close().catch(() => {});
    }
  });
});
