/**
 * Browser Agent - Real Playwright Integration
 *
 * Automates web browsing tasks:
 * - Navigate pages
 * - Click elements
 * - Fill forms
 * - Extract data
 * - Take screenshots
 * - Handle authentication
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

interface PlaywrightBrowser {
  newPage: (options?: { viewport?: { width: number; height: number } }) => Promise<PlaywrightPage>;
  close: () => Promise<void>;
}

interface PlaywrightPage {
  goto: (url: string, options?: { waitUntil?: string; timeout?: number }) => Promise<void>;
  waitForTimeout: (ms: number) => Promise<void>;
  title: () => Promise<string>;
  url: () => string;
  evaluate: <T>(fn: () => T) => Promise<T>;
  click: (selector: string, options?: { timeout?: number }) => Promise<void>;
  fill: (selector: string, value: string, options?: { timeout?: number }) => Promise<void>;
  screenshot: (options?: { path?: string; fullPage?: boolean }) => Promise<void>;
  goBack: (options?: { waitUntil?: string }) => Promise<void>;
  goForward: (options?: { waitUntil?: string }) => Promise<void>;
  reload: (options?: { waitUntil?: string }) => Promise<void>;
  close: () => Promise<void>;
}

interface PlaywrightChromium {
  launch: (options?: { headless?: boolean; args?: string[] }) => Promise<PlaywrightBrowser>;
}

let chromium: PlaywrightChromium | null = null;
let browser: PlaywrightBrowser | null = null;
const pages: Map<string, PlaywrightPage> = new Map();

async function getBrowser(headless = true): Promise<PlaywrightBrowser> {
  if (browser) return browser;
  try {
    // Dynamic import to avoid build issues
    const playwright = await Function('return import("playwright")')() as { chromium: PlaywrightChromium };
    chromium = playwright.chromium;
    browser = await chromium.launch({ headless, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    return browser;
  } catch (e) {
    throw new Error(`Failed to launch browser: ${(e as Error).message}. Install with: npx playwright install chromium`);
  }
}

export interface BrowserConfig {
  headless: boolean;
  defaultTimeout: number;
  viewport: { width: number; height: number };
  userDataDir: string;
}

export interface PageSnapshot {
  url: string;
  title: string;
  text: string;
  links: Array<{ text: string; href: string }>;
  forms: Array<{ action: string; method: string; fields: Array<{ name: string; type: string; value: string }> }>;
  images: Array<{ src: string; alt: string }>;
  timestamp: number;
}

export interface BrowserAction {
  id: string;
  type: 'navigate' | 'click' | 'type' | 'select' | 'screenshot' | 'extract' | 'scroll' | 'wait' | 'back' | 'forward' | 'reload';
  target?: string;
  value?: string;
  timestamp: number;
  result?: string;
  error?: string;
}

export interface BrowserSession {
  id: string;
  name: string;
  url: string;
  actions: BrowserAction[];
  cookies: Record<string, string>;
  localStorage: Record<string, string>;
  createdAt: number;
  lastActive: number;
}

export class BrowserAgent {
  private config: BrowserConfig;
  private sessions: Map<string, BrowserSession> = new Map();
  private dataDir: string;

  constructor(config?: Partial<BrowserConfig>) {
    this.config = {
      headless: config?.headless ?? true,
      defaultTimeout: config?.defaultTimeout ?? 30000,
      viewport: config?.viewport ?? { width: 1280, height: 720 },
      userDataDir: config?.userDataDir ?? join(homedir(), '.infinite-ai', 'browser'),
    };
    this.dataDir = this.config.userDataDir;
    this.ensureDir();
    this.loadData();
  }

  private ensureDir(): void {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
  }

  private loadData(): void {
    try {
      const sessionsPath = join(this.dataDir, 'sessions.json');
      if (existsSync(sessionsPath)) {
        const data = JSON.parse(readFileSync(sessionsPath, 'utf-8'));
        this.sessions = new Map(data);
      }
    } catch { /* silent */ }
  }

  private saveData(): void {
    try {
      writeFileSync(
        join(this.dataDir, 'sessions.json'),
        JSON.stringify(Array.from(this.sessions.entries()), null, 2),
      );
    } catch { /* silent */ }
  }

  createSession(name?: string): BrowserSession {
    const session: BrowserSession = {
      id: randomUUID(),
      name: name ?? `Session ${this.sessions.size + 1}`,
      url: 'about:blank',
      actions: [],
      cookies: {},
      localStorage: {},
      createdAt: Date.now(),
      lastActive: Date.now(),
    };
    this.sessions.set(session.id, session);
    this.saveData();
    return session;
  }

  async navigate(sessionId: string, url: string): Promise<PageSnapshot> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    const action: BrowserAction = {
      id: randomUUID(),
      type: 'navigate',
      target: url,
      timestamp: Date.now(),
    };

    try {
      const b = await getBrowser(this.config.headless);
      let page = pages.get(sessionId);
      if (!page) {
        page = await b.newPage({ viewport: this.config.viewport });
        pages.set(sessionId, page);
      }

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.config.defaultTimeout });
      await page.waitForTimeout(1000); // Wait for dynamic content

      const title = await page.title();
      const text = await page.evaluate(() => document.body?.innerText || '');
      
      const links = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href]')).slice(0, 50).map(a => ({
          text: (a as HTMLAnchorElement).innerText.trim().slice(0, 100),
          href: (a as HTMLAnchorElement).href,
        }));
      });

      const forms = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('form')).map(f => ({
          action: (f as HTMLFormElement).action,
          method: (f as HTMLFormElement).method,
          fields: Array.from(f.querySelectorAll('input, textarea, select')).map(el => ({
            name: (el as HTMLInputElement).name || (el as HTMLTextAreaElement).name || '',
            type: (el as HTMLInputElement).type || 'text',
            value: (el as HTMLInputElement).value || '',
          })),
        }));
      });

      const images = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('img')).slice(0, 30).map(img => ({
          src: (img as HTMLImageElement).src,
          alt: (img as HTMLImageElement).alt,
        }));
      });

      session.url = page.url();
      session.lastActive = Date.now();

      const snapshot: PageSnapshot = {
        url: page.url(),
        title,
        text: text.slice(0, 5000),
        links,
        forms,
        images,
        timestamp: Date.now(),
      };

      action.result = JSON.stringify({ title, textLength: text.length, linksCount: links.length });
      session.actions.push(action);
      this.saveData();

      return snapshot;
    } catch (e) {
      action.error = (e as Error).message;
      session.actions.push(action);
      this.saveData();
      throw e;
    }
  }

  async click(sessionId: string, selector: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    const action: BrowserAction = {
      id: randomUUID(),
      type: 'click',
      target: selector,
      timestamp: Date.now(),
    };

    try {
      const page = pages.get(sessionId);
      if (!page) throw new Error('No active page. Navigate first.');

      await page.click(selector, { timeout: this.config.defaultTimeout });
      await page.waitForTimeout(500);

      session.url = page.url();
      session.lastActive = Date.now();
      action.result = `Clicked: ${selector}`;
      session.actions.push(action);
      this.saveData();

      return action.result;
    } catch (e) {
      action.error = (e as Error).message;
      session.actions.push(action);
      this.saveData();
      throw e;
    }
  }

  async type(sessionId: string, selector: string, value: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    const action: BrowserAction = {
      id: randomUUID(),
      type: 'type',
      target: selector,
      value,
      timestamp: Date.now(),
    };

    try {
      const page = pages.get(sessionId);
      if (!page) throw new Error('No active page. Navigate first.');

      await page.fill(selector, value, { timeout: this.config.defaultTimeout });
      session.lastActive = Date.now();
      action.result = `Typed "${value}" into ${selector}`;
      session.actions.push(action);
      this.saveData();

      return action.result;
    } catch (e) {
      action.error = (e as Error).message;
      session.actions.push(action);
      this.saveData();
      throw e;
    }
  }

  async screenshot(sessionId: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    const action: BrowserAction = {
      id: randomUUID(),
      type: 'screenshot',
      timestamp: Date.now(),
    };

    try {
      const page = pages.get(sessionId);
      if (!page) throw new Error('No active page. Navigate first.');

      const screenshotDir = join(this.dataDir, 'screenshots');
      if (!existsSync(screenshotDir)) mkdirSync(screenshotDir, { recursive: true });

      const filename = `screenshot-${Date.now()}.png`;
      const filepath = join(screenshotDir, filename);
      
      await page.screenshot({ path: filepath, fullPage: false });
      session.lastActive = Date.now();
      action.result = filepath;
      session.actions.push(action);
      this.saveData();

      return filepath;
    } catch (e) {
      action.error = (e as Error).message;
      session.actions.push(action);
      this.saveData();
      throw e;
    }
  }

  async extractData(sessionId: string, selector: string): Promise<string[]> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    const action: BrowserAction = {
      id: randomUUID(),
      type: 'extract',
      target: selector,
      timestamp: Date.now(),
    };

    try {
      const page = pages.get(sessionId);
      if (!page) throw new Error('No active page. Navigate first.');

      const data = await page.evaluate((sel: string) => {
        return Array.from(document.querySelectorAll(sel)).map(el => el.textContent?.trim() || '');
      }, selector);

      session.lastActive = Date.now();
      action.result = JSON.stringify(data.slice(0, 100));
      session.actions.push(action);
      this.saveData();

      return data.filter(d => d.length > 0).slice(0, 100);
    } catch (e) {
      action.error = (e as Error).message;
      session.actions.push(action);
      this.saveData();
      throw e;
    }
  }

  async fillForm(sessionId: string, formSelector: string, data: Record<string, string>): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    const action: BrowserAction = {
      id: randomUUID(),
      type: 'type',
      target: formSelector,
      value: JSON.stringify(data),
      timestamp: Date.now(),
    };

    try {
      const page = pages.get(sessionId);
      if (!page) throw new Error('No active page. Navigate first.');

      for (const [name, value] of Object.entries(data)) {
        const selector = `${formSelector} [name="${name}"], ${formSelector} [id="${name}"]`;
        try {
          await page.fill(selector, value, { timeout: 5000 });
        } catch {
          // Try without form prefix
          await page.fill(`[name="${name}"]`, value, { timeout: 5000 });
        }
      }

      session.lastActive = Date.now();
      action.result = `Filled form with ${Object.keys(data).length} fields`;
      session.actions.push(action);
      this.saveData();

      return action.result;
    } catch (e) {
      action.error = (e as Error).message;
      session.actions.push(action);
      this.saveData();
      throw e;
    }
  }

  async scroll(sessionId: string, direction: 'up' | 'down' | 'top' | 'bottom'): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    const action: BrowserAction = {
      id: randomUUID(),
      type: 'scroll',
      target: direction,
      timestamp: Date.now(),
    };

    try {
      const page = pages.get(sessionId);
      if (!page) throw new Error('No active page. Navigate first.');

      switch (direction) {
        case 'up':
          await page.evaluate(() => window.scrollBy(0, -500));
          break;
        case 'down':
          await page.evaluate(() => window.scrollBy(0, 500));
          break;
        case 'top':
          await page.evaluate(() => window.scrollTo(0, 0));
          break;
        case 'bottom':
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          break;
      }

      session.lastActive = Date.now();
      action.result = `Scrolled ${direction}`;
      session.actions.push(action);
      this.saveData();

      return action.result;
    } catch (e) {
      action.error = (e as Error).message;
      session.actions.push(action);
      this.saveData();
      throw e;
    }
  }

  async goBack(sessionId: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    const page = pages.get(sessionId);
    if (!page) throw new Error('No active page.');

    await page.goBack({ waitUntil: 'domcontentloaded' });
    session.url = page.url();
    session.lastActive = Date.now();
    return `Navigated back to ${page.url()}`;
  }

  async goForward(sessionId: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    const page = pages.get(sessionId);
    if (!page) throw new Error('No active page.');

    await page.goForward({ waitUntil: 'domcontentloaded' });
    session.url = page.url();
    session.lastActive = Date.now();
    return `Navigated forward to ${page.url()}`;
  }

  async reload(sessionId: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    const page = pages.get(sessionId);
    if (!page) throw new Error('No active page.');

    await page.reload({ waitUntil: 'domcontentloaded' });
    session.url = page.url();
    session.lastActive = Date.now();
    return `Reloaded ${page.url()}`;
  }

  async getPageContent(sessionId: string): Promise<string> {
    const page = pages.get(sessionId);
    if (!page) return 'No active page';

    return await page.evaluate(() => document.body?.innerText || '');
  }

  async closeSession(sessionId: string): Promise<void> {
    const page = pages.get(sessionId);
    if (page) {
      await page.close().catch(() => {});
      pages.delete(sessionId);
    }
    this.sessions.delete(sessionId);
    this.saveData();
  }

  getSession(sessionId: string): BrowserSession | undefined {
    return this.sessions.get(sessionId);
  }

  listSessions(): BrowserSession[] {
    return Array.from(this.sessions.values());
  }

  deleteSession(sessionId: string): boolean {
    const result = this.sessions.delete(sessionId);
    this.saveData();
    return result;
  }

  getStats(): {
    totalSessions: number;
    totalActions: number;
    activeSessions: number;
  } {
    const sessions = Array.from(this.sessions.values());
    return {
      totalSessions: sessions.length,
      totalActions: sessions.reduce((sum, s) => sum + s.actions.length, 0),
      activeSessions: sessions.filter((s) => Date.now() - s.lastActive < 3600000).length,
    };
  }
}
