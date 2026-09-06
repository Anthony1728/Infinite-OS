import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Tool, ToolResult } from './base.js';
import { backupFile } from './backup.js';

export const edit: Tool = {
  name: 'Edit',
  description: 'Perform exact string replacement in a file. old_string must appear exactly once unless replace_all is true. Automatically backs up the original file before editing.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path to the file (absolute or relative to cwd)' },
      old_string: { type: 'string', description: 'The exact string to find and replace' },
      new_string: { type: 'string', description: 'The replacement string' },
      replace_all: { type: 'boolean', default: false, description: 'Replace all occurrences' },
    },
    required: ['file_path', 'old_string', 'new_string'],
  },
  permission: 'ask',

  async execute(args, ctx): Promise<ToolResult> {
    const { file_path, old_string, new_string, replace_all = false } = args as {
      file_path: string; old_string: string; new_string: string; replace_all?: boolean;
    };
    try {
      const abs = resolve(ctx.cwd, file_path);
      const signal = ctx.abortSignal;
      try { const { allowWrite } = await import('../guard/source-guard.js'); allowWrite(abs); } catch { /* guard optional */ }
      const fsOpts = signal ? { signal } as const : undefined;
      const original = await readFile(abs, { encoding: 'utf8', ...fsOpts });

      let updated: string;
      if (replace_all) {
        updated = original.split(old_string).join(new_string);
      } else {
        const occurrences = original.split(old_string).length - 1;
        if (occurrences === 0) return { content: `old_string not found in ${file_path}`, is_error: true };
        if (occurrences > 1) return { content: `old_string appears ${occurrences} times; supply more context or use replace_all`, is_error: true };
        updated = original.replace(old_string, new_string);
      }

      // Auto-backup before writing
      const backupPath = await backupFile(abs);
      await writeFile(abs, updated, { encoding: 'utf8', ...fsOpts });
      const backupNote = backupPath ? ` (backup: ${backupPath})` : '';
      return { content: `Edited ${file_path} successfully${backupNote}` };
    } catch (e) {
      return { content: `Error editing ${file_path}: ${(e as Error).message}`, is_error: true };
    }
  },
};

