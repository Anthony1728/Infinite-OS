import { bridgeServer } from '../bridge/server.js';

export interface ForcedBrowserTool {
  name: 'Operator' | 'Computer' | 'browser_extension';
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
      // Always try extension first — even when disconnected, the error message
      // tells the user to reload the extension instead of silently opening Chrome.
      return {
        name: 'browser_extension',
        input: { action: 'navigate', url: `https://www.amazon.com/s?k=${encodeURIComponent(query)}` },
      };
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
    return {
      name: 'browser_extension',
      input: { action: 'navigate', url: `https://www.google.com/search?q=${encodeURIComponent(googleQuery)}` },
    };
  }

  if (/\b(?:open|launch|start)\b[\s\S]{0,40}\b(?:google\s+)?chrome\b/i.test(text)) {
    if (extensionConnected) {
      return { name: 'browser_extension', input: { action: 'new_tab', url: 'about:blank' } };
    }
    // Only launch new Chrome when extension is disconnected AND user explicitly asked to open Chrome
    return { name: 'Computer', input: { action: 'launch_app', app: 'chrome' } };
  }

  // Extension-preferred routes for common web tasks — always try extension first
  // YouTube search
  const ytSearch = text.match(/\b(?:search|look|find)\s+(?:on\s+)?youtube\s+(?:for\s+)?(.+?)[.!?]?$/i);
  if (ytSearch) {
    const query = cleanQuery(ytSearch[1]);
    if (query) return { name: 'browser_extension', input: { action: 'navigate', url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}` } };
  }

  // Twitter/X search
  const twitterSearch = text.match(/\b(?:search|look|find)\s+(?:on\s+)?(?:twitter|x\.com)\s+(?:for\s+)?(.+?)[.!?]?$/i);
  if (twitterSearch) {
    const query = cleanQuery(twitterSearch[1]);
    if (query) return { name: 'browser_extension', input: { action: 'navigate', url: `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query` } };
  }

  // GitHub search
  const githubSearch = text.match(/\b(?:search|look|find)\s+(?:on\s+)?github\s+(?:for\s+)?(.+?)[.!?]?$/i);
  if (githubSearch) {
    const query = cleanQuery(githubSearch[1]);
    if (query) return { name: 'browser_extension', input: { action: 'navigate', url: `https://github.com/search?q=${encodeURIComponent(query)}&type=repositories` } };
  }

  // Generic "open website" / "go to URL"
  const openSite = text.match(/\b(?:open|go\s+to|visit|navigate\s+to)\s+(https?:\/\/\S+|www\.\S+|[a-zA-Z0-9-]+\.(com|org|net|io|dev|co))/i);
  if (openSite) {
    let url = openSite[1];
    if (!url.startsWith('http')) url = `https://${url}`;
    return { name: 'browser_extension', input: { action: 'navigate', url } };
  }

  return null;
}
