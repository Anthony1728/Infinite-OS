// IPC handler registration — wires every channel declared in shared/ipc.ts to a main-process function.

import { ipcMain, BrowserWindow } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { settings } from '../settings/store.js';
import { setApiKey, hasApiKey, getApiKey } from '../settings/secrets.js';
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
import { orchestrator, type OrchestratorEvent } from '../agent/orchestrator.js';
import { selectBestModel, getAllFreeModels } from '../providers/model-selector.js';
import { voiceAssistant } from '../voice/index.js';
import { videoEngine } from '../video/index.js';
import { deploySystem } from '../deploy/index.js';
import { testingFramework } from '../testing/index.js';
import { enterpriseManager } from '../enterprise/index.js';
import { callCenter } from '../callcenter/index.js';

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

  // Orchestrator IPC
  ipcMain.handle(IPC.ORCHESTRATOR_START, async (_e, { prompt, sessionId, cwd }) => {
    const win = getMainWindow();
    if (!win) throw new Error('No window');

    // Gather available providers
    const availableProviders = new Map<string, { apiKey?: string; baseUrl?: string }>();
    for (const p of listProviders()) {
      const key = await getApiKey(p.id).catch(() => undefined);
      availableProviders.set(p.id, { apiKey: key });
    }

    // Analyze and decompose the task
    const task = orchestrator.analyze(prompt, availableProviders);

    // Notify user about paid model if needed
    if (task.paidModelNotification) {
      win.webContents.send(IPC.CHAT_STREAM_EVENT, {
        sessionId,
        type: 'text_delta',
        message_id: 'system-notification',
        text: `\n\n⚠️ ${task.paidModelNotification}\n`,
      });
    }

    // Stream orchestrator events to renderer
    const sink = (e: OrchestratorEvent) => win.webContents.send(IPC.ORCHESTRATOR_EVENT, { sessionId, ...e });

    // Execute autonomously in background
    orchestrator.execute(task.id, sessionId, cwd, sink).catch(() => {});

    return { taskId: task.id, subTasks: task.subTasks.length, model: task.modelSelection };
  });

  ipcMain.handle(IPC.ORCHESTRATOR_INTERJECT, async (_e, { taskId, message }) => {
    orchestrator.interject(taskId, message);
    return { ok: true };
  });

  ipcMain.handle(IPC.ORCHESTRATOR_STATUS, async (_e, { taskId }: { taskId?: string }) => {
    if (taskId) return orchestrator.getTask(taskId);
    return orchestrator.getActiveTasks();
  });

  // Model Selector IPC
  ipcMain.handle(IPC.MODEL_SELECT, async (_e, { taskType }) => {
    const availableProviders = new Map<string, { apiKey?: string; baseUrl?: string }>();
    for (const p of listProviders()) {
      const key = await getApiKey(p.id).catch(() => undefined);
      availableProviders.set(p.id, { apiKey: key });
    }
    return selectBestModel(taskType ?? 'general', availableProviders);
  });

  ipcMain.handle(IPC.MODEL_FREE_LIST, async () => {
    return getAllFreeModels();
  });

  // Voice Assistant IPC
  ipcMain.handle(IPC.VOICE_CONFIG_GET, async () => voiceAssistant.getConfig());
  ipcMain.handle(IPC.VOICE_CONFIG_SET, async (_e, { config }) => { voiceAssistant.updateConfig(config); return { ok: true }; });
  ipcMain.handle(IPC.VOICE_START_LISTENING, async () => { voiceAssistant.setListening(true); return { ok: true }; });
  ipcMain.handle(IPC.VOICE_STOP_LISTENING, async () => { voiceAssistant.setListening(false); return { ok: true }; });
  ipcMain.handle(IPC.VOICE_PROCESS_TRANSCRIPT, async (_e, { transcript }) => voiceAssistant.processTranscript(transcript));
  ipcMain.handle(IPC.VOICE_SET_WAKE_WORD, async (_e, { word }) => { voiceAssistant.setWakeWord(word); return { ok: true }; });
  ipcMain.handle(IPC.VOICE_ADD_CUSTOM_COMMAND, async (_e, { trigger, action }) => { voiceAssistant.addCustomCommand(trigger, action); return { ok: true }; });
  ipcMain.handle(IPC.VOICE_REMOVE_CUSTOM_COMMAND, async (_e, { trigger }) => { voiceAssistant.removeCustomCommand(trigger); return { ok: true }; });
  ipcMain.handle(IPC.VOICE_CUSTOM_COMMANDS, async () => voiceAssistant.getCustomCommands());
  ipcMain.handle(IPC.VOICE_HISTORY, async () => voiceAssistant.getHistory());
  ipcMain.handle(IPC.VOICE_CLEAR_HISTORY, async () => { voiceAssistant.clearHistory(); return { ok: true }; });
  ipcMain.handle(IPC.VOICE_SPEAK, async (_e, { text }) => {
    const win = getMainWindow();
    win?.webContents.send(IPC.CHAT_STREAM_EVENT, { type: 'voice_speak', text });
    return { ok: true };
  });
  ipcMain.handle(IPC.VOICE_STATUS, async () => ({
    listening: voiceAssistant.getListening(),
    config: voiceAssistant.getConfig(),
    wakeWord: voiceAssistant.getWakeWord(),
  }));

  // Video Clipping IPC
  ipcMain.handle(IPC.VIDEO_CREATE_PROJECT, async (_e, { name, sourceFile, description }) => videoEngine.createProject(name, sourceFile, description));
  ipcMain.handle(IPC.VIDEO_LIST_PROJECTS, async () => videoEngine.listProjects());
  ipcMain.handle(IPC.VIDEO_GET_PROJECT, async (_e, { id }) => videoEngine.getProject(id) ?? null);
  ipcMain.handle(IPC.VIDEO_DELETE_PROJECT, async (_e, { id }) => videoEngine.deleteProject(id));
  ipcMain.handle(IPC.VIDEO_ANALYZE, async (_e, { projectId }) => videoEngine.analyzeVideo(projectId));
  ipcMain.handle(IPC.VIDEO_EXTRACT_CLIP, async (_e, { projectId, startTime, endTime, name, tags }) => videoEngine.extractClip({ projectId, startTime, endTime, name, tags }));
  ipcMain.handle(IPC.VIDEO_FIND_HIGHLIGHTS, async (_e, { projectId, maxClips }) => videoEngine.findHighlights(projectId, maxClips));
  ipcMain.handle(IPC.VIDEO_ADD_TRANSCRIPT, async (_e, { projectId, segments }) => { await videoEngine.addTranscript(projectId, segments); return { ok: true }; });
  ipcMain.handle(IPC.VIDEO_SPLIT_BY_CHAPTERS, async (_e, { projectId }) => videoEngine.splitByChapters(projectId));
  ipcMain.handle(IPC.VIDEO_ADD_HIGHLIGHT, async (_e, { projectId, timestamp, description }) => { videoEngine.addHighlight(projectId, timestamp, description); return { ok: true }; });

  // Deployment IPC
  ipcMain.handle(IPC.DEPLOY_CREATE_TARGET, async (_e, { name, type, config }) => deploySystem.createTarget(name, type, config));
  ipcMain.handle(IPC.DEPLOY_LIST_TARGETS, async () => deploySystem.listTargets());
  ipcMain.handle(IPC.DEPLOY_GET_TARGET, async (_e, { id }) => deploySystem.getTarget(id) ?? null);
  ipcMain.handle(IPC.DEPLOY_DELETE_TARGET, async (_e, { id }) => deploySystem.deleteTarget(id));
  ipcMain.handle(IPC.DEPLOY_CREATE_PIPELINE, async (_e, { name, projectId, targetId, commands }) => deploySystem.createPipeline(name, projectId, targetId, commands));
  ipcMain.handle(IPC.DEPLOY_RUN_PIPELINE, async (_e, { pipelineId, cwd }) => deploySystem.runPipeline(pipelineId, cwd));
  ipcMain.handle(IPC.DEPLOY_CANCEL_PIPELINE, async (_e, { pipelineId }) => deploySystem.cancelPipeline(pipelineId));
  ipcMain.handle(IPC.DEPLOY_GET_PIPELINE, async (_e, { id }) => deploySystem.getPipeline(id) ?? null);
  ipcMain.handle(IPC.DEPLOY_LIST_PIPELINES, async () => deploySystem.listPipelines());
  ipcMain.handle(IPC.DEPLOY_DETECT_PROJECT, async (_e, { projectPath }) => deploySystem.detectProjectType(projectPath));
  ipcMain.handle(IPC.DEPLOY_DEFAULT_CONFIG, async (_e, { type }) => deploySystem.getDefaultBuildConfig(type));

  // Testing Framework IPC
  ipcMain.handle(IPC.TEST_CREATE_SUITE, async (_e, { name, framework, description }) => testingFramework.createSuite(name, framework, description));
  ipcMain.handle(IPC.TEST_LIST_SUITES, async () => testingFramework.listSuites());
  ipcMain.handle(IPC.TEST_GET_SUITE, async (_e, { id }) => testingFramework.getSuite(id) ?? null);
  ipcMain.handle(IPC.TEST_DELETE_SUITE, async (_e, { id }) => testingFramework.deleteSuite(id));
  ipcMain.handle(IPC.TEST_ADD_TEST, async (_e, { suiteId, test }) => testingFramework.addTest(suiteId, test));
  ipcMain.handle(IPC.TEST_REMOVE_TEST, async (_e, { suiteId, testId }) => testingFramework.removeTest(suiteId, testId));
  ipcMain.handle(IPC.TEST_RUN_SUITE, async (_e, { suiteId }) => testingFramework.runSuite(suiteId));
  ipcMain.handle(IPC.TEST_GENERATE_TESTS, async (_e, { description, filePath }) => testingFramework.generateTests(description, filePath));
  ipcMain.handle(IPC.TEST_STATS, async () => testingFramework.getSuiteStats());
  ipcMain.handle(IPC.TEST_CREATE_PLAN, async (_e, { name, description, scope, priority }) => testingFramework.createPlan(name, description, scope, priority));
  ipcMain.handle(IPC.TEST_LIST_PLANS, async () => testingFramework.listPlans());

  // Enterprise IPC
  ipcMain.handle(IPC.ENTERPRISE_ADD_MEMBER, async (_e, { name, email, role }) => enterpriseManager.addMember(name, email, role));
  ipcMain.handle(IPC.ENTERPRISE_LIST_MEMBERS, async () => enterpriseManager.listMembers());
  ipcMain.handle(IPC.ENTERPRISE_GET_MEMBER, async (_e, { id }) => enterpriseManager.getMember(id) ?? null);
  ipcMain.handle(IPC.ENTERPRISE_UPDATE_ROLE, async (_e, { id, role }) => enterpriseManager.updateMemberRole(id, role));
  ipcMain.handle(IPC.ENTERPRISE_REMOVE_MEMBER, async (_e, { id }) => enterpriseManager.removeMember(id));
  ipcMain.handle(IPC.ENTERPRISE_CREATE_PROJECT, async (_e, { name, ownerId, description }) => enterpriseManager.createProject(name, ownerId, description));
  ipcMain.handle(IPC.ENTERPRISE_LIST_PROJECTS, async () => enterpriseManager.listProjects());
  ipcMain.handle(IPC.ENTERPRISE_ADD_MEMBER_TO_PROJECT, async (_e, { projectId, memberId }) => enterpriseManager.addMemberToProject(projectId, memberId));
  ipcMain.handle(IPC.ENTERPRISE_REMOVE_MEMBER_FROM_PROJECT, async (_e, { projectId, memberId }) => enterpriseManager.removeMemberFromProject(projectId, memberId));
  ipcMain.handle(IPC.ENTERPRISE_AUDIT_LOG, async (_e, { filters }) => enterpriseManager.getAuditLog(filters));
  ipcMain.handle(IPC.ENTERPRISE_ADD_COMPLIANCE_RULE, async (_e, { name, description, category, severity, check }) => enterpriseManager.addComplianceRule(name, description, category, severity, check));
  ipcMain.handle(IPC.ENTERPRISE_COMPLIANCE_RULES, async () => enterpriseManager.listComplianceRules());
  ipcMain.handle(IPC.ENTERPRISE_COMPLIANCE_STATUS, async () => enterpriseManager.getComplianceStatus());
  ipcMain.handle(IPC.ENTERPRISE_EXPORT_AUDIT, async () => enterpriseManager.exportAuditLog());

  // Call Center IPC
  ipcMain.handle(IPC.CALL_CREATE, async (_e, { callerId, direction, options }) => callCenter.createCall(callerId, direction, options));
  ipcMain.handle(IPC.CALL_ANSWER, async (_e, { callId, agentId }) => callCenter.answerCall(callId, agentId));
  ipcMain.handle(IPC.CALL_HOLD, async (_e, { callId }) => callCenter.holdCall(callId));
  ipcMain.handle(IPC.CALL_RESUME, async (_e, { callId }) => callCenter.resumeCall(callId));
  ipcMain.handle(IPC.CALL_END, async (_e, { callId, disposition, notes }) => callCenter.endCall(callId, disposition, notes));
  ipcMain.handle(IPC.CALL_MISS, async (_e, { callId }) => callCenter.missCall(callId));
  ipcMain.handle(IPC.CALL_GET, async (_e, { id }) => callCenter.getCall(id) ?? null);
  ipcMain.handle(IPC.CALL_LIST, async (_e, { filters }) => callCenter.listCalls(filters));
  ipcMain.handle(IPC.CALL_QUEUE_CREATE, async (_e, { name, maxWaitTime, priority }) => callCenter.createQueue(name, maxWaitTime, priority));
  ipcMain.handle(IPC.CALL_QUEUE_LIST, async () => callCenter.listQueues());
  ipcMain.handle(IPC.CALL_QUEUE_ADD, async (_e, { queueId, callId }) => callCenter.addToQueue(queueId, callId));
  ipcMain.handle(IPC.CALL_QUEUE_REMOVE, async (_e, { queueId, callId }) => callCenter.removeFromQueue(queueId, callId));
  ipcMain.handle(IPC.CALL_AGENT_CREATE, async (_e, { name, skills, maxConcurrent }) => callCenter.createAgent(name, skills, maxConcurrent));
  ipcMain.handle(IPC.CALL_AGENT_LIST, async () => callCenter.listAgents());
  ipcMain.handle(IPC.CALL_AGENT_STATUS, async (_e, { agentId, status }) => callCenter.updateAgentStatus(agentId, status));
  ipcMain.handle(IPC.CALL_ASSIGN, async (_e, { agentId, callId }) => callCenter.assignCall(agentId, callId));
  ipcMain.handle(IPC.CALL_TEMPLATE_CREATE, async (_e, { name, greeting, prompts }) => callCenter.createTemplate(name, greeting, prompts));
  ipcMain.handle(IPC.CALL_TEMPLATE_LIST, async () => callCenter.listTemplates());
  ipcMain.handle(IPC.CALL_ANALYTICS, async (_e, { since }) => callCenter.getAnalytics(since));
}
