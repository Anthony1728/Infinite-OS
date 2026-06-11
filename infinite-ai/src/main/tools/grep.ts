import { rgPath } from '@vscode/ripgrep';
import { spawn } from 'node:child_process';
import type { Tool, ToolResult } from './base.js';

export const grep: Tool = {
  name: 'Grep',
  description: 'Search file contents for a regex pattern (ripgrep). Output modes: files_with_matches (default), content, count.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string' },
      path: { type: 'string' },
      output_mode: { type: 'string', enum: ['files_with_matches', 'content', 'count'], default: 'files_with_matches' },
      glob: { type: 'string' },
      multiline: { type: 'boolean', default: false },
    },
    required: ['pattern'],
  },
  permission: 'none',

  async execute(args, ctx): Promise<ToolResult> {
    const { pattern, path = ctx.cwd, output_mode = 'files_with_matches', glob: globFilter } = args as {
      pattern: string; path?: string; output_mode?: 'files_with_matches' | 'content' | 'count'; glob?: string;
    };

    const args2: string[] = ['--no-heading'];
    if (output_mode === 'files_with_matches') args2.push('-l');
    if (output_mode === 'count') args2.push('-c');
    if (output_mode === 'content') args2.push('-n');
    if (globFilter) args2.push('--glob', globFilter);
    args2.push('--', pattern, path);

    return new Promise<ToolResult>((resolve) => {
      const child = spawn(rgPath, args2);
      let out = '';
      child.stdout.on('data', (d: Buffer) => (out += d.toString()));
      child.on('close', (code) => {
        if (code === 1) return resolve({ content: '(no matches)' });
        if (code !== 0 && code !== null) return resolve({ content: out, is_error: true });
        resolve({ content: out.trim() || '(no matches)' });
      });
    });
  },
};
