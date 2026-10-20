// Electron main process entry — creates the window, registers IPC, wires auto-update.

import { app, BrowserWindow, shell, Menu, nativeImage, session } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, rmSync, readdirSync, copyFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

// Apply staged update synchronously BEFORE any other module loads
(function applyStagedUpdateSync() {
  try {
    const markerPath = join(homedir(), '.infinite-ai', 'staged-update.json');
    if (!existsSync(markerPath)) return;
    const marker = JSON.parse(readFileSync(markerPath, 'utf8')) as { sourceDir: string };
    const src = marker.sourceDir;
    if (!src || !existsSync(src)) { try { rmSync(markerPath, { force: true }); } catch { /* stale marker, ignore */ } return; }
    const installDir = process.execPath ? join(process.execPath, '..') : '';
    if (!installDir || installDir.includes('node_modules')) return;
    if (!existsSync(join(installDir, 'Infinite OS.exe')) && !existsSync(join(installDir, 'resources'))) return;
    const copyRecursive = (s: string, d: string): void => {
      for (const e of readdirSync(s, { withFileTypes: true })) {
        const sp = join(s, e.name), dp = join(d, e.name);
        if (e.isDirectory()) { mkdirSync(dp, { recursive: true }); copyRecursive(sp, dp); }
        else { try { copyFileSync(sp, dp); } catch (err) { const c = (err as NodeJS.ErrnoException).code; if (c !== 'EBUSY' && c !== 'EPERM') throw err; } }
      }
    };
    copyRecursive(src, installDir);
    rmSync(markerPath, { force: true });
    console.log('[startup] Staged update applied');
  } catch { /* normal startup */ }
})();
import { registerIpc } from './ipc/index.js';
import { attachBackgroundWindow, disposeTray } from './workers/background.js';
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
import { SelfEvolutionEngine } from './brain/self-evolution.js';
import { BrowserAgent } from './agent/browser.js';
import { bridgeServer } from './bridge/server.js';
import { automationScheduler } from './automation/scheduler.js';
import { phoneRemoteServer } from './remote/server.js';
import { getEngine } from './engine/intelligence.js';
import { browserOperator } from './operator/browser-operator.js';
import { windowsDictation } from './voice/windows-dictation.js';
import { disposeLocalVoice } from './voice/local-voice.js';

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
  // Local weights are deliberately NOT loaded at boot any more.
  //
  // This used to pull a local model into RAM and pin it for 30 minutes on every
  // single launch, whether or not the user ever chose a local model. Measured on
  // the development machine: 1.5 GB resident for `qwen3:1.7b`, 2.5 GB for
  // `qwen3:4b`, all of it system RAM because there is no CUDA GPU there. That is
  // the main reason local models made the whole computer feel slow, and it was
  // paid by users who never intended to use one.
  //
  // Instead the model is warmed on first use — see `warmLocalModels`, which is
  // now called when a local model is actually selected, and which picks the
  // smallest comfortable model and respects the machine's memory tier.
  try {
    const { getHardwareProfile } = await import('./ollama/hardware.js');
    logger.info(`Local model budget: ${getHardwareProfile().tier} tier`);
  } catch { /* hardware probe is best-effort */ }

  // Boot optimization.
  //
  // Runs after the window is up rather than before, and it applies ONLY the
  // `safe` tier: temp files in actual temp folders. It never disables a service,
  // never ends a process and never uninstalls anything — those need the user to
  // agree, and they live in Settings -> Performance where each one explains what
  // it costs. It also does nothing at all if the user has turned it off, and it
  // never runs before they have seen the panel once, so a first launch cannot
  // change the machine behind their back.
  setTimeout(() => {
    void (async () => {
      try {
        const [{ runBootOptimization, hasSeenFindings }, { settings }] = await Promise.all([
          import('./ipc/optimize.js'),
          import('./settings/store.js'),
        ]);
        if (settings.get('bootOptimization') === false) return;
        if (!hasSeenFindings()) {
          logger.info('[optimize] first run: showing the panel instead of acting');
          return;
        }
        const result = await runBootOptimization();
        if (result.applied.length > 0) {
          logger.info(`[optimize] cleaned on launch: ${result.applied.join(', ')}`);
        }
      } catch (err) {
        logger.warn({ err }, 'Boot optimization pass failed (non-blocking)');
      }
    })();
  }, 8_000).unref?.();
  // Resolve local voice availability early (import checks, no audio): the
  // first voice:status call then answers from cache instead of spawning
  // Python while the user is already tapping the mic.
  try {
    const { getVoice } = await import('./voice/index.js');
    const voice = getVoice();
    voice.hasLocalStt();
    voice.hasLocalKokoro();
  } catch { /* voice warm is best-effort */ }
  // Then pre-load the offline models a few seconds later. Deferring means the
  // window finishes painting first; the server warms faster-whisper as soon as
  // it spawns, so the first mic tap no longer pays a ~3s model load.
  try {
    const { getLocalVoice, isLocalVoiceScriptAvailable } = await import('./voice/local-voice.js');
    if (isLocalVoiceScriptAvailable()) {
      const timer = setTimeout(() => {
        void getLocalVoice()
          .warm()
          .catch(() => undefined);
      }, 8_000);
      timer.unref?.();
    }
  } catch { /* local voice warm is best-effort */ }
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
export const selfEvolution = new SelfEvolutionEngine();

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
    // Matches the boot splash exactly, and the window stays hidden until
    // ready-to-show — opening the app fades straight into the Infinite logo,
    // never a blank frame first.
    backgroundColor: '#08080b',
    frame: false,
    roundedCorners: true,
    show: false,
    autoHideMenuBar: true,
    icon: nativeImage.createFromPath(join(__dirname, '../../resources/icon.png')),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Close-to-tray: with "keep workers running" enabled, closing the window
  // hides it instead of quitting so scheduled workers keep firing.
  attachBackgroundWindow(mainWindow);

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

  // Failsafe for show:false above: if ready-to-show somehow never fires,
  // never leave the user staring at nothing — show the window after 8s.
  setTimeout(() => {
    try {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show();
    } catch { /* show is best-effort */ }
  }, 8000);

  // Open DevTools automatically to surface render errors
  if (process.env['INFINITY_DEVTOOLS'] === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Take only the details object (Event<WebContentsConsoleMessageEventParams>):
  // Electron checks listener arity and warns at runtime when a listener uses
  // the deprecated positional (level, message, line, source) arguments.
  const rendererTag: Record<string, string> = {
    '0': 'V', '1': 'I', '2': 'W', '3': 'E',
    debug: 'V', verbose: 'V', info: 'I', warning: 'W', warn: 'W', error: 'E',
  };
  mainWindow.webContents.on('console-message', (details) => {
    const tag = rendererTag[String(details.level)] ?? '?';
    console.log(`[renderer ${tag}] ${details.message} (${details.sourceId}:${details.lineNumber})`);
  });
  let hasCrashed = false;
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer] CRASH:', JSON.stringify(details));
    if (!hasCrashed) {
      hasCrashed = true;
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          // The renderer restarted, so it has no idea which tabs were open.
          // Release the old guests first; the new surface re-creates the tab it
          // is actually showing. Leaving them attached would stack duplicates
          // over the window and keep stale pages alive off-screen.
          void import('./tab-browser-view.js')
            .then(({ closeAllTabBrowserViews }) => closeAllTabBrowserViews())
            .catch(() => {});
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

  // Fullscreen state is broadcast from the WINDOW's own events, not from the
  // code that requests it.
  //
  // Previously only the F11 handler sent `window:fullscreen-changed`, so
  // entering full screen from the title-bar button, from an IPC call, or from
  // anything else left the renderer believing it was still windowed — the title
  // bar never got out of the way and no layout adapted. One authority means
  // every route reports the same truth.
  const broadcastFullscreen = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const fullscreen = mainWindow.isFullScreen();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('window:fullscreen-changed', { fullscreen });
    }
  };
  mainWindow.on('enter-full-screen', broadcastFullscreen);
  mainWindow.on('leave-full-screen', broadcastFullscreen);

  // F11 and Ctrl+Shift+F toggle fullscreen
  mainWindow.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase();
    const isF11 = key === 'f11';
    const isCtrlShiftF = input.control && input.shift && key === 'f';
    if (isF11 || isCtrlShiftF) {
      e.preventDefault();
      if (!mainWindow || mainWindow.isDestroyed()) return;
      // The window's own enter/leave event does the broadcasting, so every
      // route (key, button, IPC) reports through the same path.
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    }
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  // Headless exec (`npm run exec -- "prompt"`): no window, no servers — one
  // agent turn to completion on stdout, exit code for scripts/CI.
  if (process.argv.includes('--exec')) {
    const { parseExecArgs, execUsage } = await import('./exec/args.js');
    const { runExec } = await import('./exec/run.js');
    const { readFileSync } = await import('node:fs');
    let stdinPrompt = '';
    let raw = process.argv.slice(process.argv.indexOf('--exec') + 1);
    if (raw.length === 1 && raw[0] === '-') {
      try {
        stdinPrompt = readFileSync(0, 'utf8').trim();
      } catch {
        stdinPrompt = '';
      }
      raw = [];
    }
    const parsed = parseExecArgs(raw);
    if ('error' in parsed) {
      if (parsed.error !== 'help') console.error(`exec: ${parsed.error}\n`);
      console.error(execUsage());
      app.exit(parsed.error === 'help' ? 0 : 2);
      return;
    }
    if (stdinPrompt) parsed.prompt = stdinPrompt;
    registerBuiltinTools();
    const code = await runExec(parsed);
    // Flush stdio before exiting: Electron's app.exit() on Windows can
    // truncate buffered stdout, silently eating the answer/JSONL tail.
    await Promise.all([
      new Promise<void>((r) => process.stdout.write('', () => r())),
      new Promise<void>((r) => process.stderr.write('', () => r())),
    ]);
    app.exit(code);
    return;
  }
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

  // Always-on voice: when the setting is on, the mic stays live and every view
  // keeps hearing you. Settings-gated like Telegram inbound, and it never blocks
  // startup — the microphone opens in the background after the window is up.
  void import('./voice/session.js').then(({ voiceSession }) => {
    void voiceSession.init();
  }).catch((e) => {
    logger.warn({ err: e }, 'Always-on voice failed to initialize');
  });

  // Telegram inbound (OpenClaw loop): DMs to your bot become agent turns.
  // Idle until enabled via settings/env + token + allowlist. Never blocks startup.
  void import('./messaging/telegram-inbound.js').then(({ telegramInbound }) => {
    try {
      telegramInbound.start();
    } catch (e) {
      logger.warn({ err: e }, 'Telegram inbound failed to start');
    }
  }).catch(() => {});

  // WhatsApp link auto-resume (self-chat-only, OpenClaw-style): a previous
  // pairing reconnects in the background so messaging yourself just works.
  // Fresh installs stay off until linked from Messaging → WhatsApp Link.
  void import('./messaging/whatsapp-link.js').then(({ whatsAppLink }) => {
    try {
      if (whatsAppLink.hasLinkedCreds()) {
        void whatsAppLink.start({ log: (...args: unknown[]) => console.log('[whatsapp-link]', ...args) })
          .catch((e) => logger.warn({ err: e }, 'WhatsApp auto-resume failed'));
      }
    } catch (e) {
      logger.warn({ err: e }, 'WhatsApp auto-resume check failed');
    }
  }).catch(() => {});

  // Continuous self-evolution auto-resume: a loop left enabled in Settings
  // picks up where it left off on every launch (createEvolutionLoop reads the
  // persisted snapshot and re-arms itself when enabled).
  void import('./brain/evolution-loop.js')
    .then(({ createEvolutionLoop }) => {
      try {
        createEvolutionLoop(); // arms the timer when evolveLoopEnabled is true
      } catch (e) {
        logger.warn({ err: e }, 'Evolution loop auto-resume failed');
      }
    })
    .catch(() => {});

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

  // Heartbeat — periodic idle consolidation (Hermes-inspired)
  void import('./heartbeat/index.js').then(({ startHeartbeat }) => startHeartbeat()).catch(() => {});

  // Source guard — only Infinite AI may edit Infinite OS source
  void import('./guard/source-guard.js').then(({ startGuard, setViolationHandler }) => {
    const cwd = process.cwd();
    let lastWarn = 0;
    setViolationHandler((file) => {
      const now = Date.now();
      if (now - lastWarn < 10_000) return; // throttle: one warning per 10s
      lastWarn = now;
      logger.warn(`[source-guard] External edit detected: ${file} — only Infinite AI should edit Infinite OS source`);
      // Notify renderer so the UI can show a gentle hint (not a blocking error)
      try { mainWindow?.webContents.send('source-guard:violation', { file }); } catch { /* ignore */ }
    });
    startGuard(cwd);
  }).catch(() => {});

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

  // Start self-evolution loop (every 10 min) — analyze patterns, auto-create skills
  setInterval(() => {
    try {
      const result = selfEvolution.evolve();
      if (result.newSkills > 0) {
        logger.info({ newSkills: result.newSkills }, 'Self-evolution auto-created skills');
      }
      const prompt = selfEvolution.getAutomationPrompt();
      if (prompt) {
        logger.info({ prompt }, 'Self-evolution suggestion available');
      }
    } catch (err) {
      logger.warn({ err }, 'Self-evolution cycle failed');
    }
  }, 600_000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

/**
 * Flush what is still buffered before the process goes away.
 *
 * There was no `before-quit` handler at all, so anything written on a timer or
 * batched in memory was simply lost on quit. The action audit log is the one
 * that mattered: it records every tool call as it happens, and its `flush` is
 * explicitly meant for graceful shutdown but was never called. Losing it means
 * losing the record of what the agent did — which is exactly the record the
 * resume banner reconstructs its summary from.
 */
app.on('before-quit', () => {
  disposeTray();
  void import('./audit/action-log.js')
    .then(({ actionAuditLog }) => actionAuditLog.flush())
    .catch((err) => console.warn('[shutdown] action log flush failed:', err));
});

app.on('window-all-closed', () => {
  disposeTray();
  windowsDictation.stop();
  // Release the always-on voice microphone before the engine goes away, so
  // closing the last window doesn't leave dictation running.
  void import('./voice/session.js').then(({ voiceSession }) => {
    try {
      voiceSession.stop();
    } catch { /* already stopped */ }
  }).catch(() => {});
  // Shuts down the Python voice server (shutdown command + stdin EOF), so the
  // microphone is released and no orphaned process survives the app.
  disposeLocalVoice();
  // Close the loopback static server so no port is left listening after quit.
  void import('./workspace-server.js')
    .then(({ stopAllWorkspaceServers }) => stopAllWorkspaceServers())
    .catch(() => {});
  // Release the agent's detached in-app browser. It is not a child view, so it
  // needs its own shutdown or the guest process outlives the app.
  void import('./in-app-browser.js')
    .then(({ disposeInAppBrowser }) => disposeInAppBrowser())
    .catch(() => {});
  // Every in-app tab guest is a child of this window's contentView; they must be
  // released with it or they are orphaned.
  void import('./tab-browser-view.js')
    .then(({ closeAllTabBrowserViews }) => closeAllTabBrowserViews())
    .catch(() => {});
  // REA runs as a long-lived child process while an investigation is open.
  // Stop it with the window, or the node process outlives the app.
  void import('./rea/client.js')
    .then(({ reaClient }) => reaClient.close())
    .catch(() => {});
  bridgeServer.stop();
  phoneRemoteServer.stop();
  automationScheduler.stop();
  void import('./messaging/telegram-inbound.js').then(({ telegramInbound }) => {
    try {
      telegramInbound.stop();
    } catch { /* already stopped */ }
  }).catch(() => {});
  void import('./messaging/whatsapp-link.js').then(({ whatsAppLink }) => {
    try {
      whatsAppLink.stop();
    } catch { /* already stopped */ }
  }).catch(() => {});
  void browserOperator.shutdown().finally(() => {
    if (process.platform !== 'darwin') app.quit();
  });
  selfEvolution.getStatus();
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

// Hard-disable navigation to external URLs.
//
// This guard is for the APP's own surfaces: a stray link click must never
// navigate the Infinite OS window away to some external site.
//
// Tab browsing is explicitly exempt. A `<webview>` guest is its own
// WebContents, so this listener also fires for it — without the type check, the
// embedded browser in the Tabs section was blocked from loading any real
// website, which is the entire reason it exists. Guests are sandboxed into
// their own partition and cannot reach the app's preload or Node.
app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() === 'webview') return;
  contents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) e.preventDefault();
  });
});
