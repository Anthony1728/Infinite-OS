/**
 * Pages IPC.
 *
 * Mutations return the authoritative record from the main-process store; the
 * renderer never invents ids or timestamps. Export uses the same Documents →
 * Downloads → Home fallback as Studio so redirected Windows profiles still
 * have a working save dialog.
 */

import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IPC } from '../../shared/ipc.js';
import type {
  PageCreateInput,
  PageDatabaseRowInput,
  PageUpdateInput,
} from '../../shared/pages.js';
import { getPagesStore } from '../pages/store.js';
import { databaseToCsv, pageToMarkdown } from '../pages/export.js';

function safeFileName(value: string): string {
  const cleaned = Array.from(value).map((ch) => {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f || '<>:"/\\|?*'.includes(ch)) return ' ';
    return ch;
  }).join('');
  return cleaned.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled';
}

function defaultExportDirectory(): string {
  for (const name of ['documents', 'downloads', 'home'] as const) {
    try {
      const directory = app.getPath(name);
      if (directory) return directory;
    } catch {
      /* known folder unavailable */
    }
  }
  return process.cwd();
}

export function registerPagesIpc(getMainWindow?: () => BrowserWindow | null): void {
  const store = () => getPagesStore();

  ipcMain.handle(IPC.PAGES_LIST, async () => store().list());
  ipcMain.handle(IPC.PAGES_GET, async (_event, { id }: { id: string }) => store().get(id));
  ipcMain.handle(IPC.PAGES_CREATE, async (_event, input: PageCreateInput) => store().create(input));
  ipcMain.handle(IPC.PAGES_UPDATE, async (_event, { id, patch }: { id: string; patch: PageUpdateInput }) =>
    store().update(id, patch));
  ipcMain.handle(IPC.PAGES_DUPLICATE, async (_event, { id }: { id: string }) => store().duplicate(id));
  ipcMain.handle(IPC.PAGES_TRASH, async (_event, { id }: { id: string }) => store().trash(id));
  ipcMain.handle(IPC.PAGES_RESTORE, async (_event, { id }: { id: string }) => store().restore(id));
  ipcMain.handle(IPC.PAGES_DELETE, async (_event, { id }: { id: string }) => {
    store().deletePermanent(id);
    return true;
  });
  ipcMain.handle(IPC.PAGES_EMPTY_TRASH, async () => {
    store().emptyTrash();
    return true;
  });
  ipcMain.handle(IPC.PAGES_SEARCH, async (_event, { query, limit }: { query: string; limit?: number }) =>
    store().search(query, limit));
  ipcMain.handle(IPC.PAGES_BACKLINKS, async (_event, { id }: { id: string }) => store().backlinksTo(id));

  ipcMain.handle(IPC.PAGES_COMMENT_ADD, async (_event, { id, text, blockId }: { id: string; text: string; blockId?: string }) =>
    store().addComment(id, text, blockId));
  ipcMain.handle(IPC.PAGES_COMMENT_DELETE, async (_event, { id, commentId }: { id: string; commentId: string }) =>
    store().deleteComment(id, commentId));
  ipcMain.handle(IPC.PAGES_COMMENT_RESOLVE, async (_event, { id, commentId, resolved }: { id: string; commentId: string; resolved: boolean }) =>
    store().resolveComment(id, commentId, resolved));

  ipcMain.handle(IPC.PAGES_VERSION_SAVE, async (_event, { id }: { id: string }) => store().saveVersion(id));
  ipcMain.handle(IPC.PAGES_VERSION_RESTORE, async (_event, { id, versionId }: { id: string; versionId: string }) =>
    store().restoreVersion(id, versionId));

  ipcMain.handle(IPC.PAGES_ROW_CREATE, async (_event, { databaseId, input }: { databaseId: string; input?: PageDatabaseRowInput }) =>
    store().createDatabaseRow(databaseId, input));
  ipcMain.handle(IPC.PAGES_ROW_UPDATE, async (_event, { databaseId, rowId, patch }: { databaseId: string; rowId: string; patch: PageDatabaseRowInput }) =>
    store().updateDatabaseRow(databaseId, rowId, patch));
  ipcMain.handle(IPC.PAGES_ROW_DELETE, async (_event, { databaseId, rowId }: { databaseId: string; rowId: string }) =>
    store().deleteDatabaseRow(databaseId, rowId));
  ipcMain.handle(IPC.PAGES_ROW_DUPLICATE, async (_event, { databaseId, rowId }: { databaseId: string; rowId: string }) =>
    store().duplicateDatabaseRow(databaseId, rowId));
  ipcMain.handle(IPC.PAGES_ROW_OPEN, async (_event, { databaseId, rowId }: { databaseId: string; rowId: string }) =>
    store().openRowPage(databaseId, rowId));

  ipcMain.handle(IPC.PAGES_EXPORT, async (_event, { id, format }: { id: string; format?: 'md' | 'csv' }) => {
    const pages = store();
    const page = pages.get(id);
    if (!page) throw new Error('That page no longer exists.');
    const csv = format === 'csv';
    const extension = csv ? 'csv' : 'md';
    const filterName = csv ? 'CSV' : 'Markdown';
    const parent = getMainWindow?.() ?? BrowserWindow.getFocusedWindow();
    const options = {
      title: `Export ${page.title}`,
      defaultPath: join(defaultExportDirectory(), `${safeFileName(page.title)}.${extension}`),
      filters: [{ name: filterName, extensions: [extension] }],
    };
    const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;
    const text = csv ? databaseToCsv(page) : pageToMarkdown(page, {
      get: (pageId) => pages.get(pageId),
    });
    writeFileSync(result.filePath, text, 'utf8');
    return result.filePath;
  });
}
