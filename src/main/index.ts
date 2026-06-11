// Electron main process entry — creates the window, registers IPC, wires auto-update.

import { app, BrowserWindow, shell, Menu } from 'electron';
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
import { ComputerControlAgent } from './agent/computer.js';
import { AutomationBuilder } from './automation/builder.js';
import { WebsiteBuilder } from './builders/website.js';
import { AppBuilder } from './builders/app.js';
import { BusinessOS } from './business/crm.js';
import { PluginStore } from './plugins/store.js';
import { CloudSync } from './cloud/sync.js';
import { MultiAgentSystem } from './team/multi-agent.js';
import { TeamWorkspaces } from './team/workspaces.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Disable hardware acceleration to prevent GPU process crashes on some systems
app.disableHardwareAcceleration();

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
export const computerControl = new ComputerControlAgent();
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
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // Open DevTools automatically to surface render errors
  if (process.env['INFINITY_DEVTOOLS'] === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.webContents.on('console-message', (_e, level, message, line, source) => {
    const tag = ['V', 'I', 'W', 'E'][level] ?? '?';
    console.log(`[renderer ${tag}] ${message} (${source}:${line})`);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer] crashed:', details);
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
  logger.info('brain', 'Brain subsystems initialized');

  registerIpc(() => mainWindow);
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

// Hard-disable navigation to external URLs
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) e.preventDefault();
  });
});
