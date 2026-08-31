// TabBrowser — control any Tabs website as a live browser
import type { Tool, ToolContext, ToolResult } from './base.js';

export const tabBrowserTool: Tool = {
  name: 'TabBrowser',
  description: [
    'Control any Infinite OS Tabs website as a live browser — the Tabs section IS a browser.',
    'Use this after CreateTab with kind=website to navigate, go back/forward, reload, or inspect the tab browser. The tab shows a real iframe with a toolbar (address bar, back/forward) that both you and the user can see. The user sees the same page you control — true co-browsing.',
    'Actions:',
    '- navigate: go to a URL in a tab (tabId + url). Creates browser history.',
    '- back/forward/reload: standard nav.',
    '- get_url: report current URL of a tab.',
    'How to find tabId: it is returned when you call CreateTab (id like ai-tab-...). You can also list tabs via reading localStorage infinite:ai-workspace-tabs client-side, but easiest is to remember the id from CreateTab.',
    'When to use: user asks to open a website, browse, shop, search, fill a form, or says "use the tab as browser". Prefer this over browser_extension when you want the result to live in the Tabs sidebar (persistent, visible in Infinite OS). For external Chrome with user sessions, use browser_extension instead.',
  ].join(' '),
  permission: 'allow',
  inputSchema: {
    type: 'object',
    properties: {
      tabId: { type: 'string', description: 'Tabs id, e.g. ai-tab-...' },
      action: { type: 'string', enum: ['navigate', 'back', 'forward', 'reload', 'get_url', 'list'], description: 'Browser action' },
      url: { type: 'string', description: 'URL to navigate to (for navigate)' },
      text: { type: 'string', description: 'Optional note' },
    },
    required: ['action'],
  },

  async execute(args: unknown, _ctx: ToolContext): Promise<ToolResult> {
    const { tabId, action, url } = args as { tabId?: string; action: string; url?: string };
    if (action === 'list') {
      return {
        content: JSON.stringify({
          action: 'list_tabs',
          message: 'Tabs are stored in renderer localStorage (infinite:ai-workspace-tabs). Use CreateTab to create a new browser tab, then TabBrowser navigate with its id. If you just created a tab, reuse its id.',
        }),
      };
    }
    if (action === 'navigate') {
      if (!tabId) return { content: 'tabId is required for navigate', is_error: true };
      if (!url) return { content: 'url is required for navigate', is_error: true };
      let target = url.trim();
      if (!/^https?:\/\//i.test(target)) {
        if (/^[\w-]+(\.[\w-]+)+/.test(target)) target = 'https://' + target;
        else target = 'https://www.google.com/search?q=' + encodeURIComponent(target);
      }
      return {
        content: JSON.stringify({
          action: 'navigate_tab',
          tabId,
          url: target,
          metadata: { browserUrl: target },
          message: `Tab ${tabId} will navigate to ${target}. The user will see it live in Tabs.`,
        }),
      };
    }
    if (action === 'back' || action === 'forward' || action === 'reload') {
      if (!tabId) return { content: `tabId is required for ${action}`, is_error: true };
      return {
        content: JSON.stringify({
          action: 'update_tab',
          tabId,
          patch: { metadata: { browserAction: action, at: Date.now() } },
          message: `Tab ${tabId} ${action} requested. Note: back/forward is handled client-side via iframe history; for precise control use navigate with explicit URL.`,
        }),
      };
    }
    if (action === 'get_url') {
      if (!tabId) return { content: 'tabId is required for get_url', is_error: true };
      return {
        content: JSON.stringify({
          action: 'get_tab_url',
          tabId,
          message: `Check the tab's htmlContent/metadata.browserUrl in the tab store for ${tabId}. If you need to report, ask the user or re-read via tool.`,
        }),
      };
    }
    return { content: `Unknown action: ${action}`, is_error: true };
  },
};
