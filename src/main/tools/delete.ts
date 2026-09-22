import { lstat, rm, readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import type { Tool, ToolResult } from './base.js';
import { recordFileMutation } from '../agent/edit-checkpoint.js';

export const deleteTool: Tool = {
  name: 'Delete',
  description:
    'Permanently delete a file or folder. Folder deletion requires recursive=true. Use only when the user explicitly asks to delete the target; inspect the exact path first and never broaden the target.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Exact file or folder path to delete' },
      recursive: { type: 'boolean', description: 'Required for folders' },
    },
    required: ['path'],
  },
  permission: 'ask',

  async execute(args, ctx): Promise<ToolResult> {
    const input = args as { path?: string; recursive?: boolean };
    if (!input.path?.trim()) return { content: 'Delete requires an exact path.', is_error: true };
    const target = isAbsolute(input.path) ? resolve(input.path) : resolve(ctx.cwd, input.path);
    try {
      const stat = await lstat(target);
      if (stat.isDirectory() && !input.recursive) {
        return { content: `Refusing to delete directory ${target} without recursive=true.`, is_error: true };
      }
      const original = stat.isFile() ? await readFile(target, 'utf8').catch(() => undefined) : undefined;
      await rm(target, { recursive: Boolean(input.recursive), force: false });
      if (stat.isFile()) {
        recordFileMutation({ sessionId: ctx.sessionId, path: target, operation: 'delete', originalContent: original, newContent: '' });
      }
      return { content: `Deleted ${target}.` };
    } catch (error) {
      return { content: `Delete failed for ${target}: ${(error as Error).message}`, is_error: true };
    }
  },
};
