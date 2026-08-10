/**
 * Git Integration Tool
 * 
 * Provides comprehensive Git operations for repository management.
 * Supports: clone, init, commit, push, pull, branch, merge, log, diff, status, stash, tag, fetch, rebase
 */

import { spawnWithTimeout } from './spawn-timeout.js';
import type { Tool, ToolResult, ToolContext } from './base.js';

interface GitBaseArgs {
  cwd?: string;
  repo?: string;
}

interface GitCommitArgs extends GitBaseArgs {
  message: string;
  all?: boolean;
  amend?: boolean;
}

interface GitPushArgs extends GitBaseArgs {
  remote?: string;
  branch?: string;
  force?: boolean;
  tags?: boolean;
  setUpstream?: boolean;
}

interface GitPullArgs extends GitBaseArgs {
  remote?: string;
  branch?: string;
  rebase?: boolean;
}

interface GitBranchArgs extends GitBaseArgs {
  list?: boolean;
  create?: string;
  delete?: string;
  current?: boolean;
}

interface GitLogArgs extends GitBaseArgs {
  count?: number;
  file?: string;
  author?: string;
  since?: string;
  until?: string;
}

interface GitDiffArgs extends GitBaseArgs {
  staged?: boolean;
  file?: string;
  stat?: boolean;
}

interface GitArgs {
  command: string;
  cwd?: string;
  flags?: string[];
  timeoutMs?: number;
  signal?: AbortSignal;
}

function checkGitResult(result: { stdout: string; stderr: string; exitCode: number; timedOut: boolean }): ToolResult | null {
  if (result.timedOut) return { content: 'Git command timed out after 120 seconds.', is_error: true };
  if (result.exitCode !== 0) return { content: result.stderr || result.stdout, is_error: true };
  return null;
}

/**
 * Execute a git command
 */
async function runGitCommand(args: GitArgs): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
  const { command, cwd = process.cwd(), flags = [], timeoutMs = 120_000, signal } = args;

  const result = await spawnWithTimeout({
    command: 'git',
    args: [command, ...flags],
    cwd,
    timeoutMs,
    signal,
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode ?? 0,
    timedOut: result.timedOut,
  };
}

/**
 * Generic Git command tool - accepts any git command
 */
export const gitTool: Tool = {
  name: 'Git',
  description: 'Execute Git commands. Supports: clone, init, commit, push, pull, branch, checkout, merge, log, diff, status, stash, tag, fetch, rebase, remote, reset, revert, clean, and more.',
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Git command to execute (e.g., "status", "log", "commit -m message")',
      },
      cwd: {
        type: 'string',
        description: 'Working directory (repository path)',
      },
    },
    required: ['command'],
  },
  permission: 'ask',

  async execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
    try {
      const { command, cwd = ctx.cwd } = args as { command: string; cwd?: string };
      
      // Parse command and flags
      const parts = command.trim().split(/\s+/);
      const subCommand = parts[0];
      const flags = parts.slice(1);

      // Validate it's a git command
      const allowedCommands = [
        'status', 'log', 'diff', 'add', 'commit', 'push', 'pull', 'fetch', 'clone', 'init',
        'branch', 'checkout', 'merge', 'rebase', 'stash', 'tag', 'remote', 'reset', 'revert',
        'clean', 'rm', 'mv', 'cp', 'show', 'describe', 'rev-parse', 'rev-list', 'shortlog',
        'blame', 'cherry-pick', 'bisect', 'archive', 'bundle', 'grep', 'ls-files', 'ls-tree',
        'cat-file', 'hash-object', 'update-index', 'config', 'help'
      ];

      if (!allowedCommands.includes(subCommand)) {
        return { content: `Git command '${subCommand}' is not allowed. Allowed commands: ${allowedCommands.join(', ')}`, is_error: true };
      }

      // Handle specific commands with better output formatting
      switch (subCommand) {
        case 'status': {
          const result = await runGitCommand({ command: 'status', cwd, flags: ['--porcelain', '-sb'] });
          const gitError = checkGitResult(result);
          if (gitError) return gitError;
          return { content: formatStatusOutput(result.stdout) };
        }

        case 'log': {
          const logFlags = [...flags];
          if (!logFlags.some(f => f.includes('--format'))) {
            logFlags.push('--format=%H|%an|%ae|%at|%s');
          }
          const result = await runGitCommand({ command: 'log', cwd, flags: logFlags });
          const gitError = checkGitResult(result);
          if (gitError) return gitError;
          return { content: formatLogOutput(result.stdout) };
        }

        case 'diff': {
          const result = await runGitCommand({ command: 'diff', cwd, flags });
          const gitError = checkGitResult(result);
          if (gitError) return gitError;
          return { content: result.stdout || '(no changes)' };
        }

        case 'branch': {
          const result = await runGitCommand({ command: 'branch', cwd, flags: ['-a', ...flags] });
          const gitError = checkGitResult(result);
          if (gitError) return gitError;
          return { content: formatBranchOutput(result.stdout) };
        }

        default: {
          const result = await runGitCommand({ command: subCommand, cwd, flags });
          const gitError = checkGitResult(result);
          if (gitError) return gitError;
          return { content: result.stdout || 'Command executed successfully' };
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: `Git error: ${message}`, is_error: true };
    }
  },
};

