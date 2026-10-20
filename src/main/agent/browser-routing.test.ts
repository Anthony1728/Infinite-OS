import { describe, expect, it, beforeEach } from 'vitest';
import { settings } from '../settings/store.js';
// Static, NOT a dynamic import inside the test: pulling this module in later
// transitively triggers `settings.load()`, which resets the store's cache and
// would wipe the preference the test just wrote.
import { routeForcedBrowserTool } from './browser-routing.js';

/**
 * Routing is where "nothing opens over Infinite OS" is actually enforced, so it
 * gets a test rather than good intentions.
 *
 * `browser-routing` reads `BrowserWindow.getAllWindows()` to detect full screen;
 * under vitest electron is not real, so the setting is what these tests drive.
 */
function routeFor(text: string) {
  return routeForcedBrowserTool(text);
}

describe('browser routing stays inside Infinite OS', () => {
  // settings.set is async and only publishes into the read cache after its
  // write resolves, so this must be awaited — otherwise the preference has not
  // landed when the route is computed.
  beforeEach(async () => {
    await settings.set('user', 'browserPreference', 'in-app', process.cwd());
  });

  it('routes a web search to the in-app browser when that is the preference', () => {
    // Read-back: proves the preference actually landed in the store the router
    // reads from, rather than silently failing to persist.
    expect(settings.get('browserPreference')).toBe('in-app');
    const routed = routeFor('search google for the state of infinite os');
    expect(routed?.name).toBe('InAppBrowser');
    expect(String(routed?.input.url)).toContain('google.com/search');
  });

  it('never launches Chrome through the Computer tool', () => {
    // This used to return Computer/launch_app chrome, which put a real browser
    // window on top of the app.
    for (const text of [
      'open chrome',
      'launch chrome',
      'start google chrome',
      'open chrome and search for cats',
    ]) {
      const routed = routeFor(text);
      expect(
        routed && routed.name === 'Computer' && routed.input.action === 'launch_app',
        `"${text}" must not launch a browser window over the app`,
      ).toBe(false);
    }
  });

  it('answers "open chrome" with an in-app browser instead of a window', () => {
    const routed = routeFor('open chrome');
    expect(routed?.name).toBe('InAppBrowser');
  });

  it('keeps every routed URL inside http(s) — no shell.openExternal target', () => {
    const texts = [
      'open https://example.com/pricing',
      'go to example.org',
      'search youtube for lofi',
      'search github for electron',
      'search on twitter for infinite os',
      'search amazon for a standing desk',
    ];
    for (const text of texts) {
      const routed = routeFor(text);
      if (!routed) continue;
      const url = String(routed.input.url ?? '');
      expect(url, `"${text}" produced a non-http URL: ${url}`).toMatch(/^https?:\/\//);
    }
  });

  it('prefers the extension when the user explicitly asked for it', async () => {
    await settings.set('user', 'browserPreference', 'extension', process.cwd());
    const routed = routeFor('open https://example.com');
    expect(routed?.name).toBe('browser_extension');
  });
});