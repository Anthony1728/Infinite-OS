// Electron main process entry — creates the window, registers IPC, wires auto-update.

import { app, BrowserWindow, shell, Menu, nativeImage, session } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerIpc } from './ipc/index.js';
import { registerMiniMode } from './ipc/mini-mode.js';
import { registerQuickCapture } from './ipc/quick-capture.js';
import { registerBuiltinTools } from './tools/registry.js';
import { settings } from './settings/store.js';
import { connectAll as mcpConnectAll } from './mcp/manager.js';
import { logger } from './util/logger.js';
import { InfiniteBrain } from './brain/core.js';
import { DecisionRouter } from './brain/router.js';
import { OfflineManager } from './brain/offline.js';
import { ReasoningLoop } from './brain/reasoning.js';
import { WorkflowEngine } from './brain/workflow.js';
import { SystemMonitor } from './brain/monitor.js';
import { SelfImprovementEngine } from './brain/improvement.js';
import { ToolMarketplace } from './brain/marketplace.js';
import { DeveloperSDK } from './brain/sdk.js';
import { BrowserAgent } from './agent/browser.js';
import { bridgeServer } from './bridge/server.js';
import { automationScheduler } from './automation/scheduler.js';
import { phoneRemoteServer } from './remote/server.js';
import { getEngine } from './engine/intelligence.js';
import { browserOperator } from './operator/browser-operator.js';
import { windowsDictation } from './voice/windows-dictation.js';

import { automationBuilder } from './automation/builder.js';
import { WebsiteBuilder } from './builders/website.js';
import { AppBuilder } from './builders/app.js';
import { BusinessOS } from './business/crm.js';
import { PluginStore } from './plugins/store.js';
import { CloudSync } from './cloud/sync.js';
import { MultiAgentSystem } from './team/multi-agent.js';
import { TeamWorkspaces } from './team/workspaces.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Pre-warm model connections for speculative execution
async function warmUpModels(): Promise<void> {
  try {
    const engine = getEngine();
    // Pre-initialize the engine to warm up provider connections
    await engine.initialize();
    logger.info('Model connections pre-warmed');
  } catch (err) {
    logger.warn({ err }, 'Model warm-up encountered issues (non-blocking)');
  }
}

// Keep acceleration available on integrated and discrete graphics. It can be
// disabled for troubleshooting with INFINITE_DISABLE_GPU=1.
if (process.env['INFINITE_DISABLE_GPU'] === '1') {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
}

// Brain subsystem instances
export const brain = new InfiniteBrain();
export const router = new DecisionRouter();
export const offline = new OfflineManager();
export const reasoning = new ReasoningLoop();
export const workflow = new WorkflowEngine();
export const monitor = new SystemMonitor();
export const improvement = new SelfImprovementEngine();
export const marketplace = new ToolMarketplace();
export const sdk = new DeveloperSDK();

// Phase 2 instances
export const browserAgent = new BrowserAgent();
import { getComputerControl } from './agent/computer-singleton.js';
export const computerControl = getComputerControl();
export { automationBuilder };

// Phase 3 instances
export const websiteBuilder = new WebsiteBuilder();
export const appBuilder = new AppBuilder();
export const businessOS = new BusinessOS();
export const pluginStore = new PluginStore();

// Phase 4 instances
export const cloudSync = new CloudSync();
export const multiAgentSystem = new MultiAgentSystem();
export const teamWorkspaces = new TeamWorkspaces();

