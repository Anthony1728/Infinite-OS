import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Tool, ToolResult } from './base.js';

const IMAGE_MIMES = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

export const read: Tool = {
  name: 'Read',
  description: 'Read the contents of a file. Supports images (returns visual content) and PDFs. Use offset/limit for large files.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path to the file (absolute or relative to cwd)' },
      offset: { type: 'number', description: 'Line number to start from (1-indexed)' },
      limit: { type: 'number', description: 'Max number of lines to read' },
    },
    required: ['file_path'],
  },
  permission: 'none',

  async execute(args, ctx): Promise<ToolResult> {
    const { file_path, offset = 0, limit } = args as { file_path: string; offset?: number; limit?: number };
    try {
      const abs = resolve(ctx.cwd, file_path);
      const ext = abs.slice(abs.lastIndexOf('.')).toLowerCase();

      if (IMAGE_MIMES.has(ext)) {
        const buf = await readFile(abs);
        return {
          content: [{
            type: 'image',
            source: {
              type: 'base64',
              mediaType: `image/${ext.slice(1)}`,
              data: buf.toString('base64'),
            },
          }],
        };
      }

      const raw = await readFile(abs, 'utf8');
      const lines = raw.split('\n');
      const start = Math.max(0, offset);
      const slice = limit ? lines.slice(start, start + limit) : lines.slice(start);
      const numbered = slice.map((l, i) => `${(start + i + 1).toString().padStart(5)}\t${l}`).join('\n');
      return { content: numbered || '(empty file)' };
    } catch (e) {
      return { content: `Error reading ${file_path}: ${(e as Error).message}`, is_error: true };
    }
  },
};

