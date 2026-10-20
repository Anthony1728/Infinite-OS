import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron } from '@playwright/test';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const mainEntry = join(root, 'out', 'main', 'index.js');

test.describe('browser voice availability', () => {
  let app: Awaited<ReturnType<typeof electron.launch>> | null = null;
  let userDataDir: string | null = null;

  test.afterEach(async () => {
    if (app) { await app.close().catch(() => {}); app = null; }
    if (userDataDir) { rmSync(userDataDir, { recursive: true, force: true }); userDataDir = null; }
  });

  test('does speechSynthesis ever expose voices', async () => {
    test.setTimeout(180_000);
    userDataDir = mkdtempSync(join(tmpdir(), 'infinite-os-voices-'));
    app = await electron.launch({
      args: [mainEntry, `--user-data-dir=${userDataDir}`],
      env: { ...process.env, INFINITE_DISABLE_GPU: '1' },
      timeout: 60_000,
    });
    const win = await app.firstWindow({ timeout: 60_000 });
    await win.waitForFunction(
      () => { const r = document.getElementById('root'); return Boolean(r && r.childElementCount > 0); },
      undefined, { timeout: 60_000 },
    );

    // Poll for 40s, and record whether voiceschanged ever fires.
    const report = await win.evaluate(async () => {
      const ss = window.speechSynthesis;
      let changed = 0;
      ss.addEventListener('voiceschanged', () => { changed++; });
      const samples: Array<{ t: number; n: number }> = [];
      for (let i = 0; i < 20; i++) {
        samples.push({ t: i * 2, n: ss.getVoices().length });
        if (ss.getVoices().length > 0) break;
        await new Promise((r) => setTimeout(r, 2000));
      }
      const v = ss.getVoices();
      return {
        voicesChangedFired: changed,
        finalVoiceCount: v.length,
        voiceNames: v.map((x) => `${x.name} [${x.lang}]`),
        samples,
        speaking: ss.speaking,
        pending: ss.pending,
        paused: ss.paused,
      };
    });
    console.log('===== BROWSER VOICE REPORT =====');
    console.log(JSON.stringify(report, null, 2));
    console.log('===== END =====');
    expect(true).toBe(true);
  });
});
