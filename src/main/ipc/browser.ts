// Browser Agent IPC handlers

import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { browserAgent } from '../index.js';

export function registerBrowserIpc(): void {
  ipcMain.handle(IPC.BROWSER_CREATE_SESSION, async (_e, { name }) => {
    return browserAgent.createSession(name);
  });

  ipcMain.handle(IPC.BROWSER_NAVIGATE, async (_e, { sessionId, url }) => {
    return browserAgent.navigate(sessionId, url);
  });

  ipcMain.handle(IPC.BROWSER_CLICK, async (_e, { sessionId, selector }) => {
    return browserAgent.click(sessionId, selector);
  });

  ipcMain.handle(IPC.BROWSER_TYPE, async (_e, { sessionId, selector, value }) => {
    return browserAgent.type(sessionId, selector, value);
  });

  ipcMain.handle(IPC.BROWSER_SCREENSHOT, async (_e, { sessionId }) => {
    return browserAgent.screenshot(sessionId);
  });

  ipcMain.handle(IPC.BROWSER_EXTRACT, async (_e, { sessionId, selector }) => {
    return browserAgent.extractData(sessionId, selector);
  });

  ipcMain.handle(IPC.BROWSER_FILL_FORM, async (_e, { sessionId, formSelector, data }) => {
    return browserAgent.fillForm(sessionId, formSelector, data);
  });

  ipcMain.handle(IPC.BROWSER_LIST_SESSIONS, async () => {
    return browserAgent.listSessions();
  });

  ipcMain.handle(IPC.BROWSER_DELETE_SESSION, async (_e, { sessionId }) => {
    return browserAgent.deleteSession(sessionId);
  });

  ipcMain.handle(IPC.BROWSER_STATS, async () => {
    return browserAgent.getStats();
  });
}
