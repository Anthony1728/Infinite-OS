// TabBrowser — control the Tabs sections as real browsers.
//
// This tool used to be a message box. `list` returned "tabs live in renderer
// localStorage, go and look", and `get_url` returned "check the tab's
// metadata.browserUrl yourself" — neither of which is an answer a model can act
// on. The renderer now mirrors its tabs into main (src/main/tab-index.ts) and
// the live WebContentsView can report the real address, so both are answered
// with data.
//
// Navigation is applied two ways on purpose: straight to the live guest if the
// tab is on screen right now, and as a tab update so the tab's stored URL is
// correct when it is opened again.

import type { Tool, ToolContext, ToolResult } from './base.js';
import { describeTabs, getTab, listTabs, resolveLiveUrl } from '../tab-index.js';
import { emitTabUpdate } from '../tab-request.js';
import { navigateTabBrowser, goBackTabBrowser, goForwardTabBrowser, reloadTabBrowser } from '../tab-browser-view.js';

/** Accept a bare domain, upgrade it, or turn it into a search. */
function normaliseTarget(url: string): string {
  const target = url.trim();
  if (/^https?:\/\//i.test(target)) return target;
  if (/^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(target)) return `https://${target}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(target)}`;
}

export const tabBrowserTool: Tool = {
  name: 'TabBrowser',
  description: [
    'Control the Infinite OS Tabs sections as real in-app browsers — list them, read their live URL, navigate, go back/forward, reload.',
    'A website tab is a genuine browser running INSIDE Infinite OS, so nothing opens on Windows and the user sees exactly what you see.',
    'Actions: list (all open tabs with their real addresses), get_url (the live address of one tab), navigate, back, forward, reload.',
    'tabId comes from CreateTab (or from `list`). For web work that does not need a visible tab, the InAppBrowser tool is better — it browses in the background and does not disturb the user.',
  ].join(' '),
  permission: 'allow',
  inputSchema: {
    type: 'object',
    properties: {
      tabId: { type: 'string', description: 'Tab id, e.g. ai-tab-… — required for everything except list' },
      action: {
        type: 'string',
        enum: ['navigate', 'back', 'forward', 'reload', 'get_url', 'list'],
        description: 'Browser action',
      },
      url: { type: 'string', description: 'For navigate: the URL. Bare domains become https://; anything else becomes a search.' },
    },
    required: ['action'],
  },

  async execute(args: unknown, _ctx: ToolContext): Promise<ToolResult> {
    const { tabId, action, url } = args as { tabId?: string; action: string; url?: string };

    if (action === 'list') {
      return { content: describeTabs() };
    }

    if (!tabId) return { content: `tabId is required for ${action}. Call action=list to see the open tabs.`, is_error: true };
    const viewId = `tabview:${tabId}`;

    if (action === 'get_url') {
      const known = getTab(tabId);
      if (!known) {
        const open = listTabs().map((t) => t.id).join(', ') || 'none';
        return {
          content: `No tab with id ${tabId}. Open tabs: ${open}.`,
          is_error: true,
        };
      }
      // The live guest knows the true address (it follows redirects and
      // in-page navigation); the mirror is the fallback for a closed tab.
      const live = await resolveLiveUrl(tabId);
      return {
        content: JSON.stringify({
          tabId,
          title: live.title || known.title,
          url: live.url ?? known.url ?? null,
          filePath: known.filePath ?? null,
          onScreen: live.mounted,
        }),
      };
    }

    if (action === 'navigate') {
      if (!url) return { content: 'url is required for navigate', is_error: true };
      const target = normaliseTarget(url);
      // Straight to the live guest if this tab is the one on screen…
      // A tab that is not currently open has no guest, so this reports "not
      // open" — that is expected, and the tab update below still lands.
      navigateTabBrowser({ viewId, url: target });
      // …and into the tab's stored state so it is right when reopened.
      emitTabUpdate({ tabId, changes: { htmlContent: target }, metadata: { browserUrl: target } });
      return { content: `Tab ${tabId} → ${target}` };
    }

    if (action === 'back' || action === 'forward' || action === 'reload') {
      const known = getTab(tabId);
      if (!known) {
        return { content: `No tab with id ${tabId}. Call action=list to see the open tabs.`, is_error: true };
      }
      if (action === 'back') goBackTabBrowser({ viewId });
      else if (action === 'forward') goForwardTabBrowser({ viewId });
      else reloadTabBrowser({ viewId });
      // Keep the stored state in step for a tab that is not currently mounted.
      emitTabUpdate({ tabId, changes: {}, metadata: { browserAction: action, at: Date.now() } });
      return { content: `${action} on tab ${tabId}` };
    }

    return { content: `Unknown action: ${action}`, is_error: true };
  },
};