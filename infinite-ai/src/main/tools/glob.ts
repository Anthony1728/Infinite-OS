import { glob as tinyGlob } from 'tinyglobby';
import type { Tool, ToolResult } from './base.js';

export const glob: Tool = {
  name: 'Glob',
  description: 'Find files by pattern. Supports ** for recursive matching. Results sorted by modification time.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern, e.g. "src/**/*.ts"' },
      cwd: { type: 'string' },
    },
    required: ['pattern'],
  },
  permission: 'none',

  async execute(args, ctx): Promise<ToolResult> {
    const { pattern, cwd = ctx.cwd } = args as { pattern: string; cwd?: string };
    const matches = await tinyGlob(pattern, { cwd, absolute: true, onlyFiles: true });
    return { content: matches.join('\n') || '(no matches)' };
  },
};
