import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, test, expect, _electron as electron } from '@playwright/test';

const exe = resolve('dist/win-unpacked/Infinite OS.exe');
const extensionPath = resolve('extensions/infinite-os-bridge');
const TEST_EMAIL = 'extension-e2e@infinite.test';

const PAGE_HTML = `<!doctype html>
<html>
  <head><title>Bridge E2E</title></head>
  <body>
    <h1 id="headline">Bridge E2E</h1>
    <form id="greet-form" onsubmit="event.preventDefault(); document.getElementById('out').textContent='Submitted ' + document.getElementById('name').value;">
      <input id="name" name="name" placeholder="Name" />
      <button id="greet" type="button" onclick="document.getElementById('out').textContent='Hello ' + document.getElementById('name').value">Greet</button>
    </form>
    <p id="out">Waiting</p>
    <div id="hover" style="width:120px;height:28px;background:#ddd" onmouseover="document.getElementById('out').textContent='Hovered'">Hover</div>
    <a id="second-link" href="/second">Second page</a>
    <div style="height:1600px"></div>
    <p id="bottom">Bottom of page</p>
  </body>
</html>`;

const SECOND_HTML = `<!doctype html>
<html><head><title>Second Page</title></head>
<body><h1>Second page content</h1><a href="/">Back home</a></body></html>`;

function seedProfile(home: string): void {
  const base = join(home, '.infinite-ai');
  mkdirSync(base, { recursive: true });
  const user = {
    id: 'extension-e2e-user',
    email: TEST_EMAIL,
    name: 'Extension E2E',
    createdAt: Date.now(),
    hasCompletedOnboarding: true,
    profile: {
      name: 'Extension E2E',
      workspaceTheme: 'dark',
      notificationsEnabled: false,
      aiMemoryEnabled: false,
    },
  };
  writeFileSync(
    join(base, 'auth.json'),
    JSON.stringify({ [TEST_EMAIL]: { user, password: 'extension-e2e' } }),
    'utf8',
  );
  writeFileSync(
    join(base, 'auth-session.json'),
    JSON.stringify({ user, isAuthenticated: true }),
    'utf8',
  );
  const uid = TEST_EMAIL.toLowerCase().replace(/[^a-zA-Z0-9-_]/g, '');
  writeFileSync(join(base, 'active-profile.json'), JSON.stringify({ uid }), 'utf8');

  // The bridge token lives on the machine-global path (homedir/.infinite-ai),
  // not in the per-profile home. Copy the real token so the source extension's
  // config.js authenticates against this isolated app instance.
  const realToken = join(process.env.USERPROFILE ?? '', '.infinite-ai', 'bridge-token');
  if (!existsSync(realToken)) throw new Error(`Missing bridge token: ${realToken}`);
  copyFileSync(realToken, join(base, 'bridge-token'));
}

