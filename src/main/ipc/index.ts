// IPC handler registration — wires every channel declared in shared/ipc.ts to a main-process function.

import { ipcMain, BrowserWindow } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { settings } from '../settings/store.js';
import { setApiKey, hasApiKey } from '../settings/secrets.js';
import { listProviders, getProvider } from '../providers/registry.js';
import { toolRegistry } from '../tools/base.js';
import { listServers as listMcpServers, connect as mcpConnect, disconnect as mcpDisconnect } from '../mcp/manager.js';
import * as sessionStore from '../session/store.js';
import { runAgent } from '../agent/loop.js';
import { respondToPermission } from '../agent/permission-prompt.js';
import { listAgents } from '../agents/registry.js';
import { listCustomAgents, createCustomAgent, getCustomAgent, updateCustomAgent, deleteCustomAgent, customAgentToAgentType } from '../agents/custom-store.js';
import * as memoryStore from '../memory/store.js';
import { listRunStates, spawnSubagent, clearCompletedRuns } from '../agent/runtime.js';
import type { AgentId } from '../agents/types.js';
import { v4 as uuid } from 'uuid';
import type { Message } from '../../shared/types.js';
import { cpus, totalmem, freemem, loadavg, platform, hostname } from 'node:os';
import { registerBrainIpc } from './brain.js';
import { registerBrowserIpc } from './browser.js';
import { registerComputerIpc } from './computer.js';
import { registerAutomationIpc } from './automation.js';
import { registerWebsiteIpc } from './website.js';
import { registerAppIpc } from './app.js';
import { registerBusinessIpc } from './business.js';
import { registerPluginIpc } from './plugin.js';
import { registerCloudIpc } from './cloud.js';
import { registerMultiAgentIpc } from './multi-agent.js';
import { registerWorkspaceIpc } from './workspace.js';
import { SelfImprovementAgent } from '../agent/self-improvement.js';
import { SkillsManager } from '../skills/manager.js';
import { PersonalizationManager } from '../personalization/manager.js';

const activeRuns = new Map<string, AbortController>();