/**
 * Git Status - quick repository status check
 */
export const gitStatusTool: Tool = {
  name: 'GitStatus',
  description: 'Get the current status of a Git repository including staged, modified, and untracked files',
  inputSchema: {
    type: 'object',
    properties: {
      cwd: {
        type: 'string',
        description: 'Repository path',
      },
      short: {
        type: 'boolean',
        description: 'Use short format',
        default: true,
      },
    },
  },
  permission: 'none',

  async execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
    try {
      const { cwd = ctx.cwd, short = true } = args as { cwd?: string; short?: boolean };

      const flags = short ? ['--porcelain', '-sb'] : [];
      const result = await runGitCommand({ command: 'status', cwd, flags });
      if (result.timedOut) {
        return { content: 'Git status timed out after 120 seconds.', is_error: true };
      }
      if (result.exitCode !== 0) {
        if (result.stderr.includes('Not a git repository')) {
          return { content: 'Not a Git repository', is_error: true };
        }
        return { content: result.stderr, is_error: true };
      }

      return { content: formatStatusOutput(result.stdout) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: `Git status error: ${message}`, is_error: true };
    }
  },
};

/**
 * Git Log - commit history
 */
export const gitLogTool: Tool = {
  name: 'GitLog',
  description: 'View commit history with author, date, and message',
  inputSchema: {
    type: 'object',
    properties: {
      cwd: {
        type: 'string',
        description: 'Repository path',
      },
      count: {
        type: 'number',
        description: 'Number of commits to show',
        default: 10,
      },
      file: {
        type: 'string',
        description: 'Show only commits affecting this file',
      },
      author: {
        type: 'string',
        description: 'Filter by author',
      },
      since: {
        type: 'string',
        description: 'Show commits since date',
      },
      until: {
        type: 'string',
        description: 'Show commits until date',
      },
    },
  },
  permission: 'none',

  async execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
    try {
      const { cwd = ctx.cwd, count = 10, file, author, since, until } = args as GitLogArgs;

      const flags = [`--format=%H|%an|%ae|%at|%s`, `-n`, String(count)];
      
      if (file) flags.push('--', file);
      if (author) flags.push(`--author=${author}`);
      if (since) flags.push(`--since=${since}`);
      if (until) flags.push(`--until=${until}`);

      const result = await runGitCommand({ command: 'log', cwd, flags });

      const gitError = checkGitResult(result);
      if (gitError) return gitError;

      return { content: formatLogOutput(result.stdout) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: `Git log error: ${message}`, is_error: true };
    }
  },
};

/**
 * Git Commit - create a commit
 */
export const gitCommitTool: Tool = {
  name: 'GitCommit',
  description: 'Create a new commit with a message. Use all=true to stage all changes.',
  inputSchema: {
    type: 'object',
    properties: {
      cwd: {
        type: 'string',
        description: 'Repository path',
      },
      message: {
        type: 'string',
        description: 'Commit message',
      },
      all: {
        type: 'boolean',
        description: 'Stage all modified files',
        default: false,
      },
      amend: {
        type: 'boolean',
        description: 'Amend the previous commit',
        default: false,
      },
    },
    required: ['message'],
  },
  permission: 'ask',

  async execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
    try {
      const { cwd = ctx.cwd, message, all = false, amend = false } = args as GitCommitArgs;

      if (!message || message.trim().length === 0) {
        return { content: 'Commit message is required', is_error: true };
      }

      const flags: string[] = ['-m', message];
      if (all) flags.push('-a');
      if (amend) flags.push('--amend');

      const result = await runGitCommand({ command: 'commit', cwd, flags });

      const gitError = checkGitResult(result);
      if (gitError) return gitError;

      return { content: result.stdout || 'Commit created successfully' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: `Git commit error: ${message}`, is_error: true };
    }
  },
};

