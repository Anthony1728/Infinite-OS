import { cp, mkdir, readdir, rename, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnWithTimeout } from './spawn-timeout.js';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { guardSelfModification } from '../agent/self-modification.js';
import { findInfiniteRepoRoot } from './backup.js';
import type { Tool, ToolResult } from './base.js';

/**
 * Resolve one archive entry against the extraction destination.
 *
 * Returns the path the entry would actually be written to, or `null` when the
 * entry tries to escape the destination folder — the "zip slip" problem. A
 * crafted archive can name an entry `../../src/main/audit/x.ts` and land a file
 * anywhere on the disk the process can write to.
 *
 * Checked here rather than trusted to `Expand-Archive`, because the
 * destination was the only thing validated before: an archive could write
 * outside the folder it was pointed at, including over the protected files
 * that implement the user's undo.
 *
 * Exported so the rule can be tested directly, without building an archive.
 */
export function resolveExtractTarget(destination: string, entryName: string): string | null {
  // ZIP always uses forward slashes; a backslash is a literal character in the
  // name and must not be treated as a separator, or `..\` would slip through.
  const name = entryName.replace(/\\/g, '/');

  // Absolute paths, drive letters and UNC paths are all escapes, not entries.
  if (name.startsWith('/')) return null;
  if (/^[A-Za-z]:/.test(name)) return null;

  const root = resolve(destination);
  const resolved = resolve(root, name);

  // Containment check on the resolved path, which collapses `..` for us.
  const rel = relative(root, resolved);
  if (rel === '') return resolved;            // the destination folder itself
  if (isAbsolute(rel)) return null;           // different drive or UNC
  // `relative()` reports an escape as `..` or `..\something`, so the separator
  // matters: without it a perfectly ordinary file called `...hidden` or
  // `..config` would be mistaken for traversal and refused.
  if (rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith('../')) return null;

  return resolved;
}

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
      // FileOps is a write path too. Without this the guard on Write/Edit/Delete
      // is advisory: copy, move and extract would each put a file straight
      // over a protected one. Checked once here, which covers all four
      // destination-writing actions below.
      const destinationGuard = guardSelfModification(
        findInfiniteRepoRoot(ctx.cwd) ?? ctx.cwd,
        destination,
        input.action === 'compress' ? 'create' : 'modify',
      );
      if (!destinationGuard.allowed) return fail(destinationGuard.reason ?? 'Refused.');
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
        // Inspect the archive before unpacking anything. Validating after the
        // fact is too late: by then the files are already on disk.
        const names = await listArchiveEntries(source);
        if (names === null) {
          return fail(`Could not read the archive at ${source}. It may not be a valid ZIP file.`);
        }

        const escaping = names.filter((n) => resolveExtractTarget(destination, n) === null);
        if (escaping.length) {
          return fail(
            `Refused to extract ${source}: ${escaping.length} entr${escaping.length === 1 ? 'y' : 'ies'} ` +
            `would be written outside ${destination}. Example: ${escaping[0]}\n\n` +
            'This is the shape of a "zip slip" archive. Nothing was extracted.',
          );
        }

        // The destination is not the only thing that matters: an entry that
        // stays inside it can still land on a protected file.
        const repoRoot = findInfiniteRepoRoot(ctx.cwd) ?? ctx.cwd;
        const targets = names
          .map((n) => resolveExtractTarget(destination, n))
          .filter((p): p is string => p !== null);
        for (const target of targets) {
          const guard = guardSelfModification(repoRoot, target, 'create');
          if (!guard.allowed) {
            return fail(
              `Refused to extract ${source}: it would write ${relative(repoRoot, target) || target}, which is protected.\n\n` +
              `${guard.reason ?? ''}\n\nNothing was extracted.`,
            );
          }
        }

        await mkdir(destination, { recursive: true });
        return await powershell(`Expand-Archive -LiteralPath '${ps(source)}' -DestinationPath '${ps(destination)}' -ErrorAction Stop`, `Extracted ${source} to ${destination} (${targets.length} entries, all verified inside the destination).`, ctx.abortSignal);
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

/**
 * Read an archive's entry names without extracting anything.
 *
 * Returns null when the archive cannot be read, which the caller reports
 * rather than treating as "no entries" — an unreadable archive must not be
 * mistaken for a safe one.
 */
async function listArchiveEntries(archive: string): Promise<string[] | null> {
  const command =
    `$ErrorActionPreference='Stop';` +
    `Add-Type -AssemblyName System.IO.Compression.FileSystem;` +
    `$z=[System.IO.Compression.ZipFile]::OpenRead('${ps(archive)}');` +
    `try { $z.Entries | ForEach-Object { $_.FullName } | ConvertTo-Json -Compress }` +
    ` finally { $z.Dispose() }`;
  try {
    const result = await spawnWithTimeout({
      command: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command', command],
      timeoutMs: 30_000,
      windowsHide: true,
    });
    if (result.exitCode !== 0) return null;
    const parsed = JSON.parse(result.stdout.trim() || '[]') as unknown;
    if (Array.isArray(parsed)) return parsed.map(String);
    // A single-entry archive serialises as a bare string, not an array.
    if (typeof parsed === 'string') return [parsed];
    return null;
  } catch {
    return null;
  }
}
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