export function registerIpc(getMainWindow: () => BrowserWindow | null): void {
  // Chat
  ipcMain.handle(IPC.CHAT_SEND, async (_e, { sessionId, message, provider, model, cwd }) => {
    const win = getMainWindow();
    if (!win) throw new Error('No window');

    const controller = new AbortController();
    activeRuns.set(sessionId, controller);

    const userMessage: Message = { id: uuid(), role: 'user', content: message, timestamp: Date.now() };
    const history = await sessionStore.loadMessages(sessionId);
    await sessionStore.appendMessage(sessionId, userMessage);

    await runAgent(history, userMessage, {
      sessionId,
      cwd,
      provider,
      model,
      signal: controller.signal,
      onEvent: (ev) => win.webContents.send(IPC.CHAT_STREAM_EVENT, { sessionId, ...ev }),
    });

    activeRuns.delete(sessionId);
    return { ok: true };
  });

  ipcMain.handle(IPC.CHAT_ABORT, async (_e, { sessionId }) => {
    activeRuns.get(sessionId)?.abort();
    activeRuns.delete(sessionId);
    return { ok: true };
  });

  // Sessions
  ipcMain.handle(IPC.SESSION_LIST, async () => sessionStore.listSessions());
  ipcMain.handle(IPC.SESSION_CREATE, async (_e, { cwd, model, provider, title }) => sessionStore.createSession({ cwd, model, provider, title }));
  ipcMain.handle(IPC.SESSION_LOAD, async (_e, { sessionId }) => sessionStore.loadMessages(sessionId));
  ipcMain.handle(IPC.SESSION_DELETE, async (_e, { sessionId }) => { await sessionStore.deleteSession(sessionId); return { ok: true }; });

  // Settings
  ipcMain.handle(IPC.SETTINGS_GET, async (_e, { key }) => settings.get(key));
  ipcMain.handle(IPC.SETTINGS_SET, async (_e, { scope, key, value, cwd }) => { await settings.set(scope, key, value, cwd); return { ok: true }; });

  // Providers
  ipcMain.handle(IPC.PROVIDER_LIST, async () => listProviders().map((p) => ({
    id: p.id, label: p.label, requiresApiKey: p.requiresApiKey, defaultBaseUrl: p.defaultBaseUrl, freeModels: p.freeModels,
    ...(p.homepage ? { homepage: p.homepage } : {}),
  })));
  ipcMain.handle(IPC.PROVIDER_TEST, async (_e, { provider, apiKey, baseUrl }) => {
    const p = getProvider(provider);
    if (!p) return { ok: false, error: 'Unknown provider' };
    return p.testConnection(apiKey, baseUrl);
  });
  ipcMain.handle(IPC.PROVIDER_MODELS, async (_e, { provider, apiKey, baseUrl }) => {
    const p = getProvider(provider);
    if (!p) return [];
    return p.listModels(apiKey, baseUrl);
  });
  ipcMain.handle(IPC.PROVIDER_SET_KEY, async (_e, { provider, key }) => { await setApiKey(provider, key); return { ok: true }; });
  ipcMain.handle(IPC.PROVIDER_HAS_KEY, async (_e, { provider }) => hasApiKey(provider));

  // Tools
  ipcMain.handle(IPC.TOOLS_LIST, async () => toolRegistry.asProviderTools());

  // Agents (multi-agent system)
  ipcMain.handle(IPC.AGENT_LIST, async () => {
    const builtin = listAgents();
    const custom = listCustomAgents().map(customAgentToAgentType);
    return [...builtin, ...custom].map((a) => ({
      id: a.id, name: a.name, description: a.description, icon: a.icon, color: a.color,
      allowedTools: a.allowedTools, maxTurns: a.maxTurns ?? 30,
    }));
  });
  ipcMain.handle(IPC.AGENT_RUNS, async () => {
    clearCompletedRuns();
    return listRunStates();
  });
  ipcMain.handle(IPC.AGENT_SPAWN, async (_e, { agentId, task, sessionId, cwd, provider, model }) => {
    const win = getMainWindow();
    const sink = (e: unknown) => win?.webContents.send(IPC.AGENT_EVENT, e);
    const { state, done } = spawnSubagent({
      agentId: agentId as AgentId,
      task,
      sessionId,
      cwd,
      provider,
      model,
      parentHistory: [],
      sink,
    });
    done.catch(() => {}); // don't await — fire and forget
    return state;
  });

  // Custom Agents
  ipcMain.handle(IPC.CUSTOM_AGENT_CREATE, async (_e, { agent }) => createCustomAgent(agent));
  ipcMain.handle(IPC.CUSTOM_AGENT_LIST, async () => listCustomAgents());
  ipcMain.handle(IPC.CUSTOM_AGENT_GET, async (_e, { id }) => getCustomAgent(id));
  ipcMain.handle(IPC.CUSTOM_AGENT_UPDATE, async (_e, { id, updates }) => updateCustomAgent(id, updates));
  ipcMain.handle(IPC.CUSTOM_AGENT_DELETE, async (_e, { id }) => deleteCustomAgent(id));

  // Memory
  ipcMain.handle(IPC.MEMORY_CREATE, async (_e, { entry }) => memoryStore.createMemory(entry));
  ipcMain.handle(IPC.MEMORY_LIST, async (_e, { type, search }) => memoryStore.listMemories(type, search));
  ipcMain.handle(IPC.MEMORY_GET, async (_e, { id }) => memoryStore.getMemory(id));
  ipcMain.handle(IPC.MEMORY_UPDATE, async (_e, { id, updates }) => memoryStore.updateMemory(id, updates));
  ipcMain.handle(IPC.MEMORY_DELETE, async (_e, { id }) => memoryStore.deleteMemory(id));
  ipcMain.handle(IPC.MEMORY_SEARCH, async (_e, { query }) => memoryStore.searchMemories(query));
  ipcMain.handle(IPC.MEMORY_STATS, async () => memoryStore.getMemoryStats());

  // MCP
  ipcMain.handle(IPC.MCP_LIST_SERVERS, async () => listMcpServers());
  ipcMain.handle(IPC.MCP_CONNECT, async (_e, { name, config }) => { await mcpConnect(name, config); return { ok: true }; });
  ipcMain.handle(IPC.MCP_DISCONNECT, async (_e, { name }) => { await mcpDisconnect(name); return { ok: true }; });

  // Permissions
  ipcMain.handle(IPC.PERMISSION_RESPONSE, async (_e, { id, allowed }) => { respondToPermission(id, allowed); return { ok: true }; });

  // File System
  ipcMain.handle(IPC.FILE_READ, async (_e, { path: filePath }: { path: string }) => {
    try {
      const { readFile, stat } = await import('node:fs/promises');
      const s = await stat(filePath);
      if (s.isDirectory()) {
        const { readdir } = await import('node:fs/promises');
        const entries = await readdir(filePath, { withFileTypes: true });
        return {
          type: 'directory',
          entries: entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory() })),
        };
      }
      const content = await readFile(filePath, 'utf8');
      return { type: 'file', content, size: s.size };
    } catch (e) {
      return { error: (e as Error).message };
    }
  });

  ipcMain.handle(IPC.FILE_WRITE, async (_e, { path: filePath, content }: { path: string; content: string }) => {
    try {
      const { writeFile, mkdir } = await import('node:fs/promises');
      const { dirname } = await import('node:path');
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content, 'utf8');
      return { ok: true };
    } catch (e) {
      return { error: (e as Error).message };
    }
  });

  // App
  ipcMain.handle(IPC.APP_VERSION, async () => '0.1.0');

  // System Metrics
  ipcMain.handle(IPC.METRICS_GET, async () => {
    const cpuInfo = cpus();
    const load = loadavg();
    const totalMem = totalmem();
    const freeMem = freemem();
    const usedMem = totalMem - freeMem;
    const cpuUsage = Math.min(100, Math.round((load[0] / cpuInfo.length) * 100));
    const ramUsage = Math.round((usedMem / totalMem) * 100);
    return {
      cpu: cpuUsage,
      cpuCores: cpuInfo.length,
      ram: ramUsage,
      ramUsed: (usedMem / 1073741824).toFixed(1),
      ramTotal: (totalMem / 1073741824).toFixed(1),
      load1: load[0].toFixed(2),
      load5: load[1].toFixed(2),
      load15: load[2].toFixed(2),
      platform: platform(),
      hostname: hostname(),
    };
  });

  // Brain subsystem IPC
  registerBrainIpc();

  // Phase 2 IPC
  registerBrowserIpc();
  registerComputerIpc();
  registerAutomationIpc();

  // Phase 3 IPC
  registerWebsiteIpc();
  registerAppIpc();
  registerBusinessIpc();
  registerPluginIpc();

  // Phase 4 IPC
  registerCloudIpc();
  registerMultiAgentIpc();
  registerWorkspaceIpc();

  // Self-Improvement Agent IPC
  ipcMain.handle('self-improvement:audit', async (_e, { cwd }: { cwd: string }) => {
    const agent = new SelfImprovementAgent(cwd);
    return agent.runFullAudit();
  });
  ipcMain.handle('self-improvement:status', async (_e, { cwd }: { cwd: string }) => {
    const agent = new SelfImprovementAgent(cwd);
    return agent.getLastReport();
  });

  // Skills IPC
  ipcMain.handle('skills:list', async () => {
    const mgr = new SkillsManager();
    return mgr.listAllSkills();
  });
  ipcMain.handle('skills:get', async (_e, { id }: { id: string }) => {
    const mgr = new SkillsManager();
    return mgr.getSkill(id) ?? null;
  });
  ipcMain.handle('skills:create', async (_e, { skill }: { skill: Parameters<SkillsManager['addSkill']>[0] }) => {
    const mgr = new SkillsManager();
    return mgr.addSkill(skill);
  });
  ipcMain.handle('skills:update', async (_e, { id, updates }: { id: string; updates: Record<string, unknown> }) => {
    const mgr = new SkillsManager();
    return mgr.updateSkill(id, updates as Parameters<SkillsManager['updateSkill']>[1]);
  });
  ipcMain.handle('skills:delete', async (_e, { id }: { id: string }) => {
    const mgr = new SkillsManager();
    return mgr.removeSkill(id);
  });
  ipcMain.handle('skills:toggle', async (_e, { id }: { id: string }) => {
    const mgr = new SkillsManager();
    return mgr.toggleSkill(id);
  });
  ipcMain.handle('skills:search', async (_e, { query }: { query: string }) => {
    const mgr = new SkillsManager();
    return mgr.searchSkills(query);
  });
  ipcMain.handle('skills:stats', async () => {
    const mgr = new SkillsManager();
    return mgr.getStats();
  });
  ipcMain.handle('skills:import-claude', async (_e, { filePath }: { filePath: string }) => {
    const mgr = new SkillsManager();
    return mgr.importClaudeCodeSkill(filePath);
  });
  ipcMain.handle('skills:relevant', async (_e, { task }: { task: string }) => {
    const mgr = new SkillsManager();
    return mgr.getRelevantSkills(task);
  });

  // Personalization IPC
  ipcMain.handle('profile:get', async () => {
    const mgr = new PersonalizationManager();
    return mgr.getProfile();
  });
  ipcMain.handle('profile:update', async (_e, { updates }: { updates: Record<string, unknown> }) => {
    const mgr = new PersonalizationManager();
    return mgr.updateProfile(updates as Parameters<PersonalizationManager['updateProfile']>[0]);
  });
  ipcMain.handle('profile:preferences', async (_e, { prefs }: { prefs: Record<string, unknown> }) => {
    const mgr = new PersonalizationManager();
    return mgr.updatePreferences(prefs as Parameters<PersonalizationManager['updatePreferences']>[0]);
  });
  ipcMain.handle('profile:business', async (_e, { ctx }: { ctx: Record<string, unknown> }) => {
    const mgr = new PersonalizationManager();
    return mgr.updateBusinessContext(ctx as Parameters<PersonalizationManager['updateBusinessContext']>[0]);
  });
  ipcMain.handle('profile:context', async () => {
    const mgr = new PersonalizationManager();
    return mgr.getPersonalizedContext();
  });
  ipcMain.handle('profile:suggestions', async () => {
    const mgr = new PersonalizationManager();
    return mgr.suggestImprovements();
  });
}
