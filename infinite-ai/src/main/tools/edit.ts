import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Tool, ToolResult } from './base.js';

export const edit: Tool = {
  name: 'Edit',
  description: 'Perform exact string replacement in a file. old_string must appear exactly once unless replace_all is true.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string' },
      old_string: { type: 'string' },
      new_string: { type: 'string' },
      replace_all: { type: 'boolean', default: false },
    },
    required: ['file_path', 'old_string', 'new_string'],
  },
  permission: 'ask',

  async execute(args, ctx): Promise<ToolResult> {
    const { file_path, old_string, new_string, replace_all = false } = args as {
      file_path: string; old_string: string; new_string: string; replace_all?: boolean;
    };
    const abs = resolve(ctx.cwd, file_path);
    const original = await readFile(abs, 'utf8');

    let updated: string;
    if (replace_all) {
      updated = original.split(old_string).join(new_string);
    } else {
      const occurrences = original.split(old_string).length - 1;
      if (occurrences === 0) return { content: `old_string not found in ${file_path}`, is_error: true };
      if (occurrences > 1) return { content: `old_string appears ${occurrences} times; supply more context or use replace_all`, is_error: true };
      updated = original.replace(old_string, new_string);
    }

    await writeFile(abs, updated, 'utf8');
    return { content: `Edited ${file_path}` };
  },
};
