import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc.js';

const api = {
  sendMessage: (args: { sessionId: string; message: unknown; displayMessage?: unknown; provider: string; model: string; cwd: string }) =>
    ipcRenderer.invoke(IPC.CHAT_SEND, args),
  abortMessage: (args: { sessionId: string }) => ipcRenderer.invoke(IPC.CHAT_ABORT, args),
  interjectMessage: (args: { sessionId: string; message: string }) => ipcRenderer.invoke(IPC.CHAT_INTERJECT, args),
  operatorBrowserSearch: (args: { query: string }) => ipcRenderer.invoke(IPC.OPERATOR_BROWSER_SEARCH, args),
  operatorBrowserNavigate: (args: { url: string }) => ipcRenderer.invoke(IPC.OPERATOR_BROWSER_NAVIGATE, args),
  operatorBrowserShutdown: () => ipcRenderer.invoke(IPC.OPERATOR_BROWSER_SHUTDOWN),
  bridgeStatus: () => ipcRenderer.invoke(IPC.BRIDGE_STATUS),
  bridgeExec: (args: { command: string; params?: Record<string, unknown>; timeoutMs?: number }) =>
    ipcRenderer.invoke(IPC.BRIDGE_EXEC, args),
  onStreamEvent: (cb: (e: unknown) => void) => {
    const handler = (_e: unknown, payload: unknown) => {
      cb(payload);
    };
    ipcRenderer.on(IPC.CHAT_STREAM_EVENT, handler);
    return () => ipcRenderer.removeListener(IPC.CHAT_STREAM_EVENT, handler);
  },

  listSessions: () => ipcRenderer.invoke(IPC.SESSION_LIST),
  createSession: (args: { cwd: string; model: string; provider: string; title?: string }) =>
    ipcRenderer.invoke(IPC.SESSION_CREATE, args),
  loadSession: (args: { sessionId: string }) => ipcRenderer.invoke(IPC.SESSION_LOAD, args),
  deleteSession: (args: { sessionId: string }) => ipcRenderer.invoke(IPC.SESSION_DELETE, args),
  clearAllSessions: () => ipcRenderer.invoke(IPC.SESSION_CLEAR_ALL),
  renameSession: (args: { sessionId: string; title: string }) => ipcRenderer.invoke(IPC.SESSION_RENAME, args),
  pinSession: (args: { sessionId: string; pinned: boolean }) => ipcRenderer.invoke(IPC.SESSION_PIN, args),
  searchSessions: (args: { query: string }) => ipcRenderer.invoke(IPC.SESSION_SEARCH, args),
  branchSession: (args: { sessionId: string; messageId?: string }) => ipcRenderer.invoke(IPC.SESSION_BRANCH, args),
  updateSessionMessage: (args: { sessionId: string; messageId: string; content: unknown }) =>
    ipcRenderer.invoke(IPC.SESSION_UPDATE_MESSAGE, args),
  exportSession: (args: { sessionId: string; format?: 'markdown' | 'json' }) =>
    ipcRenderer.invoke(IPC.SESSION_EXPORT, args),
  importSession: (args: { format: 'markdown' | 'json'; content: string; cwd: string; model: string; provider: string }) =>
    ipcRenderer.invoke(IPC.SESSION_IMPORT, args),
  shareSession: (args: { sessionId: string }) => ipcRenderer.invoke(IPC.SESSION_SHARE, args),
  appendSessionMessage: (args: { sessionId: string; message: unknown }) => ipcRenderer.invoke(IPC.SESSION_APPEND, args),

  getSetting: (args: { key: string }) => ipcRenderer.invoke(IPC.SETTINGS_GET, args),
  setSetting: (args: { scope: 'user' | 'project' | 'local'; key: string; value: unknown; cwd: string }) =>
    ipcRenderer.invoke(IPC.SETTINGS_SET, args),

  listProviders: () => ipcRenderer.invoke(IPC.PROVIDER_LIST),
  testProvider: (args: { provider: string; apiKey: string; baseUrl?: string }) =>
    ipcRenderer.invoke(IPC.PROVIDER_TEST, args),
  listProviderModels: (args: { provider: string; apiKey?: string; baseUrl?: string }) =>
    ipcRenderer.invoke(IPC.PROVIDER_MODELS, args),
  setProviderKey: (args: { provider: string; key: string }) => ipcRenderer.invoke(IPC.PROVIDER_SET_KEY, args),
  hasProviderKey: (args: { provider: string }) => ipcRenderer.invoke(IPC.PROVIDER_HAS_KEY, args),

  listTools: () => ipcRenderer.invoke(IPC.TOOLS_LIST),

  listAgents: () => ipcRenderer.invoke(IPC.AGENT_LIST),
  listAgentRuns: () => ipcRenderer.invoke(IPC.AGENT_RUNS),
  spawnAgent: (args: {
    agentId: string;
    task: string;
    sessionId: string;
    cwd: string;
    provider: string;
    model: string;
  }) => ipcRenderer.invoke(IPC.AGENT_SPAWN, args),
  abortAgent: (args: { runId: string }) => ipcRenderer.invoke(IPC.AGENT_ABORT, args),
  onAgentEvent: (cb: (e: unknown) => void) => {
    const handler = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(IPC.AGENT_EVENT, handler);
    return () => ipcRenderer.removeListener(IPC.AGENT_EVENT, handler);
  },

  createCustomAgent: (args: {
    agent: {
      name: string;
      description: string;
      icon: string;
      color: string;
      systemPrompt: string;
      allowedTools: string[];
      maxTurns: number;
      model?: string;
      provider?: string;
      soul?: string;
      avatarSeed?: string;
    };
  }) => ipcRenderer.invoke(IPC.CUSTOM_AGENT_CREATE, args),
  listCustomAgents: () => ipcRenderer.invoke(IPC.CUSTOM_AGENT_LIST),
  getCustomAgent: (args: { id: string }) => ipcRenderer.invoke(IPC.CUSTOM_AGENT_GET, args),
  updateCustomAgent: (args: { id: string; updates: Record<string, unknown> }) =>
    ipcRenderer.invoke(IPC.CUSTOM_AGENT_UPDATE, args),
  deleteCustomAgent: (args: { id: string }) => ipcRenderer.invoke(IPC.CUSTOM_AGENT_DELETE, args),

  createMemory: (args: {
    type: string; title: string; content: string; tags: string[]; sessionId?: string;
  }) => ipcRenderer.invoke(IPC.MEMORY_CREATE, { entry: args }),
  listMemories: (args?: { type?: string; search?: string }) => ipcRenderer.invoke(IPC.MEMORY_LIST, args ?? {}),
  getMemory: (args: { id: string }) => ipcRenderer.invoke(IPC.MEMORY_GET, args),
  updateMemory: (args: { id: string; updates: Record<string, unknown> }) => ipcRenderer.invoke(IPC.MEMORY_UPDATE, args),
  deleteMemory: (args: { id: string }) => ipcRenderer.invoke(IPC.MEMORY_DELETE, args),
  searchMemories: (args: { query: string }) => ipcRenderer.invoke(IPC.MEMORY_SEARCH, args),
  getMemoryStats: () => ipcRenderer.invoke(IPC.MEMORY_STATS),

  listMcpServers: () => ipcRenderer.invoke(IPC.MCP_LIST_SERVERS),
  connectMcp: (args: { name: string; config: { command: string; args?: string[]; env?: Record<string, string> } }) =>
    ipcRenderer.invoke(IPC.MCP_CONNECT, args),
  disconnectMcp: (args: { name: string }) => ipcRenderer.invoke(IPC.MCP_DISCONNECT, args),
  mcpStatus: () => ipcRenderer.invoke(IPC.MCP_STATUS),
  mcpListTools: (args?: { name?: string }) => ipcRenderer.invoke(IPC.MCP_LIST_TOOLS, args),
  openExternal: (url: string) => ipcRenderer.invoke(IPC.APP_OPEN_EXTERNAL, url),

  respondPermission: (args: { id: string; allowed: boolean }) => ipcRenderer.invoke(IPC.PERMISSION_RESPONSE, args),
  onPermissionRequest: (cb: (e: { id: string; tool: string; input: unknown }) => void) => {
    const handler = (_e: unknown, payload: { id: string; tool: string; input: unknown }) => cb(payload);
    ipcRenderer.on(IPC.PERMISSION_REQUEST, handler);
    return () => ipcRenderer.removeListener(IPC.PERMISSION_REQUEST, handler);
  },

  // Files
  fileRead: (args: { path: string }) => ipcRenderer.invoke(IPC.FILE_READ, args),
  fileWrite: (args: { path: string; content: string }) => ipcRenderer.invoke(IPC.FILE_WRITE, args),
  fileOpen: (args: { path: string }) => ipcRenderer.invoke(IPC.FILE_OPEN, args),
  pickDirectory: () => ipcRenderer.invoke(IPC.PICK_DIRECTORY),
  fileSystemRoots: () => ipcRenderer.invoke(IPC.FILE_SYSTEM_ROOTS),
  fileMkdir: (args: { path: string }) => ipcRenderer.invoke(IPC.FILE_MKDIR, args),
  fileDelete: (args: { path: string }) => ipcRenderer.invoke(IPC.FILE_DELETE, args),
  fileRename: (args: { oldPath: string; newPath: string }) => ipcRenderer.invoke(IPC.FILE_RENAME, args),
  fileCopy: (args: { src: string; dest: string }) => ipcRenderer.invoke(IPC.FILE_COPY, args),
  fileStat: (args: { path: string }) => ipcRenderer.invoke(IPC.FILE_STAT, args),
  terminalExecute: (args: { command: string; cwd?: string }) => ipcRenderer.invoke(IPC.TERMINAL_EXECUTE, args),

  // App
  appVersion: () => ipcRenderer.invoke(IPC.APP_VERSION),
  getMetrics: () => ipcRenderer.invoke(IPC.METRICS_GET),

  // Brain
  brainStatus: () => ipcRenderer.invoke(IPC.BRAIN_STATUS),
  brainDecide: (args: unknown) => ipcRenderer.invoke(IPC.BRAIN_DECIDE, args),
  brainSafetyValidate: (args: unknown) => ipcRenderer.invoke(IPC.BRAIN_SAFETY_VALIDATE, args),
  brainOfflineStatus: () => ipcRenderer.invoke(IPC.BRAIN_OFFLINE_STATUS),
  brainReason: (args: unknown) => ipcRenderer.invoke(IPC.BRAIN_REASON, args),
  brainWorkflowRun: (args: unknown) => ipcRenderer.invoke(IPC.BRAIN_WORKFLOW_RUN, args),
  brainWorkflowStatus: (args: unknown) => ipcRenderer.invoke(IPC.BRAIN_WORKFLOW_STATUS, args),
  brainMonitorMetrics: () => ipcRenderer.invoke(IPC.BRAIN_MONITOR_METRICS),
  brainMonitorAlerts: () => ipcRenderer.invoke(IPC.BRAIN_MONITOR_ALERTS),
  brainImproveStats: () => ipcRenderer.invoke(IPC.BRAIN_IMPROVE_STATS),
  brainImproveRecord: (args: unknown) => ipcRenderer.invoke(IPC.BRAIN_IMPROVE_RECORD, args),
  brainMarketplaceList: () => ipcRenderer.invoke(IPC.BRAIN_MARKETPLACE_LIST),
  brainMarketplaceSearch: (args: unknown) => ipcRenderer.invoke(IPC.BRAIN_MARKETPLACE_SEARCH, args),
  brainMarketplaceInstall: (args: unknown) => ipcRenderer.invoke(IPC.BRAIN_MARKETPLACE_INSTALL, args),
  brainSdkInfo: () => ipcRenderer.invoke(IPC.BRAIN_SDK_INFO),
  brainSdkCreateTool: (args: unknown) => ipcRenderer.invoke(IPC.BRAIN_SDK_CREATE_TOOL, args),
  brainTeachStart: (args: {
    durationMinutes: number;
    source?: 'curriculum' | 'topic' | 'conversation' | 'last-task' | 'online';
    topic?: string;
    context?: string;
    focus?: string;
    provider?: string;
    model?: string;
  }) =>
    ipcRenderer.invoke(IPC.BRAIN_TEACH_START, args),
  brainTeachStop: () => ipcRenderer.invoke(IPC.BRAIN_TEACH_STOP),
  brainTeachStatus: () => ipcRenderer.invoke(IPC.BRAIN_TEACH_STATUS),
  onBrainTeachEvent: (cb: (event: unknown) => void) => {
    const handler = (_event: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(IPC.BRAIN_TEACH_EVENT, handler);
    return () => ipcRenderer.removeListener(IPC.BRAIN_TEACH_EVENT, handler);
  },
  brainLearnInteraction: (args: {
    request: string;
    response: string;
    provider: string;
    model: string;
    durationMs?: number;
    success: boolean;
  }) => ipcRenderer.invoke(IPC.BRAIN_LEARN_INTERACTION, args),
  brainLearnStats: () => ipcRenderer.invoke(IPC.BRAIN_LEARN_STATS),

  // ── System Doctor ──
  brainDoctorHealth: () => ipcRenderer.invoke('brain:doctor:health'),
  brainDoctorRunCheck: () => ipcRenderer.invoke('brain:doctor:runCheck'),

  // ── Self-Improvement ──
  brainImproveRun: () => ipcRenderer.invoke('brain:improve:run'),
  brainImprovePatterns: () => ipcRenderer.invoke('brain:improve:patterns'),
  brainImproveErrors: () => ipcRenderer.invoke('brain:improve:errors'),
  brainImproveActions: () => ipcRenderer.invoke('brain:improve:actions'),

  // ── Brain Memory ──
  brainMemoryLearning: () => ipcRenderer.invoke('brain:memory:learning'),
  brainMemoryPerformance: () => ipcRenderer.invoke('brain:memory:performance'),
  brainMemoryEvents: (args?: { count?: number }) => ipcRenderer.invoke('brain:memory:events', args ?? {}),

  // ── Intelligence Engine ──
  engineStatus: () => ipcRenderer.invoke(IPC.ENGINE_STATUS),
  engineBootstrap: () => ipcRenderer.invoke(IPC.ENGINE_BOOTSTRAP),

  // Browser Agent
  browserCreateSession: (args?: unknown) => ipcRenderer.invoke(IPC.BROWSER_CREATE_SESSION, args),
  browserNavigate: (args: unknown) => ipcRenderer.invoke(IPC.BROWSER_NAVIGATE, args),
  browserClick: (args: unknown) => ipcRenderer.invoke(IPC.BROWSER_CLICK, args),
  browserType: (args: unknown) => ipcRenderer.invoke(IPC.BROWSER_TYPE, args),
  browserScreenshot: (args: unknown) => ipcRenderer.invoke(IPC.BROWSER_SCREENSHOT, args),
  browserExtract: (args: unknown) => ipcRenderer.invoke(IPC.BROWSER_EXTRACT, args),
  browserFillForm: (args: unknown) => ipcRenderer.invoke(IPC.BROWSER_FILL_FORM, args),
  browserListSessions: () => ipcRenderer.invoke(IPC.BROWSER_LIST_SESSIONS),
  browserDeleteSession: (args: unknown) => ipcRenderer.invoke(IPC.BROWSER_DELETE_SESSION, args),
  browserStats: () => ipcRenderer.invoke(IPC.BROWSER_STATS),

  // Automation
  automationCreateWorkflow: (args: unknown) => ipcRenderer.invoke(IPC.AUTOMATION_CREATE_WORKFLOW, args),
  automationRunWorkflow: (args: unknown) => ipcRenderer.invoke(IPC.AUTOMATION_RUN_WORKFLOW, args),
  onAutomationRunEvent: (cb: (event: unknown) => void) => {
    const handler = (_event: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(IPC.AUTOMATION_RUN_EVENT, handler);
    return () => ipcRenderer.removeListener(IPC.AUTOMATION_RUN_EVENT, handler);
  },
  automationListWorkflows: () => ipcRenderer.invoke(IPC.AUTOMATION_LIST_WORKFLOWS),
  automationGetWorkflow: (args: unknown) => ipcRenderer.invoke(IPC.AUTOMATION_GET_WORKFLOW, args),
  automationEnableWorkflow: (args: unknown) => ipcRenderer.invoke(IPC.AUTOMATION_ENABLE_WORKFLOW, args),
  automationDisableWorkflow: (args: unknown) => ipcRenderer.invoke(IPC.AUTOMATION_DISABLE_WORKFLOW, args),
  automationDeleteWorkflow: (args: unknown) => ipcRenderer.invoke(IPC.AUTOMATION_DELETE_WORKFLOW, args),
  automationAddAction: (args: unknown) => ipcRenderer.invoke(IPC.AUTOMATION_ADD_ACTION, args),
  automationGetTemplates: () => ipcRenderer.invoke(IPC.AUTOMATION_GET_TEMPLATES),
  automationGetRuns: (args: unknown) => ipcRenderer.invoke(IPC.AUTOMATION_GET_RUNS, args),
  automationStats: () => ipcRenderer.invoke(IPC.AUTOMATION_STATS),
  automationSchedulerStatus: () => ipcRenderer.invoke(IPC.AUTOMATION_SCHEDULER_STATUS),
  automationSetKeepAwake: (enabled: boolean) => ipcRenderer.invoke(IPC.AUTOMATION_SET_KEEP_AWAKE, { enabled }),
  automationNextRuns: () => ipcRenderer.invoke(IPC.AUTOMATION_NEXT_RUNS),
  automationCancelRun: (args: unknown) => ipcRenderer.invoke(IPC.AUTOMATION_CANCEL_RUN, args),
  automationCreateFromNL: (args: unknown) => ipcRenderer.invoke(IPC.AUTOMATION_CREATE_FROM_NL, args),

  // Phone remote
  remotePhoneInfo: () => ipcRenderer.invoke(IPC.REMOTE_PHONE_INFO),

  // Website Builder
  websiteCreate: (args: unknown) => ipcRenderer.invoke(IPC.WEBSITE_CREATE, args),
  websiteList: () => ipcRenderer.invoke(IPC.WEBSITE_LIST),
  websiteGet: (args: unknown) => ipcRenderer.invoke(IPC.WEBSITE_GET, args),
  websiteAddPage: (args: unknown) => ipcRenderer.invoke(IPC.WEBSITE_ADD_PAGE, args),
  websiteAddComponent: (args: unknown) => ipcRenderer.invoke(IPC.WEBSITE_ADD_COMPONENT, args),
  websiteGenerateCode: (args: unknown) => ipcRenderer.invoke(IPC.WEBSITE_GENERATE_CODE, args),
  websitePublish: (args: unknown) => ipcRenderer.invoke(IPC.WEBSITE_PUBLISH, args),
  websiteDeploy: (args: unknown) => ipcRenderer.invoke(IPC.WEBSITE_DEPLOY, args),
  websiteDelete: (args: unknown) => ipcRenderer.invoke(IPC.WEBSITE_DELETE, args),
  websiteTemplates: () => ipcRenderer.invoke(IPC.WEBSITE_TEMPLATES),
  websiteStats: () => ipcRenderer.invoke(IPC.WEBSITE_STATS),

  // App Builder
  appCreateProject: (args: unknown) => ipcRenderer.invoke(IPC.APP_CREATE_PROJECT, args),
  appListProjects: () => ipcRenderer.invoke(IPC.APP_LIST_PROJECTS),
  appGetProject: (args: unknown) => ipcRenderer.invoke(IPC.APP_GET_PROJECT, args),
  appAddFile: (args: unknown) => ipcRenderer.invoke(IPC.APP_ADD_FILE, args),
  appGenerateComponent: (args: unknown) => ipcRenderer.invoke(IPC.APP_GENERATE_COMPONENT, args),
  appGeneratePage: (args: unknown) => ipcRenderer.invoke(IPC.APP_GENERATE_PAGE, args),
  appGenerateApi: (args: unknown) => ipcRenderer.invoke(IPC.APP_GENERATE_API, args),
  appBuild: (args: unknown) => ipcRenderer.invoke(IPC.APP_BUILD, args),
  appRename: (args: unknown) => ipcRenderer.invoke(IPC.APP_RENAME, args),
  appMove: (args: unknown) => ipcRenderer.invoke(IPC.APP_MOVE, args),
  appRun: (args: unknown) => ipcRenderer.invoke(IPC.APP_RUN, args),
  appDelete: (args: unknown) => ipcRenderer.invoke(IPC.APP_DELETE, args),
  appTemplates: () => ipcRenderer.invoke(IPC.APP_TEMPLATES),
  appStats: () => ipcRenderer.invoke(IPC.APP_STATS),

  // Business Command Center
  businessCreateContact: (args: unknown) => ipcRenderer.invoke(IPC.BUSINESS_CREATE_CONTACT, args),
  businessUpdateContact: (args: unknown) => ipcRenderer.invoke(IPC.BUSINESS_UPDATE_CONTACT, args),
  businessDeleteContact: (args: unknown) => ipcRenderer.invoke(IPC.BUSINESS_DELETE_CONTACT, args),
  businessListContacts: () => ipcRenderer.invoke(IPC.BUSINESS_LIST_CONTACTS),
  businessCreateLead: (args: unknown) => ipcRenderer.invoke(IPC.BUSINESS_CREATE_LEAD, args),
  businessUpdateLeadStatus: (args: unknown) => ipcRenderer.invoke(IPC.BUSINESS_UPDATE_LEAD_STATUS, args),
  businessListLeads: () => ipcRenderer.invoke(IPC.BUSINESS_LIST_LEADS),
  businessCreateInvoice: (args: unknown) => ipcRenderer.invoke(IPC.BUSINESS_CREATE_INVOICE, args),
  businessUpdateInvoiceStatus: (args: unknown) => ipcRenderer.invoke(IPC.BUSINESS_UPDATE_INVOICE_STATUS, args),
  businessListInvoices: () => ipcRenderer.invoke(IPC.BUSINESS_LIST_INVOICES),
  businessCreateDeal: (args: unknown) => ipcRenderer.invoke(IPC.BUSINESS_CREATE_DEAL, args),
  businessUpdateDealStage: (args: unknown) => ipcRenderer.invoke(IPC.BUSINESS_UPDATE_DEAL_STAGE, args),
  businessListDeals: () => ipcRenderer.invoke(IPC.BUSINESS_LIST_DEALS),
  businessAnalytics: () => ipcRenderer.invoke(IPC.BUSINESS_ANALYTICS),
  businessStats: () => ipcRenderer.invoke(IPC.BUSINESS_STATS),

  // Plugin Store
  pluginInstall: (args: unknown) => ipcRenderer.invoke(IPC.PLUGIN_INSTALL, args),
  pluginUninstall: (args: unknown) => ipcRenderer.invoke(IPC.PLUGIN_UNINSTALL, args),
  pluginEnable: (args: unknown) => ipcRenderer.invoke(IPC.PLUGIN_ENABLE, args),
  pluginDisable: (args: unknown) => ipcRenderer.invoke(IPC.PLUGIN_DISABLE, args),
  pluginUpdateConfig: (args: unknown) => ipcRenderer.invoke(IPC.PLUGIN_UPDATE_CONFIG, args),
  pluginSearch: (args: unknown) => ipcRenderer.invoke(IPC.PLUGIN_SEARCH, args),
  pluginList: () => ipcRenderer.invoke(IPC.PLUGIN_LIST),
  pluginGet: (args: unknown) => ipcRenderer.invoke(IPC.PLUGIN_GET, args),
  pluginCategories: () => ipcRenderer.invoke(IPC.PLUGIN_CATEGORIES),
  pluginStats: () => ipcRenderer.invoke(IPC.PLUGIN_STATS),

  // Cloud Sync
  cloudRegisterDevice: (args?: unknown) => ipcRenderer.invoke(IPC.CLOUD_REGISTER_DEVICE, args),
  cloudSyncData: (args: unknown) => ipcRenderer.invoke(IPC.CLOUD_SYNC_DATA, args),
  cloudCreateBackup: (args?: unknown) => ipcRenderer.invoke(IPC.CLOUD_CREATE_BACKUP, args),
  cloudRestoreBackup: (args: unknown) => ipcRenderer.invoke(IPC.CLOUD_RESTORE_BACKUP, args),
  cloudListDevices: () => ipcRenderer.invoke(IPC.CLOUD_LIST_DEVICES),
  cloudRecentRecords: () => ipcRenderer.invoke(IPC.CLOUD_RECENT_RECORDS),
  cloudListBackups: () => ipcRenderer.invoke(IPC.CLOUD_LIST_BACKUPS),
  cloudStats: () => ipcRenderer.invoke(IPC.CLOUD_STATS),

  // Multi-Agent
  multiAgentCreateTeam: (args: unknown) => ipcRenderer.invoke(IPC.MULTI_AGENT_CREATE_TEAM, args),
  multiAgentAddToTeam: (args: unknown) => ipcRenderer.invoke(IPC.MULTI_AGENT_ADD_TO_TEAM, args),
  multiAgentRemoveFromTeam: (args: unknown) => ipcRenderer.invoke(IPC.MULTI_AGENT_REMOVE_FROM_TEAM, args),
  multiAgentListTeams: () => ipcRenderer.invoke(IPC.MULTI_AGENT_LIST_TEAMS),
  multiAgentCreateTask: (args: unknown) => ipcRenderer.invoke(IPC.MULTI_AGENT_CREATE_TASK, args),
  multiAgentAssignTask: (args: unknown) => ipcRenderer.invoke(IPC.MULTI_AGENT_ASSIGN_TASK, args),
  multiAgentStartTask: (args: unknown) => ipcRenderer.invoke(IPC.MULTI_AGENT_START_TASK, args),
  multiAgentCompleteTask: (args: unknown) => ipcRenderer.invoke(IPC.MULTI_AGENT_COMPLETE_TASK, args),
  multiAgentListTasks: () => ipcRenderer.invoke(IPC.MULTI_AGENT_LIST_TASKS),
  multiAgentSendMessage: (args: unknown) => ipcRenderer.invoke(IPC.MULTI_AGENT_SEND_MESSAGE, args),
  multiAgentGetMessages: (args: unknown) => ipcRenderer.invoke(IPC.MULTI_AGENT_GET_MESSAGES, args),
  multiAgentExecuteTeamTask: (args: unknown) => ipcRenderer.invoke(IPC.MULTI_AGENT_EXECUTE_TEAM_TASK, args),
  multiAgentStats: () => ipcRenderer.invoke(IPC.MULTI_AGENT_STATS),

  // Workspaces
  workspaceCreate: (args: unknown) => ipcRenderer.invoke(IPC.WORKSPACE_CREATE, args),
  workspaceList: () => ipcRenderer.invoke(IPC.WORKSPACE_LIST),
  workspaceGet: (args: unknown) => ipcRenderer.invoke(IPC.WORKSPACE_GET, args),
  workspaceDelete: (args: unknown) => ipcRenderer.invoke(IPC.WORKSPACE_DELETE, args),
  workspaceAddMember: (args: unknown) => ipcRenderer.invoke(IPC.WORKSPACE_ADD_MEMBER, args),
  workspaceRemoveMember: (args: unknown) => ipcRenderer.invoke(IPC.WORKSPACE_REMOVE_MEMBER, args),
  workspaceUpdateMemberRole: (args: unknown) => ipcRenderer.invoke(IPC.WORKSPACE_UPDATE_MEMBER_ROLE, args),
  workspaceCreateProject: (args: unknown) => ipcRenderer.invoke(IPC.WORKSPACE_CREATE_PROJECT, args),
  workspaceDeleteProject: (args: unknown) => ipcRenderer.invoke(IPC.WORKSPACE_DELETE_PROJECT, args),
  workspaceAddResource: (args: unknown) => ipcRenderer.invoke(IPC.WORKSPACE_ADD_RESOURCE, args),
  workspaceRemoveResource: (args: unknown) => ipcRenderer.invoke(IPC.WORKSPACE_REMOVE_RESOURCE, args),
  workspaceGetActivity: (args: unknown) => ipcRenderer.invoke(IPC.WORKSPACE_GET_ACTIVITY, args),
  workspaceStats: () => ipcRenderer.invoke(IPC.WORKSPACE_STATS),

  // Self-Improvement
  selfImprovementAudit: (args: { cwd: string }) => ipcRenderer.invoke('self-improvement:audit', args),
  selfImprovementStatus: (args: { cwd: string }) => ipcRenderer.invoke('self-improvement:status', args),

  // Skills
  skillsList: () => ipcRenderer.invoke(IPC.SKILLS_LIST),
  skillsGet: (args: { id: string }) => ipcRenderer.invoke(IPC.SKILLS_GET, args),
  skillsCreate: (args: { skill: unknown }) => ipcRenderer.invoke(IPC.SKILLS_CREATE, args),
  skillsUpdate: (args: { id: string; updates: unknown }) => ipcRenderer.invoke(IPC.SKILLS_UPDATE, args),
  skillsDelete: (args: { id: string }) => ipcRenderer.invoke(IPC.SKILLS_DELETE, args),
  skillsToggle: (args: { id: string }) => ipcRenderer.invoke(IPC.SKILLS_TOGGLE, args),
  skillsSearch: (args: { query: string }) => ipcRenderer.invoke(IPC.SKILLS_SEARCH, args),
  skillsStats: () => ipcRenderer.invoke(IPC.SKILLS_STATS),
  skillsImportClaude: (args: { filePath: string }) => ipcRenderer.invoke(IPC.SKILLS_IMPORT_CLAUDE, args),
  skillsRelevant: (args: { task: string }) => ipcRenderer.invoke(IPC.SKILLS_RELEVANT, args),

  // Personalization
  profileGet: () => ipcRenderer.invoke('profile:get'),
  profileUpdate: (args: { updates: unknown }) => ipcRenderer.invoke('profile:update', args),
  profilePreferences: (args: { prefs: unknown }) => ipcRenderer.invoke('profile:preferences', args),
  profileBusiness: (args: { ctx: unknown }) => ipcRenderer.invoke('profile:business', args),
  profileContext: () => ipcRenderer.invoke('profile:context'),
  profileSuggestions: () => ipcRenderer.invoke('profile:suggestions'),

  // Orchestrator
  orchestratorStart: (args: { prompt: string; displayPrompt?: string; sessionId: string; cwd: string; provider: string; model: string }) =>
    ipcRenderer.invoke(IPC.ORCHESTRATOR_START, args),
  orchestratorInterject: (args: { taskId: string; message: string }) =>
    ipcRenderer.invoke(IPC.ORCHESTRATOR_INTERJECT, args),
  orchestratorStatus: (args?: { taskId?: string }) => ipcRenderer.invoke(IPC.ORCHESTRATOR_STATUS, args ?? {}),
  onOrchestratorEvent: (cb: (e: unknown) => void) => {
    const handler = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(IPC.ORCHESTRATOR_EVENT, handler);
    return () => ipcRenderer.removeListener(IPC.ORCHESTRATOR_EVENT, handler);
  },

  // Crew — multi-agent, multi-model orchestration
  crewStart: (args: { prompt: string; displayPrompt?: string; sessionId: string; cwd: string; provider: string; model: string; agents?: string[]; preferPaid?: boolean; provider2?: string; model2?: string }) =>
    ipcRenderer.invoke(IPC.CREW_START, args),
  crewStatus: () => ipcRenderer.invoke(IPC.CREW_STATUS),
  onCrewEvent: (cb: (e: unknown) => void) => {
    const handler = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(IPC.CREW_EVENT, handler);
    return () => ipcRenderer.removeListener(IPC.CREW_EVENT, handler);
  },

  // Model Selector
  modelSelect: (args: { taskType?: string }) => ipcRenderer.invoke(IPC.MODEL_SELECT, args),
  modelFreeList: () => ipcRenderer.invoke(IPC.MODEL_FREE_LIST),

  // Voice Assistant
  voiceConfigGet: () => ipcRenderer.invoke(IPC.VOICE_CONFIG_GET),
  voiceConfigSet: (args: { config: unknown }) => ipcRenderer.invoke(IPC.VOICE_CONFIG_SET, args),
  voiceStartListening: () => ipcRenderer.invoke(IPC.VOICE_START_LISTENING),
  voiceStopListening: () => ipcRenderer.invoke(IPC.VOICE_STOP_LISTENING),
  onVoiceTranscript: (cb: (event: { type: string; transcript?: string; confidence?: number; final?: boolean; language?: string; message?: string }) => void) => {
    const handler = (_event: unknown, payload: { type: string; transcript?: string; confidence?: number; final?: boolean; language?: string; message?: string }) => cb(payload);
    ipcRenderer.on(IPC.VOICE_TRANSCRIPT_EVENT, handler);
    return () => ipcRenderer.removeListener(IPC.VOICE_TRANSCRIPT_EVENT, handler);
  },
  voiceProcessTranscript: (args: { transcript: string }) => ipcRenderer.invoke(IPC.VOICE_PROCESS_TRANSCRIPT, args),
  voiceSetWakeWord: (args: { word: string }) => ipcRenderer.invoke(IPC.VOICE_SET_WAKE_WORD, args),
  voiceAddCustomCommand: (args: { trigger: string; action: string }) =>
    ipcRenderer.invoke(IPC.VOICE_ADD_CUSTOM_COMMAND, args),
  voiceRemoveCustomCommand: (args: { trigger: string }) => ipcRenderer.invoke(IPC.VOICE_REMOVE_CUSTOM_COMMAND, args),
  voiceCustomCommands: () => ipcRenderer.invoke(IPC.VOICE_CUSTOM_COMMANDS),
  voiceHistory: () => ipcRenderer.invoke(IPC.VOICE_HISTORY),
  voiceClearHistory: () => ipcRenderer.invoke(IPC.VOICE_CLEAR_HISTORY),
  voiceSpeak: (args: { text: string }) => ipcRenderer.invoke(IPC.VOICE_SPEAK, args),

  // Video Clipping
  videoCreateProject: (args: { name: string; sourceFile: string; description?: string }) =>
    ipcRenderer.invoke(IPC.VIDEO_CREATE_PROJECT, args),
  videoListProjects: () => ipcRenderer.invoke(IPC.VIDEO_LIST_PROJECTS),
  videoGetProject: (args: { id: string }) => ipcRenderer.invoke(IPC.VIDEO_GET_PROJECT, args),
  videoDeleteProject: (args: { id: string }) => ipcRenderer.invoke(IPC.VIDEO_DELETE_PROJECT, args),
  videoAnalyze: (args: { projectId: string }) => ipcRenderer.invoke(IPC.VIDEO_ANALYZE, args),
  videoExtractClip: (args: { projectId: string; startTime: number; endTime: number; name: string; tags?: string[] }) =>
    ipcRenderer.invoke(IPC.VIDEO_EXTRACT_CLIP, args),
  videoFindHighlights: (args: { projectId: string; maxClips?: number }) =>
    ipcRenderer.invoke(IPC.VIDEO_FIND_HIGHLIGHTS, args),
  videoAddTranscript: (args: { projectId: string; segments: unknown[] }) =>
    ipcRenderer.invoke(IPC.VIDEO_ADD_TRANSCRIPT, args),
  videoSplitByChapters: (args: { projectId: string }) => ipcRenderer.invoke(IPC.VIDEO_SPLIT_BY_CHAPTERS, args),
  videoAddHighlight: (args: { projectId: string; timestamp: number; description: string }) =>
    ipcRenderer.invoke(IPC.VIDEO_ADD_HIGHLIGHT, args),

  // Deployment
  deployCreateTarget: (args: { name: string; type: string; config: Record<string, string> }) =>
    ipcRenderer.invoke(IPC.DEPLOY_CREATE_TARGET, args),
  deployListTargets: () => ipcRenderer.invoke(IPC.DEPLOY_LIST_TARGETS),
  deployGetTarget: (args: { id: string }) => ipcRenderer.invoke(IPC.DEPLOY_GET_TARGET, args),
  deployDeleteTarget: (args: { id: string }) => ipcRenderer.invoke(IPC.DEPLOY_DELETE_TARGET, args),
  deployCreatePipeline: (args: { name: string; projectId: string; targetId: string; commands: string[] }) =>
    ipcRenderer.invoke(IPC.DEPLOY_CREATE_PIPELINE, args),
  deployRunPipeline: (args: { pipelineId: string; cwd?: string }) => ipcRenderer.invoke(IPC.DEPLOY_RUN_PIPELINE, args),
  deployCancelPipeline: (args: { pipelineId: string }) => ipcRenderer.invoke(IPC.DEPLOY_CANCEL_PIPELINE, args),
  deployGetPipeline: (args: { id: string }) => ipcRenderer.invoke(IPC.DEPLOY_GET_PIPELINE, args),
  deployListPipelines: () => ipcRenderer.invoke(IPC.DEPLOY_LIST_PIPELINES),
  deployDetectProject: (args: { projectPath: string }) => ipcRenderer.invoke(IPC.DEPLOY_DETECT_PROJECT, args),
  deployDefaultConfig: (args: { type: string }) => ipcRenderer.invoke(IPC.DEPLOY_DEFAULT_CONFIG, args),
  deployQuickPush: (args: { cwd?: string; message?: string }) => ipcRenderer.invoke(IPC.DEPLOY_QUICK_PUSH, args),

  // Testing
  testCreateSuite: (args: { name: string; framework: string; description?: string }) =>
    ipcRenderer.invoke(IPC.TEST_CREATE_SUITE, args),
  testListSuites: () => ipcRenderer.invoke(IPC.TEST_LIST_SUITES),
  testGetSuite: (args: { id: string }) => ipcRenderer.invoke(IPC.TEST_GET_SUITE, args),
  testDeleteSuite: (args: { id: string }) => ipcRenderer.invoke(IPC.TEST_DELETE_SUITE, args),
  testAddTest: (args: { suiteId: string; test: unknown }) => ipcRenderer.invoke(IPC.TEST_ADD_TEST, args),
  testRemoveTest: (args: { suiteId: string; testId: string }) => ipcRenderer.invoke(IPC.TEST_REMOVE_TEST, args),
  testRunSuite: (args: { suiteId: string }) => ipcRenderer.invoke(IPC.TEST_RUN_SUITE, args),
  testGenerateTests: (args: { description: string; filePath?: string }) =>
    ipcRenderer.invoke(IPC.TEST_GENERATE_TESTS, args),
  testStats: () => ipcRenderer.invoke(IPC.TEST_STATS),
  testCreatePlan: (args: { name: string; description: string; scope: string; priority?: string }) =>
    ipcRenderer.invoke(IPC.TEST_CREATE_PLAN, args),
  testListPlans: () => ipcRenderer.invoke(IPC.TEST_LIST_PLANS),

  // Enterprise
  enterpriseAddMember: (args: { name: string; email: string; role?: string }) =>
    ipcRenderer.invoke(IPC.ENTERPRISE_ADD_MEMBER, args),
  enterpriseListMembers: () => ipcRenderer.invoke(IPC.ENTERPRISE_LIST_MEMBERS),
  enterpriseGetMember: (args: { id: string }) => ipcRenderer.invoke(IPC.ENTERPRISE_GET_MEMBER, args),
  enterpriseUpdateRole: (args: { id: string; role: string }) => ipcRenderer.invoke(IPC.ENTERPRISE_UPDATE_ROLE, args),
  enterpriseRemoveMember: (args: { id: string }) => ipcRenderer.invoke(IPC.ENTERPRISE_REMOVE_MEMBER, args),
  enterpriseCreateProject: (args: { name: string; ownerId: string; description?: string }) =>
    ipcRenderer.invoke(IPC.ENTERPRISE_CREATE_PROJECT, args),
  enterpriseListProjects: () => ipcRenderer.invoke(IPC.ENTERPRISE_LIST_PROJECTS),
  enterpriseAddToProject: (args: { projectId: string; memberId: string }) =>
    ipcRenderer.invoke(IPC.ENTERPRISE_ADD_MEMBER_TO_PROJECT, args),
  enterpriseRemoveFromProject: (args: { projectId: string; memberId: string }) =>
    ipcRenderer.invoke(IPC.ENTERPRISE_REMOVE_MEMBER_FROM_PROJECT, args),
  enterpriseAuditLog: (args?: { filters?: unknown }) => ipcRenderer.invoke(IPC.ENTERPRISE_AUDIT_LOG, args ?? {}),
  enterpriseAddComplianceRule: (args: {
    name: string;
    description: string;
    category: string;
    severity: string;
    check: string;
  }) => ipcRenderer.invoke(IPC.ENTERPRISE_ADD_COMPLIANCE_RULE, args),
  enterpriseComplianceRules: () => ipcRenderer.invoke(IPC.ENTERPRISE_COMPLIANCE_RULES),
  enterpriseComplianceStatus: () => ipcRenderer.invoke(IPC.ENTERPRISE_COMPLIANCE_STATUS),
  enterpriseExportAudit: () => ipcRenderer.invoke(IPC.ENTERPRISE_EXPORT_AUDIT),

  // Call Center
  callCreate: (args: { callerId: string; direction: string; options?: unknown }) =>
    ipcRenderer.invoke(IPC.CALL_CREATE, args),
  callAnswer: (args: { callId: string; agentId?: string }) => ipcRenderer.invoke(IPC.CALL_ANSWER, args),
  callHold: (args: { callId: string }) => ipcRenderer.invoke(IPC.CALL_HOLD, args),
  callResume: (args: { callId: string }) => ipcRenderer.invoke(IPC.CALL_RESUME, args),
  callEnd: (args: { callId: string; disposition?: string; notes?: string }) => ipcRenderer.invoke(IPC.CALL_END, args),
  callMiss: (args: { callId: string }) => ipcRenderer.invoke(IPC.CALL_MISS, args),
  callGet: (args: { id: string }) => ipcRenderer.invoke(IPC.CALL_GET, args),
  callList: (args?: { filters?: unknown }) => ipcRenderer.invoke(IPC.CALL_LIST, args ?? {}),
  callQueueCreate: (args: { name: string; maxWaitTime?: number; priority?: number }) =>
    ipcRenderer.invoke(IPC.CALL_QUEUE_CREATE, args),
  callQueueList: () => ipcRenderer.invoke(IPC.CALL_QUEUE_LIST),
  callQueueAdd: (args: { queueId: string; callId: string }) => ipcRenderer.invoke(IPC.CALL_QUEUE_ADD, args),
  callQueueRemove: (args: { queueId: string; callId: string }) => ipcRenderer.invoke(IPC.CALL_QUEUE_REMOVE, args),
  callAgentCreate: (args: { name: string; skills?: string[]; maxConcurrent?: number }) =>
    ipcRenderer.invoke(IPC.CALL_AGENT_CREATE, args),
  callAgentList: () => ipcRenderer.invoke(IPC.CALL_AGENT_LIST),
  callAgentStatus: (args: { agentId: string; status: string }) => ipcRenderer.invoke(IPC.CALL_AGENT_STATUS, args),
  callAssign: (args: { agentId: string; callId: string }) => ipcRenderer.invoke(IPC.CALL_ASSIGN, args),
  callTemplateCreate: (args: { name: string; greeting: string; prompts?: string[] }) =>
    ipcRenderer.invoke(IPC.CALL_TEMPLATE_CREATE, args),
  callTemplateList: () => ipcRenderer.invoke(IPC.CALL_TEMPLATE_LIST),
  callAnalytics: (args?: { since?: number }) => ipcRenderer.invoke(IPC.CALL_ANALYTICS, args ?? {}),

  // YouTube Learning
  ytAnalyze: (args: { url: string; transcript: string; title?: string; channel?: string }) =>
    ipcRenderer.invoke(IPC.YT_ANALYZE, args),
  ytLearn: (args: { url: string; transcript: string; taskTitle?: string }) => ipcRenderer.invoke(IPC.YT_LEARN, args),
  ytListTasks: () => ipcRenderer.invoke(IPC.YT_LIST_TASKS),
  ytGetTask: (args: { id: string }) => ipcRenderer.invoke(IPC.YT_GET_TASK, args),
  ytDeleteTask: (args: { id: string }) => ipcRenderer.invoke(IPC.YT_DELETE_TASK, args),
  ytListAnalyses: () => ipcRenderer.invoke(IPC.YT_LIST_ANALYSES),
  ytCreateTemplate: (args: {
    name: string;
    steps: Array<{ type: string; action: string; target?: string; value?: string }>;
    variables?: Record<string, string>;
    description?: string;
  }) => ipcRenderer.invoke(IPC.YT_CREATE_TEMPLATE, args),
  ytListTemplates: () => ipcRenderer.invoke(IPC.YT_LIST_TEMPLATES),
  ytLearnDaily: (args: {
    sessionData: { date: string; videosWatched: number; tasksCompleted: number; timeSpent: number };
  }) => ipcRenderer.invoke(IPC.YT_LEARN_DAILY, args),

  // Activity Tracker
  trackerStart: () => ipcRenderer.invoke(IPC.TRACKER_START),
  trackerStop: () => ipcRenderer.invoke(IPC.TRACKER_STOP),
  trackerStatus: () => ipcRenderer.invoke(IPC.TRACKER_STATUS),
  trackerRecord: (args: { action: { type: string; target?: string; timestamp: number } }) =>
    ipcRenderer.invoke(IPC.TRACKER_RECORD, args),
  trackerRecent: (args?: { count?: number }) => ipcRenderer.invoke(IPC.TRACKER_RECENT, args ?? { count: 50 }),
  trackerAnalyzeDay: (args?: { date?: string }) => ipcRenderer.invoke(IPC.TRACKER_ANALYZE_DAY, args ?? {}),
  trackerPatterns: () => ipcRenderer.invoke(IPC.TRACKER_PATTERNS),

  // Task Replay
  replayExecute: (args: {
    taskName: string;
    steps: Array<{ type: string; action: string; target?: string; value?: string }>;
    variables?: Record<string, string>;
    speed?: number;
  }) => ipcRenderer.invoke(IPC.REPLAY_EXECUTE, args),
  replayExecuteTask: (args: { taskId: string; overrides?: Record<string, string> }) =>
    ipcRenderer.invoke(IPC.REPLAY_EXECUTE_TASK, args),
  replayExecuteNL: (args: { description: string }) => ipcRenderer.invoke(IPC.REPLAY_EXECUTE_NL, args),
  replayCancel: (args: { executionId: string }) => ipcRenderer.invoke(IPC.REPLAY_CANCEL, args),
  replayPause: (args: { executionId: string }) => ipcRenderer.invoke(IPC.REPLAY_PAUSE, args),
  replayResume: (args: { executionId: string }) => ipcRenderer.invoke(IPC.REPLAY_RESUME, args),
  replayList: () => ipcRenderer.invoke(IPC.REPLAY_LIST),
  replayGet: (args: { id: string }) => ipcRenderer.invoke(IPC.REPLAY_GET, args),
  replayBrowserTask: (args: { url: string; actions: Array<{ type: string; selector?: string; value?: string }> }) =>
    ipcRenderer.invoke(IPC.REPLAY_BROWSER_TASK, args),
  replayComputerTask: (args: { actions: Array<{ type: string; target?: string; value?: string }> }) =>
    ipcRenderer.invoke(IPC.REPLAY_COMPUTER_TASK, args),

  // Email
  emailList: (args?: { folder?: string; limit?: number }) => ipcRenderer.invoke(IPC.EMAIL_LIST, args ?? {}),
  emailRead: (args: { uid: string; folder?: string }) => ipcRenderer.invoke(IPC.EMAIL_READ, args),
  emailSend: (args: { to: string; subject: string; text: string; inReplyTo?: string }) =>
    ipcRenderer.invoke(IPC.EMAIL_SEND, args),
  emailTest: (args: {
    imapHost: string;
    imapPort: number;
    imapSecure: boolean;
    smtpHost: string;
    smtpPort: number;
    smtpSecure: boolean;
    user: string;
    password: string;
  }) => ipcRenderer.invoke(IPC.EMAIL_TEST, args),
  emailConfigGet: () => ipcRenderer.invoke(IPC.EMAIL_CONFIG_GET),
  emailConfigSave: (args: {
    imapHost: string;
    imapPort: number;
    imapSecure: boolean;
    smtpHost: string;
    smtpPort: number;
    smtpSecure: boolean;
    user: string;
    password: string;
  }) => ipcRenderer.invoke(IPC.EMAIL_CONFIG_SAVE, args),
  emailHasConfig: () => ipcRenderer.invoke(IPC.EMAIL_HAS_CONFIG),

  // Auth (file-based)
  authGetUsers: () => ipcRenderer.invoke(IPC.AUTH_GET_USERS),
  authSetUsers: (users: Record<string, unknown>) => ipcRenderer.invoke(IPC.AUTH_SET_USERS, users),
  authGetSession: () => ipcRenderer.invoke(IPC.AUTH_GET_SESSION),
  authSetSession: (session: unknown) => ipcRenderer.invoke(IPC.AUTH_SET_SESSION, session),
  authListProfiles: () => ipcRenderer.invoke(IPC.AUTH_LIST_PROFILES),

  // Replay events
  onReplayCommand: (callback: (event: { type: string; data: unknown }) => void) => {
    ipcRenderer.on(IPC.REPLAY_COMMAND, (_event, data) => callback(data));
    return () => {
      ipcRenderer.removeAllListeners(IPC.REPLAY_COMMAND);
    };
  },

  // Ollama local AI brain
  ollamaChat: (args: {
    messages: Array<{ role: string; content: string; images?: string[] }>;
    options?: { temperature?: number; maxTokens?: number };
  }) => ipcRenderer.invoke(IPC.OLLAMA_CHAT, args),
  ollamaAsk: (args: { prompt: string; systemPrompt?: string; model?: string }) =>
    ipcRenderer.invoke(IPC.OLLAMA_ASK, args),
  ollamaAnalyzeImage: (args: { imageBase64: string; question: string }) =>
    ipcRenderer.invoke(IPC.OLLAMA_ANALYZE_IMAGE, args),
  ollamaTeach: () => ipcRenderer.invoke(IPC.OLLAMA_TEACH),
  ollamaStatus: () => ipcRenderer.invoke(IPC.OLLAMA_STATUS),
  ollamaRecordApi: (args: { input: string; response: string; model: string; provider: string }) =>
    ipcRenderer.invoke(IPC.OLLAMA_RECORD_API, args),
  ollamaRecordConversation: (args: { input: string; output: string; source: 'brain' | 'api' | 'ollama' }) =>
    ipcRenderer.invoke(IPC.OLLAMA_RECORD_CONVERSATION, args),
  ollamaSystemPrompt: () => ipcRenderer.invoke(IPC.OLLAMA_SYSTEM_PROMPT),

  // ── OCR ──
  ocrRecognize: (args: { imagePath: string }) => ipcRenderer.invoke('ocr:recognize', args),
  ocrAnalyze: (args: { imagePath: string; prompt: string }) => ipcRenderer.invoke('ocr:analyze', args),
  ocrStatus: () => ipcRenderer.invoke('ocr:status'),

  // ── Voice ──
  voiceSTT: (args: { audioBuffer: string; format: string }) => ipcRenderer.invoke('voice:stt', args),
  voiceTTS: (args: { text: string; voice?: string }) => ipcRenderer.invoke('voice:tts', args),
  voiceStatus: () => ipcRenderer.invoke('voice:status'),
  voiceSetKey: (args: { apiKey: string }) => ipcRenderer.invoke('voice:setKey', args),

  // ── Credentials ──
  credSave: (args: { id: string; service: string; apiKey: string }) => ipcRenderer.invoke('cred:save', args),
  credGet: (args: { id: string }) => ipcRenderer.invoke('cred:get', args),
  credList: () => ipcRenderer.invoke('cred:list'),
  credDelete: (args: { id: string }) => ipcRenderer.invoke('cred:delete', args),
  credHas: (args: { id: string }) => ipcRenderer.invoke('cred:has', args),
  credDetect: (args: { text: string }) => ipcRenderer.invoke('cred:detect', args),

  // ── Persistent Memory ──
  pmemSave: (args: { category: string; key: string; value: string }) => ipcRenderer.invoke('pmem:save', args),
  pmemGet: (args: { category: string }) => ipcRenderer.invoke('pmem:get', args),
  pmemGetValue: (args: { category: string; key: string }) => ipcRenderer.invoke('pmem:getValue', args),
  pmemDelete: (args: { category: string; key: string }) => ipcRenderer.invoke('pmem:delete', args),
  pmemSaveSession: (args: { sessionId: string; history: unknown[]; title?: string }) =>
    ipcRenderer.invoke('pmem:saveSession', args),
  pmemLoadSession: (args: { sessionId: string }) => ipcRenderer.invoke('pmem:loadSession', args),
  pmemListSessions: () => ipcRenderer.invoke('pmem:listSessions'),
  pmemDeleteSession: (args: { sessionId: string }) => ipcRenderer.invoke('pmem:deleteSession', args),
  pmemLogAudit: (args: { action: string; details?: string; source?: string }) =>
    ipcRenderer.invoke('pmem:logAudit', args),
  pmemAuditLogs: (args?: { limit?: number }) => ipcRenderer.invoke('pmem:auditLogs', args ?? {}),
  pmemSaveKnowledge: (args: { input: string; output: string; source?: string; tags?: string[] }) =>
    ipcRenderer.invoke('pmem:saveKnowledge', args),
  pmemSearchKnowledge: (args: { query: string; limit?: number }) => ipcRenderer.invoke('pmem:searchKnowledge', args),
  pmemStats: () => ipcRenderer.invoke('pmem:stats'),
  pmemKnowledgeStats: () => ipcRenderer.invoke('pmem:knowledgeStats'),

  // Window controls
  windowSetFullScreen: (args: { fullScreen: boolean }) => ipcRenderer.invoke(IPC.WINDOW_SET_FULLSCREEN, args),
  windowIsFullScreen: () => ipcRenderer.invoke(IPC.WINDOW_IS_FULLSCREEN),
  windowSetAlwaysOnTop: (args: { onTop: boolean }) => ipcRenderer.invoke(IPC.WINDOW_SET_ALWAYS_ON_TOP, args),
  windowIsAlwaysOnTop: () => ipcRenderer.invoke(IPC.WINDOW_IS_ALWAYS_ON_TOP),
  windowMinimize: () => ipcRenderer.invoke(IPC.WINDOW_MINIMIZE),
  windowMaximize: () => ipcRenderer.invoke(IPC.WINDOW_MAXIMIZE),
  windowRestore: () => ipcRenderer.invoke(IPC.WINDOW_RESTORE),
  windowClose: () => ipcRenderer.invoke(IPC.WINDOW_CLOSE),

  // System
  systemOpenUrl: (args: { url: string }) => ipcRenderer.invoke(IPC.SYSTEM_OPEN_URL, args),

  // Clipboard
  clipboardRead: (args?: { format?: string }) => ipcRenderer.invoke(IPC.CLIPBOARD_READ, args ?? {}),
  clipboardWrite: (args: { text?: string; html?: string }) => ipcRenderer.invoke(IPC.CLIPBOARD_WRITE, args),

  // Unified messaging (Slack / Discord / Telegram / WhatsApp + Telegram inbound)
  messagingStatus: () => ipcRenderer.invoke(IPC.MESSAGING_STATUS),
  messagingSend: (args: {
    action: 'send_slack' | 'send_discord' | 'send_telegram' | 'send_whatsapp' | 'simulate';
    text: string;
    webhookUrl?: string;
    channel?: string;
    username?: string;
    telegramToken?: string;
    telegramChatId?: string;
    whatsappTo?: string;
    whatsappVia?: 'meta' | 'twilio';
    whatsappPhoneNumberId?: string;
    whatsappToken?: string;
    twilioAccountSid?: string;
    twilioAuthToken?: string;
    twilioFrom?: string;
  }) => ipcRenderer.invoke(IPC.MESSAGING_SEND, args),
  messagingInboundGet: () => ipcRenderer.invoke(IPC.MESSAGING_INBOUND_GET),
  messagingInboundSet: (args: { enabled?: boolean; allowedChatIds?: string[] }) =>
    ipcRenderer.invoke(IPC.MESSAGING_INBOUND_SET, args),

  // Notifications
  notificationShow: (args: { title: string; body: string; silent?: boolean }) =>
    ipcRenderer.invoke(IPC.NOTIFICATION_SHOW, args),
  notificationStatus: () => ipcRenderer.invoke(IPC.NOTIFICATION_STATUS),
  notificationClear: () => ipcRenderer.invoke(IPC.NOTIFICATION_CLEAR),

  // Interactive Terminal (PTY)
  terminalCreateSession: (args?: { cols?: number; rows?: number; cwd?: string }) =>
    ipcRenderer.invoke(IPC.TERMINAL_CREATE_SESSION, args),
  terminalWrite: (args: { sessionId: string; data: string }) => ipcRenderer.invoke(IPC.TERMINAL_WRITE, args),
  terminalResize: (args: { sessionId: string; cols: number; rows: number }) =>
    ipcRenderer.invoke(IPC.TERMINAL_RESIZE, args),
  terminalCloseSession: (args: { sessionId: string }) => ipcRenderer.invoke(IPC.TERMINAL_CLOSE_SESSION, args),
  terminalListSessions: () => ipcRenderer.invoke(IPC.TERMINAL_LIST_SESSIONS),
  terminalSubscribe: (args: { sessionId: string }) => ipcRenderer.invoke(IPC.TERMINAL_SUBSCRIBE, args),
  terminalUnsubscribe: (args: { sessionId: string }) => ipcRenderer.invoke(IPC.TERMINAL_UNSUBSCRIBE, args),
  terminalCloseAll: () => ipcRenderer.invoke(IPC.TERMINAL_CLOSE_ALL),
  onTerminalData: (cb: (data: { sessionId: string; data: string }) => void) => {
    ipcRenderer.on(IPC.TERMINAL_DATA, (_event, payload) => cb(payload));
    return () => ipcRenderer.removeAllListeners(IPC.TERMINAL_DATA);
  },
  onTerminalExit: (cb: (data: { sessionId: string; exitCode: number; signal: string }) => void) => {
    ipcRenderer.on(IPC.TERMINAL_EXIT, (_event, payload) => cb(payload));
    return () => ipcRenderer.removeAllListeners(IPC.TERMINAL_EXIT);
  },
  onTerminalSessionCreated: (cb: (data: unknown) => void) => {
    ipcRenderer.on(IPC.TERMINAL_SESSION_CREATED, (_event, payload) => cb(payload));
    return () => ipcRenderer.removeAllListeners(IPC.TERMINAL_SESSION_CREATED);
  },

  // Git
  gitStatus: (args?: { cwd?: string }) => ipcRenderer.invoke(IPC.GIT_STATUS, args ?? {}),
  gitLog: (args?: { cwd?: string; count?: number }) => ipcRenderer.invoke(IPC.GIT_LOG, args ?? {}),
  gitCommit: (args: { cwd?: string; message: string; all?: boolean }) => ipcRenderer.invoke(IPC.GIT_COMMIT, args),
  gitBranch: (args?: { cwd?: string }) => ipcRenderer.invoke(IPC.GIT_BRANCH, args ?? {}),
  gitPush: (args?: { cwd?: string; remote?: string; branch?: string; force?: boolean }) =>
    ipcRenderer.invoke(IPC.GIT_PUSH, args ?? {}),
  gitPull: (args?: { cwd?: string; remote?: string; rebase?: boolean }) => ipcRenderer.invoke(IPC.GIT_PULL, args ?? {}),
  gitDiff: (args?: { cwd?: string; staged?: boolean; file?: string }) => ipcRenderer.invoke(IPC.GIT_DIFF, args ?? {}),

  // Checkpoints
  checkpointCreate: (args: {
    taskId: string;
    name: string;
    description?: string;
    metadata?: Record<string, unknown>;
  }) => ipcRenderer.invoke(IPC.CHECKPOINT_CREATE, args),
  checkpointList: (args?: { taskId?: string; limit?: number }) => ipcRenderer.invoke(IPC.CHECKPOINT_LIST, args ?? {}),
  checkpointGet: (args: { id: string }) => ipcRenderer.invoke(IPC.CHECKPOINT_GET, args),
  checkpointRestore: (args: { id: string }) => ipcRenderer.invoke(IPC.CHECKPOINT_RESTORE, args),
  checkpointDelete: (args: { id: string }) => ipcRenderer.invoke(IPC.CHECKPOINT_DELETE, args),
  checkpointDiff: (args: { id1: string; id2: string }) => ipcRenderer.invoke(IPC.CHECKPOINT_DIFF, args),

  // Task Queue
  queueCreate: (args: { name: string; priority?: number }) => ipcRenderer.invoke(IPC.QUEUE_CREATE, args),
  queueList: () => ipcRenderer.invoke(IPC.QUEUE_LIST),
  queueGet: (args: { id: string }) => ipcRenderer.invoke(IPC.QUEUE_GET, args),
  queueDelete: (args: { id: string }) => ipcRenderer.invoke(IPC.QUEUE_DELETE, args),
  queueEnqueue: (args: { queueId: string; task: Record<string, unknown>; priority?: number }) =>
    ipcRenderer.invoke(IPC.QUEUE_ENQUEUE, args),
  queueDequeue: (args: { queueId: string }) => ipcRenderer.invoke(IPC.QUEUE_DEQUEUE, args),
  queuePeek: (args: { queueId: string }) => ipcRenderer.invoke(IPC.QUEUE_PEEK, args),
  queueStatus: (args: { queueId: string }) => ipcRenderer.invoke(IPC.QUEUE_STATUS, args),
  queueStats: () => ipcRenderer.invoke(IPC.QUEUE_STATS),

  // Workspace Indexing
  indexBuild: (args?: { paths?: string[]; force?: boolean }) => ipcRenderer.invoke(IPC.INDEX_BUILD, args ?? {}),
  indexSearch: (args: { query: string; limit?: number }) => ipcRenderer.invoke(IPC.INDEX_SEARCH, args),
  indexStatus: () => ipcRenderer.invoke(IPC.INDEX_STATUS),
  indexClear: () => ipcRenderer.invoke(IPC.INDEX_CLEAR),
  indexFileAdd: (args: { path: string }) => ipcRenderer.invoke(IPC.INDEX_FILE_ADD, args),
  indexFileRemove: (args: { path: string }) => ipcRenderer.invoke(IPC.INDEX_FILE_REMOVE, args),
  indexRebuild: () => ipcRenderer.invoke(IPC.INDEX_REBUILD),

  // Code Completion
  completionRequest: (args: { filePath: string; position: { line: number; character: number }; context: string }) =>
    ipcRenderer.invoke(IPC.COMPLETION_REQUEST, args),
  completionCancel: (args: { id: string }) => ipcRenderer.invoke(IPC.COMPLETION_CANCEL, args),
  completionList: () => ipcRenderer.invoke(IPC.COMPLETION_LIST),
  onCompletionResult: (cb: (data: { id: string; completions: unknown[] }) => void) => {
    ipcRenderer.on('completion:result', (_event, payload) => cb(payload));
    return () => ipcRenderer.removeAllListeners('completion:result');
  },

  // Debug
  debugStart: (args: { filePath: string; breakPoints?: string[] }) => ipcRenderer.invoke(IPC.DEBUG_START, args),
  debugStop: () => ipcRenderer.invoke(IPC.DEBUG_STOP),
  debugStatus: () => ipcRenderer.invoke(IPC.DEBUG_STATUS),
  debugBreakpointsSet: (args: { filePath: string; lines: number[] }) =>
    ipcRenderer.invoke(IPC.DEBUG_BREAKPOINTS_SET, args),
  debugBreakpointsList: (args: { filePath: string }) => ipcRenderer.invoke(IPC.DEBUG_BREAKPOINTS_LIST, args),
  debugEvaluate: (args: { expression: string }) => ipcRenderer.invoke(IPC.DEBUG_EVALUATE, args),
  debugStep: (args: { action: 'in' | 'out' | 'over' }) => ipcRenderer.invoke(IPC.DEBUG_STEP, args),
  debugContinue: () => ipcRenderer.invoke(IPC.DEBUG_CONTINUE),
  debugPause: () => ipcRenderer.invoke(IPC.DEBUG_PAUSE),
  onDebugEvent: (cb: (data: unknown) => void) => {
    ipcRenderer.on('debug:event', (_event, payload) => cb(payload));
    return () => ipcRenderer.removeAllListeners('debug:event');
  },

  // GitHub Integration
  githubSetToken: (args: { token: string }) => ipcRenderer.invoke('github:setToken', args),
  githubSetUsername: (args: { username: string }) => ipcRenderer.invoke('github:setUsername', args),
  githubIsConfigured: () => ipcRenderer.invoke('github:isConfigured'),
  githubCreateRepo: (args: { name: string; description?: string; private?: boolean }) =>
    ipcRenderer.invoke('github:createRepo', args),
  githubGetRepo: (args: { owner: string; repo: string }) => ipcRenderer.invoke('github:getRepo', args),
  githubListRepos: (args?: { type?: string; sort?: string; perPage?: number }) =>
    ipcRenderer.invoke('github:listRepos', args),
  githubDeleteRepo: (args: { owner: string; repo: string }) => ipcRenderer.invoke('github:deleteRepo', args),
  githubForkRepo: (args: { owner: string; repo: string }) => ipcRenderer.invoke('github:forkRepo', args),
  githubGetFile: (args: { owner: string; repo: string; path: string; ref?: string }) =>
    ipcRenderer.invoke('github:getFile', args),
  githubSaveFile: (args: {
    owner: string;
    repo: string;
    path: string;
    content: string;
    message: string;
    sha?: string;
    branch?: string;
  }) => ipcRenderer.invoke('github:saveFile', args),
  githubListContents: (args: { owner: string; repo: string; path: string }) =>
    ipcRenderer.invoke('github:listContents', args),
  githubListBranches: (args: { owner: string; repo: string }) => ipcRenderer.invoke('github:listBranches', args),
  githubCreateBranch: (args: { owner: string; repo: string; name: string; fromSha: string }) =>
    ipcRenderer.invoke('github:createBranch', args),
  githubCreateIssue: (args: { owner: string; repo: string; title: string; body: string; labels?: string[] }) =>
    ipcRenderer.invoke('github:createIssue', args),
  githubListIssues: (args: { owner: string; repo: string; state?: string }) =>
    ipcRenderer.invoke('github:listIssues', args),
  githubUpdateIssue: (args: {
    owner: string;
    repo: string;
    number: number;
    updates: { title?: string; body?: string; state?: string };
  }) => ipcRenderer.invoke('github:updateIssue', args),
  githubCreatePR: (args: {
    owner: string;
    repo: string;
    title: string;
    body: string;
    head: string;
    base: string;
    draft?: boolean;
  }) => ipcRenderer.invoke('github:createPR', args),
  githubListPRs: (args: { owner: string; repo: string; state?: string }) => ipcRenderer.invoke('github:listPRs', args),
  githubMergePR: (args: { owner: string; repo: string; number: number; method?: string }) =>
    ipcRenderer.invoke('github:mergePR', args),
  githubCreateDeployment: (args: {
    owner: string;
    repo: string;
    ref: string;
    environment?: string;
    description?: string;
  }) => ipcRenderer.invoke('github:createDeployment', args),
  githubListDeployments: (args: { owner: string; repo: string; environment?: string }) =>
    ipcRenderer.invoke('github:listDeployments', args),
  githubListWorkflowRuns: (args: { owner: string; repo: string; workflowId?: string; branch?: string }) =>
    ipcRenderer.invoke('github:listWorkflowRuns', args),
  githubTriggerWorkflow: (args: {
    owner: string;
    repo: string;
    workflowId: string;
    ref: string;
    inputs?: Record<string, string>;
  }) => ipcRenderer.invoke('github:triggerWorkflow', args),
  githubCloneRepo: (args: { url: string; targetPath: string; depth?: number; branch?: string }) =>
    ipcRenderer.invoke('github:cloneRepo', args),
  githubPush: (args: { cwd: string; remote?: string; branch?: string }) => ipcRenderer.invoke('github:push', args),

  // Computer Automation
  computerMoveMouse: (args: { x: number; y: number; smooth?: boolean }) =>
    ipcRenderer.invoke('computer:moveMouse', args),
  computerGetCursorPosition: () => ipcRenderer.invoke('computer:getCursorPosition'),
  computerClick: (args: { x: number; y: number; button?: string }) => ipcRenderer.invoke('computer:click', args),
  computerDoubleClick: (args: { x: number; y: number }) => ipcRenderer.invoke('computer:doubleClick', args),
  computerRightClick: (args: { x: number; y: number }) => ipcRenderer.invoke('computer:rightClick', args),
  computerDrag: (args: { fromX: number; fromY: number; toX: number; toY: number; holdTime?: number }) =>
    ipcRenderer.invoke('computer:drag', args),
  computerScroll: (args: { x: number; y: number; amount: number }) => ipcRenderer.invoke('computer:scroll', args),
  computerHover: (args: { x: number; y: number; duration?: number }) => ipcRenderer.invoke('computer:hover', args),
  computerTypeText: (args: { text: string; delay?: number }) => ipcRenderer.invoke('computer:typeText', args),
  computerPressKey: (args: { key: string }) => ipcRenderer.invoke('computer:pressKey', args),
  computerHotkey: (args: { keys: string[] }) => ipcRenderer.invoke('computer:hotkey', args),
  computerCaptureScreen: () => ipcRenderer.invoke('computer:captureScreen'),
  computerLiveFrame: () => ipcRenderer.invoke('computer:liveFrame'),
  computerCaptureRegion: (args: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.invoke('computer:captureRegion', args),
  computerGetScreenSize: () => ipcRenderer.invoke('computer:getScreenSize'),
  computerGetDesktopState: () => ipcRenderer.invoke('computer:getDesktopState'),
  computerSaveScreenshot: (args: { filename: string }) => ipcRenderer.invoke('computer:saveScreenshot', args),
  computerGetWindows: () => ipcRenderer.invoke('computer:getWindows'),
  computerFindWindow: (args: { title: string }) => ipcRenderer.invoke('computer:findWindow', args),
  computerFocusWindow: (args: { title: string }) => ipcRenderer.invoke('computer:focusWindow', args),
  computerMinimizeWindow: (args: { title: string }) => ipcRenderer.invoke('computer:minimizeWindow', args),
  computerOpenApp: (args: { name: string }) => ipcRenderer.invoke('computer:openApp', args),
  computerOpenUrl: (args: { url: string }) => ipcRenderer.invoke('computer:openUrl', args),
  computerCloseApp: (args: { name: string }) => ipcRenderer.invoke('computer:closeApp', args),
  computerGetProcesses: () => ipcRenderer.invoke('computer:getProcesses'),
  computerGetClipboard: () => ipcRenderer.invoke('computer:getClipboard'),
  computerSetClipboard: (args: { text: string }) => ipcRenderer.invoke('computer:setClipboard', args),
  computerExecute: (args: { command: string; cwd?: string }) => ipcRenderer.invoke('computer:execute', args),
  computerStats: () => ipcRenderer.invoke(IPC.COMPUTER_STATS),
  computerActionLog: (args?: { count?: number }) => ipcRenderer.invoke('computer:actionLog', args),

  // Window controls
  windowToggleFullscreen: () => ipcRenderer.invoke(IPC.WINDOW_TOGGLE_FULLSCREEN),
  windowEnterFullscreen: () => ipcRenderer.invoke(IPC.WINDOW_ENTER_FULLSCREEN),
  windowExitFullscreen: () => ipcRenderer.invoke(IPC.WINDOW_EXIT_FULLSCREEN),
  windowIsFullscreen: () => ipcRenderer.invoke(IPC.WINDOW_IS_FULLSCREEN),
  windowUnmaximize: () => ipcRenderer.invoke(IPC.WINDOW_UNMAXIMIZE),
  windowIsMaximized: () => ipcRenderer.invoke(IPC.WINDOW_IS_MAXIMIZED),
  onWindowFullscreenChange: (cb: (data: { fullscreen: boolean }) => void) => {
    const handler = (_e: unknown, data: { fullscreen: boolean }) => cb(data);
    ipcRenderer.on('window:fullscreen-changed', handler);
    return () => ipcRenderer.removeListener('window:fullscreen-changed', handler);
  },

  // Screenshot cleanup
  screenshotCleanup: () => ipcRenderer.invoke('screenshot:cleanup'),
  screenshotRestore: () => ipcRenderer.invoke('screenshot:restore'),
  screenshotStats: () => ipcRenderer.invoke('screenshot:stats'),

  // Owner System
  ownerGetProfile: () => ipcRenderer.invoke(IPC.OWNER_GET_PROFILE),
  ownerGetPublicInfo: () => ipcRenderer.invoke(IPC.OWNER_GET_PUBLIC_INFO),
  ownerUpdateProfile: (args: { email?: string; updates: Record<string, unknown> }) =>
    ipcRenderer.invoke(IPC.OWNER_UPDATE_PROFILE, args),
  ownerListDocuments: () => ipcRenderer.invoke(IPC.OWNER_LIST_DOCUMENTS),
  ownerGetDocument: (args: { key: string }) => ipcRenderer.invoke(IPC.OWNER_GET_DOCUMENT, args),
  ownerUpsertDocument: (args: { email?: string; key: string; title: string; category?: string; body: string }) =>
    ipcRenderer.invoke(IPC.OWNER_UPSERT_DOCUMENT, args),
  ownerDeleteDocument: (args: { email?: string; key: string }) =>
    ipcRenderer.invoke(IPC.OWNER_DELETE_DOCUMENT, args),
  ownerListCapabilities: () => ipcRenderer.invoke(IPC.OWNER_LIST_CAPABILITIES),
  ownerToggleCapability: (args: { email?: string; capability: string; enabled: boolean }) =>
    ipcRenderer.invoke(IPC.OWNER_TOGGLE_CAPABILITY, args),
  ownerGetAudit: (args?: { limit?: number }) => ipcRenderer.invoke(IPC.OWNER_GET_AUDIT, args),

  // Mini Mode
  miniToggle: () => ipcRenderer.invoke(IPC.MINI_TOGGLE),
  miniRestore: () => ipcRenderer.invoke(IPC.MINI_RESTORE),
  miniSend: (args: { sessionId: string; message: string; provider: string; model: string; cwd: string }) =>
    ipcRenderer.invoke(IPC.MINI_SEND, args),
  miniAbort: (args: { sessionId: string }) => ipcRenderer.invoke(IPC.MINI_ABORT, args),
  quickCaptureAppend: (args: { text: string }) => ipcRenderer.invoke(IPC.QUICK_CAPTURE_APPEND, args),
  quickCaptureOpen: () => ipcRenderer.invoke(IPC.QUICK_CAPTURE_OPEN),
  quickCaptureLatest: () => ipcRenderer.invoke(IPC.QUICK_CAPTURE_LATEST) as Promise<{ path: string; preview: string } | null>,
  onMiniStreamEvent: (cb: (e: unknown) => void) => {
    const handler = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(IPC.MINI_STREAM_EVENT, handler);
    return () => ipcRenderer.removeListener(IPC.MINI_STREAM_EVENT, handler);
  },
  onMiniState: (cb: (e: unknown) => void) => {
    const handler = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(IPC.MINI_STATE, handler);
    return () => ipcRenderer.removeListener(IPC.MINI_STATE, handler);
  },
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
