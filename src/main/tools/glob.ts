import { glob as tinyGlob } from 'tinyglobby';
import type { Tool, ToolResult } from './base.js';

export const glob: Tool = {
  name: 'Glob',
  description: 'Find files by glob pattern. Supports ** for recursive matching. Returns absolute file paths.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern, e.g. "src/**/*.ts"' },
      cwd: { type: 'string', description: 'Directory to search in (defaults to working directory)' },
    },
    required: ['pattern'],
  },
  permission: 'none',

  async execute(args, ctx): Promise<ToolResult> {
    const { pattern, cwd = ctx.cwd } = args as { pattern: string; cwd?: string };
    try {
      const matches = await tinyGlob(pattern, { cwd, absolute: true, onlyFiles: true });
      return { content: matches.join('\n') || '(no matches)' };
    } catch (e) {
      return { content: `Glob error: ${(e as Error).message}`, is_error: true };
    }
  },
};
