import { cp, mkdir, readdir, rename, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnWithTimeout } from './spawn-timeout.js';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import type { Tool, ToolResult } from './base.js';

export const fileOpsTool: Tool = {
  name: 'FileOps',
  description: 'Manage files and folders: list, inspect, create folders, copy, move/rename, compress ZIP archives, and extract ZIP archives. Uses exact paths and refuses accidental overwrites.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'stat', 'mkdir', 'copy', 'move', 'compress', 'extract'] },
      path: { type: 'string', description: 'Source or target path' },
      destination: { type: 'string', description: 'Destination for copy, move, compress, or extract' },
      recursive: { type: 'boolean', description: 'Copy directories recursively' },
    },
    required: ['action', 'path'],
  },
  permission: 'ask',

  async execute(args, ctx): Promise<ToolResult> {
    const input = args as { action: string; path?: string; destination?: string; recursive?: boolean };
    const source = absolute(input.path ?? ctx.cwd, ctx.cwd);
    const destination = input.destination ? absolute(input.destination, ctx.cwd) : undefined;
    try {
      if (input.action === 'list') {
        const entries = await readdir(source, { withFileTypes: true });
        return { content: JSON.stringify(entries.map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' })), null, 2) };
      }
      if (input.action === 'stat') {
        const value = await stat(source);
        return { content: JSON.stringify({ path: source, name: basename(source), directory: value.isDirectory(), size: value.size, created: value.birthtime, modified: value.mtime }, null, 2) };
      }
      if (input.action === 'mkdir') {
        await mkdir(source, { recursive: true });
        return { content: `Created directory ${source}.` };
      }
      if (!destination) return fail(`${input.action} requires destination.`);
      if (existsSync(destination)) return fail(`Destination already exists: ${destination}`);
      await mkdir(dirname(destination), { recursive: true });
      if (input.action === 'copy') {
        const value = await stat(source);
        if (value.isDirectory() && !input.recursive) return fail('Directory copy requires recursive=true.');
        await cp(source, destination, { recursive: Boolean(input.recursive), force: false, errorOnExist: true });
        const copied = await stat(destination);
        return { content: `Copied ${source} to ${destination}. Verified ${copied.isDirectory() ? 'directory' : 'file'} destination.` };
      }
      if (input.action === 'move') {
        try { await rename(source, destination); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
          await cp(source, destination, { recursive: true, force: false, errorOnExist: true });
          const { rm } = await import('node:fs/promises');
          await rm(source, { recursive: true });
        }
        const moved = await stat(destination);
        if (existsSync(source)) return fail(`Move verification failed: source still exists at ${source}.`);
        return { content: `Moved ${source} to ${destination}. Verified ${moved.isDirectory() ? 'directory' : 'file'} destination and source removal.` };
      }
      if (process.platform !== 'win32') return fail('ZIP operations currently require Windows PowerShell.');
      if (input.action === 'compress') {
        return await powershell(`Compress-Archive -LiteralPath '${ps(source)}' -DestinationPath '${ps(destination)}' -CompressionLevel Optimal -ErrorAction Stop`, `Created archive ${destination}.`, ctx.abortSignal);
      }
      if (input.action === 'extract') {
        await mkdir(destination, { recursive: true });
        return await powershell(`Expand-Archive -LiteralPath '${ps(source)}' -DestinationPath '${ps(destination)}' -ErrorAction Stop`, `Extracted ${source} to ${destination}.`, ctx.abortSignal);
      }
      return fail(`Unknown FileOps action: ${input.action}`);
    } catch (error) {
      return fail(`File operation failed: ${(error as Error).message}`);
    }
  },
};

function absolute(path: string, cwd: string): string { return isAbsolute(path) ? resolve(path) : resolve(cwd, path); }
function ps(value: string): string { return value.replace(/'/g, "''"); }
function fail(content: string): ToolResult { return { content, is_error: true }; }
async function powershell(command: string, success: string, signal?: AbortSignal): Promise<ToolResult> {
  const result = await spawnWithTimeout({
    command: 'powershell.exe',
    args: ['-NoProfile', '-Command', command],
    timeoutMs: 120_000,
    signal,
  });
  if (result.timedOut) return fail('PowerShell operation timed out after 120 seconds.');
  return result.exitCode === 0 ? { content: success } : fail(result.stdout + result.stderr || `PowerShell exited ${result.exitCode}`);
}