/**
 * Git Branch - list, create, delete branches
 */
export const gitBranchTool: Tool = {
  name: 'GitBranch',
  description: 'List, create, delete, or rename branches',
  inputSchema: {
    type: 'object',
    properties: {
      cwd: {
        type: 'string',
        description: 'Repository path',
      },
      list: {
        type: 'boolean',
        description: 'List all branches',
        default: true,
      },
      create: {
        type: 'string',
        description: 'Create a new branch',
      },
      delete: {
        type: 'string',
        description: 'Delete a branch',
      },
      current: {
        type: 'boolean',
        description: 'Show only current branch',
      },
    },
  },
  permission: 'ask',

  async execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
    try {
      const { cwd = ctx.cwd, list = true, create, delete: deleteBranch, current } = args as GitBranchArgs;

      let flags: string[] = [];
      let command = 'branch';

      if (current) {
        const result = await runGitCommand({ command: 'rev-parse', cwd, flags: ['--abbrev-ref', 'HEAD'] });
        const gitError = checkGitResult(result);
        if (gitError) return { content: result.exitCode !== 0 ? 'Not on a branch' : gitError.content, is_error: true };
        return { content: `Current branch: ${result.stdout.trim()}` };
      }

      if (deleteBranch) {
        flags = ['-D', deleteBranch];
        const result = await runGitCommand({ command, cwd, flags });
        const gitError = checkGitResult(result);
        if (gitError) return gitError;
        return { content: `Deleted branch: ${deleteBranch}` };
      }

      if (create) {
        command = 'checkout';
        flags = ['-b', create];
        const result = await runGitCommand({ command, cwd, flags });
        const gitError = checkGitResult(result);
        if (gitError) return gitError;
        return { content: `Created and switched to branch: ${create}` };
      }

      if (list) {
        flags = ['-a'];
        const result = await runGitCommand({ command, cwd, flags });
        const gitError = checkGitResult(result);
        if (gitError) return gitError;
        return { content: formatBranchOutput(result.stdout) };
      }

      return { content: 'Use list=true, create=<name>, or delete=<name>', is_error: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: `Git branch error: ${message}`, is_error: true };
    }
  },
};

/**
 * Git Push - push commits to remote
 */
export const gitPushTool: Tool = {
  name: 'GitPush',
  description: 'Push commits to a remote repository',
  inputSchema: {
    type: 'object',
    properties: {
      cwd: {
        type: 'string',
        description: 'Repository path',
      },
      remote: {
        type: 'string',
        description: 'Remote name',
        default: 'origin',
      },
      branch: {
        type: 'string',
        description: 'Branch to push',
      },
      force: {
        type: 'boolean',
        description: 'Force push',
        default: false,
      },
      tags: {
        type: 'boolean',
        description: 'Push tags',
        default: false,
      },
      setUpstream: {
        type: 'boolean',
        description: 'Set upstream tracking',
        default: false,
      },
    },
  },
  permission: 'ask',

  async execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
    try {
      const { cwd = ctx.cwd, remote = 'origin', branch, force = false, tags = false, setUpstream = false } = args as GitPushArgs;

      const flags: string[] = [];
      if (force) flags.push('--force');
      if (tags) flags.push('--tags');
      if (setUpstream) flags.push('-u');
      
      flags.push(remote);
      if (branch) flags.push(branch);

      const result = await runGitCommand({ command: 'push', cwd, flags });

      const gitError = checkGitResult(result);
      if (gitError) return gitError;

      return { content: result.stdout || 'Pushed successfully' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: `Git push error: ${message}`, is_error: true };
    }
  },
};

/**
 * Git Pull - pull from remote
 */
