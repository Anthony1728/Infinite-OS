// In-app browser views for the Tabs section.
//
// WHY THIS IS NOT A <webview>
//
// A <webview> was tried first and is the obvious choice, but its guest viewport
// would not follow the element: with the element at 846x473 and the width/height
// attributes set to match, the guest still reported an inner size of 846x150 and
// painted only a 150px band. Setting the attributes after attach does nothing
// (the guest is sized once, at creation), and a forced resize plus reload did
// not correct it. There is no way to set the guest bounds from the renderer, so
// this could not be fixed from that side.
//
// WebContentsView is the supported modern API for exactly this: main owns the
// guest and its bounds are set explicitly. The renderer measures its own box
// and reports it; main applies it. Nothing is guessed.
//
// Everything stays inside the app window. Each view is a child of the window's
// contentView, so there is no separate OS window and nothing can appear over
// Infinite OS — which is the whole point.
//
// ISOLATION. Each browser gets its own session partition, so no guest can reach
// this app's preload, contextBridge, or Node, and logins persist per partition
// across tabs without leaking into anything else.

import { BrowserWindow, WebContentsView } from 'electron';

const PARTITION = 'persist:infinite-tab-browser';

interface Entry {
  view: WebContentsView;
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  error: string | null;
  /** Set while the guest asks to open a new window; kept in-app. */
  lastRequested: string;
}

const views = new Map<string, Entry>();

/** Electron bounds want device-independent pixels with an origin. */
export interface ViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function findWindow(id: number): BrowserWindow | null {
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.id === id) ?? null;
}

function coerceBounds(input: Partial<ViewBounds> | undefined): ViewBounds {
  const width = Math.max(0, Math.round(Number(input?.width) || 0));
  const height = Math.max(0, Math.round(Number(input?.height) || 0));
  const x = Math.round(Number(input?.x) || 0);
  const y = Math.round(Number(input?.y) || 0);
  return { x, y, width, height };
}

function snapshot(id: string): Record<string, unknown> | null {
  const entry = views.get(id);
  if (!entry) return null;
  return {
    url: entry.url,
    title: entry.title,
    canGoBack: entry.canGoBack,
    canGoForward: entry.canGoForward,
    loading: entry.loading,
    error: entry.error,
  };
}

export interface CreateArgs {
  viewId: string;
  windowId: number;
  url: string;
  bounds: ViewBounds;
}

export function createTabBrowserView(args: CreateArgs): { ok: boolean; error?: string; state?: Record<string, unknown> } {
  const win = findWindow(args.windowId);
  if (!win) return { ok: false, error: 'The host window was not found.' };

  // Replace rather than stack: the renderer may re-request on remount.
  closeTabBrowserView({ viewId: args.viewId });

  const bounds = coerceBounds(args.bounds);
  if (bounds.width <= 0 || bounds.height <= 0) {
    return { ok: false, error: 'The tab has no size yet.' };
  }

  const view = new WebContentsView({
    webPreferences: {
      partition: PARTITION,
      // A remote page is a visitor in a browser. It gets no preload, no Node,
      // and no bridge into Infinite OS.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  view.setBackgroundColor('#ffffff');

  const entry: Entry = {
    view,
    url: args.url,
    title: '',
    canGoBack: false,
    canGoForward: false,
    loading: true,
    error: null,
    lastRequested: args.url,
  };
  views.set(args.viewId, entry);

  const wc = view.webContents;
  const onStateChange = () => {
    const current = views.get(args.viewId);
    if (!current || current.view !== view) return;
    current.canGoBack = wc.navigationHistory.canGoBack();
    current.canGoForward = wc.navigationHistory.canGoForward();
  };
  wc.on('did-start-loading', () => {
    const current = views.get(args.viewId);
    if (current?.view === view) {
      current.loading = true;
      current.error = null;
    }
  });
  wc.on('did-stop-loading', () => {
    const current = views.get(args.viewId);
    if (current?.view === view) current.loading = false;
    onStateChange();
  });
  wc.on('did-navigate', (_e, url) => {
    const current = views.get(args.viewId);
    if (current?.view === view) {
      current.url = url;
      current.error = null;
    }
    onStateChange();
  });
  wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
    if (!isMainFrame) return;
    const current = views.get(args.viewId);
    if (current?.view === view) current.url = url;
    onStateChange();
  });
  wc.on('page-title-updated', (_e, title) => {
    const current = views.get(args.viewId);
    if (current?.view === view) current.title = title;
  });
  wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
    // -3 is ERR_ABORTED, which fires on every ordinary redirect.
    if (!isMainFrame || code === -3) return;
    const current = views.get(args.viewId);
    if (current?.view === view) {
      current.loading = false;
      current.error = `${description || 'Could not load that page'} — ${url}`;
    }
  });
  // `new-window` is deprecated in modern Electron but still the only signal
  // that a page tried to open a separate window, which is exactly the case that
  // must not escape to the OS browser. Typed loosely because Electron's
  // overload set does not describe the event payload.
  const onWindowOpen = (event: unknown) => {
    const payload = event as { preventDefault?: () => void; url?: string };
    // target=_blank must never escape to the OS browser. Keep it in this view.
    payload.preventDefault?.();
    const target = payload.url;
    if (target) {
      entry.lastRequested = target;
      void wc.loadURL(target);
    }
};
  // Electron's typed overloads for this channel do not match the runtime
  // signature, so the subscription is made through a narrow local alias.
  (wc.on as unknown as (channel: string, listener: (event: unknown) => void) => void)('new-window', onWindowOpen);

  view.setBounds(bounds);
  win.contentView.addChildView(view);
  void wc.loadURL(args.url).catch((error: Error) => {
    const current = views.get(args.viewId);
    if (current?.view === view) current.error = (error as Error).message;
  });

  return { ok: true, state: snapshot(args.viewId) ?? undefined };
}

