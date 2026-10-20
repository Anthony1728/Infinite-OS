// Workers + Teaching mode + app catalog + credential vault IPC.

import { ipcMain, shell } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { getWorkerManager } from '../workers/manager.js';
import {
  APP_CATALOG,
  installApp,
  launchApp,
  listInstalledApps,
  searchCatalog,
  type InstalledApp,
} from '../workers/apps.js';
import { getCredentialVault } from '../workers/vault.js';
import {
  getBackgroundStatus,
  setBackgroundEnabled,
} from '../workers/background.js';
import { getTeachingRecorder } from '../teaching/recorder.js';

/** Installed-app discovery is a PowerShell round trip; cache it briefly. */
let installedCache: { at: number; apps: InstalledApp[] } | null = null;
const INSTALLED_TTL_MS = 30_000;
let eventsAttached = false;

async function installedApps(force = false): Promise<InstalledApp[]> {
  if (!force && installedCache && Date.now() - installedCache.at < INSTALLED_TTL_MS) return installedCache.apps;
  const result = await listInstalledApps();
  installedCache = { at: Date.now(), apps: result.apps };
  return result.apps;
}

export function registerWorkersIpc(getMainWindow?: () => Electron.BrowserWindow | null): void {
  const manager = getWorkerManager();

  if (getMainWindow && !eventsAttached) {
    eventsAttached = true;
    manager.onEvent((event) => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) win.webContents.send(IPC.WORKERS_EVENT, event);
    });
    getTeachingRecorder().onEvent((message) => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) win.webContents.send(IPC.TEACH_EVENT, message);
    });
  }

  // --- Workers -------------------------------------------------------------
  ipcMain.handle(IPC.WORKERS_LIST, async () => ({
    workers: manager.list(),
    stats: manager.stats(),
    background: getBackgroundStatus(),
  }));

  ipcMain.handle(IPC.WORKERS_GET, async (_e, { workerId }: { workerId: string }) => manager.get(workerId));

  ipcMain.handle(IPC.WORKERS_CREATE, async (_e, input: Parameters<typeof manager.create>[0]) =>
    manager.create(input));

  ipcMain.handle(IPC.WORKERS_UPDATE, async (_e, { workerId, input }: { workerId: string; input: Parameters<typeof manager.update>[1] }) =>
    manager.update(workerId, input));

  ipcMain.handle(IPC.WORKERS_DELETE, async (_e, { workerId }: { workerId: string }) => manager.delete(workerId));

  ipcMain.handle(IPC.WORKERS_RUN, async (_e, { workerId }: { workerId: string }) => manager.startRun(workerId));

  ipcMain.handle(IPC.WORKERS_PAUSE, async (_e, { workerId }: { workerId: string }) => manager.pause(workerId));

  ipcMain.handle(IPC.WORKERS_RESUME, async (_e, { workerId }: { workerId: string }) => manager.resume(workerId));

  ipcMain.handle(IPC.WORKERS_CANCEL, async (_e, { workerId }: { workerId: string }) => manager.cancel(workerId));

  ipcMain.handle(IPC.WORKERS_INTERJECT, async (_e, { workerId, message }: { workerId: string; message: string }) =>
    manager.interject(workerId, message));

  ipcMain.handle(IPC.WORKERS_HISTORY, async (_e, { workerId }: { workerId: string }) => manager.getHistory(workerId));

  ipcMain.handle(IPC.WORKERS_OPEN_FOLDER, async (_e, { workerId }: { workerId: string }) => {
    const worker = manager.get(workerId);
    if (!worker) return { ok: false, error: 'Worker not found.' };
    const error = await shell.openPath(worker.workspace);
    return { ok: !error, error: error || undefined };
  });

  ipcMain.handle(IPC.WORKERS_BACKGROUND_GET, async () => getBackgroundStatus());

  ipcMain.handle(IPC.WORKERS_BACKGROUND_SET, async (_e, { enabled }: { enabled: boolean }) =>
    setBackgroundEnabled(Boolean(enabled)));

  // --- Teaching mode -------------------------------------------------------
  const teach = getTeachingRecorder();

  ipcMain.handle(IPC.TEACH_START, async (_e, input?: { name?: string }) => teach.start(input ?? {}));

  ipcMain.handle(IPC.TEACH_STOP, async (_e, { recordingId }: { recordingId: string }) => teach.stop(recordingId));

  ipcMain.handle(IPC.TEACH_NARRATE, async (_e, { recordingId, text }: { recordingId: string; text: string }) =>
    teach.addNarration(recordingId, text));

  ipcMain.handle(IPC.TEACH_RENAME, async (_e, { recordingId, name }: { recordingId: string; name: string }) =>
    teach.rename(recordingId, name));

  ipcMain.handle(IPC.TEACH_LIST, async () => ({
    recordings: teach.list(),
    activeId: teach.activeId(),
  }));

  ipcMain.handle(IPC.TEACH_GET, async (_e, { recordingId }: { recordingId: string }) => teach.get(recordingId));

  ipcMain.handle(IPC.TEACH_DELETE, async (_e, { recordingId }: { recordingId: string }) => teach.remove(recordingId));

  ipcMain.handle(IPC.TEACH_COMPILE, async (_e, { recordingId }: { recordingId: string }) => teach.compile(recordingId));

  ipcMain.handle(IPC.TEACH_FRAME, async (_e, { recordingId, path }: { recordingId: string; path?: string }) =>
    teach.frameData(recordingId, path));

  ipcMain.handle(IPC.TEACH_UPDATE_STEPS, async (_e, { recordingId, steps }: {
    recordingId: string;
    steps: Array<{ title: string; instruction?: string; referenceFrame?: string }>;
  }) => teach.updateSteps(recordingId, steps));

  ipcMain.handle(IPC.TEACH_CREATE_WORKER, async (_e, {
    recordingId,
    name,
    trigger,
    notifyOnFinish,
    steps,
  }: {
    recordingId: string;
    name?: string;
    trigger?: Parameters<typeof manager.create>[0]['trigger'];
    notifyOnFinish?: boolean;
    steps?: Array<{ title: string; instruction?: string; referenceFrame?: string }>;
  }) => {
    const view = steps ? teach.get(recordingId) : teach.compile(recordingId);
    if (!view) throw new Error('Recording not found.');
    const compiled = steps ?? view.compiledSteps;
    if (!compiled.length) throw new Error('This recording has no steps yet.');
    const taskSource = view.narration.trim() || view.compiledSteps.map((step) => step.title).join('; ');
    return manager.create({
      name: (name ?? '').trim() || view.name,
      description: `Created from a recorded demonstration on ${new Date(view.startedAt).toLocaleString()}.`,
      task: taskSource.slice(0, 4_000) || view.name,
      steps: compiled.map((step) => ({
        title: step.title,
        instruction: step.instruction,
        referenceFrame: step.referenceFrame,
      })),
      trigger,
      notifyOnFinish,
    });
  });

  // --- App catalog ---------------------------------------------------------
  ipcMain.handle(IPC.APPS_LIST, async (_e, { query }: { query?: string } = {}) => {
    const installed = await installedApps();
    return {
      catalog: searchCatalog(String(query ?? ''), installed),
      installed,
      total: APP_CATALOG.length,
    };
  });

  ipcMain.handle(IPC.APPS_INSTALL, async (_e, { wingetId }: { wingetId: string }) => {
    const result = await installApp(String(wingetId ?? ''));
    installedCache = null; // refresh discovery after a change
    return result;
  });

  ipcMain.handle(IPC.APPS_LAUNCH, async (_e, { appId }: { appId: string }) => launchApp(String(appId ?? '')));

  // --- Credential vault ----------------------------------------------------
  const vault = getCredentialVault();

  ipcMain.handle(IPC.VAULT_LIST, async (_e, { workerId }: { workerId?: string } = {}) => ({
    available: vault.available(),
    cipher: vault.cipherLabel(),
    entries: vault.list(workerId),
  }));

  ipcMain.handle(IPC.VAULT_ADD, async (_e, input: Parameters<typeof vault.add>[0]) => vault.add(input));

  ipcMain.handle(IPC.VAULT_AUTHORIZE, async (_e, { entryId, workerIds }: { entryId: string; workerIds: string[] }) =>
    vault.authorize(entryId, workerIds));

  ipcMain.handle(IPC.VAULT_DELETE, async (_e, { entryId }: { entryId: string }) => vault.remove(entryId));
}
