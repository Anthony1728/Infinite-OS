import { BrowserWindow, ipcMain, screen, nativeImage } from 'electron';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { v4 as uuid } from 'uuid';
import { IPC } from '../../shared/ipc.js';
import type { Message } from '../../shared/types.js';
import { logger } from '../util/logger.js';
import * as sessionStore from '../session/store.js';
import { runAgent } from '../agent/loop.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

let miniWindow: BrowserWindow | null = null;
let mainWinGetter: () => BrowserWindow | null = () => null;

// One AbortController per running mini-mode request so a new send supersedes
// an in-flight one instead of interleaving two agent runs in one session.
const activeMiniRuns = new Map<string, AbortController>();

// ── Notepad streaming ──────────────────────────────────────────────────
// Mini-mode answers stream into a live Notepad window instead of a floating
// preview. The text accumulates in a temp .txt file; Notepad (Windows 10+)
// reloads it as it changes on disk.
interface NotepadSession {
  file: string;
  notepad: ReturnType<typeof spawn> | null;
  buffer: string;
  flushTimer: NodeJS.Timeout | null;
}

const notepadSessions = new Map<string, NotepadSession>();

function openNotepadFor(sessionId: string): NotepadSession {
  let session = notepadSessions.get(sessionId);
  if (session) return session;
  const dir = mkdtempSync(join(tmpdir(), 'infinite-mini-'));
  const file = resolve(dir, 'response.txt');
  writeFileSync(file, '');
  const notepad = spawn('notepad.exe', [file], {
    detached: true,
    stdio: 'ignore',
  });
  notepad.unref();
  session = { file, notepad, buffer: '', flushTimer: null };
  notepadSessions.set(sessionId, session);
  return session;
}

