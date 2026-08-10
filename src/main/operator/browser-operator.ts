import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium, type Browser, type Page } from 'playwright-core';
import { getComputerAutomation } from '../automation/computer-automation.js';
import { getAutomationDisplayState, type AutomationDisplayMode } from '../automation/display-policy.js';

const DISPLAY_CONFIG = {
  visible: { port: 9222, profile: join(homedir(), '.infinite-ai', 'chrome-operator-profile') },
  background: { port: 9223, profile: join(homedir(), '.infinite-ai', 'chrome-background-profile') },
} as const;
const SCREENSHOT_DIR = join(homedir(), '.infinite-ai', 'operator-screenshots');

export interface OperatorResult {
  ok: boolean;
  mode: 'cdp' | 'mouse-keyboard';
  action: string;
  url?: string;
  title?: string;
  error?: string;
  steps: string[];
  displayMode?: AutomationDisplayMode;
}

class BrowserOperator {
  private browsers: Partial<Record<AutomationDisplayMode, Browser>> = {};

  async shutdown(): Promise<void> {
    const browsers = Object.values(this.browsers);
    this.browsers = {};
    await Promise.allSettled(browsers.map(async (browser) => {
      try {
        const session = await browser.newBrowserCDPSession();
        await session.send('Browser.close');
      } catch { /* browser may already be exiting */ }
      await browser.close().catch(() => undefined);
    }));
  }

  async searchAmazon(query: string): Promise<OperatorResult> {
    const url = `https://www.amazon.com/s?k=${encodeURIComponent(query)}`;
    return this.navigate(url, `Search Amazon for ${query}`);
  }

