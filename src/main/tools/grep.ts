import { rgPath } from '@vscode/ripgrep';
import { spawnWithTimeout } from './spawn-timeout.js';
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

    const result = await spawnWithTimeout({
      command: rgPath,
      args: rgArgs,
      timeoutMs: 60_000,
      signal: ctx.abortSignal,
    });
    if (result.timedOut) {
      return { content: 'Grep timed out after 60 seconds; the search may be too broad or the directory too large.', is_error: true };
    }
    if (result.exitCode === 1) return { content: '(no matches)' };
    if (result.exitCode !== 0 && result.exitCode !== null) {
      return { content: result.stderr || result.stdout || `ripgrep exited with code ${result.exitCode}`, is_error: true };
    }
    return { content: result.stdout.trim() || '(no matches)' };
  },
};