export const gitPullTool: Tool = {
  name: 'GitPull',
  description: 'Pull changes from a remote repository',
  inputSchema: {
    type: 'object',
    properties: {
      cwd: {
        type: 'string',
        description: 'Repository path',
      },
      remote: {
        type: 'string',
        description: 'Remote name',
        default: 'origin',
      },
      branch: {
        type: 'string',
        description: 'Branch to pull',
      },
      rebase: {
        type: 'boolean',
        description: 'Rebase instead of merge',
        default: false,
      },
    },
  },
  permission: 'ask',

  async execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
    try {
      const { cwd = ctx.cwd, remote = 'origin', branch, rebase = false } = args as GitPullArgs;

      const flags: string[] = [];
      if (rebase) flags.push('--rebase');
      flags.push(remote);
      if (branch) flags.push(branch);

      const result = await runGitCommand({ command: 'pull', cwd, flags });

      const gitError = checkGitResult(result);
      if (gitError) return gitError;

      return { content: result.stdout || 'Pulled successfully' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: `Git pull error: ${message}`, is_error: true };
    }
  },
};

/**
 * Git Diff - show changes
 */
export const gitDiffTool: Tool = {
  name: 'GitDiff',
  description: 'Show changes between commits, working tree, etc.',
  inputSchema: {
    type: 'object',
    properties: {
      cwd: {
        type: 'string',
        description: 'Repository path',
      },
      staged: {
        type: 'boolean',
        description: 'Show staged changes',
        default: false,
      },
      file: {
        type: 'string',
        description: 'Show diff for specific file',
      },
      stat: {
        type: 'boolean',
        description: 'Show diffstat only',
        default: false,
      },
    },
  },
  permission: 'none',

  async execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
    try {
      const { cwd = ctx.cwd, staged = false, file, stat = false } = args as GitDiffArgs;

      const flags: string[] = [];
      if (staged) flags.push('--cached');
      if (stat) flags.push('--stat');
      if (file) flags.push('--', file);

      const result = await runGitCommand({ command: 'diff', cwd, flags });

      const gitError = checkGitResult(result);
      if (gitError) return gitError;

      return { content: result.stdout || (staged ? '(no staged changes)' : '(no changes)') };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: `Git diff error: ${message}`, is_error: true };
    }
  },
};

// Output formatters

function formatStatusOutput(output: string): string {
  if (!output.trim()) return '✅ Working tree clean';
  
  const lines = output.split('\n').filter(l => l.trim());
  const result: string[] = ['📊 Git Status:'];
  
  const branchLine = lines.find(l => l.startsWith('## '));
  if (branchLine) {
    result.push(branchLine);
  }
  
  const staged: string[] = [];
  const modified: string[] = [];
  const untracked: string[] = [];
  const deleted: string[] = [];
  
  for (const line of lines) {
    if (!line.startsWith('## ')) {
      const status = line.slice(0, 2);
      const file = line.slice(3);
      
      if (status.includes('?')) untracked.push(file);
      else if (status.includes('D')) deleted.push(file);
      else if (status.includes('M') || status.includes('A')) {
        staged.push(`${status} ${file}`);
      } else {
        modified.push(`${status} ${file}`);
      }
    }
  }
  
  if (staged.length) result.push(`\n📦 Staged:\n  ${staged.join('\n  ')}`);
  if (modified.length) result.push(`\n✏️  Modified:\n  ${modified.join('\n  ')}`);
  if (deleted.length) result.push(`\n🗑️  Deleted:\n  ${deleted.join('\n  ')}`);
  if (untracked.length) result.push(`\n❓ Untracked:\n  ${untracked.join('\n  ')}`);
  
  return result.join('\n');
}

function formatLogOutput(output: string): string {
  if (!output.trim()) return 'No commits found';
  
  const lines = output.split('\n').filter(l => l.trim());
  const result: string[] = ['📜 Commit History:'];
  
  for (const line of lines) {
    const parts = line.split('|');
    if (parts.length >= 5) {
      const hash = parts[0].slice(0, 7);
      const author = parts[1];
      const date = new Date(parseInt(parts[3]) * 1000).toLocaleDateString();
      const message = parts[4];
      result.push(`\n🔹 ${hash} - ${author} (${date})\n   ${message}`);
    }
  }
  
  return result.join('\n');
}

function formatBranchOutput(output: string): string {
  if (!output.trim()) return 'No branches found';
  
  const lines = output.split('\n').filter(l => l.trim());
  const current = lines.find(l => l.startsWith('*'));
  const others = lines.filter(l => !l.startsWith('*'));
  
  const result = ['🌿 Branches:'];
  
  if (current) {
    result.push(`  ${current.replace(/^\* /, '👉 ')}`);
  }
  
  for (const branch of others) {
    result.push(`  ${branch.trim()}`);
  }
  
  return result.join('\n');
}
