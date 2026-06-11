import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Tool, ToolResult } from './base.js';

export const write: Tool = {
  name: 'Write',
  description: 'Create a new file or overwrite an existing file with the given content.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Absolute path to the file' },
      content: { type: 'string', description: 'The full file content' },
    },
    required: ['file_path', 'content'],
  },
  permission: 'ask',

  async execute(args, ctx): Promise<ToolResult> {
    const { file_path, content } = args as { file_path: string; content: string };
    const abs = resolve(ctx.cwd, file_path);
    await writeFile(abs, content, 'utf8');
    return { content: `Wrote ${content.length} bytes to ${file_path}` };
  },
};
