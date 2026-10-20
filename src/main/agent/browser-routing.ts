import { BrowserWindow } from 'electron';
import { bridgeServer } from '../bridge/server.js';
import { settings } from '../settings/store.js';

export interface ForcedBrowserTool {
  name: 'Operator' | 'Computer' | 'browser_extension' | 'InAppBrowser';
  input: Record<string, unknown>;
}

function cleanQuery(value: string): string {
  return value.trim().replace(/[.!?]+$/, '').trim();
}

/** True when the Infinite OS Bridge extension is connected to the local bridge server. */
function isExtensionConnected(): boolean {
  return bridgeServer.getStatus().connected;
}

/**
 * Should web work stay inside the app right now?
 *
 * True when the user has explicitly asked for the in-app browser, and also
 * whenever Infinite OS is full screen. Full screen is the important case: a
 * Chrome window opened over a full-screen app is the single most disruptive
 * thing this product can do, and the in-app browser can do the same job without
 * the user losing a single pixel of what they were looking at.
 */
function prefersInAppBrowser(): boolean {
  const preference = settings.get('browserPreference');
  if (preference === 'in-app') return true;
  if (preference === 'extension') return false;
  // No explicit preference: full screen means web work stays inside the app.
  //
  // Guarded because Electron is not guaranteed to be importable here — during
  // early startup, during teardown, and under tests it can be absent. An
  // unhandled throw in this function would take out the whole routing path.
  try {
    return BrowserWindow.getAllWindows().some((win) => !win.isDestroyed() && win.isFullScreen());
  } catch {
    return false;
  }
}

/** Route a web task to the in-app browser, or null if that is not appropriate. */
function inApp(url: string): ForcedBrowserTool | null {
  return prefersInAppBrowser() ? { name: 'InAppBrowser', input: { action: 'open', url } } : null;
}

/**
 * Deterministic routing for common visible-Chrome requests. This bypasses
 * model-dependent tool selection while still executing through real tools.
 * ALWAYS routes to browser_extension first — even when disconnected — so the
 * model sees the bridge error and auto-falls back to Operator/CDP without asking the user.
 * Only falls back to Operator/Computer for truly offline tasks.
 */
export function routeForcedBrowserTool(text: string): ForcedBrowserTool | null {
  const extensionConnected = isExtensionConnected();

  const amazonSearch = text.match(
    /\bsearch\s+(?:on\s+)?amazon(?:\.com)?\s+(?:for\s+)?(.+?)[.!?]?$/i,
  );
  if (amazonSearch) {
    const query = cleanQuery(amazonSearch[1]);
    if (query) {
      const url = `https://www.amazon.com/s?k=${encodeURIComponent(query)}`;
      // Inside the app when that is the user's chosen surface (or full screen).
      const inAppRoute = inApp(url);
      if (inAppRoute) return inAppRoute;
      // Otherwise prefer the extension — even when disconnected, its error tells
      // the user to reload the extension instead of silently opening Chrome.
      return { name: 'browser_extension', input: { action: 'navigate', url } };
    }
  }

  const explicitGoogleSearch = text.match(
    /\b(?:search\s+(?:on\s+)?google|google)\s+(?:for\s+)?(.+?)[.!?]?$/i,
  );
  const chromeSearch = text.match(
    /\b(?:chrome|google\s+chrome)\b[\s\S]*?\bsearch\s+(?:for\s+)?(.+?)[.!?]?$/i,
  );
  const googleQuery = cleanQuery(explicitGoogleSearch?.[1] ?? chromeSearch?.[1] ?? '');
  if (googleQuery) {
    const url = `https://www.google.com/search?q=${encodeURIComponent(googleQuery)}`;
    const inAppRoute = inApp(url);
    if (inAppRoute) return inAppRoute;
    return { name: 'browser_extension', input: { action: 'navigate', url } };
  }

  if (/\b(?:open|launch|start)\b[\s\S]{0,40}\b(?:google\s+)?chrome\b/i.test(text)) {
    // "Open Chrome" must never spawn a browser window over Infinite OS. Open a
    // browser instead — in the app when that is the surface, otherwise in the
    // user's own Chrome through the extension.
    if (prefersInAppBrowser()) {
      return { name: 'InAppBrowser', input: { action: 'open', url: 'https://www.google.com' } };
    }
    if (extensionConnected) {
      return { name: 'browser_extension', input: { action: 'new_tab', url: 'about:blank' } };
    }
    // Previously this launched Chrome through the Computer tool — a visible
    // window on top of the app, which is exactly what must not happen.
    return { name: 'InAppBrowser', input: { action: 'open', url: 'https://www.google.com' } };
  }

  // Extension-preferred routes for common web tasks
  // YouTube search
  const ytSearch = text.match(/\b(?:search|look|find)\s+(?:on\s+)?youtube\s+(?:for\s+)?(.+?)[.!?]?$/i);
  if (ytSearch) {
    const query = cleanQuery(ytSearch[1]);
    if (query) {
      const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
      const inAppRoute = inApp(url);
      return inAppRoute ?? { name: 'browser_extension', input: { action: 'navigate', url } };
    }
  }

  // Twitter/X search
  const twitterSearch = text.match(/\b(?:search|look|find)\s+(?:on\s+)?(?:twitter|x\.com)\s+(?:for\s+)?(.+?)[.!?]?$/i);
  if (twitterSearch) {
    const query = cleanQuery(twitterSearch[1]);
    if (query) {
      const url = `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query`;
      const inAppRoute = inApp(url);
      return inAppRoute ?? { name: 'browser_extension', input: { action: 'navigate', url } };
    }
  }

  // GitHub search
  const githubSearch = text.match(/\b(?:search|look|find)\s+(?:on\s+)?github\s+(?:for\s+)?(.+?)[.!?]?$/i);
  if (githubSearch) {
    const query = cleanQuery(githubSearch[1]);
    if (query) {
      const url = `https://github.com/search?q=${encodeURIComponent(query)}&type=repositories`;
      const inAppRoute = inApp(url);
      return inAppRoute ?? { name: 'browser_extension', input: { action: 'navigate', url } };
    }
  }

  // Generic "open website" / "go to URL"
  const openSite = text.match(/\b(?:open|go\s+to|visit|navigate\s+to)\s+(https?:\/\/\S+|www\.\S+|[a-zA-Z0-9-]+\.(com|org|net|io|dev|co))/i);
  if (openSite) {
    let url = openSite[1];
    if (!url.startsWith('http')) url = `https://${url}`;
    const inAppRoute = inApp(url);
    return inAppRoute ?? { name: 'browser_extension', input: { action: 'navigate', url } };
  }

  return null;
}
