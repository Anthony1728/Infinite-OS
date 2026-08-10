import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';

export interface BrowserConfig {
  headless: boolean;
  defaultTimeoutMs: number;
  viewport: { width: number; height: number };
  userDataDir?: string;
}

export interface PageSnapshot {
  url: string;
  title: string;
  text: string;
  links: Array<{ text: string; href: string }>;
  forms: Array<{
    action: string;
    method: string;
    fields: Array<{ name: string; type: string; value: string }>;
  }>;
  images: Array<{ src: string; alt: string }>;
  timestamp: number;
}

export interface BrowserAction {
  id: string;
  type:
    | 'navigate'
    | 'click'
    | 'type'
    | 'select'
    | 'screenshot'
    | 'extract'
    | 'fill-form'
    | 'scroll'
    | 'wait'
    | 'back'
    | 'forward'
    | 'reload';
  target?: string;
  value?: string;
  timestamp: number;
  result?: unknown;
  error?: string;
}

export interface BrowserSession {
  id: string;
  name: string;
  url: string;
  actions: BrowserAction[];
  createdAt: number;
  lastActive: number;
  page: Page;
  context: BrowserContext;
}

export type BrowserSessionSummary = Omit<BrowserSession, 'page' | 'context'>;

interface EvaluatedElement {
  textContent?: string | null;
  innerText?: string;
  href?: string;
  action?: string;
  method?: string;
  name?: string;
  id?: string;
  type?: string;
  tagName?: string;
  value?: string;
  currentSrc?: string;
  src?: string;
  alt?: string;
  querySelectorAll?(selector: string): ArrayLike<EvaluatedElement>;
}

interface EvaluatedScrollableElement {
  scrollHeight: number;
  clientHeight: number;
  scrollTo(x: number, y: number): void;
  scrollBy(x: number, y: number): void;
}

interface EvaluatedDocument {
  body?: EvaluatedElement;
  querySelectorAll(selector: string): ArrayLike<EvaluatedElement>;
  scrollingElement?: EvaluatedScrollableElement;
  documentElement?: EvaluatedScrollableElement;
}

interface EvaluatedGlobal {
  document?: EvaluatedDocument;
}

function now() {
  return Date.now();
}

function safeId(prefix: string) {
  return `${prefix}-${now()}-${Math.random().toString(16).slice(2)}`;
}

function toBase64(buf: Buffer) {
  return buf.toString('base64');
}

export class BrowserAgentPlaywright {
  private browser: Browser | null = null;
  private readonly sessions: Map<string, BrowserSession> = new Map();
  private readonly config: BrowserConfig;

