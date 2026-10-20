// The agent's browser, inside Infinite OS.
//
// This is the tool that makes "the AI does web work without anything popping up
// over the app" true. It drives a detached WebContentsView (main/in-app-browser.ts)
// that shares its session partition with the visible Tabs browser — so the agent
// can sign in, search, read and fill forms entirely behind the scenes, and the
// page it lands on can be shown to the user already authenticated.
//
// When `show` is true (the default) the page is ALSO opened in a Tabs section so
// the user sees what the agent is looking at. That is emitted through the normal
// create_tab payload the renderer already understands.
//
// There is deliberately no code path from this tool to an external browser.

import type { Tool, ToolResult } from './base.js';
import * as inApp from '../in-app-browser.js';
import { emitTabRequest } from '../tab-request.js';

function ok(text: string): ToolResult {
  return { content: text };
}

function bad(text: string, hint?: string): ToolResult {
  return { content: hint ? `${text}\n\nHint: ${hint}` : text, is_error: true };
}

/**
 * Show a URL in a Tabs section over the real tab IPC, so the user watches what
 * the agent is looking at. Best-effort: showing the page is a convenience and
 * must never fail automation that already succeeded.
 */
function showInTab(url: string, title: string): void {
  try {
    emitTabRequest({
      title: (title || 'Browser').slice(0, 40),
      kind: 'website',
      prompt: `Opened by the agent: ${url}`,
      metadata: { browserUrl: url, openedByAgent: true },
    });
  } catch {
    /* best-effort */
  }
}

export const inAppBrowserTool: Tool = {
  name: 'InAppBrowser',
  description:
    'Real browser INSIDE Infinite OS — opens, reads, clicks and fills pages without launching Chrome or putting any window on top of the app. This is the default way to do web work: open/read/click/fill/type/press/back/forward/reload/screenshot/url. Shares the session with the Tabs browser, so a site you are signed into here is signed in there too. Use `show:false` for background work the user should not be interrupted by. Prefer this over Computer/Operator for anything on the open web; use browser_extension only when you specifically need the user\'s already-signed-in personal browser profile.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['open', 'read', 'click', 'fill', 'type', 'press', 'back', 'forward', 'reload', 'url', 'screenshot', 'close'],
      },
      url: { type: 'string', description: 'open: the URL to load. Bare domains are upgraded to https.' },
      selector: { type: 'string', description: 'read/click/fill: CSS selector. read with no selector returns the whole visible page.' },
      text: { type: 'string', description: 'fill/type: the text to enter.' },
      key: { type: 'string', description: 'press: key name, e.g. Enter, Tab, Escape, ArrowDown.' },
      show: {
        type: 'boolean',
        description: 'open: also show the page in a Tabs section so the user can watch it. Default true. Use false for background work.',
      },
    },
    required: ['action'],
  },
  permission: 'allow',

  async execute(args): Promise<ToolResult> {
    const input = args as { action?: string; url?: string; selector?: string; text?: string; key?: string; show?: boolean };
    const action = input.action ?? '';

    switch (action) {
      case 'open': {
        const url = input.url?.trim();
        if (!url) return bad('`url` is required for open.');
        const result = await inApp.openUrl(url);
        if (result.status === 'error') {
          return bad(result.error ?? `Could not open ${url}.`, 'Check the address, or try a search engine instead.');
        }
        if (input.show !== false) showInTab(result.url || url, result.title);
        return ok(`Opened ${result.url}${result.title ? ` — "${result.title}"` : ''}.${
          input.show === false ? ' (background only — not shown to the user)' : ''
        }`);
      }

      case 'read': {
        const selector = input.selector?.trim();
        const text = await inApp.readText(selector);
        if (text === null) return bad(selector ? `No element matched ${selector}.` : 'The page has no readable body yet.');
        if (!text) return ok('The page has no visible text.');
        return ok(text);
      }

      case 'click': {
        const selector = input.selector?.trim();
        if (!selector) return bad('`selector` is required for click.');
        const done = await inApp.click(selector);
        if (!done) return bad(`No element matched ${selector}.`, 'Read the page first to find the right selector.');
        await new Promise((resolve) => setTimeout(resolve, 600));
        return ok(`Clicked ${selector}.`);
      }

      case 'fill':
      case 'type': {
        const selector = input.selector?.trim();
        if (!selector) return bad(`\`selector\` is required for ${action}.`);
        const text = input.text ?? '';
        const done = await inApp.fill(selector, text);
        if (!done) return bad(`No element matched ${selector}.`, 'Read the page first to find the right field.');
        return ok(`Entered text into ${selector}.`);
      }

      case 'press': {
        const key = input.key?.trim();
        if (!key) return bad('`key` is required for press.');
        await inApp.press(key);
        return ok(`Pressed ${key}.`);
      }

      case 'back':
        return ok(`Back → ${await inApp.back()}`);
      case 'forward':
        return ok(`Forward → ${await inApp.forward()}`);
      case 'reload':
        return ok(`Reloaded ${await inApp.reload()}`);

      case 'url': {
        const state = await inApp.currentUrl();
        return ok(`${state.url}${state.title ? ` — "${state.title}"` : ''}`);
      }

      case 'screenshot': {
        const png = await inApp.screenshot();
        if (!png) return bad('Could not capture the in-app browser.');
        return ok(`Captured the page (${Math.round((png.length * 3) / 4 / 1024)} KB PNG, base64).\n\n${png}`);
      }

      case 'close':
        inApp.disposeInAppBrowser();
        return ok('In-app browser released.');

      default:
        return bad(`Unknown action "${action}".`);
    }
  },
};