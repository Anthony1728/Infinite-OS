// Browser Extension tool — drives the user's real browser through the local
// Infinite OS Bridge extension (fast, DOM-verified control of logged-in pages:
// navigate, click, type, fill forms, extract content, screenshot, tabs, JS).

import type { Tool, ToolResult } from './base.js';
import { bridgeServer } from '../bridge/server.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnWithTimeout } from './spawn-timeout.js';

const ACTIONS = [
  'prepare_install',
  'navigate',
  'inspect',
  'click',
  'click_text',
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
    'PRIMARY browser control — ALWAYS use this FIRST for any web/browser task. Drives the user\'s EXISTING Chrome/Edge via the Infinite OS Bridge extension (localhost:8765). Fast DOM control with logged-in sessions. The tool auto-retries if the extension is temporarily unreachable, then falls back to Operator (CDP) silently. The action enum below is the authoritative list of what it can do.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [...ACTIONS],
        description:
          'What to do. navigate→url; inspect→page state+snapshot+screenshot; click/right_click/highlight/hover/focus/clear→selector; click_text→text; type→selector+text; fill→fields map; press→key; scroll→direction+pixels; extract_text/links/forms→page content; screenshot→base64 PNG; execute_js→script; list_tabs/new_tab/activate_tab/close_tab→tabId; reload/back/forward→history; wait→ms; set_value/get_value→selector+value; get_element/get_elements→selector; select→dropdown option; drag→fromSelector+toSelector; cookie_get/cookie_set→name/domain/path/value; clipboard_read/clipboard_write→text; storage_get→keys, storage_set→data; batch→ops [{op,params}]; console_log→duration ms; get_page_performance→metrics.',
      },
      url: { type: 'string', description: 'URL for navigate/new_tab.' },
      selector: { type: 'string', description: 'CSS selector of the element to act on.' },
      text: { type: 'string', description: 'Visible text to click, or value to type.' },
      value: { type: 'string', description: 'Value to set.' },
      fromSelector: { type: 'string', description: 'CSS selector of the drag source element.' },
      toSelector: { type: 'string', description: 'CSS selector of the drag target element.' },
      fields: {
        type: 'object',
        description: 'Map of selector -> value for fill (e.g. {"#email":"a@b.com","#pass":"secret"}).',
        additionalProperties: { type: 'string' },
      },
      key: { type: 'string', description: 'Key name for press (Enter, Tab, Escape, ArrowDown, ArrowUp, Backspace…).' },
      direction: { type: 'string', enum: ['down', 'up', 'left', 'right', 'top', 'bottom'], description: 'Scroll direction.' },
      pixels: { type: 'number', description: 'Pixels to scroll (optional).' },
      script: { type: 'string', description: 'JavaScript source for execute_js.' },
      tabId: { type: 'number', description: 'Tab id for activate_tab/close_tab/navigate.' },
      ms: { type: 'number', description: 'Milliseconds for wait.' },
      name: { type: 'string', description: 'Cookie name for cookie_get/cookie_set.' },
      domain: { type: 'string', description: 'Cookie domain for cookie_set.' },
      path: { type: 'string', description: 'Cookie path for cookie_set.' },
      secure: { type: 'boolean', description: 'Cookie secure flag for cookie_set.' },
      httpOnly: { type: 'boolean', description: 'Cookie httpOnly flag for cookie_set.' },
      keys: { type: 'array', items: { type: 'string' }, description: 'Storage keys for storage_get.' },
      data: { type: 'object', description: 'Data for storage_set or cookie_set value.' },
      bypassCache: { type: 'boolean', description: 'Bypass cache for reload.' },
      ops: {
        type: 'array',
        description: 'Array of {op, params} for batch (e.g. [{"op":"click","params":{"selector":"#btn"}},{"op":"type","params":{"selector":"#input","text":"hello"}}]).',
        items: {
          type: 'object',
          properties: {
            op: { type: 'string' },
            params: { type: 'object' },
          },
        },
      },
      duration: { type: 'number', description: 'Duration in ms for console_log capture (100-10000, default 2000).' },
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
      const root = process.cwd();
      const script = join(root, 'scripts', 'install-extension.ps1');
      if (!existsSync(script)) return { content: `Extension installer not found at ${script}`, is_error: true };
      const result = await spawnWithTimeout({
        command: 'powershell.exe',
        args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script],
        cwd: root,
        timeoutMs: 120_000,
        windowsHide: true,
      });
      if (result.timedOut || result.exitCode !== 0) {
        return { content: result.stderr || result.stdout || 'Extension preparation failed.', is_error: true };
      }
      const extensionPath = join(process.env.USERPROFILE ?? root, '.infinite-ai', 'extensions', 'infinite-os-bridge');
      return {
        content: JSON.stringify({
          prepared: true,
          extensionPath,
          next: [
            'Open chrome://extensions in Chrome.',
            'Enable Developer mode.',
            `Click Load unpacked and choose ${extensionPath}.`,
            'Use Computer visual_observe and visual_click to complete and verify installation.',
          ],
          output: result.stdout.slice(-4_000),
        }, null, 2),
      };
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
