// The agent's in-app browser.
//
// This is the surface that makes "the AI uses the browser inside Infinite OS"
// real. It is a WebContentsView like the tab browser, with two differences that
// matter:
//
//   1. It is DETACHED from the window. It has no bounds on screen, never paints,
//      never takes focus, and cannot appear over Infinite OS. The agent can
//      drive it from any view, at any time, without the user noticing — which
//      is what "if anything happens outside Infinite OS it mustn't be visible"
//      requires.
//
//   2. It shares the session partition with the visible tab browser. So when
//      the agent has signed in to something in the background, opening that
//      page in a visible tab shows it already logged in. The automation surface
//      and the surface the user looks at are the same browser session.
//
// Nothing here launches an external browser. There is no code path from here to
// Chrome, Edge, or `shell.openExternal`.

import { WebContentsView } from 'electron';

const PARTITION = 'persist:infinite-tab-browser';

interface Session {
  view: WebContentsView;
  url: string;
  title: string;
}

let session: Session | null = null;
let ready: Promise<Session> | null = null;

function create(): Session {
  const view = new WebContentsView({
    webPreferences: {
      partition: PARTITION,
      // A remote page is a visitor. No preload, no Node, no bridge into the app.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  view.setBackgroundColor('#ffffff');
  // Offscreen. Never added to a window's contentView, so it cannot be seen.
  view.setBounds({ x: 0, y: 0, width: 1280, height: 900 });

  const wc = view.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  // A site trying to open or navigate the OS browser is refused outright.
  (wc.on as unknown as (channel: string, listener: (event: unknown) => void) => void)('new-window', (event) => {
    (event as { preventDefault?: () => void }).preventDefault?.();
  });

  const created: Session = { view, url: 'about:blank', title: '' };
  wc.on('did-navigate', (_e, url) => {
    created.url = url;
  });
  wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
    if (isMainFrame) created.url = url;
  });
  wc.on('page-title-updated', (_e, title) => {
    created.title = title;
  });
  return created;
}

async function get(): Promise<Session> {
  if (session && !session.view.webContents.isDestroyed()) return session;
  if (ready) return ready;
  ready = new Promise<Session>((resolve, reject) => {
    const made = create();
    // Wait for the first paint so callers can interact immediately afterwards.
    const timer = setTimeout(() => {
      session = made;
      ready = null;
      resolve(made);
    }, 20_000);
    made.view.webContents.once('did-finish-load', () => {
      clearTimeout(timer);
      session = made;
      ready = null;
      resolve(made);
    });
    made.view.webContents.once('did-fail-load', () => {
      clearTimeout(timer);
      session = made;
      ready = null;
      reject(new Error('The in-app browser could not start its first page.'));
    });
  });
  return ready;
}

export interface NavigateResult {
  url: string;
  title: string;
  status: 'ok' | 'error';
  error?: string;
}

/** Load a URL and wait for it to settle. */
export async function openUrl(rawUrl: string, timeoutMs = 30_000): Promise<NavigateResult> {
  const target = /^https?:\/\//i.test(rawUrl.trim()) ? rawUrl.trim() : `https://${rawUrl.trim()}`;
  const s = await get();
  const wc = s.view.webContents;

  const settled = new Promise<'done' | 'fail'>((resolve) => {
    const timer = setTimeout(() => resolve('done'), timeoutMs);
    wc.once('did-finish-load', () => {
      clearTimeout(timer);
      resolve('done');
    });
    wc.once('did-fail-load', (_e, code, description, url) => {
      clearTimeout(timer);
      // -3 is ERR_ABORTED: an ordinary redirect, not a failure.
      if (code === -3) resolve('done');
      else resolve('fail');
      void description;
      void url;
    });
  });

  await wc.loadURL(target).catch((error: Error) => ({ error: error.message }));
  const outcome = await settled;
  return {
    url: s.url,
    title: s.title,
    status: outcome === 'fail' ? 'error' : 'ok',
    error: outcome === 'fail' ? `Could not load ${target}` : undefined,
  };
}

/** Run script in the page and return its JSON value. Never throws at the caller. */
export async function evaluate<T>(script: string): Promise<T | null> {
  const s = await get();
  if (s.view.webContents.isDestroyed()) return null;
  try {
    const raw = await s.view.webContents.executeJavaScript(`(async () => { ${script} })()`, true);
    return raw as T;
  } catch {
    return null;
  }
}

/**
 * Read the page as text.
 *
 * `innerText` rather than `textContent` so hidden navigation chrome and script
 * bodies do not pollute the result — what the user can see is what comes back.
 */
export async function readText(selector?: string): Promise<string | null> {
  return evaluate<string>(`
    const target = ${JSON.stringify(selector ?? '')} ? document.querySelector(${JSON.stringify(selector ?? '')}) : document.body;
    if (!target) return null;
    return (target.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim().slice(0, 20000);
  `);
}

export async function click(selector: string): Promise<boolean> {
  const result = await evaluate<boolean>(`
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    el.click();
    return true;
  `);
  return result === true;
}

export async function fill(selector: string, text: string): Promise<boolean> {
  const result = await evaluate<boolean>(`
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    // Set the value through the native setter so frameworks that listen on
    // 'input' actually see the change, then fire the events they expect.
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  `);
  return result === true;
}

export async function press(key: string): Promise<boolean> {
  const result = await evaluate<boolean>(`
    const el = document.activeElement || document.body;
    el.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: ${JSON.stringify(key)}, bubbles: true }));
    return true;
  `);
  return result === true;
}

export async function back(): Promise<string> {
  const s = await get();
  if (s.view.webContents.navigationHistory.canGoBack()) s.view.webContents.navigationHistory.goBack();
  return s.url;
}

export async function forward(): Promise<string> {
  const s = await get();
  if (s.view.webContents.navigationHistory.canGoForward()) s.view.webContents.navigationHistory.goForward();
  return s.url;
}

export async function reload(): Promise<string> {
  const s = await get();
  s.view.webContents.reload();
  return s.url;
}

export async function currentUrl(): Promise<{ url: string; title: string }> {
  const s = await get();
  return { url: s.url, title: s.title };
}

export async function screenshot(): Promise<string | null> {
  const s = await get();
  try {
    const image = await s.view.webContents.capturePage();
    return image.toPNG().toString('base64');
  } catch {
    return null;
  }
}

/** Release the browser. Called on quit. */
export function disposeInAppBrowser(): void {
  if (!session) return;
  try {
    if (!session.view.webContents.isDestroyed()) session.view.webContents.close();
  } catch {
    /* already gone */
  }
  session = null;
  ready = null;
}