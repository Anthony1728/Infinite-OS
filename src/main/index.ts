// Electron main process entry — creates the window, registers IPC, wires auto-update.

import { app, BrowserWindow, shell, Menu, nativeImage } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerIpc } from './ipc/index.js';
import { registerBuiltinTools } from './tools/registry.js';
import { settings } from './settings/store.js';
import { connectAll as mcpConnectAll } from './mcp/manager.js';
import { logger } from './util/logger.js';
import { InfiniteBrain } from './brain/core.js';
import { DecisionRouter } from './brain/router.js';
import { SafetyGovernor } from './brain/safety.js';
import { OfflineManager } from './brain/offline.js';
import { ReasoningLoop } from './brain/reasoning.js';
import { WorkflowEngine } from './brain/workflow.js';
import { SystemMonitor } from './brain/monitor.js';
import { SelfImprovementEngine } from './brain/improvement.js';
import { ToolMarketplace } from './brain/marketplace.js';
import { DeveloperSDK } from './brain/sdk.js';
import { BrowserAgent } from './agent/browser.js';

import { AutomationBuilder } from './automation/builder.js';
import { WebsiteBuilder } from './builders/website.js';
import { AppBuilder } from './builders/app.js';
import { BusinessOS } from './business/crm.js';
import { PluginStore } from './plugins/store.js';
import { CloudSync } from './cloud/sync.js';
import { MultiAgentSystem } from './team/multi-agent.js';
import { TeamWorkspaces } from './team/workspaces.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

// Brain subsystem instances
export const brain = new InfiniteBrain();
export const router = new DecisionRouter();
export const safety = new SafetyGovernor();
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
export const automationBuilder = new AutomationBuilder();

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

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Infinite AI',
    backgroundColor: '#0e0e10',
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

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  registerBuiltinTools();

  const cwd = process.cwd();
  await settings.load(cwd);
  await mcpConnectAll(cwd).catch((e) => logger.warn('mcp', e.message));

  // Start brain subsystems (instantiated and ready for IPC calls)
  logger.info('Brain subsystems initialized');

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
    } catch (err) {
      logger.warn({ err }, 'Brain improvement cycle failed');
    }
  }, 300_000);

  await registerIpc(() => mainWindow);
  createWindow();
  Menu.setApplicationMenu(null);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Prevent crashes from unhandled promise rejections
process.on('unhandledRejection', (reason) => {
  console.error('[main] Unhandled promise rejection:', reason);
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

