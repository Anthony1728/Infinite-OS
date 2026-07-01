/**
 * Indexing IPC Handler
 */

import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { getWorkspaceIndexer } from '../indexing/indexer.js';

export function registerIndexingIpc(): void {
  const indexer = getWorkspaceIndexer();

  // Build index
  ipcMain.handle(IPC.INDEX_BUILD, async (_event, args?: { paths?: string[]; force?: boolean }) => {
    try {
      const paths = args?.paths ?? [process.cwd()];
      
      const result = await indexer.buildIndex(paths, args?.force ?? false);
      
      return { ok: true, ...result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  // Search index
  ipcMain.handle(IPC.INDEX_SEARCH, async (_event, args: { query: string; limit?: number }) => {
    try {
      const results = indexer.search(args.query, args.limit ?? 20);
      return { ok: true, results };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  // Get status
  ipcMain.handle(IPC.INDEX_STATUS, async () => {
    try {
      const stats = indexer.getStatus();
      return { ok: true, stats };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  // Clear index
  ipcMain.handle(IPC.INDEX_CLEAR, async () => {
    try {
      indexer.clear();
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  // Add file to index
  ipcMain.handle(IPC.INDEX_FILE_ADD, async (_event, args: { path: string }) => {
    try {
      const file = await indexer.indexFile(args.path);
      if (!file) {
        return { ok: false, error: 'Failed to index file' };
      }
      return { ok: true, file };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  // Remove file from index
  ipcMain.handle(IPC.INDEX_FILE_REMOVE, async (_event, args: { path: string }) => {
    try {
      const removed = indexer.removeFile(args.path);
      return { ok: removed, error: removed ? undefined : 'File not in index' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  // Rebuild index
  ipcMain.handle(IPC.INDEX_REBUILD, async (_event, args?: { paths?: string[] }) => {
    try {
      const paths = args?.paths ?? [process.cwd()];
      const result = await indexer.buildIndex(paths, true); // force = true
      return { ok: true, ...result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });
}