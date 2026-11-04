// Browser Extension tool — drives the user's real browser through the local
// Infinite OS Bridge extension (fast, DOM-verified control of logged-in pages:
// navigate, click, type, fill forms, extract content, screenshot, tabs, JS).

import type { Tool, ToolResult } from './base.js';
import { bridgeServer } from '../bridge/server.js';
import { ensureBrowserReady, installBridgeExtension } from '../bridge/extension-setup.js';

const ACTIONS = [
  'prepare_install',
  'navigate',
  'inspect',
  'click',
  'click_text',
  'double_click',
  'type',
  'fill',
  'press',
  'scroll',
  'extract_text',
  'extract_links',
  'extract_forms',
  'screenshot',
  'execute_js',
  'highlight',
  'list_tabs',
  'new_tab',
  'activate_tab',
  'close_tab',
  'reload',
  'back',
  'forward',
  'wait',
  'hover',
  'focus',
  'clear',
  'set_value',
  'get_value',
  'get_element',
  'get_elements',
  'select',
  'right_click',
  'drag',
  'cookie_get',
  'cookie_set',
  'clipboard_read',
  'clipboard_write',
  'storage_get',
  'storage_set',
  'batch',
  'console_log',
  'get_page_performance',
  // Browser-window and tab management
  'get_windows',
  'create_window',
  'focus_window',
  'minimize_window',
  'maximize_window',
  'get_tab_tree',
  'get_tab_info',
  'duplicate_tab',
  'pin_tab',
  'move_tab',
  'zoom',
  // Downloads, history and cookies
  'get_downloads',
  'download',
  'get_history',
  'clear_history',
  'get_cookies',
  'clear_cookies',
  // Page structure, forms, search and device info
  'get_page_html',
  'get_page_meta',
  'get_page_structured',
  'get_table_data',
  'get_form_data',
  'submit_form',
  'find_in_page',
  'get_browser_info',
  'get_network_info',
  'get_cpu_info',
  'get_battery',
  'get_idle_state',
  'get_permissions',
  'get_storage_info',
] as const;

function commandFor(action: string): string {
  switch (action) {
    case 'click_text':
      return 'click_text';
    case 'extract_text':
      return 'get_page_text';
    case 'extract_links':
      return 'get_page_links';
    case 'extract_forms':
      return 'get_form_fields';
    case 'execute_js':
      return 'execute_js';
    case 'hover':
      return 'hover';
    case 'focus':
      return 'focus';
    case 'clear':
      return 'clear';
    // These four were sent camelCase while the extension's dispatcher only ever
    // matched snake_case, so they always failed with "Unknown command". The
    // extension now accepts both spellings; the canonical name is sent here.
    case 'set_value':
      return 'set_value';
    case 'get_value':
      return 'get_value';
    case 'get_element':
      return 'get_element';
    case 'get_elements':
      return 'get_elements';
    case 'right_click':
      return 'right_click';
    case 'drag':
      return 'drag';
    case 'cookie_get':
      return 'cookie_get';
    case 'cookie_set':
      return 'cookie_set';
    case 'clipboard_read':
      return 'clipboard_read';
    case 'clipboard_write':
      return 'clipboard_write';
    case 'storage_get':
      return 'storage_get';
    case 'storage_set':
      return 'storage_set';
    case 'console_log':
      return 'console_log';
    case 'get_page_performance':
      return 'get_page_performance';
    default:
      return action;
  }
}