let mainWindow: BrowserWindow | null = null;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Infinite OS',
    backgroundColor: '#0e0e10',
    frame: false,
    roundedCorners: true,
    show: true,
    autoHideMenuBar: true,
    icon: nativeImage.createFromPath(join(__dirname, '../../resources/icon.png')),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    console.log('[main] Window ready-to-show, showing...');
    mainWindow?.show();
    mainWindow?.focus();
    // Normal maximizable window — fills the desktop but keeps the Windows
    // taskbar and chrome visible; user can minimize/resize. F11 / Ctrl+Shift+F
    // still toggles true fullscreen when they want it.
    try {
      mainWindow?.maximize();
    } catch (err) {
      console.error('[main] Maximize failed:', err);
      mainWindow?.setFullScreen(true);
    }
  });

  // Open DevTools automatically to surface render errors
  if (process.env['INFINITY_DEVTOOLS'] === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.webContents.on('console-message', (_e, level, message, line, source) => {
    const tag = ['V', 'I', 'W', 'E'][level] ?? '?';
    console.log(`[renderer ${tag}] ${message} (${source}:${line})`);
  });
  let hasCrashed = false;
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer] CRASH:', JSON.stringify(details));
    if (!hasCrashed) {
      hasCrashed = true;
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.reload();
        }
      }, 2000);
    }
  });
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[renderer] did-fail-load ${code} ${desc} ${url}`);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // F11 and Ctrl+Shift+F toggle fullscreen
  mainWindow.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase();
    const isF11 = key === 'f11';
    const isCtrlShiftF = input.control && input.shift && key === 'f';
    if (isF11 || isCtrlShiftF) {
      e.preventDefault();
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const nowFs = mainWindow.isFullScreen();
      mainWindow.setFullScreen(!nowFs);
      mainWindow.webContents.send('window:fullscreen-changed', { fullscreen: !nowFs });
    }
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  // Dictation is a local composer capability and must not depend on a model
  // provider. Grant microphone capture only to the trusted Infinite OS window.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const isTrustedWindow = mainWindow?.webContents === webContents;
    const wantsMicrophone = permission === 'media' && 'mediaTypes' in details && details.mediaTypes?.includes('audio');
    callback(Boolean(isTrustedWindow && wantsMicrophone));
  });

  // The visible shell is always the first startup action. Subsystem registry
  // work must not be able to strand Electron as a background-only process.
  createWindow();
  Menu.setApplicationMenu(null);

  // Start the local browser bridge (127.0.0.1:8765). The Infinite OS Bridge
  // browser extension connects here so the agent can drive the user's real
  // browser with their logged-in sessions. Never blocks startup.
  void bridgeServer.start().catch((e) => logger.warn({ err: e }, 'Bridge server failed to start'));

  // Phone companion server (LAN, token-authed) so a phone can chat with and
  // watch the agent over SSE. Never blocks startup.
  phoneRemoteServer.start();

  // Pre-warm model connections in background (non-blocking)
  warmUpModels().catch((e) => logger.warn({ err: e }, 'Model warm-up failed'));

  registerBuiltinTools();
  registerIpc(() => mainWindow);
  registerMiniMode(() => mainWindow);
  registerQuickCapture();
  const cwd = process.cwd();

  // Settings and external services initialize in the background. Slow disk,
  // credentials, or an unavailable provider must never block window creation.
  void settings.load(cwd)
    .then(() => mcpConnectAll(cwd))
    .catch((e) => logger.warn({ err: e }, 'Background startup initialization failed'));

  // Start brain subsystems (instantiated and ready for IPC calls)
  logger.info('Brain subsystems initialized');

  // Initialize Intelligence Engine — manages bootstrap lifecycle
  const engine = getEngine();
  engine.initialize().then(() => {
    logger.info(`Engine initialized: phase=${engine.getPhase()}`);
    const status = engine.getStatus();
    logger.info(`Engine status: interactions=${status.totalInteractions}, progress=${status.progressPercent}%`);
  }).catch((e) => logger.warn({ err: e }, 'Engine initialization failed'));

  // Start background health check loop (every 60s)
  setInterval(() => {
    try {
      monitor.collectMetrics();
      brain.checkHealth();
      const suggestions = monitor.getSuggestions();
      if (suggestions.length > 0) {
        logger.info({ suggestions: suggestions.map(s => s.title) }, 'Brain doctor suggestions');
      }
    } catch (err) {
      logger.warn({ err }, 'Brain health check failed');
    }
  }, 60_000);

  // Run screenshot cleanup on startup and every 30 minutes.
  const { runScreenshotCleanup, startPeriodicCleanup } = await import('./system/screenshot-cleanup.js');
  runScreenshotCleanup().catch((e) => logger.warn({ err: e }, 'Screenshot cleanup failed'));
  startPeriodicCleanup();

  // Start background self-improvement loop (every 5 min)
  setInterval(() => {
    try {
      const result = improvement.generateImprovements();
      if (result.length > 0) {
        logger.info({ count: result.length }, 'Brain self-improvement generated');
      }
      const cycleResult = brain.runImprovementCycle();
      if (cycleResult.issuesFound > 0) {
        logger.info({ issues: cycleResult.issuesFound, suggestions: cycleResult.improvementsSuggested }, 'Brain improvement cycle');
      }
      // Log engine progress
      const engStatus = engine.getStatus();
      if (engStatus.phase !== 'active') {
        logger.info({ phase: engStatus.phase, progress: engStatus.progressPercent, interactions: engStatus.totalInteractions }, 'Engine bootstrapping');
      }
    } catch (err) {
      logger.warn({ err }, 'Brain improvement cycle failed');
    }
  }, 300_000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  windowsDictation.stop();
  bridgeServer.stop();
  phoneRemoteServer.stop();
  automationScheduler.stop();
  void browserOperator.shutdown().finally(() => {
    if (process.platform !== 'darwin') app.quit();
  });
});

// Prevent crashes from unhandled promise rejections
process.on('unhandledRejection', (reason) => {
  console.error('[main] Unhandled promise rejection:', reason);
});

// Third-party network clients can emit delayed errors outside the original
// request promise. Log them for diagnosis instead of letting Electron exit.
process.on('uncaughtException', (error) => {
  console.error('[main] Uncaught exception:', error);
});

// Handle GPU process crashes
app.on('child-process-gone', (_e, details) => {
  console.error('[main] Child process gone:', details.type, details.reason);
});

// Hard-disable navigation to external URLs
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) e.preventDefault();
  });
});
