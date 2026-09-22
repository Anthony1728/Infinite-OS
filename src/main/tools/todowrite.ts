import type { Tool, ToolResult } from './base.js';
import { getTodos, setTodos, type TodoItem } from '../agent/todo-store.js';

export const todowrite: Tool = {
  name: 'TodoWrite',
  description: 'Manage the persistent in-session task checklist. Pass an array of {status, content, activeForm} items to set the full list. The plan persists across turns and renders live for the user.',
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

  async execute(args, ctx): Promise<ToolResult> {
    const { items } = args as { items: TodoItem[] };
    const saved = setTodos(ctx.sessionId, Array.isArray(items) ? items : []);
    const done = saved.filter((i) => i.status === 'completed').length;
    return { content: `Todo list updated: ${saved.length} items (${done} completed, ${saved.length - done} open). Keep exactly one item in_progress and update after each step.` };
  },
};

export const todoread: Tool = {
  name: 'TodoRead',
  description: 'Read the current session task checklist. Use at the start of resuming multi-step work to recover the plan and what remains.',
  inputSchema: { type: 'object', properties: {} },
  permission: 'none',

  async execute(_args, ctx): Promise<ToolResult> {
    const items = getTodos(ctx.sessionId);
    if (!items.length) return { content: 'No todos yet for this session. Plan multi-step work with TodoWrite.' };
    const lines = items.map((i) => `[${i.status}] ${i.content}`);
    return { content: `Session todos:\n${lines.join('\n')}` };
  },
};