  async navigate(url: string, action = 'Navigate Chrome'): Promise<OperatorResult> {
    const steps: string[] = [];
    const mode = getAutomationDisplayState().mode;
    try {
      const page = await this.ensurePage(steps, mode);
      steps.push(`CDP navigate: ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      if (mode === 'visible') await page.bringToFront();
      const finalUrl = page.url();
      const title = await page.title().catch(() => '');
      if (!finalUrl.startsWith('http')) throw new Error('Chrome did not reach a web page.');
      steps.push(`Verified page: ${title || finalUrl}`);
      return { ok: true, mode: 'cdp', action, url: finalUrl, title, steps, displayMode: mode };
    } catch (error) {
      steps.push(`CDP unavailable: ${(error as Error).message}`);
      if (mode === 'background') {
        return { ok: false, mode: 'cdp', displayMode: mode, action, url, error: 'Background browser automation could not attach. Physical input was not used because Infinite OS must remain visible.', steps };
      }
      return this.keyboardFallback(url, action, steps);
    }
  }

  async inspect(): Promise<OperatorResult & { text?: string; screenshot?: string }> {
    const steps: string[] = [];
    const mode = getAutomationDisplayState().mode;
    try {
      const page = await this.ensurePage(steps, mode);
      const text = await page.locator('body').innerText({ timeout: 10_000 }).catch(() => '');
      mkdirSync(SCREENSHOT_DIR, { recursive: true });
      const screenshot = join(SCREENSHOT_DIR, `page-${randomUUID()}.png`);
      await page.screenshot({ path: screenshot, fullPage: false });
      steps.push('Read visible page text and captured a current browser frame');
      return { ok: true, mode: 'cdp', displayMode: mode, action: 'Inspect Chrome', url: page.url(), title: await page.title().catch(() => ''), text: text.slice(0, 20_000), screenshot, steps };
    } catch (error) {
      return { ok: false, mode: 'cdp', displayMode: mode, action: 'Inspect Chrome', error: (error as Error).message, steps };
    }
  }

  async click(selector: string): Promise<OperatorResult> {
    const steps: string[] = [];
    const mode = getAutomationDisplayState().mode;
    try {
      const page = await this.ensurePage(steps, mode);
      const target = page.locator(selector).first();
      await target.waitFor({ state: 'visible', timeout: 15_000 });
      await target.click({ timeout: 15_000 });
      await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined);
      steps.push(`Clicked verified visible selector: ${selector}`);
      return { ok: true, mode: 'cdp', displayMode: mode, action: 'Click in Chrome', url: page.url(), title: await page.title().catch(() => ''), steps };
    } catch (error) {
      return { ok: false, mode: 'cdp', displayMode: mode, action: 'Click in Chrome', error: (error as Error).message, steps };
    }
  }

  async type(selector: string, text: string): Promise<OperatorResult> {
    const steps: string[] = [];
    const mode = getAutomationDisplayState().mode;
    try {
      const page = await this.ensurePage(steps, mode);
      const target = page.locator(selector).first();
      await target.waitFor({ state: 'visible', timeout: 15_000 });
      await target.fill(text, { timeout: 15_000 });
      const value = await target.inputValue().catch(() => '');
      if (value !== text) throw new Error('Browser value verification failed after typing.');
      steps.push(`Filled and verified selector: ${selector}`);
      return { ok: true, mode: 'cdp', displayMode: mode, action: 'Type in Chrome', url: page.url(), title: await page.title().catch(() => ''), steps };
    } catch (error) {
      return { ok: false, mode: 'cdp', displayMode: mode, action: 'Type in Chrome', error: (error as Error).message, steps };
    }
  }

  private async ensurePage(steps: string[], mode: AutomationDisplayMode): Promise<Page> {
    const config = DISPLAY_CONFIG[mode];
    const debugUrl = `http://127.0.0.1:${config.port}`;
    let browser = this.browsers[mode];
    if (!browser?.isConnected()) {
      if (!(await this.debugEndpointReady(config.port))) {
        const executable = findChromeExecutable();
        if (!executable) throw new Error('Google Chrome is not installed in a known location.');
        mkdirSync(config.profile, { recursive: true });
        const displayArgs = mode === 'background' ? ['--headless=new', '--disable-gpu'] : ['--new-window'];
        const child = spawn(
          executable,
          [
            `--remote-debugging-port=${config.port}`,
            `--user-data-dir=${config.profile}`,
            ...displayArgs,
            '--no-first-run',
            '--no-default-browser-check',
            'about:blank',
          ],
          { detached: true, stdio: 'ignore', windowsHide: mode === 'background' },
        );
        child.unref();
        steps.push(`Started ${mode} Chrome operator (PID ${child.pid}) with remote debugging on port ${config.port}`);
        await this.waitForDebugEndpoint(config.port);
      } else {
        steps.push(`Reusing ${mode} Chrome operator debugging port ${config.port}`);
      }
      browser = await chromium.connectOverCDP(debugUrl, { timeout: 15_000 });
      this.browsers[mode] = browser;
      steps.push(`Attached ${mode} operator through Chrome DevTools Protocol`);
    }

    const contexts = browser.contexts();
    const context = contexts[0] ?? (await browser.newContext());
    const pages = context.pages();
    return pages.find((page) => page.url() !== 'about:blank') ?? pages[0] ?? (await context.newPage());
  }

  private async debugEndpointReady(port: number): Promise<boolean> {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(750) });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async waitForDebugEndpoint(port: number): Promise<void> {
    for (let attempt = 0; attempt < 30; attempt++) {
      if (await this.debugEndpointReady(port)) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('Chrome remote-debugging endpoint did not become ready.');
  }

  private async keyboardFallback(url: string, action: string, steps: string[]): Promise<OperatorResult> {
    try {
      const computer = getComputerAutomation();
      await computer.openApp('chrome');
      steps.push('Launched Chrome through desktop automation');
      await new Promise((resolve) => setTimeout(resolve, 1400));
      await computer.focusWindow('Chrome');
      await computer.hotkey('ctrl', 'l');
      await computer.typeText(url, 8);
      await computer.pressKey('enter');
      steps.push('Focused Chrome, pressed Ctrl+L, typed the address, and pressed Enter');
      return { ok: true, mode: 'mouse-keyboard', action, url, steps };
    } catch (fallbackError) {
      return {
        ok: false,
        mode: 'mouse-keyboard',
        action,
        url,
        error: (fallbackError as Error).message,
        steps,
      };
    }
  }
}

function findChromeExecutable(): string | null {
  const local = process.env.LOCALAPPDATA ?? '';
  const programFiles = process.env.PROGRAMFILES ?? 'C:\\Program Files';
  const programFilesX86 = process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)';
  const candidates = [
    join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export const browserOperator = new BrowserOperator();
