import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc.js';
import {
  gitBranchTool,
  gitCommitTool,
  gitDiffTool,
  gitLogTool,
  gitPullTool,
  gitPushTool,
  gitStatusTool,
} from '../tools/git.js';
import type { Tool, ToolContext } from '../tools/base.js';

/** Register the Git renderer API against the existing, validated Git tools. */
export function registerGitIpc(): void {
  ipcMain.handle(IPC.GIT_STATUS, async (_event, args: { cwd?: string } = {}) =>
    execute(gitStatusTool, args));
  ipcMain.handle(IPC.GIT_LOG, async (_event, args: { cwd?: string; count?: number } = {}) =>
    execute(gitLogTool, args));
  ipcMain.handle(IPC.GIT_COMMIT, async (_event, args: { cwd?: string; message: string; all?: boolean }) =>
    execute(gitCommitTool, args));
  ipcMain.handle(IPC.GIT_BRANCH, async (_event, args: { cwd?: string } = {}) =>
    execute(gitBranchTool, { ...args, list: true }));
  ipcMain.handle(IPC.GIT_PUSH, async (_event, args: {
    cwd?: string;
    remote?: string;
    branch?: string;
    force?: boolean;
  } = {}) => execute(gitPushTool, args));
  ipcMain.handle(IPC.GIT_PULL, async (_event, args: { cwd?: string; remote?: string; rebase?: boolean } = {}) =>
    execute(gitPullTool, args));
  ipcMain.handle(IPC.GIT_DIFF, async (_event, args: { cwd?: string; staged?: boolean; file?: string } = {}) =>
    execute(gitDiffTool, args));
}

function execute(tool: Tool, args: { cwd?: string } & Record<string, unknown>) {
  const context: ToolContext = {
    cwd: args.cwd || process.cwd(),
    sessionId: 'ipc:git',
    abortSignal: new AbortController().signal,
    onUpdate: () => undefined,
  };
  return tool.execute(args, context);
}
