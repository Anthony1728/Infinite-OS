/**
 * Custom slash commands IPC — list (with templates for expansion) and save.
 * Bodies are prompt text, rendered through the normal agent path; nothing
 * here executes code. Tokens/paths in templates are the user's own data.
 */
import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { listCustomCommands, saveCustomCommand } from '../commands/custom.js';

export function registerCommandsIpc(): void {
  ipcMain.handle(IPC.COMMANDS_CUSTOM_LIST, async () => {
    try {
      const { dir, commands } = listCustomCommands();
      return { ok: true, dir, commands };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  ipcMain.handle(
    IPC.COMMANDS_CUSTOM_SAVE,
    async (_e, args: { name?: string; description?: string; template?: string }) => {
      try {
        if (!args?.name || !args?.template) return { ok: false, error: 'Name and template are required' };
        return saveCustomCommand(args.name, args.description ?? '', args.template);
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  );
}
