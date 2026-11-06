import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc.js';
import type {
  PageCreateInput,
  PageDatabaseRowInput,
  PageUpdateInput,
} from '../shared/pages.js';

const api = {
  sendMessage: (args: { sessionId: string; message: unknown; displayMessage?: unknown; provider: string; model: string; cwd: string; planMode?: boolean; background?: boolean; untilDone?: boolean }) =>
    ipcRenderer.invoke(IPC.CHAT_SEND, args),
  resolvePlan: (args: { sessionId: string; approved: boolean }) => ipcRenderer.invoke(IPC.CHAT_PLAN_RESOLVE, args),
  resolveQuestion: (args: { id: string; answers: Record<string, string>; skipped: Record<string, boolean> }) =>
    ipcRenderer.invoke(IPC.CHAT_QUESTION_RESOLVE, args),
  listBackgroundTasks: () => ipcRenderer.invoke(IPC.BACKGROUND_TASKS_LIST),
  abortMessage: (args: { sessionId: string }) => ipcRenderer.invoke(IPC.CHAT_ABORT, args),
  interjectMessage: (args: { sessionId: string; message: string }) => ipcRenderer.invoke(IPC.CHAT_INTERJECT, args),
  operatorBrowserSearch: (args: { query: string }) => ipcRenderer.invoke(IPC.OPERATOR_BROWSER_SEARCH, args),
  operatorBrowserNavigate: (args: { url: string }) => ipcRenderer.invoke(IPC.OPERATOR_BROWSER_NAVIGATE, args),
  operatorBrowserShutdown: () => ipcRenderer.invoke(IPC.OPERATOR_BROWSER_SHUTDOWN),
  bridgeStatus: () => ipcRenderer.invoke(IPC.BRIDGE_STATUS),
  bridgeExec: (args: { command: string; params?: Record<string, unknown>; timeoutMs?: number }) =>
    ipcRenderer.invoke(IPC.BRIDGE_EXEC, args),
  bridgeSetupStatus: () => ipcRenderer.invoke(IPC.BRIDGE_SETUP_STATUS),
  bridgeSetupLaunch: () => ipcRenderer.invoke(IPC.BRIDGE_SETUP_LAUNCH),
  bridgeSetupRestart: () => ipcRenderer.invoke(IPC.BRIDGE_SETUP_RESTART),
  bridgeSetupInstall: () => ipcRenderer.invoke(IPC.BRIDGE_SETUP_INSTALL),
  bridgeSetupOpenFolder: () => ipcRenderer.invoke(IPC.BRIDGE_SETUP_OPEN_FOLDER),
  bridgeSetupCopyPath: () => ipcRenderer.invoke(IPC.BRIDGE_SETUP_COPY_PATH),
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

  // ── Archive ──────────────────────────────────────────────────────────────
  archiveSession: (args: { sessionId: string; archived: boolean }) =>
    ipcRenderer.invoke(IPC.SESSION_ARCHIVE_SET, args),
  archiveList: () => ipcRenderer.invoke(IPC.SESSION_ARCHIVE_LIST),
  archiveSearch: (args: { query: string }) => ipcRenderer.invoke(IPC.SESSION_ARCHIVE_SEARCH, args),
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
  opencodeCliVersion: () => ipcRenderer.invoke(IPC.OPENCODE_CLI_VERSION),
  opencodeCliUpgrade: () => ipcRenderer.invoke(IPC.OPENCODE_CLI_UPGRADE),
  opencodeServerRestart: () => ipcRenderer.invoke(IPC.OPENCODE_SERVER_RESTART),

  // Continuous self-evolution loop (Settings → Self-Evolve)
  evolveLoopStart: (args?: { intervalMs?: number }) => ipcRenderer.invoke(IPC.EVOLVE_LOOP_START, args ?? {}),
  evolveLoopStop: () => ipcRenderer.invoke(IPC.EVOLVE_LOOP_STOP),
  evolveLoopStatus: () => ipcRenderer.invoke(IPC.EVOLVE_LOOP_STATUS),

  // Self-Evolution Engine. These handlers were registered in main but never
  // exposed here, so the renderer had no way to call them and the feature was
  // unreachable — the same bug as FreeBuff, where the code was finished and
  // tested and simply never wired to anything the user can reach.
  selfEvolveAnalyze: () => ipcRenderer.invoke(IPC.SELF_EVOLVE_ANALYZE),
  selfEvolveSuggestions: (args?: { status?: 'suggested' | 'accepted' | 'dismissed' }) =>
    ipcRenderer.invoke(IPC.SELF_EVOLVE_SUGGESTIONS, args ?? {}),
  selfEvolveAccept: (args: { id: string }) => ipcRenderer.invoke(IPC.SELF_EVOLVE_ACCEPT, args),
  selfEvolveDismiss: (args: { id: string }) => ipcRenderer.invoke(IPC.SELF_EVOLVE_DISMISS, args),
  selfEvolveStatus: () => ipcRenderer.invoke(IPC.SELF_EVOLVE_STATUS),
  selfEvolvePrompt: () => ipcRenderer.invoke(IPC.SELF_EVOLVE_PROMPT),
  selfEvolveEvolve: () => ipcRenderer.invoke(IPC.SELF_EVOLVE_EVOLVE),

  /**
   * Background builds. The five handlers existed in main with no preload
   * exposure and no caller, so the whole feature was unreachable.
   */
  buildStart: () => ipcRenderer.invoke(IPC.BUILD_START),
  buildStatus: () => ipcRenderer.invoke(IPC.BUILD_STATUS),
  buildCancel: () => ipcRenderer.invoke(IPC.BUILD_CANCEL),
  buildHasUpdate: () => ipcRenderer.invoke(IPC.BUILD_HAS_UPDATE),
  buildClearUpdate: () => ipcRenderer.invoke(IPC.BUILD_CLEAR_UPDATE),
  onBuildStatus: (cb: (status: unknown) => void) => {
    const listener = (_e: unknown, status: unknown) => cb(status);
    ipcRenderer.on(IPC.BUILD_STATUS_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.BUILD_STATUS_CHANGED, listener);
  },

  /** Token and cost totals across conversations. */
  usageGet: () => ipcRenderer.invoke(IPC.USAGE_GET),
  usageReset: () => ipcRenderer.invoke(IPC.USAGE_RESET),
  evolveLoopRunNow: () => ipcRenderer.invoke(IPC.EVOLVE_LOOP_RUN_NOW),

  // Self-apply: rebuild + relaunch so packaged builds load self-edits
  selfApplyRun: () => ipcRenderer.invoke(IPC.SELF_APPLY_RUN),
  selfApplyStatus: () => ipcRenderer.invoke(IPC.SELF_APPLY_STATUS),
  onSelfApplyEvent: (cb: (e: unknown) => void) => {
    const handler = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(IPC.SELF_APPLY_EVENT, handler);
    return () => ipcRenderer.removeListener(IPC.SELF_APPLY_EVENT, handler);
  },
  listTools: () => ipcRenderer.invoke(IPC.TOOLS_LIST),

  // Action audit log (query the agent's black-box record)
  auditRecent: (args?: { limit?: number }) => ipcRenderer.invoke(IPC.AUDIT_RECENT, args),
  auditQuery: (args?: { sessionId?: string; tool?: string; limit?: number }) =>
    ipcRenderer.invoke(IPC.AUDIT_QUERY, args),
  auditDay: (args?: { date?: string }) => ipcRenderer.invoke(IPC.AUDIT_DAY, args),
  auditStats: () => ipcRenderer.invoke(IPC.AUDIT_STATS),
  auditVerify: () => ipcRenderer.invoke(IPC.AUDIT_VERIFY),

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
    tier?: 'episodic' | 'semantic' | 'procedural'; importance?: number;
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
  automationListRuns: () => ipcRenderer.invoke(IPC.AUTOMATION_LIST_RUNS),
  automationStats: () => ipcRenderer.invoke(IPC.AUTOMATION_STATS),
  automationSchedulerStatus: () => ipcRenderer.invoke(IPC.AUTOMATION_SCHEDULER_STATUS),
  automationSetKeepAwake: (enabled: boolean) => ipcRenderer.invoke(IPC.AUTOMATION_SET_KEEP_AWAKE, { enabled }),
  automationNextRuns: () => ipcRenderer.invoke(IPC.AUTOMATION_NEXT_RUNS),
  automationCancelRun: (args: unknown) => ipcRenderer.invoke(IPC.AUTOMATION_CANCEL_RUN, args),
  automationCreateFromNL: (args: unknown) => ipcRenderer.invoke(IPC.AUTOMATION_CREATE_FROM_NL, args),
  automationGetPendingApprovals: () => ipcRenderer.invoke(IPC.AUTOMATION_GET_PENDING_APPROVALS),
  automationApproveAction: (args: { approvalId: string; approve: boolean }) => ipcRenderer.invoke(IPC.AUTOMATION_APPROVE_ACTION, args),
  automationCommentAction: (args: { approvalId: string; comment: string }) => ipcRenderer.invoke(IPC.AUTOMATION_COMMENT_ACTION, args),

  // Workers
  workerList: () => ipcRenderer.invoke(IPC.WORKERS_LIST),
  workerGet: (args: { workerId: string }) => ipcRenderer.invoke(IPC.WORKERS_GET, args),
  workerCreate: (args: unknown) => ipcRenderer.invoke(IPC.WORKERS_CREATE, args),
  workerUpdate: (args: { workerId: string; input: unknown }) => ipcRenderer.invoke(IPC.WORKERS_UPDATE, args),
  workerDelete: (args: { workerId: string }) => ipcRenderer.invoke(IPC.WORKERS_DELETE, args),
  workerRun: (args: { workerId: string }) => ipcRenderer.invoke(IPC.WORKERS_RUN, args),
  workerPause: (args: { workerId: string }) => ipcRenderer.invoke(IPC.WORKERS_PAUSE, args),
  workerResume: (args: { workerId: string }) => ipcRenderer.invoke(IPC.WORKERS_RESUME, args),
  workerCancel: (args: { workerId: string }) => ipcRenderer.invoke(IPC.WORKERS_CANCEL, args),
  workerInterject: (args: { workerId: string; message: string }) => ipcRenderer.invoke(IPC.WORKERS_INTERJECT, args),
  workerHistory: (args: { workerId: string }) => ipcRenderer.invoke(IPC.WORKERS_HISTORY, args),
  workerOpenFolder: (args: { workerId: string }) => ipcRenderer.invoke(IPC.WORKERS_OPEN_FOLDER, args),
  workerBackgroundGet: () => ipcRenderer.invoke(IPC.WORKERS_BACKGROUND_GET),
  workerBackgroundSet: (args: { enabled: boolean }) => ipcRenderer.invoke(IPC.WORKERS_BACKGROUND_SET, args),
  onWorkerEvent: (cb: (event: unknown) => void) => {
    const handler = (_event: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(IPC.WORKERS_EVENT, handler);
    return () => ipcRenderer.removeListener(IPC.WORKERS_EVENT, handler);
  },

  // Teaching mode
  teachStart: (args?: unknown) => ipcRenderer.invoke(IPC.TEACH_START, args),
  teachStop: (args: { recordingId: string }) => ipcRenderer.invoke(IPC.TEACH_STOP, args),
  teachNarrate: (args: { recordingId: string; text: string }) => ipcRenderer.invoke(IPC.TEACH_NARRATE, args),
  teachRename: (args: { recordingId: string; name: string }) => ipcRenderer.invoke(IPC.TEACH_RENAME, args),
  teachList: () => ipcRenderer.invoke(IPC.TEACH_LIST),
  teachGet: (args: { recordingId: string }) => ipcRenderer.invoke(IPC.TEACH_GET, args),
  teachDelete: (args: { recordingId: string }) => ipcRenderer.invoke(IPC.TEACH_DELETE, args),
  teachCompile: (args: { recordingId: string }) => ipcRenderer.invoke(IPC.TEACH_COMPILE, args),
  teachFrame: (args: { recordingId: string; path?: string }) => ipcRenderer.invoke(IPC.TEACH_FRAME, args),
  teachUpdateSteps: (args: { recordingId: string; steps: unknown }) => ipcRenderer.invoke(IPC.TEACH_UPDATE_STEPS, args),
  teachCreateWorker: (args: unknown) => ipcRenderer.invoke(IPC.TEACH_CREATE_WORKER, args),
  onTeachEvent: (cb: (event: unknown) => void) => {
    const handler = (_event: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(IPC.TEACH_EVENT, handler);
    return () => ipcRenderer.removeListener(IPC.TEACH_EVENT, handler);
  },

  // App catalog + credential vault
  appsList: (args?: { query?: string }) => ipcRenderer.invoke(IPC.APPS_LIST, args ?? {}),
  appsInstall: (args: { wingetId: string }) => ipcRenderer.invoke(IPC.APPS_INSTALL, args),
  appsLaunch: (args: { appId: string }) => ipcRenderer.invoke(IPC.APPS_LAUNCH, args),
  vaultList: (args?: { workerId?: string }) => ipcRenderer.invoke(IPC.VAULT_LIST, args ?? {}),
  vaultAdd: (args: unknown) => ipcRenderer.invoke(IPC.VAULT_ADD, args),
  vaultAuthorize: (args: { entryId: string; workerIds: string[] }) => ipcRenderer.invoke(IPC.VAULT_AUTHORIZE, args),
  vaultDelete: (args: { entryId: string }) => ipcRenderer.invoke(IPC.VAULT_DELETE, args),

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

  // Tasks are real records now, shared with the agent rather than living in the
  // renderer's memory where a reload lost them.
  businessListTasks: (args?: { status?: string; assignee?: string }) => ipcRenderer.invoke(IPC.BUSINESS_LIST_TASKS, args ?? {}),
  businessCreateTask: (args: Record<string, unknown>) => ipcRenderer.invoke(IPC.BUSINESS_CREATE_TASK, args),
  businessUpdateTask: (args: { id: string; updates: Record<string, unknown> }) => ipcRenderer.invoke(IPC.BUSINESS_UPDATE_TASK, args),
  businessDeleteTask: (args: { id: string }) => ipcRenderer.invoke(IPC.BUSINESS_DELETE_TASK, args),
  businessOverview: () => ipcRenderer.invoke(IPC.BUSINESS_OVERVIEW),
  businessSearch: (args: { query: string }) => ipcRenderer.invoke(IPC.BUSINESS_SEARCH, args),
  businessActivities: (args?: { type?: string; entityId?: string; limit?: number }) =>
    ipcRenderer.invoke(IPC.BUSINESS_ACTIVITIES, args ?? {}),
  businessAddNote: (args: { text: string; entityId?: string; entityName?: string }) =>
    ipcRenderer.invoke(IPC.BUSINESS_ADD_NOTE, args),
  businessContactDetail: (args: { id: string }) => ipcRenderer.invoke(IPC.BUSINESS_CONTACT_DETAIL, args),
  businessAttention: () => ipcRenderer.invoke(IPC.BUSINESS_ATTENTION),
  businessDeleteLead: (args: { id: string }) => ipcRenderer.invoke(IPC.BUSINESS_DELETE_LEAD, args),
  businessDeleteInvoice: (args: { id: string }) => ipcRenderer.invoke(IPC.BUSINESS_DELETE_INVOICE, args),
  businessDeleteDeal: (args: { id: string }) => ipcRenderer.invoke(IPC.BUSINESS_DELETE_DEAL, args),
  businessLogSentEmail: (args: { from: string; to: string; subject: string; body: string }) =>
    ipcRenderer.invoke(IPC.BUSINESS_LOG_SENT_EMAIL, args),
  businessStats: () => ipcRenderer.invoke(IPC.BUSINESS_STATS),
  businessListEmails: () => ipcRenderer.invoke(IPC.BUSINESS_LIST_EMAILS),
  businessSaveEmail: (args: unknown) => ipcRenderer.invoke(IPC.BUSINESS_SAVE_EMAIL, args),
  businessDeleteEmail: (args: unknown) => ipcRenderer.invoke(IPC.BUSINESS_DELETE_EMAIL, args),

  // ── Project board ────────────────────────────────────────────────────────
  // Backed by the same store the `Project` tool uses, so the board the user
  // drags cards on and the tasks the agent creates are the same records.
  projectsList: (args?: { workspace?: string }) => ipcRenderer.invoke(IPC.PROJECTS_LIST, args ?? {}),
  projectsCreate: (args: { name: string; workspace?: string; description?: string; board?: string[]; path?: string; kind?: string }) =>
    ipcRenderer.invoke(IPC.PROJECTS_CREATE, args),
  // One shared project record behind both Projects and Board.
  projectsUpdate: (args: { id: string; updates: Record<string, unknown> }) => ipcRenderer.invoke(IPC.PROJECTS_UPDATE, args),
  projectsDelete: (args: { id: string }) => ipcRenderer.invoke(IPC.PROJECTS_DELETE, args),
  projectsWithFiles: () => ipcRenderer.invoke(IPC.PROJECTS_WITH_FILES),
  projectsBoard: (args: { projectId: string }) => ipcRenderer.invoke(IPC.PROJECTS_BOARD, args),
  projectsListAll: () => ipcRenderer.invoke(IPC.PROJECTS_LIST_ALL),
  projectsCreateTask: (args: Record<string, unknown>) => ipcRenderer.invoke(IPC.PROJECTS_CREATE_TASK, args),
  projectsUpdateTask: (args: { id: string; updates: Record<string, unknown> }) =>
    ipcRenderer.invoke(IPC.PROJECTS_UPDATE_TASK, args),
  projectsDeleteTask: (args: { id: string }) => ipcRenderer.invoke(IPC.PROJECTS_DELETE_TASK, args),
  projectsAddChecklist: (args: { taskId: string; text: string }) => ipcRenderer.invoke(IPC.PROJECTS_ADD_CHECKLIST, args),
  projectsToggleChecklist: (args: { taskId: string; index: number }) => ipcRenderer.invoke(IPC.PROJECTS_TOGGLE_CHECKLIST, args),
  projectsAddComment: (args: { taskId: string; text: string }) => ipcRenderer.invoke(IPC.PROJECTS_ADD_COMMENT, args),
  projectsAnalytics: (args?: { projectId?: string }) => ipcRenderer.invoke(IPC.PROJECTS_ANALYTICS, args ?? {}),

  // Runs cut off by a restart, with what they had really done.
  resumeInterrupted: () => ipcRenderer.invoke(IPC.RESUME_INTERRUPTED),

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
  multiAgentUpdateTeam: (args: unknown) => ipcRenderer.invoke(IPC.MULTI_AGENT_UPDATE_TEAM, args),
  multiAgentAddToTeam: (args: unknown) => ipcRenderer.invoke(IPC.MULTI_AGENT_ADD_TO_TEAM, args),
  multiAgentRemoveFromTeam: (args: unknown) => ipcRenderer.invoke(IPC.MULTI_AGENT_REMOVE_FROM_TEAM, args),
  multiAgentSetRole: (args: unknown) => ipcRenderer.invoke(IPC.MULTI_AGENT_SET_ROLE, args),
  multiAgentSetLeader: (args: unknown) => ipcRenderer.invoke(IPC.MULTI_AGENT_SET_LEADER, args),
  multiAgentListTeams: () => ipcRenderer.invoke(IPC.MULTI_AGENT_LIST_TEAMS),
  multiAgentOrg: () => ipcRenderer.invoke(IPC.MULTI_AGENT_ORG),
  multiAgentCreateTask: (args: unknown) => ipcRenderer.invoke(IPC.MULTI_AGENT_CREATE_TASK, args),
  multiAgentAssignTask: (args: unknown) => ipcRenderer.invoke(IPC.MULTI_AGENT_ASSIGN_TASK, args),
  multiAgentStartTask: (args: unknown) => ipcRenderer.invoke(IPC.MULTI_AGENT_START_TASK, args),
  multiAgentCompleteTask: (args: unknown) => ipcRenderer.invoke(IPC.MULTI_AGENT_COMPLETE_TASK, args),
  multiAgentListTasks: () => ipcRenderer.invoke(IPC.MULTI_AGENT_LIST_TASKS),
  multiAgentSendMessage: (args: unknown) => ipcRenderer.invoke(IPC.MULTI_AGENT_SEND_MESSAGE, args),
  multiAgentGetMessages: (args: unknown) => ipcRenderer.invoke(IPC.MULTI_AGENT_GET_MESSAGES, args),
  multiAgentExecuteTeamTask: (args: unknown) => ipcRenderer.invoke(IPC.MULTI_AGENT_EXECUTE_TEAM_TASK, args),
  multiAgentRunOrgMission: (args: unknown) => ipcRenderer.invoke(IPC.MULTI_AGENT_RUN_ORG_MISSION, args),
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
  skillsExport: (args?: { skillIds?: string[] }) => ipcRenderer.invoke(IPC.SKILLS_EXPORT, args),
  skillsImport: (args: { manifest: unknown }) => ipcRenderer.invoke(IPC.SKILLS_IMPORT, args),

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

  // Session Board — kanban management of parallel agent sessions
  sessionBoardCreate: (args: { title: string; options?: unknown }) =>
    ipcRenderer.invoke(IPC.SESSION_BOARD_CREATE, args),
  sessionBoardStart: (args: { sessionId: string; task: string; agentId?: string; model?: string; provider?: string }) =>
    ipcRenderer.invoke(IPC.SESSION_BOARD_START, args),
  sessionBoardCancel: (args: { sessionId: string }) =>
    ipcRenderer.invoke(IPC.SESSION_BOARD_CANCEL, args),
  sessionBoardInterject: (args: { sessionId: string; message: string }) =>
    ipcRenderer.invoke(IPC.SESSION_BOARD_INTERJECT, args),
  sessionBoardList: () => ipcRenderer.invoke(IPC.SESSION_BOARD_LIST),
  sessionBoardGet: (args: { sessionId: string }) => ipcRenderer.invoke(IPC.SESSION_BOARD_GET, args),
  onSessionBoardEvent: (cb: (e: unknown) => void) => {
    const handler = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(IPC.SESSION_BOARD_EVENT, handler);
    return () => ipcRenderer.removeListener(IPC.SESSION_BOARD_EVENT, handler);
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

  // Loopback static server. Used by the Tabs section to show a file the agent
  // produced (a generated site, a test page, a built project) inside the app
  // instead of launching the user's default browser over it.
  workspaceServe: (args: { root: string }) => ipcRenderer.invoke(IPC.WORKSPACE_SERVE, args),
  workspaceUrlFor: (args: { path: string }) => ipcRenderer.invoke(IPC.WORKSPACE_URL_FOR, args),

  // ── In-app browser (Tabs section) ─────────────────────────────────────────
  // Main owns the guest as a WebContentsView child of the window, so browsing
  // happens inside Infinite OS. The renderer only measures its box and reports
  // bounds — it never creates a surface of its own.
  tabBrowserCreate: (args: { viewId: string; url: string; bounds: { x: number; y: number; width: number; height: number } }) =>
    ipcRenderer.invoke(IPC.TAB_BROWSER_CREATE, args),
  tabBrowserBounds: (args: { viewId: string; bounds: { x: number; y: number; width: number; height: number } }) =>
    ipcRenderer.invoke(IPC.TAB_BROWSER_BOUNDS, args),
  tabBrowserNavigate: (args: { viewId: string; url: string }) => ipcRenderer.invoke(IPC.TAB_BROWSER_NAVIGATE, args),
  tabBrowserBack: (args: { viewId: string }) => ipcRenderer.invoke(IPC.TAB_BROWSER_BACK, args),
  tabBrowserForward: (args: { viewId: string }) => ipcRenderer.invoke(IPC.TAB_BROWSER_FORWARD, args),
  tabBrowserReload: (args: { viewId: string }) => ipcRenderer.invoke(IPC.TAB_BROWSER_RELOAD, args),
  tabBrowserState: (args: { viewId: string }) => ipcRenderer.invoke(IPC.TAB_BROWSER_STATE, args),
  tabBrowserClose: (args: { viewId: string }) => ipcRenderer.invoke(IPC.TAB_BROWSER_CLOSE, args),
  onTabBrowserEvent: (
    cb: (payload: { viewId: string; url?: string; title?: string; canGoBack?: boolean; canGoForward?: boolean; loading?: boolean; error?: string | null }) => void,
  ) => {
    const handler = (_event: unknown, payload: unknown) =>
      cb(payload as { viewId: string; url?: string; title?: string; canGoBack?: boolean; canGoForward?: boolean; loading?: boolean; error?: string | null });
    ipcRenderer.on(IPC.TAB_BROWSER_EVENT, handler);
    return () => ipcRenderer.removeListener(IPC.TAB_BROWSER_EVENT, handler);
  },
  onTabCreate: (cb: (tab: unknown) => void) => {
    const handler = (_event: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(IPC.TAB_CREATE, handler);
    return () => ipcRenderer.removeListener(IPC.TAB_CREATE, handler);
  },
  onTabUpdate: (cb: (patch: { tabId: string; changes: Record<string, unknown>; metadata?: Record<string, unknown> }) => void) => {
    const handler = (_event: unknown, payload: unknown) => cb(payload as { tabId: string; changes: Record<string, unknown>; metadata?: Record<string, unknown> });
    ipcRenderer.on(IPC.TAB_UPDATE, handler);
    return () => ipcRenderer.removeListener(IPC.TAB_UPDATE, handler);
  },
  // Mirror the renderer's tabs into main so the agent can list them and read
  // their real address.
  tabIndexReplace: (args: { tabs: unknown[] }) => ipcRenderer.invoke(IPC.TAB_INDEX_REPLACE, args),
  tabIndexUpsert: (args: { tab: unknown }) => ipcRenderer.invoke(IPC.TAB_INDEX_UPSERT, args),
  tabIndexRemove: (args: { id: string }) => ipcRenderer.invoke(IPC.TAB_INDEX_REMOVE, args),

  // ── Always-on voice ───────────────────────────────────────────────────────
  // The listening loop runs in the main process, so the microphone (and the
  // agent answering it) survive every view change. The renderer only observes
  // state and sends control intents.
  voiceSessionState: () => ipcRenderer.invoke(IPC.VOICE_SESSION_STATE),
  voiceSessionSetEnabled: (args: { enabled: boolean; cwd?: string }) =>
    ipcRenderer.invoke(IPC.VOICE_SESSION_SET_ENABLED, args),
  voiceSessionPause: () => ipcRenderer.invoke(IPC.VOICE_SESSION_PAUSE),
  voiceSessionResume: () => ipcRenderer.invoke(IPC.VOICE_SESSION_RESUME),
  voiceSessionInterrupt: () => ipcRenderer.invoke(IPC.VOICE_SESSION_INTERRUPT),
  voiceSessionSay: (args: { text: string }) => ipcRenderer.invoke(IPC.VOICE_SESSION_SAY, args),
  onVoiceSession: (
    cb: (state: {
      enabled: boolean; listening: boolean; phase: string; interim: string;
      engine: string | null; wakeWord: string; error: string | null;
      sessionId: string; speaking: boolean; muted: boolean;
    }, utterance?: { text: string; at: number }) => void,
  ) => {
    const handler = (_event: unknown, payload: unknown, utterance?: { text: string; at: number }) =>
      cb(payload as never, utterance);
    ipcRenderer.on(IPC.VOICE_SESSION_EVENT, handler);
    return () => ipcRenderer.removeListener(IPC.VOICE_SESSION_EVENT, handler);
  },

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
  deployOsStatus: () => ipcRenderer.invoke(IPC.DEPLOY_OS_STATUS),
  deployOsPush: (args: { message?: string }) => ipcRenderer.invoke(IPC.DEPLOY_OS_PUSH, args),

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
  enterpriseCompanyGet: () => ipcRenderer.invoke(IPC.ENTERPRISE_COMPANY_GET),
  enterpriseCompanyUpdate: (args: { name?: string; industry?: string; website?: string }) =>
    ipcRenderer.invoke(IPC.ENTERPRISE_COMPANY_UPDATE, args),
  enterpriseCompanyAddNote: (args: { text: string; kind?: string }) =>
    ipcRenderer.invoke(IPC.ENTERPRISE_COMPANY_ADD_NOTE, args),
  enterpriseCompanyDeleteNote: (args: { id: string }) =>
    ipcRenderer.invoke(IPC.ENTERPRISE_COMPANY_DELETE_NOTE, args),
  kbList: () => ipcRenderer.invoke(IPC.KB_LIST),
  kbGet: (args: { id: string }) => ipcRenderer.invoke(IPC.KB_GET, args),
  kbSave: (args: { id?: string; title: string; content?: string; tags?: string[] }) =>
    ipcRenderer.invoke(IPC.KB_SAVE, args),
  kbDelete: (args: { id: string }) => ipcRenderer.invoke(IPC.KB_DELETE, args),
  kbAttach: (args: { path: string; title?: string }) => ipcRenderer.invoke(IPC.KB_ATTACH, args),
  pickFile: (args?: { filters?: Array<{ name: string; extensions: string[] }> }) =>
    ipcRenderer.invoke(IPC.PICK_FILE, args ?? {}),
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

  // Local model performance: what this machine can run, what is installed, what
  // is currently pinned in RAM, and the controls to free it.
  ollamaCapability: () => ipcRenderer.invoke(IPC.OLLAMA_CAPABILITY),
  ollamaLocalModels: () => ipcRenderer.invoke(IPC.OLLAMA_MODELS_LOCAL),
  ollamaLoaded: () => ipcRenderer.invoke(IPC.OLLAMA_LOADED),
  ollamaPreload: (args: { model: string }) => ipcRenderer.invoke(IPC.OLLAMA_PRELOAD, args),
  ollamaUnload: (args: { model: string }) => ipcRenderer.invoke(IPC.OLLAMA_UNLOAD, args),
  ollamaHealth: () => ipcRenderer.invoke(IPC.OLLAMA_HEALTH),

  // ── Boot optimization ────────────────────────────────────────────────────
  // Applies ONE finding at a time, and the handler refuses anything report-only.
  // There is deliberately no "optimize everything" call.
  optimizeAnalyse: (args?: { busyNames?: string[] }) => ipcRenderer.invoke(IPC.OPTIMIZE_ANALYSE, args ?? {}),
  optimizeApply: (args: { finding: unknown; approved?: boolean }) => ipcRenderer.invoke(IPC.OPTIMIZE_APPLY, args),
  optimizeUndoList: () => ipcRenderer.invoke(IPC.OPTIMIZE_UNDO_LIST),
  optimizeUndo: (args: { entry: unknown }) => ipcRenderer.invoke(IPC.OPTIMIZE_UNDO, args),
  optimizeUndoAll: () => ipcRenderer.invoke(IPC.OPTIMIZE_UNDO_ALL),
  optimizeDismiss: () => ipcRenderer.invoke(IPC.OPTIMIZE_DISMISS),
  optimizeSeen: () => ipcRenderer.invoke(IPC.OPTIMIZE_SEEN),
  optimizeAutoEnabled: () => ipcRenderer.invoke(IPC.OPTIMIZE_AUTO_ENABLED),

  // ── OCR ──
  ocrRecognize: (args: { imagePath: string }) => ipcRenderer.invoke('ocr:recognize', args),
  ocrAnalyze: (args: { imagePath: string; prompt: string }) => ipcRenderer.invoke('ocr:analyze', args),
  ocrStatus: () => ipcRenderer.invoke('ocr:status'),

  // ── Voice ──
  voiceSTT: (args: { audioBuffer: string; format: string; local?: boolean; language?: string }) =>
    ipcRenderer.invoke('voice:stt', args),
  voiceTTS: (args: {
    text: string;
    voice?: string;
    source?: 'local' | 'kokoro' | 'auto' | 'openrouter' | 'openai' | 'edge';
    model?: string;
  }) => ipcRenderer.invoke('voice:tts', args) as Promise<{ audio: string; provider: string }>,
  voiceStatus: () => ipcRenderer.invoke('voice:status'),
  voiceWarmup: (args?: { which?: 'stt' | 'tts' | 'both' }) =>
    ipcRenderer.invoke('voice:warmup', args ?? {}) as Promise<{ stt: boolean; tts: boolean }>,
  voiceSetKey: (args: { apiKey: string }) => ipcRenderer.invoke('voice:setKey', args),
  voiceKeysGet: () =>
    ipcRenderer.invoke('voice:keys:get') as Promise<{
      stt: boolean;
      tts: boolean;
      sttSource: 'dedicated' | 'provider' | 'openrouter' | null;
      ttsSource: 'dedicated' | 'provider' | 'openrouter' | null;
    }>,
  voiceKeysSet: (args: { sttKey?: string; ttsKey?: string; clearStt?: boolean; clearTts?: boolean }) =>
    ipcRenderer.invoke('voice:keys:set', args) as Promise<{ ok: boolean }>,

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

  // WhatsApp link (companion-device QR pairing, OpenClaw-style inbox)
  whatsappLinkStatus: () => ipcRenderer.invoke(IPC.WHATSAPP_LINK_STATUS),
  whatsappLinkStart: () => ipcRenderer.invoke(IPC.WHATSAPP_LINK_START),
  whatsappLinkStop: () => ipcRenderer.invoke(IPC.WHATSAPP_LINK_STOP),
  whatsappLinkUnpair: () => ipcRenderer.invoke(IPC.WHATSAPP_LINK_UNPAIR),

  // Custom slash commands (user-defined /commands from profile files)
  customCommandsList: () => ipcRenderer.invoke(IPC.COMMANDS_CUSTOM_LIST),
  customCommandSave: (args: { name: string; description?: string; template: string }) =>
    ipcRenderer.invoke(IPC.COMMANDS_CUSTOM_SAVE, args),

  // Notifications
  notificationShow: (args: { title: string; body: string; silent?: boolean }) =>
    ipcRenderer.invoke(IPC.NOTIFICATION_SHOW, args),
  notificationStatus: () => ipcRenderer.invoke(IPC.NOTIFICATION_STATUS),
  notificationClear: () => ipcRenderer.invoke(IPC.NOTIFICATION_CLEAR),
  notificationActiveCount: () => ipcRenderer.invoke(IPC.NOTIFICATION_ACTIVE_COUNT),

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
  // Computer control IS exposed below, on the `computer:*` channels registered by
  // ipc/computer-automation.ts (computerMoveMouse, computerClick, ...). Those are
  // live and used by the renderer.
  //
  // What was removed is the separate `COMPUTER_*` constant family — a second
  // implementation of the same capability, registered with no preload exposure
  // and no caller. It duplicated this one and could never run.
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

  // Studio — documents, spreadsheets, decks
  studioList: () => ipcRenderer.invoke(IPC.STUDIO_LIST),
  studioGet: (args: { id: string }) => ipcRenderer.invoke(IPC.STUDIO_GET, args),
  studioCreate: (args: { kind: 'document' | 'sheet' | 'slides'; title?: string }) =>
    ipcRenderer.invoke(IPC.STUDIO_CREATE, args),
  studioUpdate: (args: { id: string; patch: Record<string, unknown> }) =>
    ipcRenderer.invoke(IPC.STUDIO_UPDATE, args),
  studioDelete: (args: { id: string }) => ipcRenderer.invoke(IPC.STUDIO_DELETE, args),
  studioDuplicate: (args: { id: string }) => ipcRenderer.invoke(IPC.STUDIO_DUPLICATE, args),
  studioAi: (args: {
    action: string;
    kind: 'document' | 'sheet' | 'slides';
    prompt: string;
    context?: string;
    itemId?: string;
    language?: string;
  }) => ipcRenderer.invoke(IPC.STUDIO_AI, args),
  studioExport: (args: { id: string; format?: string }) => ipcRenderer.invoke(IPC.STUDIO_EXPORT, args),

  // Pages — Notion-style pages, blocks, databases, comments, versions
  pagesList: () => ipcRenderer.invoke(IPC.PAGES_LIST),
  pagesGet: (args: { id: string }) => ipcRenderer.invoke(IPC.PAGES_GET, args),
  pagesCreate: (args: PageCreateInput) => ipcRenderer.invoke(IPC.PAGES_CREATE, args),
  pagesUpdate: (args: { id: string; patch: PageUpdateInput }) => ipcRenderer.invoke(IPC.PAGES_UPDATE, args),
  pagesDuplicate: (args: { id: string }) => ipcRenderer.invoke(IPC.PAGES_DUPLICATE, args),
  pagesTrash: (args: { id: string }) => ipcRenderer.invoke(IPC.PAGES_TRASH, args),
  pagesRestore: (args: { id: string }) => ipcRenderer.invoke(IPC.PAGES_RESTORE, args),
  pagesDelete: (args: { id: string }) => ipcRenderer.invoke(IPC.PAGES_DELETE, args),
  pagesEmptyTrash: () => ipcRenderer.invoke(IPC.PAGES_EMPTY_TRASH),
  pagesSearch: (args: { query: string; limit?: number }) => ipcRenderer.invoke(IPC.PAGES_SEARCH, args),
  pagesBacklinks: (args: { id: string }) => ipcRenderer.invoke(IPC.PAGES_BACKLINKS, args),
  pagesCommentAdd: (args: { id: string; text: string; blockId?: string }) => ipcRenderer.invoke(IPC.PAGES_COMMENT_ADD, args),
  pagesCommentDelete: (args: { id: string; commentId: string }) => ipcRenderer.invoke(IPC.PAGES_COMMENT_DELETE, args),
  pagesCommentResolve: (args: { id: string; commentId: string; resolved: boolean }) => ipcRenderer.invoke(IPC.PAGES_COMMENT_RESOLVE, args),
  pagesVersionSave: (args: { id: string }) => ipcRenderer.invoke(IPC.PAGES_VERSION_SAVE, args),
  pagesVersionRestore: (args: { id: string; versionId: string }) => ipcRenderer.invoke(IPC.PAGES_VERSION_RESTORE, args),
  pagesRowCreate: (args: { databaseId: string; input?: PageDatabaseRowInput }) => ipcRenderer.invoke(IPC.PAGES_ROW_CREATE, args),
  pagesRowUpdate: (args: { databaseId: string; rowId: string; patch: PageDatabaseRowInput }) => ipcRenderer.invoke(IPC.PAGES_ROW_UPDATE, args),
  pagesRowDelete: (args: { databaseId: string; rowId: string }) => ipcRenderer.invoke(IPC.PAGES_ROW_DELETE, args),
  pagesRowDuplicate: (args: { databaseId: string; rowId: string }) => ipcRenderer.invoke(IPC.PAGES_ROW_DUPLICATE, args),
  pagesRowOpen: (args: { databaseId: string; rowId: string }) => ipcRenderer.invoke(IPC.PAGES_ROW_OPEN, args),
  pagesExport: (args: { id: string; format?: 'md' | 'csv' }) => ipcRenderer.invoke(IPC.PAGES_EXPORT, args),

  // Planner — tasks, events, reminders
  plannerGet: () => ipcRenderer.invoke(IPC.PLANNER_GET),
  plannerTaskCreate: (args: {
    title: string;
    notes?: string;
    due?: number;
    priority?: 'low' | 'medium' | 'high';
    tags?: string[];
    list?: string;
  }) => ipcRenderer.invoke(IPC.PLANNER_TASK_CREATE, args),
  plannerTaskUpdate: (args: { id: string; patch: Record<string, unknown> }) =>
    ipcRenderer.invoke(IPC.PLANNER_TASK_UPDATE, args),
  plannerTaskToggle: (args: { id: string }) => ipcRenderer.invoke(IPC.PLANNER_TASK_TOGGLE, args),
  plannerTaskDelete: (args: { id: string }) => ipcRenderer.invoke(IPC.PLANNER_TASK_DELETE, args),
  plannerEventCreate: (args: {
    title: string;
    start: number;
    end?: number;
    allDay?: boolean;
    location?: string;
    notes?: string;
    color?: string;
  }) => ipcRenderer.invoke(IPC.PLANNER_EVENT_CREATE, args),
  plannerEventUpdate: (args: { id: string; patch: Record<string, unknown> }) =>
    ipcRenderer.invoke(IPC.PLANNER_EVENT_UPDATE, args),
  plannerEventDelete: (args: { id: string }) => ipcRenderer.invoke(IPC.PLANNER_EVENT_DELETE, args),
  plannerReminderCreate: (args: { title: string; at: number; taskId?: string }) =>
    ipcRenderer.invoke(IPC.PLANNER_REMINDER_CREATE, args),
  plannerReminderUpdate: (args: { id: string; patch: Record<string, unknown> }) =>
    ipcRenderer.invoke(IPC.PLANNER_REMINDER_UPDATE, args),
  plannerReminderDelete: (args: { id: string }) => ipcRenderer.invoke(IPC.PLANNER_REMINDER_DELETE, args),
  plannerDue: () => ipcRenderer.invoke(IPC.PLANNER_DUE),
  plannerFired: (args: { id: string }) => ipcRenderer.invoke(IPC.PLANNER_FIRED, args),
  plannerStats: () => ipcRenderer.invoke(IPC.PLANNER_STATS),
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
