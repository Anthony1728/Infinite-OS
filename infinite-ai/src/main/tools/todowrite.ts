import type { Tool, ToolResult } from './base.js';

// In-session checklist. State lives in the session store; this tool just appends entries.

export const todowrite: Tool = {
  name: 'TodoWrite',
  description: 'Manage the in-session task checklist. Pass an array of {status, content, activeForm} items to set the list.',
  inputSchema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
            content: { type: 'string' },
            activeForm: { type: 'string' },
          },
          required: ['status', 'content'],
        },
      },
    },
    required: ['items'],
  },
  permission: 'none',

  async execute(args): Promise<ToolResult> {
    const { items } = args as { items: { status: string; content: string; activeForm?: string }[] };
    // Renderer subscribes to a side channel to render the todo list.
    return { content: items.map((i) => `[${i.status}] ${i.content}`).join('\n') };
  },
};
