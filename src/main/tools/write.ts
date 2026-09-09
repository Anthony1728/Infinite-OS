import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import type { Tool, ToolResult } from './base.js';
import { backupFile } from './backup.js';

export const write: Tool = {
  name: 'Write',
  description: 'Create a new file or overwrite an existing file with the given content. Automatically creates parent directories and backs up existing files.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path to the file (absolute or relative to cwd)' },
      content: { type: 'string', description: 'The full file content' },
    },
    required: ['file_path', 'content'],
  },
  permission: 'ask',

  async execute(args, ctx): Promise<ToolResult> {
    const { file_path, content } = args as { file_path: string; content: string };
    try {
      const abs = resolve(ctx.cwd, file_path);
      const signal = ctx.abortSignal;
      // Mark as agent-authorized so source guard allows it
      try { const { allowWrite } = await import('../guard/source-guard.js'); allowWrite(abs); } catch { /* guard optional */ }
      // Auto-backup before overwriting existing files (session-grouped
      // snapshot inside the Infinite OS repo, legacy .backups elsewhere)
      const backupPath = await backupFile(abs, ctx.sessionId);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content, { encoding: 'utf8', ...(signal ? { signal } : {}) });
      const backupNote = backupPath ? ` (backup: ${backupPath})` : '';
      return { content: `Wrote ${content.length} bytes to ${file_path}${backupNote}` };
    } catch (e) {
      return { content: `Error writing ${file_path}: ${(e as Error).message}`, is_error: true };
    }
  },
};