function noteDelta(sessionId: string, delta: string): void {
  if (!delta) return;
  const session = openNotepadFor(sessionId);
  session.buffer += delta;
  if (session.flushTimer) return;
  // Debounce disk writes so a fast stream does not thrash the file watcher.
  session.flushTimer = setTimeout(() => {
    session.flushTimer = null;
    try {
      // Notepad (Win10 1903+/11) live-reloads files that change on disk.
      writeFileSync(session.file, session.buffer, 'utf8');
    } catch (err) {
      logger.error(`MINI_SEND: notepad write failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, 150);
}

function noteFinish(sessionId: string): void {
  const session = notepadSessions.get(sessionId);
  if (!session) return;
  if (session.flushTimer) {
    clearTimeout(session.flushTimer);
    session.flushTimer = null;
  }
  try {
    writeFileSync(session.file, session.buffer, 'utf8');
  } catch (err) {
    logger.error(`MINI_SEND: notepad final write failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  // Leave the window open for the user to read; release our bookkeeping.
  setTimeout(() => {
    try {
      rmSync(resolve(session.file, '..'), { recursive: true, force: true });
    } catch {
      /* temp cleanup is best-effort; notepad may still hold the file open */
    }
  }, 60_000);
  notepadSessions.delete(sessionId);
}

export function registerMiniMode(getMainWindow: () => BrowserWindow | null): void {
  mainWinGetter = getMainWindow;

  ipcMain.handle(IPC.MINI_TOGGLE, () => {
    if (miniWindow && !miniWindow.isDestroyed()) {
      closeMini();
      return { active: false };
    }
    openMini();
    return { active: true };
  });

  ipcMain.handle(IPC.MINI_ABORT, (_e, args: { sessionId?: string } = {}) => {
    const sid = typeof args?.sessionId === 'string' ? args.sessionId : '';
    if (!sid) {
      // No session: abort every active run (best-effort).
      for (const controller of activeMiniRuns.values()) controller.abort();
      activeMiniRuns.clear();
      return { ok: true, aborted: 'all' };
    }
    const controller = activeMiniRuns.get(sid);
    if (!controller) return { ok: false, error: 'No active run for session' };
    controller.abort(new Error('User stopped the mini-mode run.'));
    return { ok: true };
  });

  ipcMain.handle(IPC.MINI_RESTORE, () => {
    const main = mainWinGetter();
    if (main && !main.isDestroyed()) {
      main.show();
      main.focus();
    }
    closeMini();
  });

  // Mini-bar chat: run the agent on behalf of the mini window and stream
  // events back to IT. The regular CHAT_SEND path streams to the main window
  // only, so the mini bar cannot reuse it while the main window is minimized.
  ipcMain.handle(
    IPC.MINI_SEND,
    async (
      _e,
      args: { sessionId?: string; message?: string; provider?: string; model?: string; cwd?: string },
    ) => {
      const text = typeof args?.message === 'string' ? args.message.trim() : '';
      if (!text) return { ok: false, error: 'Empty message' };

      const provider = args?.provider ?? '';
      const model = args?.model ?? '';
      const cwd = args?.cwd ?? '.';

      // Reuse the caller's session when it still exists; otherwise create one
      // dedicated to mini mode so history persists across open/close cycles.
      let sessionId = typeof args?.sessionId === 'string' ? args.sessionId : '';
      if (!sessionId || !(await sessionStore.loadSessionMeta(sessionId))) {
        const session = await sessionStore.createSession({
          cwd,
          model,
          provider,
          title: 'Mini mode',
        });
        sessionId = session.id;
      }

      const userMessage: Message = {
        id: uuid(),
        role: 'user',
        content: [{ type: 'text', text }],
        timestamp: Date.now(),
      };
      const history = await sessionStore.loadMessages(sessionId);
      await sessionStore.appendMessage(sessionId, userMessage);

      activeMiniRuns.get(sessionId)?.abort();
      const controller = new AbortController();
      activeMiniRuns.set(sessionId, controller);
      sendMiniState({ active: true, sessionId });

      runAgent(history, userMessage, {
        sessionId,
        cwd,
        provider,
        model,
        signal: controller.signal,
        onEvent: (ev) => {
          // Mini-mode answers stream straight into Notepad: text deltas are
          // appended to the temp file (debounced), and completion flushes it.
          if (ev.type === 'text_delta' && typeof ev.delta === 'string') {
            noteDelta(sessionId, ev.delta);
          } else if (ev.type === 'done') {
            noteFinish(sessionId);
          }
          // Keep the renderer's status signals alive — the dot only reflects
          // whether a run is active, the text itself lives in Notepad.
          if (ev.type === 'text_delta' || ev.type === 'message_end' || ev.type === 'error') {
            sendMiniStreamEvent(ev);
          } else if (ev.type === 'done') {
            sendMiniState({ active: false, sessionId });
            if (activeMiniRuns.get(sessionId) === controller) activeMiniRuns.delete(sessionId);
          }
        },
      })
        .then(async (completedMessages) => {
          // A deleted session must never be recreated by a late completion.
          if (await sessionStore.loadSessionMeta(sessionId)) {
            for (const message of completedMessages.slice(history.length + 1)) {
              await sessionStore.appendMessage(sessionId, message);
            }
          }
        })
        .catch((err: unknown) => {
          const errorMessage = err instanceof Error ? err.message : String(err);
          logger.error(`MINI_SEND: agent run failed: ${errorMessage}`);
          noteFinish(sessionId);
          sendMiniStreamEvent({ type: 'error', error: errorMessage });
          sendMiniState({ active: false, sessionId });
        })
        .finally(() => {
          if (activeMiniRuns.get(sessionId) === controller) activeMiniRuns.delete(sessionId);
        });

      return { ok: true, sessionId };
    },
  );
}

function sendMiniStreamEvent(payload: unknown): void {
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.webContents.send(IPC.MINI_STREAM_EVENT, payload);
  }
}

function sendMiniState(payload: unknown): void {
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.webContents.send(IPC.MINI_STATE, payload);
  }
}

function openMini(): void {
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.focus();
    return;
  }

  const main = mainWinGetter();
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;

  const miniW = 440;
  const miniH = 64;
  const x = Math.round((screenW - miniW) / 2);
  const y = screenH - miniH - 24;

  miniWindow = new BrowserWindow({
    width: miniW,
    height: miniH,
    x,
    y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    hasShadow: false,
    title: 'Infinite OS Mini',
    icon: nativeImage.createFromPath(join(__dirname, '../../resources/icon.png')),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  miniWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (process.env['ELECTRON_RENDERER_URL']) {
    miniWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/mini.html`);
  } else {
    miniWindow.loadFile(join(__dirname, '../renderer/mini.html'));
  }

  miniWindow.on('closed', () => {
    miniWindow = null;
  });

  // Minimize main window when mini opens
  if (main && !main.isDestroyed() && !main.isMinimized()) {
    main.minimize();
  }

  logger.info('Mini mode opened');
}

function closeMini(): void {
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.close();
  }
  miniWindow = null;
  logger.info('Mini mode closed');
}

export function getMiniWindow(): BrowserWindow | null {
  return miniWindow;
}
