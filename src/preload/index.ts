import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc.js';

const api = {
  sendMessage: (args: { sessionId: string; message: unknown; provider: string; model: string; cwd: string }) =>
    ipcRenderer.invoke(IPC.CHAT_SEND, args),
  abortMessage: (args: { sessionId: string }) => ipcRenderer.invoke(IPC.CHAT_ABORT, args),
  onStreamEvent: (cb: (e: unknown) => void) => {
    const handler = (_e: unknown, payload: unknown) => {
      console.log('[preload] onStreamEvent:', JSON.stringify(payload)?.slice(0, 200));
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
  spawnAgent: (args: { agentId: string; task: string; sessionId: string; cwd: string; provider: string; model: string }) =>
    ipcRenderer.invoke(IPC.AGENT_SPAWN, args),
  onAgentEvent: (cb: (e: unknown) => void) => {
    const handler = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(IPC.AGENT_EVENT, handler);
    return () => ipcRenderer.removeListener(IPC.AGENT_EVENT, handler);
  },

  createCustomAgent: (args: { agent: { name: string; description: string; icon: string; color: string; systemPrompt: string; allowedTools: string[]; maxTurns: number } }) =>
    ipcRenderer.invoke(IPC.CUSTOM_AGENT_CREATE, args),
  listCustomAgents: () => ipcRenderer.invoke(IPC.CUSTOM_AGENT_LIST),
  getCustomAgent: (args: { id: string }) => ipcRenderer.invoke(IPC.CUSTOM_AGENT_GET, args),
  updateCustomAgent: (args: { id: string; updates: Record<string, unknown> }) =>
    ipcRenderer.invoke(IPC.CUSTOM_AGENT_UPDATE, args),
  deleteCustomAgent: (args: { id: string }) => ipcRenderer.invoke(IPC.CUSTOM_AGENT_DELETE, args),

  createMemory: (args: { entry: { type: string; title: string; content: string; tags: string[]; sessionId?: string } }) =>
    ipcRenderer.invoke(IPC.MEMORY_CREATE, args),
  listMemories: (args?: { type?: string; search?: string }) =>
    ipcRenderer.invoke(IPC.MEMORY_LIST, args ?? {}),
  getMemory: (args: { id: string }) => ipcRenderer.invoke(IPC.MEMORY_GET, args),
  updateMemory: (args: { id: string; updates: Record<string, unknown> }) =>
    ipcRenderer.invoke(IPC.MEMORY_UPDATE, args),
  deleteMemory: (args: { id: string }) => ipcRenderer.invoke(IPC.MEMORY_DELETE, args),
  searchMemories: (args: { query: string }) => ipcRenderer.invoke(IPC.MEMORY_SEARCH, args),
  getMemoryStats: () => ipcRenderer.invoke(IPC.MEMORY_STATS),

  listMcpServers: () => ipcRenderer.invoke(IPC.MCP_LIST_SERVERS),
  connectMcp: (args: { name: string; config: { command: string; args?: string[]; env?: Record<string, string> } }) =>
    ipcRenderer.invoke(IPC.MCP_CONNECT, args),
  disconnectMcp: (args: { name: string }) => ipcRenderer.invoke(IPC.MCP_DISCONNECT, args),

  respondPermission: (args: { id: string; allowed: boolean }) => ipcRenderer.invoke(IPC.PERMISSION_RESPONSE, args),
  onPermissionRequest: (cb: (e: { id: string; tool: string; input: unknown }) => void) => {
    const handler = (_e: unknown, payload: { id: string; tool: string; input: unknown }) => cb(payload);
    ipcRenderer.on(IPC.PERMISSION_REQUEST, handler);
    return () => ipcRenderer.removeListener(IPC.PERMISSION_REQUEST, handler);
  },

  // Files
  fileRead: (args: { path: string }) => ipcRenderer.invoke(IPC.FILE_READ, args),
  fileWrite: (args: { path: string; content: string }) => ipcRenderer.invoke(IPC.FILE_WRITE, args),

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

  // Computer Control
  computerMoveMouse: (args: unknown) => ipcRenderer.invoke(IPC.COMPUTER_MOVE_MOUSE, args),
  computerClickMouse: (args: unknown) => ipcRenderer.invoke(IPC.COMPUTER_CLICK_MOUSE, args),
  computerTypeText: (args: unknown) => ipcRenderer.invoke(IPC.COMPUTER_TYPE_TEXT, args),
  computerPressKey: (args: unknown) => ipcRenderer.invoke(IPC.COMPUTER_PRESS_KEY, args),
  computerCaptureScreen: () => ipcRenderer.invoke(IPC.COMPUTER_CAPTURE_SCREEN),
  computerOpenApp: (args: unknown) => ipcRenderer.invoke(IPC.COMPUTER_OPEN_APP, args),
  computerCloseApp: (args: unknown) => ipcRenderer.invoke(IPC.COMPUTER_CLOSE_APP, args),
  computerStats: () => ipcRenderer.invoke(IPC.COMPUTER_STATS),

  // Automation
  automationCreateWorkflow: (args: unknown) => ipcRenderer.invoke(IPC.AUTOMATION_CREATE_WORKFLOW, args),
  automationRunWorkflow: (args: unknown) => ipcRenderer.invoke(IPC.AUTOMATION_RUN_WORKFLOW, args),
  automationListWorkflows: () => ipcRenderer.invoke(IPC.AUTOMATION_LIST_WORKFLOWS),
  automationGetWorkflow: (args: unknown) => ipcRenderer.invoke(IPC.AUTOMATION_GET_WORKFLOW, args),
  automationEnableWorkflow: (args: unknown) => ipcRenderer.invoke(IPC.AUTOMATION_ENABLE_WORKFLOW, args),
  automationDisableWorkflow: (args: unknown) => ipcRenderer.invoke(IPC.AUTOMATION_DISABLE_WORKFLOW, args),
  automationAddAction: (args: unknown) => ipcRenderer.invoke(IPC.AUTOMATION_ADD_ACTION, args),
  automationGetTemplates: () => ipcRenderer.invoke(IPC.AUTOMATION_GET_TEMPLATES),
  automationGetRuns: (args: unknown) => ipcRenderer.invoke(IPC.AUTOMATION_GET_RUNS, args),
  automationStats: () => ipcRenderer.invoke(IPC.AUTOMATION_STATS),

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
  appDelete: (args: unknown) => ipcRenderer.invoke(IPC.APP_DELETE, args),
  appTemplates: () => ipcRenderer.invoke(IPC.APP_TEMPLATES),
  appStats: () => ipcRenderer.invoke(IPC.APP_STATS),

  // Business OS
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
  skillsList: () => ipcRenderer.invoke('skills:list'),
  skillsGet: (args: { id: string }) => ipcRenderer.invoke('skills:get', args),
  skillsCreate: (args: { skill: unknown }) => ipcRenderer.invoke('skills:create', args),
  skillsUpdate: (args: { id: string; updates: unknown }) => ipcRenderer.invoke('skills:update', args),
  skillsDelete: (args: { id: string }) => ipcRenderer.invoke('skills:delete', args),
  skillsToggle: (args: { id: string }) => ipcRenderer.invoke('skills:toggle', args),
  skillsSearch: (args: { query: string }) => ipcRenderer.invoke('skills:search', args),
  skillsStats: () => ipcRenderer.invoke('skills:stats'),
  skillsImportClaude: (args: { filePath: string }) => ipcRenderer.invoke('skills:import-claude', args),
  skillsRelevant: (args: { task: string }) => ipcRenderer.invoke('skills:relevant', args),

  // Personalization
  profileGet: () => ipcRenderer.invoke('profile:get'),
  profileUpdate: (args: { updates: unknown }) => ipcRenderer.invoke('profile:update', args),
  profilePreferences: (args: { prefs: unknown }) => ipcRenderer.invoke('profile:preferences', args),
  profileBusiness: (args: { ctx: unknown }) => ipcRenderer.invoke('profile:business', args),
  profileContext: () => ipcRenderer.invoke('profile:context'),
  profileSuggestions: () => ipcRenderer.invoke('profile:suggestions'),

  // Orchestrator
  orchestratorStart: (args: { prompt: string; sessionId: string; cwd: string; provider: string; model: string }) =>
    ipcRenderer.invoke(IPC.ORCHESTRATOR_START, args),
  orchestratorInterject: (args: { taskId: string; message: string }) =>
    ipcRenderer.invoke(IPC.ORCHESTRATOR_INTERJECT, args),
  orchestratorStatus: (args?: { taskId?: string }) =>
    ipcRenderer.invoke(IPC.ORCHESTRATOR_STATUS, args ?? {}),
  onOrchestratorEvent: (cb: (e: unknown) => void) => {
    const handler = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(IPC.ORCHESTRATOR_EVENT, handler);
    return () => ipcRenderer.removeListener(IPC.ORCHESTRATOR_EVENT, handler);
  },

  // Model Selector
  modelSelect: (args: { taskType?: string }) => ipcRenderer.invoke(IPC.MODEL_SELECT, args),
  modelFreeList: () => ipcRenderer.invoke(IPC.MODEL_FREE_LIST),

  // Voice Assistant
  voiceConfigGet: () => ipcRenderer.invoke(IPC.VOICE_CONFIG_GET),
  voiceConfigSet: (args: { config: unknown }) => ipcRenderer.invoke(IPC.VOICE_CONFIG_SET, args),
  voiceStartListening: () => ipcRenderer.invoke(IPC.VOICE_START_LISTENING),
  voiceStopListening: () => ipcRenderer.invoke(IPC.VOICE_STOP_LISTENING),
  voiceProcessTranscript: (args: { transcript: string }) => ipcRenderer.invoke(IPC.VOICE_PROCESS_TRANSCRIPT, args),
  voiceSetWakeWord: (args: { word: string }) => ipcRenderer.invoke(IPC.VOICE_SET_WAKE_WORD, args),
  voiceAddCustomCommand: (args: { trigger: string; action: string }) => ipcRenderer.invoke(IPC.VOICE_ADD_CUSTOM_COMMAND, args),
  voiceRemoveCustomCommand: (args: { trigger: string }) => ipcRenderer.invoke(IPC.VOICE_REMOVE_CUSTOM_COMMAND, args),
  voiceCustomCommands: () => ipcRenderer.invoke(IPC.VOICE_CUSTOM_COMMANDS),
  voiceHistory: () => ipcRenderer.invoke(IPC.VOICE_HISTORY),
  voiceClearHistory: () => ipcRenderer.invoke(IPC.VOICE_CLEAR_HISTORY),
  voiceSpeak: (args: { text: string }) => ipcRenderer.invoke(IPC.VOICE_SPEAK, args),
  voiceStatus: () => ipcRenderer.invoke(IPC.VOICE_STATUS),

  // Video Clipping
  videoCreateProject: (args: { name: string; sourceFile: string; description?: string }) => ipcRenderer.invoke(IPC.VIDEO_CREATE_PROJECT, args),
  videoListProjects: () => ipcRenderer.invoke(IPC.VIDEO_LIST_PROJECTS),
  videoGetProject: (args: { id: string }) => ipcRenderer.invoke(IPC.VIDEO_GET_PROJECT, args),
  videoDeleteProject: (args: { id: string }) => ipcRenderer.invoke(IPC.VIDEO_DELETE_PROJECT, args),
  videoAnalyze: (args: { projectId: string }) => ipcRenderer.invoke(IPC.VIDEO_ANALYZE, args),
  videoExtractClip: (args: { projectId: string; startTime: number; endTime: number; name: string; tags?: string[] }) => ipcRenderer.invoke(IPC.VIDEO_EXTRACT_CLIP, args),
  videoFindHighlights: (args: { projectId: string; maxClips?: number }) => ipcRenderer.invoke(IPC.VIDEO_FIND_HIGHLIGHTS, args),
  videoAddTranscript: (args: { projectId: string; segments: unknown[] }) => ipcRenderer.invoke(IPC.VIDEO_ADD_TRANSCRIPT, args),
  videoSplitByChapters: (args: { projectId: string }) => ipcRenderer.invoke(IPC.VIDEO_SPLIT_BY_CHAPTERS, args),
  videoAddHighlight: (args: { projectId: string; timestamp: number; description: string }) => ipcRenderer.invoke(IPC.VIDEO_ADD_HIGHLIGHT, args),

  // Deployment
  deployCreateTarget: (args: { name: string; type: string; config: Record<string, string> }) => ipcRenderer.invoke(IPC.DEPLOY_CREATE_TARGET, args),
  deployListTargets: () => ipcRenderer.invoke(IPC.DEPLOY_LIST_TARGETS),
  deployGetTarget: (args: { id: string }) => ipcRenderer.invoke(IPC.DEPLOY_GET_TARGET, args),
  deployDeleteTarget: (args: { id: string }) => ipcRenderer.invoke(IPC.DEPLOY_DELETE_TARGET, args),
  deployCreatePipeline: (args: { name: string; projectId: string; targetId: string; commands: string[] }) => ipcRenderer.invoke(IPC.DEPLOY_CREATE_PIPELINE, args),
  deployRunPipeline: (args: { pipelineId: string; cwd?: string }) => ipcRenderer.invoke(IPC.DEPLOY_RUN_PIPELINE, args),
  deployCancelPipeline: (args: { pipelineId: string }) => ipcRenderer.invoke(IPC.DEPLOY_CANCEL_PIPELINE, args),
  deployGetPipeline: (args: { id: string }) => ipcRenderer.invoke(IPC.DEPLOY_GET_PIPELINE, args),
  deployListPipelines: () => ipcRenderer.invoke(IPC.DEPLOY_LIST_PIPELINES),
  deployDetectProject: (args: { projectPath: string }) => ipcRenderer.invoke(IPC.DEPLOY_DETECT_PROJECT, args),
  deployDefaultConfig: (args: { type: string }) => ipcRenderer.invoke(IPC.DEPLOY_DEFAULT_CONFIG, args),

  // Testing
  testCreateSuite: (args: { name: string; framework: string; description?: string }) => ipcRenderer.invoke(IPC.TEST_CREATE_SUITE, args),
  testListSuites: () => ipcRenderer.invoke(IPC.TEST_LIST_SUITES),
  testGetSuite: (args: { id: string }) => ipcRenderer.invoke(IPC.TEST_GET_SUITE, args),
  testDeleteSuite: (args: { id: string }) => ipcRenderer.invoke(IPC.TEST_DELETE_SUITE, args),
  testAddTest: (args: { suiteId: string; test: unknown }) => ipcRenderer.invoke(IPC.TEST_ADD_TEST, args),
  testRemoveTest: (args: { suiteId: string; testId: string }) => ipcRenderer.invoke(IPC.TEST_REMOVE_TEST, args),
  testRunSuite: (args: { suiteId: string }) => ipcRenderer.invoke(IPC.TEST_RUN_SUITE, args),
  testGenerateTests: (args: { description: string; filePath?: string }) => ipcRenderer.invoke(IPC.TEST_GENERATE_TESTS, args),
  testStats: () => ipcRenderer.invoke(IPC.TEST_STATS),
  testCreatePlan: (args: { name: string; description: string; scope: string; priority?: string }) => ipcRenderer.invoke(IPC.TEST_CREATE_PLAN, args),
  testListPlans: () => ipcRenderer.invoke(IPC.TEST_LIST_PLANS),

  // Enterprise
  enterpriseAddMember: (args: { name: string; email: string; role?: string }) => ipcRenderer.invoke(IPC.ENTERPRISE_ADD_MEMBER, args),
  enterpriseListMembers: () => ipcRenderer.invoke(IPC.ENTERPRISE_LIST_MEMBERS),
  enterpriseGetMember: (args: { id: string }) => ipcRenderer.invoke(IPC.ENTERPRISE_GET_MEMBER, args),
  enterpriseUpdateRole: (args: { id: string; role: string }) => ipcRenderer.invoke(IPC.ENTERPRISE_UPDATE_ROLE, args),
  enterpriseRemoveMember: (args: { id: string }) => ipcRenderer.invoke(IPC.ENTERPRISE_REMOVE_MEMBER, args),
  enterpriseCreateProject: (args: { name: string; ownerId: string; description?: string }) => ipcRenderer.invoke(IPC.ENTERPRISE_CREATE_PROJECT, args),
  enterpriseListProjects: () => ipcRenderer.invoke(IPC.ENTERPRISE_LIST_PROJECTS),
  enterpriseAddToProject: (args: { projectId: string; memberId: string }) => ipcRenderer.invoke(IPC.ENTERPRISE_ADD_MEMBER_TO_PROJECT, args),
  enterpriseRemoveFromProject: (args: { projectId: string; memberId: string }) => ipcRenderer.invoke(IPC.ENTERPRISE_REMOVE_MEMBER_FROM_PROJECT, args),
  enterpriseAuditLog: (args?: { filters?: unknown }) => ipcRenderer.invoke(IPC.ENTERPRISE_AUDIT_LOG, args ?? {}),
  enterpriseAddComplianceRule: (args: { name: string; description: string; category: string; severity: string; check: string }) => ipcRenderer.invoke(IPC.ENTERPRISE_ADD_COMPLIANCE_RULE, args),
  enterpriseComplianceRules: () => ipcRenderer.invoke(IPC.ENTERPRISE_COMPLIANCE_RULES),
  enterpriseComplianceStatus: () => ipcRenderer.invoke(IPC.ENTERPRISE_COMPLIANCE_STATUS),
  enterpriseExportAudit: () => ipcRenderer.invoke(IPC.ENTERPRISE_EXPORT_AUDIT),

  // Call Center
  callCreate: (args: { callerId: string; direction: string; options?: unknown }) => ipcRenderer.invoke(IPC.CALL_CREATE, args),
  callAnswer: (args: { callId: string; agentId?: string }) => ipcRenderer.invoke(IPC.CALL_ANSWER, args),
  callHold: (args: { callId: string }) => ipcRenderer.invoke(IPC.CALL_HOLD, args),
  callResume: (args: { callId: string }) => ipcRenderer.invoke(IPC.CALL_RESUME, args),
  callEnd: (args: { callId: string; disposition?: string; notes?: string }) => ipcRenderer.invoke(IPC.CALL_END, args),
  callMiss: (args: { callId: string }) => ipcRenderer.invoke(IPC.CALL_MISS, args),
  callGet: (args: { id: string }) => ipcRenderer.invoke(IPC.CALL_GET, args),
  callList: (args?: { filters?: unknown }) => ipcRenderer.invoke(IPC.CALL_LIST, args ?? {}),
  callQueueCreate: (args: { name: string; maxWaitTime?: number; priority?: number }) => ipcRenderer.invoke(IPC.CALL_QUEUE_CREATE, args),
  callQueueList: () => ipcRenderer.invoke(IPC.CALL_QUEUE_LIST),
  callQueueAdd: (args: { queueId: string; callId: string }) => ipcRenderer.invoke(IPC.CALL_QUEUE_ADD, args),
  callQueueRemove: (args: { queueId: string; callId: string }) => ipcRenderer.invoke(IPC.CALL_QUEUE_REMOVE, args),
  callAgentCreate: (args: { name: string; skills?: string[]; maxConcurrent?: number }) => ipcRenderer.invoke(IPC.CALL_AGENT_CREATE, args),
  callAgentList: () => ipcRenderer.invoke(IPC.CALL_AGENT_LIST),
  callAgentStatus: (args: { agentId: string; status: string }) => ipcRenderer.invoke(IPC.CALL_AGENT_STATUS, args),
  callAssign: (args: { agentId: string; callId: string }) => ipcRenderer.invoke(IPC.CALL_ASSIGN, args),
  callTemplateCreate: (args: { name: string; greeting: string; prompts?: string[] }) => ipcRenderer.invoke(IPC.CALL_TEMPLATE_CREATE, args),
  callTemplateList: () => ipcRenderer.invoke(IPC.CALL_TEMPLATE_LIST),
  callAnalytics: (args?: { since?: number }) => ipcRenderer.invoke(IPC.CALL_ANALYTICS, args ?? {}),
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
