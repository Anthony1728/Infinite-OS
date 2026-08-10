import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import type { Tool, ToolResult } from './base.js';

export const write: Tool = {
  name: 'Write',
  description: 'Create a new file or overwrite an existing file with the given content. Automatically creates parent directories.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path to the file (absolute or relative to cwd)' },
      content: { type: 'string', description: 'The full file content' },
    },
    required: ['file_path', 'content'],
  },
  permission: 'ask',

  async execute(args, ctx): Promise<ToolResult> {
    const { file_path, content } = args as { file_path: string; content: string };
    try {
      const abs = resolve(ctx.cwd, file_path);
      const signal = ctx.abortSignal;
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content, { encoding: 'utf8', ...(signal ? { signal } : {}) });
      return { content: `Wrote ${content.length} bytes to ${file_path}` };
    } catch (e) {
      return { content: `Error writing ${file_path}: ${(e as Error).message}`, is_error: true };
    }
  },
};