test.describe('Browser bridge extension', () => {
  test.skip(!existsSync(exe), 'Build dist/win-unpacked before running the extension smoke test.');
  test.skip(!existsSync(join(extensionPath, 'manifest.json')), 'Extension source is missing.');

  test('drives an isolated Chromium through the packaged app and real extension', async () => {
    test.setTimeout(300_000);

    const server: Server = createServer((req, res) => {
      if (req.url === '/second') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(SECOND_HTML);
        return;
      }
      if (req.url === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE_HTML);
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind');
    const baseURL = `http://127.0.0.1:${address.port}`;

    const tmp = mkdtempSync(join(tmpdir(), 'infinite-os-extension-'));
    const home = join(tmp, 'home');
    const appData = join(tmp, 'appdata');
    const localAppData = join(tmp, 'localappdata');
    const electronData = join(tmp, 'electron-data');
    const chromiumData = join(tmp, 'chromium-data');
    for (const dir of [home, appData, localAppData, electronData, chromiumData]) mkdirSync(dir, { recursive: true });
    seedProfile(home);

    let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
    let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;

    try {
      app = await electron.launch({
        executablePath: exe,
        args: [`--user-data-dir=${electronData}`],
        env: {
          ...process.env,
          USERPROFILE: home,
          HOME: home,
          APPDATA: appData,
          LOCALAPPDATA: localAppData,
          INFINITE_TEST_HOME: join(home, '.infinite-ai'),
          INFINITE_DISABLE_GPU: '1',
        },
        timeout: 90_000,
      });

      const page = await app.firstWindow({ timeout: 90_000 });
      await page.waitForFunction(
        () => Boolean(document.querySelector('[data-nav="studio"]')),
        undefined,
        { timeout: 90_000 },
      );

      context = await chromium.launchPersistentContext(chromiumData, {
        headless: false,
        args: [
          `--disable-extensions-except=${extensionPath}`,
          `--load-extension=${extensionPath}`,
          '--no-first-run',
          '--no-default-browser-check',
          '--window-size=1200,800',
          '--window-position=80,60',
        ],
      });

      let worker = context.serviceWorkers().find((candidate) => candidate.url().includes('background.js'));
      if (!worker) {
        worker = await context.waitForEvent('serviceworker', {
          predicate: (candidate) => candidate.url().includes('background.js'),
          timeout: 60_000,
        });
      }
      expect(worker.url()).toContain('chrome-extension://');

      const browserPage = context.pages()[0] ?? (await context.newPage());

      const bridgeStatus = async () =>
        page.evaluate(async () => {
          const api = (window as unknown as { api?: { bridgeStatus?: () => Promise<unknown> } }).api;
          return api?.bridgeStatus ? await api.bridgeStatus() : null;
        });

      await expect
        .poll(async () => {
          const status = (await bridgeStatus()) as { status?: { connected?: boolean } } | null;
          return status?.status?.connected === true;
        }, { timeout: 60_000, message: 'extension did not connect to the packaged bridge' })
        .toBe(true);

      const exec = async (command: string, params: Record<string, unknown> = {}) => {
        const result = await page.evaluate(
          async ({ command: cmd, params: args }) => {
            const api = (window as unknown as { api?: { bridgeExec?: (v: { command: string; params?: Record<string, unknown> }) => Promise<unknown> } }).api;
            return api?.bridgeExec ? await api.bridgeExec({ command: cmd, params: args }) : null;
          },
          { command, params },
        );
        return result as { ok: boolean; data?: Record<string, unknown>; error?: string } | null;
      };

      const expectOk = async (command: string, params: Record<string, unknown> = {}) => {
        const result = await exec(command, params);
        expect(result, `${command} returned no result`).not.toBeNull();
        expect(result?.ok, `${command} failed: ${result?.error ?? 'unknown error'}`).toBe(true);
        return result?.data ?? {};
      };

      // navigate -> DOM-verified page state
      await expectOk('navigate', { url: `${baseURL}/` });
      await browserPage.waitForURL(`${baseURL}/`, { timeout: 20_000 });
      await browserPage.waitForSelector('#greet', { timeout: 15_000 });

      const text = await expectOk('get_page_text');
      expect(String(text.text)).toContain('Bridge E2E');

      const links = await expectOk('get_page_links');
      expect(JSON.stringify(links.links)).toContain('/second');

      const forms = await expectOk('get_form_fields');
      expect(JSON.stringify(forms.fields)).toContain('name');

      // type -> value -> click -> observable page mutation
      await expectOk('type', { selector: '#name', text: 'Ada' });
      const typedValue = await expectOk('get_value', { selector: '#name' });
      expect(String(typedValue.value)).toBe('Ada');
      await expectOk('click', { selector: '#greet' });
      await expect.poll(() => browserPage.locator('#out').textContent(), { timeout: 10_000 }).toBe('Hello Ada');

      // set_value / clear / fill
      await expectOk('set_value', { selector: '#name', value: 'Grace' });
      await expectOk('fill', { fields: { '#name': 'Grace' } });
      await expectOk('click', { selector: '#greet' });
      await expect.poll(() => browserPage.locator('#out').textContent(), { timeout: 10_000 }).toBe('Hello Grace');
      await expectOk('clear', { selector: '#name' });
      const cleared = await expectOk('get_value', { selector: '#name' });
      expect(String(cleared.value)).toBe('');

      // focus + hover + scroll
      await expectOk('focus', { selector: '#hover' });
      await expectOk('hover', { selector: '#hover' });
      await expect.poll(() => browserPage.locator('#out').textContent(), { timeout: 10_000 }).toBe('Hovered');
      await expectOk('scroll', { direction: 'down', pixels: 700 });
      await expect
        .poll(() => browserPage.evaluate(() => window.scrollY), { timeout: 10_000 })
        .toBeGreaterThan(0);

      // execute_js, screenshot, inspect
      const js = await expectOk('execute_js', { script: 'document.title' });
      expect(String(js.value)).toBe('Bridge E2E');
      const shot = await expectOk('screenshot');
      expect(String(shot.format)).toBe('png');
      expect(String(shot.base64).length).toBeGreaterThan(1_000);
      // The debugger fallback is what keeps screenshots working when the tab's
      // window is occluded or captureVisibleTab's GPU readback fails.
      const debugShot = await expectOk('screenshot', { forceDebugger: true });
      expect(String(debugShot.source)).toBe('debugger');
      expect(String(debugShot.format)).toBe('png');
      expect(String(debugShot.base64).length).toBeGreaterThan(1_000);
      const inspected = await expectOk('inspect');
      expect(String(inspected.title)).toBe('Bridge E2E');
      expect(Array.isArray(inspected.snapshot)).toBe(true);
      expect(String(inspected.screenshot).length).toBeGreaterThan(1_000);

      // storage round-trip
      await expectOk('storage_set', { data: { bridgeProbe: 'ok' } });
      const storage = await expectOk('storage_get', { keys: ['bridgeProbe'] });
      expect(JSON.stringify(storage.data)).toContain('ok');

      // cookie round-trip on the isolated test origin
      await expectOk('cookie_set', { url: `${baseURL}/`, name: 'bridge', value: 'ok', secure: false });
      const cookie = await expectOk('cookie_get', { url: `${baseURL}/`, name: 'bridge' });
      expect(JSON.stringify(cookie.cookies)).toContain('bridge');

      // batch
      const batch = await expectOk('batch', {
        ops: [
          { op: 'get_page_text' },
          { op: 'get_value', params: { selector: '#name' } },
        ],
      });
      expect(JSON.stringify(batch.results)).toContain('Bridge E2E');

      // tabs: list -> new -> activate -> close
      const tabsBefore = await expectOk('list_tabs');
      const firstTab = (tabsBefore.tabs as Array<{ id: number; url: string }>).find((tab) => tab.url.startsWith(baseURL));
      expect(firstTab, 'test tab missing from list_tabs').toBeTruthy();

      const newPagePromise = context.waitForEvent('page', { timeout: 20_000 });
      const newTab = await expectOk('new_tab', { url: `${baseURL}/second` });
      const secondPage = await newPagePromise;
      await secondPage.waitForLoadState('domcontentloaded');
      expect(String(newTab.id)).toBeTruthy();
      await expect.poll(() => secondPage.title(), { timeout: 10_000 }).toBe('Second Page');

      const tabsAfter = await expectOk('list_tabs');
      const secondTab = (tabsAfter.tabs as Array<{ id: number; url: string }>).find((tab) => tab.url.includes('/second'));
      expect(secondTab, 'second tab missing from list_tabs').toBeTruthy();

      await expectOk('activate_tab', { tabId: firstTab?.id });
      await expect.poll(() => browserPage.url(), { timeout: 10_000 }).toContain(baseURL);

      await expectOk('close_tab', { tabId: secondTab?.id });
      await expect
        .poll(async () => {
          const tabs = await expectOk('list_tabs');
          return (tabs.tabs as Array<{ url: string }>).filter((tab) => tab.url.includes('/second')).length;
        }, { timeout: 10_000 })
        .toBe(0);

      // reload still serves the page
      await expectOk('reload');
      await expect.poll(() => browserPage.locator('#headline').textContent(), { timeout: 15_000 }).toBe('Bridge E2E');
    } finally {
      await context?.close().catch(() => {});
      await app?.close().catch(() => {});
      await new Promise<void>((done) => server.close(() => done()));
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
