import { _electron as electron } from 'playwright-core';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let app;

try {
  app = await electron.launch({ args: ['.'], cwd: root, timeout: 30_000 });
  const window = await app.firstWindow({ timeout: 30_000 });
  await window.locator('#root').waitFor({ state: 'visible', timeout: 30_000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setFullScreen(true));
  await window.waitForTimeout(500);

  const fullscreenBefore = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isFullScreen());
  if (!fullscreenBefore) throw new Error('F11 did not enter full screen.');

  const result = await window.evaluate(async () => window.api.operatorBrowserNavigate({ url: 'https://example.com' }));
  if (!result?.ok || result.displayMode !== 'background' || !result.steps?.some((step) => /background/i.test(step))) {
    throw new Error(`Operator did not use hidden background CDP: ${JSON.stringify(result)}`);
  }

  const fullscreenAfter = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isFullScreen());
  const stillFocused = await window.evaluate(() => document.hasFocus());
  if (!fullscreenAfter || !stillFocused) throw new Error(`Infinite OS lost full-screen focus: ${JSON.stringify({ fullscreenAfter, stillFocused })}`);

  console.log(JSON.stringify({ ok: true, hiddenCdp: true, infiniteOsStayedFullscreen: true, displayMode: result.displayMode, title: result.title }, null, 2));
} finally {
  if (app) {
    await app.firstWindow().then((window) => window.evaluate(() => window.api.operatorBrowserShutdown())).catch(() => undefined);
    await app.close();
  }
}