export function updateTabBrowserBounds(args: { viewId: string; bounds: ViewBounds }): { ok: boolean } {
  const entry = views.get(args.viewId);
  if (!entry) return { ok: false };
  entry.view.setBounds(coerceBounds(args.bounds));
  return { ok: true };
}

export function navigateTabBrowser(args: { viewId: string; url: string }): { ok: boolean; error?: string } {
  const entry = views.get(args.viewId);
  if (!entry) return { ok: false, error: 'That tab is not open.' };
  const target = args.url.trim();
  if (!target) return { ok: false, error: 'No URL given.' };
  entry.lastRequested = target;
  entry.url = target;
  entry.loading = true;
  entry.error = null;
  void entry.view.webContents.loadURL(target).catch((error: Error) => {
    entry.error = (error as Error).message;
    entry.loading = false;
  });
  return { ok: true };
}

export function goBackTabBrowser(args: { viewId: string }): { ok: boolean } {
  const entry = views.get(args.viewId);
  if (!entry) return { ok: false };
  if (entry.view.webContents.navigationHistory.canGoBack()) entry.view.webContents.navigationHistory.goBack();
  return { ok: true };
}

export function goForwardTabBrowser(args: { viewId: string }): { ok: boolean } {
  const entry = views.get(args.viewId);
  if (!entry) return { ok: false };
  if (entry.view.webContents.navigationHistory.canGoForward()) entry.view.webContents.navigationHistory.goForward();
  return { ok: true };
}

export function reloadTabBrowser(args: { viewId: string }): { ok: boolean } {
  const entry = views.get(args.viewId);
  if (!entry) return { ok: false };
  entry.view.webContents.reload();
  return { ok: true };
}

export function tabBrowserState(args: { viewId: string }): { ok: boolean; state?: Record<string, unknown> } {
  const state = snapshot(args.viewId);
  return state ? { ok: true, state } : { ok: false };
}

/**
 * The guest's own viewport, read from inside the page.
 *
 * This is the only honest way to confirm the bounds main applied actually took
 * effect — the element box, the width/height attributes and the window capture
 * can all look right while the guest keeps a stale viewport. It is also
 * genuinely useful: the agent needs it to reason about responsive layout, and
 * "is this page actually visible at the size I think it is" is a real question
 * when testing something it just generated.
 */
export async function tabBrowserViewport(viewId: string): Promise<{ width: number; height: number } | null> {
  const entry = views.get(viewId);
  if (!entry || entry.view.webContents.isDestroyed()) return null;
  try {
    const raw = await entry.view.webContents.executeJavaScript(
      'JSON.stringify({ w: window.innerWidth, h: window.innerHeight })',
      true,
    );
    const parsed = JSON.parse(String(raw)) as { w?: number; h?: number };
    return { width: Number(parsed.w) || 0, height: Number(parsed.h) || 0 };
  } catch {
    return null;
  }
}

/** Pull the live state for a view — used after navigation settles. */
export function readTabBrowserState(viewId: string): Record<string, unknown> | null {
  return snapshot(viewId);
}

export function closeTabBrowserView(args: { viewId: string }): { ok: boolean } {
  const entry = views.get(args.viewId);
  if (!entry) return { ok: false };
  views.delete(args.viewId);
  try {
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close();
  } catch {
    /* already gone */
  }
  return { ok: true };
}

/** Drop every view — called when the host window is destroyed. */
export function closeAllTabBrowserViews(): void {
  for (const id of [...views.keys()]) closeTabBrowserView({ viewId: id });
}

/** Which window a view belongs to, so the renderer can re-parent bounds. */
export function tabBrowserWindowId(viewId: string): number | null {
  const entry = views.get(viewId);
  if (!entry) return null;
  return entry.view.webContents.hostWebContents?.id ?? null;
}

export function listTabBrowserViews(): string[] {
  return [...views.keys()];
}

/** The guest's WebContents, so callers can subscribe to its lifecycle. */
export function getTabBrowserWebContents(viewId: string): Electron.WebContents | null {
  const entry = views.get(viewId);
  if (!entry || entry.view.webContents.isDestroyed()) return null;
  return entry.view.webContents;
}