export const browserExtensionTool: Tool = {
  name: 'browser_extension',
  description:
    'PRIMARY browser control — use FIRST for web tasks. Drives logged-in Chrome/Edge through the Infinite OS Bridge extension, auto-heals the connection, and falls back to Operator (CDP). The action enum is authoritative.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [...ACTIONS],
        description:
          'Action to perform (see enum). Selector actions use selector; click_text/types use text; fill uses fields; navigate uses url; batch uses ops; tab actions use tabId.',
      },
      url: { type: 'string', description: 'navigate/new_tab URL.' },
      selector: { type: 'string', description: 'CSS selector.' },
      text: { type: 'string', description: 'Click text or typed value.' },
      value: { type: 'string', description: 'Value to set/select.' },
      fromSelector: { type: 'string', description: 'Drag source selector.' },
      toSelector: { type: 'string', description: 'Drag target selector.' },
      fields: {
        type: 'object',
        description: 'Map of selector→value for fill.',
        additionalProperties: { type: 'string' },
      },
      key: { type: 'string', description: 'Key name for press.' },
      direction: { type: 'string', enum: ['down', 'up', 'left', 'right', 'top', 'bottom'], description: 'Scroll direction.' },
      pixels: { type: 'number', description: 'Scroll distance.' },
      script: { type: 'string', description: 'JavaScript for execute_js.' },
      tabId: { type: 'number', description: 'Target tab id.' },
      ms: { type: 'number', description: 'Wait milliseconds.' },
      name: { type: 'string', description: 'Cookie name.' },
      domain: { type: 'string', description: 'Cookie domain.' },
      path: { type: 'string', description: 'Cookie path.' },
      secure: { type: 'boolean', description: 'Cookie secure flag.' },
      httpOnly: { type: 'boolean', description: 'Cookie httpOnly flag.' },
      keys: { type: 'array', items: { type: 'string' }, description: 'Storage keys.' },
      data: { type: 'object', description: 'Storage or cookie payload.' },
      bypassCache: { type: 'boolean', description: 'Reload without cache.' },
      ops: {
        type: 'array',
        description: 'Batch ops [{op,params}].',
        items: {
          type: 'object',
          properties: {
            op: { type: 'string' },
            params: { type: 'object' },
          },
        },
      },
      duration: { type: 'number', description: 'Console capture ms (100-10000).' },
      windowId: { type: 'number', description: 'Window id.' },
      index: { type: 'number', description: 'Tab/match index.' },
      filename: { type: 'string', description: 'Download path.' },
      saveAs: { type: 'boolean', description: 'Show Save As dialog.' },
      conflictAction: { type: 'string', description: 'uniquify|overwrite|prompt.' },
      maxResults: { type: 'number', description: 'History result cap.' },
      query: { type: 'string', description: 'History/download search.' },
      limit: { type: 'number', description: 'Download result cap.' },
      orderBy: { type: 'array', items: { type: 'string' }, description: 'Download sort order.' },
      startTime: { type: 'number', description: 'History start (epoch ms).' },
      type: { type: 'string', description: 'Window type: normal|popup|panel.' },
      state: { type: 'string', description: 'Window state: normal|minimized|maximized|fullscreen.' },
      width: { type: 'number', description: 'Window width.' },
      height: { type: 'number', description: 'Window height.' },
      left: { type: 'number', description: 'Window left.' },
      top: { type: 'number', description: 'Window top.' },
      focused: { type: 'boolean', description: 'Focus new window.' },
      pinned: { type: 'boolean', description: 'Pin tab.' },
      factor: { type: 'number', description: 'Zoom factor (1 = 100%).' },
      zoomAction: { type: 'string', enum: ['in', 'out', 'reset'], description: 'Relative zoom.' },
      interval: { type: 'number', description: 'Idle threshold seconds.' },
    },
    required: ['action'],
  },
  permission: 'ask',

  async execute(args): Promise<ToolResult> {
    const input = args as Record<string, unknown>;
    const action = String(input.action || 'inspect');
    if (!ACTIONS.includes(action as (typeof ACTIONS)[number])) {
      return { content: JSON.stringify({ ok: false, error: `Unknown action "${action}"` }, null, 2), is_error: true };
    }
    if (action === 'prepare_install') {
      const installed = installBridgeExtension();
      if (!installed.ok) {
        return { content: JSON.stringify({ ok: false, error: installed.error, extensionPath: installed.path }, null, 2), is_error: true };
      }
      // The dedicated profile is the zero-click path: launch it, install the
      // unpacked extension over CDP, and wait for the bridge handshake. If that
      // fails, the same folder can still be loaded by hand in the user's Chrome.
      const ready = await ensureBrowserReady({ launch: true });
      return {
        content: JSON.stringify(
          {
            ok: ready.ok,
            prepared: true,
            extensionPath: installed.path,
            version: installed.version,
            launchedBrowser: ready.launched,
            installedExtension: ready.installedExtension,
            bridgeConnected: ready.status.bridgeConnected,
            cdpRunning: ready.status.cdpRunning,
            needsBrowserRestart: ready.needsRestart,
            error: ready.error || undefined,
            next: ready.ok
              ? ['The Infinite OS browser is running and connected. No manual step is needed.']
              : [
                  'If a Chrome window opened, give it a few seconds and run action "inspect" to verify.',
                  'To use your main Chrome instead: open chrome://extensions, enable Developer mode, click Load unpacked, and choose the extensionPath above.',
                  'If the panel says the browser needs a restart, use its Restart browser button.',
                ],
          },
          null,
          2,
        ),
        is_error: !ready.ok,
      };
    }
    // Self-heal before a command: if the extension is not connected, try to
    // attach to or launch the dedicated browser instead of failing the action.
    if (!bridgeServer.getStatus().connected && !process.env.VITEST) {
      await ensureBrowserReady({ launch: true }).catch(() => null);
    }
    const command = commandFor(action);
    const params: Record<string, unknown> = {};
    if (input.url != null) params.url = input.url;
    if (input.selector != null) params.selector = input.selector;
    if (input.text != null) params.text = input.text;
    if (input.value != null) params.value = input.value;
    if (input.fields != null && typeof input.fields === 'object') params.fields = input.fields;
    if (input.key != null) params.key = input.key;
    if (input.direction != null) params.direction = input.direction;
    if (input.pixels != null) params.pixels = input.pixels;
    if (input.script != null) params.script = input.script;
    if (input.tabId != null) params.tabId = input.tabId;
    if (input.ms != null) params.ms = input.ms;
    if (input.name != null) params.name = input.name;
    if (input.domain != null) params.domain = input.domain;
    if (input.path != null) params.path = input.path;
    if (input.secure != null) params.secure = input.secure;
    if (input.httpOnly != null) params.httpOnly = input.httpOnly;
    if (input.keys != null) params.keys = input.keys;
    if (input.data != null) params.data = input.data;
    if (input.bypassCache != null) params.bypassCache = input.bypassCache;
    if (input.ops != null) params.ops = input.ops;
    if (input.duration != null) params.duration = input.duration;
    if (input.fromSelector != null) params.from = input.fromSelector;
    if (input.toSelector != null) params.to = input.toSelector;
    // Window, tab, download, history and form controls
    if (input.windowId != null) params.windowId = input.windowId;
    if (input.index != null) params.index = input.index;
    if (input.filename != null) params.filename = input.filename;
    if (input.saveAs != null) params.saveAs = input.saveAs;
    if (input.conflictAction != null) params.conflictAction = input.conflictAction;
    if (input.maxResults != null) params.maxResults = input.maxResults;
    if (input.query != null) params.query = input.query;
    if (input.limit != null) params.limit = input.limit;
    if (input.orderBy != null) params.orderBy = input.orderBy;
    if (input.startTime != null) params.startTime = input.startTime;
    if (input.type != null) params.type = input.type;
    if (input.state != null) params.state = input.state;
    if (input.width != null) params.width = input.width;
    if (input.height != null) params.height = input.height;
    if (input.left != null) params.left = input.left;
    if (input.top != null) params.top = input.top;
    if (input.focused != null) params.focused = input.focused;
    if (input.pinned != null) params.pinned = input.pinned;
    if (input.factor != null) params.factor = input.factor;
    if (input.zoomAction != null) params.action = input.zoomAction;
    if (input.interval != null) params.interval = input.interval;
    if (action === 'click_text' && input.text != null) params.value = input.text;
    if (action === 'click' && input.selector == null && input.text != null) params.text = input.text;

    let result = await bridgeServer.exec(command, params);
    // Auto-retry once if the bridge was temporarily unreachable (extension reconnecting).
    if (!result.ok && result.error?.includes('not connected')) {
      await new Promise((r) => setTimeout(r, 800));
      const retry = await bridgeServer.exec(command, params);
      if (retry.ok) result = retry;
    }
    const payload = result.ok
      ? { ok: true, action, ...(result.data as Record<string, unknown>) }
      : {
          ok: false,
          action,
          error: result.error,
          hint: result.error?.includes('not connected')
            ? 'The Bridge extension is temporarily unreachable. Try Operator (CDP) or Computer as fallback — do not ask the user to fix it unless all fallbacks fail.'
            : undefined,
        };
    return { content: JSON.stringify(payload, null, 2), is_error: !result.ok };
  },
};
