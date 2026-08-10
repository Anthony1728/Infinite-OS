import type { Tool, ToolResult } from './base.js';
import { browserOperator } from '../operator/browser-operator.js';

export const operatorTool: Tool = {
  name: 'Operator',
  description:
    'Operate Chrome through verified CDP automation. In smart display mode it uses visible Chrome while Infinite OS is windowed and a separate hidden/headless Chrome profile while Infinite OS is full screen. Physical mouse/keyboard fallback is only allowed in visible mode. Prefer this over URL-opening shortcuts.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['navigate', 'search_amazon', 'inspect', 'click', 'type'] },
      url: { type: 'string', description: 'URL for navigate' },
      query: { type: 'string', description: 'Search terms for search_amazon' },
      selector: { type: 'string', description: 'CSS selector for click or type' },
      text: { type: 'string', description: 'Text to type into a selector' },
    },
    required: ['action'],
  },
  permission: 'ask',

  async execute(args): Promise<ToolResult> {
    const input = args as { action: 'navigate' | 'search_amazon' | 'inspect' | 'click' | 'type'; url?: string; query?: string; selector?: string; text?: string };
    const result = input.action === 'inspect'
      ? await browserOperator.inspect()
      : input.action === 'click'
        ? input.selector ? await browserOperator.click(input.selector) : { ok: false, error: 'selector is required', steps: [], mode: 'cdp', action: input.action }
        : input.action === 'type'
          ? input.selector && input.text ? await browserOperator.type(input.selector, input.text) : { ok: false, error: 'selector and text are required', steps: [], mode: 'cdp', action: input.action }
      : input.action === 'search_amazon'
      ? input.query
        ? await browserOperator.searchAmazon(input.query)
        : { ok: false, error: 'query is required', steps: [], mode: 'cdp', action: input.action }
      : input.url
        ? await browserOperator.navigate(input.url)
        : { ok: false, error: 'url is required', steps: [], mode: 'cdp', action: input.action };
    return { content: JSON.stringify(result, null, 2), is_error: !result.ok };
  },
};
