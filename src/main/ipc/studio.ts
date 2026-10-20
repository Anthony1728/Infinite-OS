/**
 * Studio + Planner IPC.
 *
 * Every mutation returns the authoritative record from the main-process store.
 * The renderer never invents ids or timestamps, and an agent tool and the UI
 * can safely interleave because both go through the same store.
 */

import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { join } from 'node:path';
import { IPC } from '../../shared/ipc.js';
import type { StudioAiRequest, StudioCreateInput, StudioUpdateInput } from '../../shared/studio.js';
import type { PlannerEventInput, PlannerReminderInput, PlannerTaskInput, PlannerTaskUpdate } from '../../shared/planner.js';
import { getStudioStore } from '../studio/store.js';
import { completeStudioText } from '../studio/ai.js';
import { exportStudioItem } from '../studio/export.js';
import { getPlannerStore } from '../planner/store.js';

function safeFileName(value: string): string {
  const cleaned = Array.from(value).map((ch) => {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f || '<>:"/\\|?*'.includes(ch)) return ' ';
    return ch;
  }).join('');
  return cleaned.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled';
}

/**
 * `app.getPath('documents')` throws when Windows has no Documents known
 * folder (redirected profiles, fresh temporary homes, policy-locked machines).
 * Export must still work there, so walk to the first usable default.
 */
function defaultExportDirectory(): string {
  for (const name of ['documents', 'downloads', 'home'] as const) {
    try {
      const directory = app.getPath(name);
      if (directory) return directory;
    } catch { /* known folder unavailable */ }
  }
  return process.cwd();
}

export function registerStudioIpc(getMainWindow?: () => BrowserWindow | null): void {
  const studio = () => getStudioStore();
  const planner = () => getPlannerStore();

  ipcMain.handle(IPC.STUDIO_LIST, async () => studio().list());
  ipcMain.handle(IPC.STUDIO_GET, async (_event, { id }: { id: string }) => studio().get(id));
  ipcMain.handle(IPC.STUDIO_CREATE, async (_event, input: StudioCreateInput) => studio().create(input));
  ipcMain.handle(IPC.STUDIO_UPDATE, async (_event, { id, patch }: { id: string; patch: StudioUpdateInput }) => studio().update(id, patch));
  ipcMain.handle(IPC.STUDIO_DELETE, async (_event, { id }: { id: string }) => studio().delete(id));
  ipcMain.handle(IPC.STUDIO_DUPLICATE, async (_event, { id }: { id: string }) => studio().duplicate(id));
  ipcMain.handle(IPC.STUDIO_AI, async (_event, request: StudioAiRequest) => completeStudioText(request));

  ipcMain.handle(IPC.STUDIO_EXPORT, async (_event, { id, format }: { id: string; format?: string }) => {
    const item = studio().get(id);
    if (!item) throw new Error('That Studio item no longer exists.');
    const extension = format === 'md' ? 'md'
      : format === 'html' ? 'html'
        : format === 'csv' ? 'csv'
          : item.kind === 'document' ? 'docx'
            : item.kind === 'sheet' ? 'xlsx'
              : 'pptx';
    const filterName = extension === 'docx' ? 'Word document'
      : extension === 'xlsx' ? 'Excel workbook'
        : extension === 'pptx' ? 'PowerPoint presentation'
          : extension === 'md' ? 'Markdown'
            : extension === 'csv' ? 'CSV'
              : 'HTML';
    const parent = getMainWindow?.() ?? BrowserWindow.getFocusedWindow();
    const options = {
      title: `Export ${item.title}`,
      defaultPath: join(defaultExportDirectory(), `${safeFileName(item.title)}.${extension}`),
      filters: [{ name: filterName, extensions: [extension] }],
    };
    const result = parent
      ? await dialog.showSaveDialog(parent, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { canceled: true as const };
    await exportStudioItem(item, result.filePath);
    return { canceled: false as const, path: result.filePath };
  });

  ipcMain.handle(IPC.PLANNER_GET, async () => planner().get());
  ipcMain.handle(IPC.PLANNER_TASK_CREATE, async (_event, input: PlannerTaskInput) => planner().createTask(input));
  ipcMain.handle(IPC.PLANNER_TASK_UPDATE, async (_event, { id, patch }: { id: string; patch: PlannerTaskUpdate }) => planner().updateTask(id, patch));
  ipcMain.handle(IPC.PLANNER_TASK_TOGGLE, async (_event, { id }: { id: string }) => planner().toggleTask(id));
  ipcMain.handle(IPC.PLANNER_TASK_DELETE, async (_event, { id }: { id: string }) => planner().deleteTask(id));
  ipcMain.handle(IPC.PLANNER_EVENT_CREATE, async (_event, input: PlannerEventInput) => planner().createEvent(input));
  ipcMain.handle(IPC.PLANNER_EVENT_UPDATE, async (_event, { id, patch }: { id: string; patch: Partial<PlannerEventInput> }) => planner().updateEvent(id, patch));
  ipcMain.handle(IPC.PLANNER_EVENT_DELETE, async (_event, { id }: { id: string }) => planner().deleteEvent(id));
  ipcMain.handle(IPC.PLANNER_REMINDER_CREATE, async (_event, input: PlannerReminderInput) => planner().createReminder(input));
  ipcMain.handle(IPC.PLANNER_REMINDER_UPDATE, async (_event, { id, patch }: { id: string; patch: Partial<PlannerReminderInput> }) => planner().updateReminder(id, patch));
  ipcMain.handle(IPC.PLANNER_REMINDER_DELETE, async (_event, { id }: { id: string }) => planner().deleteReminder(id));
  ipcMain.handle(IPC.PLANNER_DUE, async () => planner().dueReminders());
  ipcMain.handle(IPC.PLANNER_FIRED, async (_event, { id }: { id: string }) => planner().markReminderFired(id));
  ipcMain.handle(IPC.PLANNER_STATS, async () => planner().stats());
}
