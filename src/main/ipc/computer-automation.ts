/**
 * Computer Automation IPC Handler
 */

import { ipcMain } from 'electron';
import { getComputerAutomation } from '../automation/computer-automation.js';

export function registerComputerAutomationIpc(): void {
  const computer = getComputerAutomation();

  // Mouse control
  ipcMain.handle('computer:moveMouse', async (_event, args: { x: number; y: number; smooth?: boolean }) => {
    try {
      await computer.moveMouse(args.x, args.y, args.smooth);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('computer:getCursorPosition', async () => {
    try {
      const pos = await computer.getCursorPosition();
      return { ok: true, ...pos };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('computer:click', async (_event, args: {
    x: number;
    y: number;
    button?: 'left' | 'right' | 'middle';
  }) => {
    try {
      await computer.click(args.x, args.y, args.button);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('computer:doubleClick', async (_event, args: { x: number; y: number }) => {
    try {
      await computer.doubleClick(args.x, args.y);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('computer:rightClick', async (_event, args: { x: number; y: number }) => {
    try {
      await computer.rightClick(args.x, args.y);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('computer:drag', async (_event, args: {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    holdTime?: number;
  }) => {
    try {
      await computer.drag(args.fromX, args.fromY, args.toX, args.toY, args.holdTime);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('computer:scroll', async (_event, args: {
    x: number;
    y: number;
    amount: number;
  }) => {
    try {
      await computer.scroll(args.x, args.y, args.amount);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('computer:hover', async (_event, args: {
    x: number;
    y: number;
    duration?: number;
  }) => {
    try {
      await computer.hover(args.x, args.y, args.duration);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Keyboard control
  ipcMain.handle('computer:typeText', async (_event, args: { text: string; delay?: number }) => {
    try {
      await computer.typeText(args.text, args.delay);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('computer:pressKey', async (_event, args: { key: string }) => {
    try {
      await computer.pressKey(args.key);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('computer:hotkey', async (_event, args: { keys: string[] }) => {
    try {
      await computer.hotkey(...args.keys);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Screen capture
  ipcMain.handle('computer:captureScreen', async () => {
    try {
      const result = await computer.captureScreen();
      return { ok: true, ...result };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('computer:captureRegion', async (_event, args: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => {
    try {
      const result = await computer.captureRegion(args.x, args.y, args.width, args.height);
      return { ok: true, ...result };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('computer:getScreenSize', async () => {
    try {
      const size = await computer.getScreenSize();
      return { ok: true, ...size };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('computer:saveScreenshot', async (_event, args: { filename: string }) => {
    try {
      const path = await computer.saveScreenshot(args.filename);
      return { ok: true, path };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Window management
  ipcMain.handle('computer:getWindows', async () => {
    try {
      const windows = await computer.getWindows();
      return { ok: true, windows };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('computer:findWindow', async (_event, args: { title: string }) => {
    try {
      const window = await computer.findWindow(args.title);
      return { ok: true, window };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('computer:focusWindow', async (_event, args: { title: string }) => {
    try {
      const focused = await computer.focusWindow(args.title);
      return { ok: focused };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('computer:minimizeWindow', async (_event, args: { title: string }) => {
    try {
      const minimized = await computer.minimizeWindow(args.title);
      return { ok: minimized };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Application management
  ipcMain.handle('computer:openApp', async (_event, args: { name: string }) => {
    try {
      const opened = await computer.openApp(args.name);
      return { ok: opened };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('computer:openUrl', async (_event, args: { url: string }) => {
    try {
      const opened = await computer.openUrl(args.url);
      return { ok: opened };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('computer:closeApp', async (_event, args: { name: string }) => {
    try {
      const closed = await computer.closeApp(args.name);
      return { ok: closed };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('computer:getProcesses', async () => {
    try {
      const processes = await computer.getProcesses();
      return { ok: true, processes };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Clipboard
  ipcMain.handle('computer:getClipboard', async () => {
    try {
      const text = await computer.getClipboard();
      return { ok: true, text };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('computer:setClipboard', async (_event, args: { text: string }) => {
    try {
      await computer.setClipboard(args.text);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Execute shell command
  ipcMain.handle('computer:execute', async (_event, args: {
    command: string;
    cwd?: string;
  }) => {
    try {
      const result = await computer.execute(args.command, args.cwd);
      return { ok: true, ...result };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Stats
  ipcMain.handle('computer:stats', async () => {
    return { ok: true, ...computer.getStats() };
  });

  ipcMain.handle('computer:actionLog', async (_event, args?: { count?: number }) => {
    return { ok: true, log: computer.getActionLog(args?.count) };
  });
}