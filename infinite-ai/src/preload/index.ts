import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc.js';

const api = {
  sendMessage: (args: { sessionId: string; message: unknown; provider: string; model: string; cwd: string }) =>
    ipcRenderer.invoke(IPC.CHAT_SEND, args),
  abortMessage: (args: { sessionId: string }) => ipcRenderer.invoke(IPC.CHAT_ABORT, args),
  onStreamEvent: (cb: (e: unknown) => void) => {
    const handler = (_e: unknown, payload: unknown) => cb(payload);
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
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
