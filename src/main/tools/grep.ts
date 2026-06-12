import { rgPath } from '@vscode/ripgrep';
import { spawn } from 'node:child_process';
import type { Tool, ToolResult } from './base.js';

export const grep: Tool = {
  name: 'Grep',
  description: 'Search file contents for a regex pattern (ripgrep). Output modes: files_with_matches (default), content, count.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regex pattern to search for' },
      path: { type: 'string', description: 'File or directory to search (defaults to cwd)' },
      output_mode: { type: 'string', enum: ['files_with_matches', 'content', 'count'], default: 'files_with_matches' },
      glob: { type: 'string', description: 'Glob filter for file names, e.g. "*.ts"' },
    },
    required: ['pattern'],
  },
  permission: 'none',

  async execute(args, ctx): Promise<ToolResult> {
    const { pattern, path = ctx.cwd, output_mode = 'files_with_matches', glob: globFilter } = args as {
      pattern: string; path?: string; output_mode?: 'files_with_matches' | 'content' | 'count'; glob?: string;
    };

    const rgArgs: string[] = ['--no-heading', '--color=never'];
    if (output_mode === 'files_with_matches') rgArgs.push('-l');
    if (output_mode === 'count') rgArgs.push('-c');
    if (output_mode === 'content') rgArgs.push('-n');
    if (globFilter) rgArgs.push('--glob', globFilter);
    rgArgs.push('--', pattern, path);

    return new Promise<ToolResult>((resolve) => {
      try {
        const child = spawn(rgPath, rgArgs);
        let out = '';
        let err = '';
        child.stdout.on('data', (d: Buffer) => (out += d.toString()));
        child.stderr.on('data', (d: Buffer) => (err += d.toString()));
        child.on('error', (e) => resolve({ content: `Grep error: ${e.message}`, is_error: true }));
        child.on('close', (code) => {
          if (code === 1) return resolve({ content: '(no matches)' });
          if (code !== 0 && code !== null) {
            return resolve({ content: err || out || `ripgrep exited with code ${code}`, is_error: true });
          }
          resolve({ content: out.trim() || '(no matches)' });
        });
      } catch (e) {
        resolve({ content: `Grep error: ${(e as Error).message}`, is_error: true });
      }
    });
  },
};
