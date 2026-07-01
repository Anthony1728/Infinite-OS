import type { BrowserConfig as PWBrowserConfig, BrowserSession as PWBrowserSession, PageSnapshot } from './browser-agent-playwright.js';

import { BrowserAgentPlaywright as Impl } from './browser-agent-playwright.js';

// Browser agent (Playwright-backed)

export type BrowserConfig = {
  headless: boolean;
  defaultTimeoutMs?: number;
  viewport: { width: number; height: number };
  userDataDir: string;
  
  // Back-compat for older config naming
  defaultTimeout?: number;
};


export type { PageSnapshot };

export type BrowserAction = {
  id: string;
  type:
    | 'navigate'
    | 'click'
    | 'type'
    | 'select'
    | 'screenshot'
    | 'extract'
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
};

export type BrowserSession = PWBrowserSession;

export class BrowserAgent {
  private impl: Impl;

  constructor(config?: Partial<BrowserConfig>) {
    this.impl = new Impl({
      headless: config?.headless ?? true,
      defaultTimeoutMs: config?.defaultTimeoutMs ?? config?.defaultTimeout ?? 30_000,
      viewport: config?.viewport ?? { width: 1280, height: 720 },
      userDataDir: config?.userDataDir,
    } satisfies Partial<PWBrowserConfig>);
  }

  createSession(name?: string): Promise<BrowserSession> {
    return this.impl.createSession(name);
  }

  navigate(sessionId: string, url: string): Promise<PageSnapshot> {
    return this.impl.navigate(sessionId, url);
  }

  click(sessionId: string, selector: string): Promise<string> {
    return this.impl.click(sessionId, selector);
  }

  type(sessionId: string, selector: string, value: string): Promise<string> {
    return this.impl.type(sessionId, selector, value);
  }

  screenshot(sessionId: string): Promise<{ imageBase64: string; mimeType: 'image/png'; fileName: string }> {
    return this.impl.screenshot(sessionId);
  }

  extractData(sessionId: string, selector: string): Promise<string[]> {
    return this.impl.extractData(sessionId, selector);
  }

  fillForm(sessionId: string, formSelector: string, data: Record<string, string>): Promise<string> {
    return this.impl.fillForm(sessionId, formSelector, data);
  }

  scroll(sessionId: string, direction: 'up' | 'down' | 'top' | 'bottom'): Promise<string> {
    return this.impl.scroll(sessionId, direction);
  }

  goBack(sessionId: string): Promise<string> {
    return this.impl.goBack(sessionId);
  }

  goForward(sessionId: string): Promise<string> {
    return this.impl.goForward(sessionId);
  }

  reload(sessionId: string): Promise<string> {
    return this.impl.reload(sessionId);
  }

  getPageContent(sessionId: string): Promise<string> {
    return this.impl.getPageContent(sessionId);
  }

  closeSession(sessionId: string): Promise<void> {
    return this.impl.closeSession(sessionId);
  }

  listSessions(): BrowserSession[] {
    return this.impl.listSessions();
  }

  deleteSession(sessionId: string): boolean {
    return this.impl.deleteSession(sessionId);
  }

  getStats() {
    return this.impl.getStats();
  }
}