  constructor(config?: Partial<BrowserConfig>) {
    this.config = {
      headless: config?.headless ?? true,
      defaultTimeoutMs: config?.defaultTimeoutMs ?? 30_000,
      viewport: config?.viewport ?? { width: 1280, height: 720 },
      userDataDir: config?.userDataDir,
    };
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser) return this.browser;
    this.browser = await chromium.launch({ headless: this.config.headless, chromiumSandbox: false });
    return this.browser;
  }

  private ensureSession(sessionId: string): BrowserSession {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`Unknown browser session: ${sessionId}`);
    return s;
  }

  private track(session: BrowserSession, action: BrowserAction) {
    session.actions.push(action);
    session.lastActive = now();
    session.url = session.page.url() ?? session.url;
  }

  private async snapshot(page: Page): Promise<PageSnapshot> {
    // Node-side TS scope must not reference DOM globals (like `document`).
    // All DOM access happens inside `page.evaluate` using bracket access.
    const [url, title, text, links, forms, images] = await Promise.all([
      page.url(),
      page.title().catch(() => ''),
      page.evaluate(() => {
        try {
          const d = (globalThis as unknown as EvaluatedGlobal).document;
          const body = d?.body;
          const innerText = body?.innerText;
          return String(innerText ?? '').slice(0, 200_000);
        } catch {
          return '';
        }
      }),

      page.evaluate(() => {
        try {
          const doc = (globalThis as unknown as EvaluatedGlobal).document;
          const list = Array.from(doc?.querySelectorAll('a[href]') ?? []);
          return list.slice(0, 200).map((a) => ({
            text: String(a?.textContent ?? '').trim().slice(0, 200),
            href: String(a?.href ?? ''),
          }));
        } catch {
          return [];
        }
      }),

      page.evaluate(() => {
        try {
          const doc = (globalThis as unknown as EvaluatedGlobal).document;
          const formsEl = Array.from(doc?.querySelectorAll('form') ?? []);
          return formsEl.slice(0, 50).map((f) => {
            const inputs = Array.from(
              f?.querySelectorAll?.('input, select, textarea') ?? [],
            );
            return {
              action: String(f?.action ?? ''),
              method: String(f?.method ?? 'get').toLowerCase(),
              fields: inputs.slice(0, 50).map((el) => ({
                name: String(el?.name ?? el?.id ?? ''),
                type: String(el?.type ?? el?.tagName ?? '').toLowerCase(),
                value: String(el?.value ?? ''),
              })),
            };
          });
        } catch {
          return [];
        }
      }),

      page.evaluate(() => {
        try {
          const doc = (globalThis as unknown as EvaluatedGlobal).document;
          const imgs = Array.from(doc?.querySelectorAll('img') ?? []);
          return imgs.slice(0, 50).map((img) => ({
            src: String(img?.currentSrc ?? img?.src ?? ''),
            alt: String(img?.alt ?? '').slice(0, 200),
          }));
        } catch {
          return [];
        }
      }),
    ]);

    return {
      url,
      title,
      text,
      links,
      forms,
      images,
      timestamp: now(),
    };
  }

  async createSession(name?: string): Promise<BrowserSession> {
    const browser = await this.ensureBrowser();

    const context = await browser.newContext({
      viewport: this.config.viewport,
      userAgent: undefined,
      // userDataDir needs extra wiring; omitted for now.
    });

    const page = await context.newPage();

    const id = safeId('session');
    const session: BrowserSession = {
      id,
      name: name ?? `Session ${this.sessions.size + 1}`,
      url: 'about:blank',
      actions: [],
      createdAt: now(),
      lastActive: now(),
      page,
      context,
    };

    this.sessions.set(id, session);
    return session;
  }

  async navigate(sessionId: string, url: string): Promise<PageSnapshot> {
    const session = this.ensureSession(sessionId);
    const action: BrowserAction = { id: safeId('act'), type: 'navigate', target: url, timestamp: now() };

    try {
      session.page.setDefaultTimeout(this.config.defaultTimeoutMs);
      await session.page.goto(url, { waitUntil: 'domcontentloaded' });
      action.result = { url: session.page.url() };
      this.track(session, action);
      return await this.snapshot(session.page);
    } catch (e) {
      action.error = e instanceof Error ? e.message : String(e);
      this.track(session, action);
      throw e;
    }
  }

  async click(sessionId: string, selector: string): Promise<string> {
    const session = this.ensureSession(sessionId);
    const action: BrowserAction = { id: safeId('act'), type: 'click', target: selector, timestamp: now() };

    try {
      await session.page.click(selector, { timeout: this.config.defaultTimeoutMs });
      action.result = { ok: true, url: session.page.url() };
      this.track(session, action);
      return `Clicked: ${selector}`;
    } catch (e) {
      action.error = e instanceof Error ? e.message : String(e);
      this.track(session, action);
      throw e;
    }
  }

  async type(sessionId: string, selector: string, value: string): Promise<string> {
    const session = this.ensureSession(sessionId);
    const action: BrowserAction = {
      id: safeId('act'),
      type: 'type',
      target: selector,
      value,
      timestamp: now(),
    };

    try {
      await session.page.fill(selector, value, { timeout: this.config.defaultTimeoutMs });
      action.result = { ok: true };
      this.track(session, action);
      return `Typed into ${selector}`;
    } catch (e) {
      action.error = e instanceof Error ? e.message : String(e);
      this.track(session, action);
      throw e;
    }
  }

  async screenshot(
    sessionId: string,
  ): Promise<{ imageBase64: string; mimeType: 'image/png'; fileName: string }> {
    const session = this.ensureSession(sessionId);
    const action: BrowserAction = { id: safeId('act'), type: 'screenshot', timestamp: now() };

    try {
      const buf = (await session.page.screenshot({ type: 'png', fullPage: true })) as Buffer;
      const base64 = toBase64(buf);
      action.result = { bytes: buf.byteLength };
      this.track(session, action);
      return { imageBase64: base64, mimeType: 'image/png', fileName: `screenshot-${sessionId}.png` };
    } catch (e) {
      action.error = e instanceof Error ? e.message : String(e);
      this.track(session, action);
      throw e;
    }
  }

  async extractData(sessionId: string, selector: string): Promise<string[]> {
    const session = this.ensureSession(sessionId);
    const action: BrowserAction = { id: safeId('act'), type: 'extract', target: selector, timestamp: now() };

    try {
      const values = await session.page.$$eval(selector, (els) => {
        const list = Array.from(els).slice(0, 200);
        return list.map((el) => {
          const evaluated = el as unknown as EvaluatedElement;
          const href = String(evaluated.href ?? '');
          if (href) return href;
          const t = String(evaluated.innerText ?? evaluated.textContent ?? '');
          return t.trim();
        });
      });

      action.result = values;
      this.track(session, action);
      return values;
    } catch (e) {
      action.error = e instanceof Error ? e.message : String(e);
      this.track(session, action);
      throw e;
    }
  }

  async fillForm(sessionId: string, formSelector: string, data: Record<string, string>): Promise<string> {
    const session = this.ensureSession(sessionId);
    const action: BrowserAction = {
      id: safeId('act'),
      type: 'fill-form',
      target: formSelector,
      value: JSON.stringify(Object.keys(data)),
      timestamp: now(),
    };

    try {
      const page = session.page;
      for (const [name, v] of Object.entries(data)) {
        const byName = `${formSelector} [name="${name}"]`;
        const byId = `${formSelector} #${name.replace(/[^a-zA-Z0-9_-]/g, '')}`;

        const candidate = page.locator(byName);
        if ((await candidate.count()) > 0) {
          await candidate.first().fill(v);
          continue;
        }

        const candidateById = page.locator(byId);
        if ((await candidateById.count()) > 0) {
          await candidateById.first().fill(v);
          continue;
        }

        const candidatePlaceholder = page.locator(
          `${formSelector} input[placeholder*="${name}"]`,
        );
        if ((await candidatePlaceholder.count()) > 0) {
          await candidatePlaceholder.first().fill(v);
          continue;
        }
      }

      action.result = { ok: true, fields: Object.keys(data).length };
      this.track(session, action);
      return 'Form filled';
    } catch (e) {
      action.error = e instanceof Error ? e.message : String(e);
      this.track(session, action);
      throw e;
    }
  }

  async scroll(sessionId: string, direction: 'up' | 'down' | 'top' | 'bottom'): Promise<string> {
    const session = this.ensureSession(sessionId);
    const action: BrowserAction = { id: safeId('act'), type: 'scroll', target: direction, timestamp: now() };

    try {
      await session.page.evaluate((dir) => {
        const doc = (globalThis as unknown as EvaluatedGlobal).document;
        const el = doc?.scrollingElement ?? doc?.documentElement;
        if (!el) return;

        if (dir === 'top') el.scrollTo(0, 0);
        else if (dir === 'bottom') el.scrollTo(0, el.scrollHeight);
        else if (dir === 'up') el.scrollBy(0, -Math.round(el.clientHeight * 0.8));
        else if (dir === 'down') el.scrollBy(0, Math.round(el.clientHeight * 0.8));
      }, direction);

      action.result = { ok: true };
      this.track(session, action);
      return `Scrolled ${direction}`;
    } catch (e) {
      action.error = e instanceof Error ? e.message : String(e);
      this.track(session, action);
      throw e;
    }
  }

  async goBack(sessionId: string): Promise<string> {
    const session = this.ensureSession(sessionId);
    await session.page.goBack({ timeout: this.config.defaultTimeoutMs }).catch(() => undefined);
    session.lastActive = now();
    return 'Navigated back';
  }

  async goForward(sessionId: string): Promise<string> {
    const session = this.ensureSession(sessionId);
    await session.page.goForward({ timeout: this.config.defaultTimeoutMs }).catch(() => undefined);
    session.lastActive = now();
    return 'Navigated forward';
  }

  async reload(sessionId: string): Promise<string> {
    const session = this.ensureSession(sessionId);
    await session.page.reload({ timeout: this.config.defaultTimeoutMs });
    session.lastActive = now();
    return 'Reloaded';
  }

  async getPageContent(sessionId: string): Promise<string> {
    const session = this.ensureSession(sessionId);
    return session.page.content();
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      await session.context.close();
    } catch {
      // ignore
    }

    this.sessions.delete(sessionId);
  }

  listSessions(): BrowserSessionSummary[] {
    return Array.from(this.sessions.values()).map((session) => ({
      id: session.id,
      name: session.name,
      url: session.url,
      actions: session.actions,
      createdAt: session.createdAt,
      lastActive: session.lastActive,
    }));
  }

  deleteSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  getStats() {
    const sessions = Array.from(this.sessions.values());
    return {
      totalSessions: sessions.length,
      totalActions: sessions.reduce((sum, s) => sum + s.actions.length, 0),
      activeSessions: sessions.filter((s) => now() - s.lastActive < 3_600_000).length,
    };
  }

  async shutdown(): Promise<void> {
    for (const id of Array.from(this.sessions.keys())) {
      await this.closeSession(id);
    }
    this.sessions.clear();

    if (this.browser) {
      await this.browser.close().catch(() => undefined);
      this.browser = null;
    }
  }
}
