// IPC channel constants — shared by main (ipcMain.handle) and renderer (ipcRenderer.invoke)

/** ExitPlan approval waits this long for the user before auto-declining. */
export const PLAN_APPROVAL_TIMEOUT_MS = 10 * 60_000;
/** AskUserQuestion cards wait this long before auto-skipping (user may be away). */
export const QUESTION_TIMEOUT_MS = 30 * 60_000;

export const IPC = {
  // Chat
  CHAT_SEND: 'chat:send',
  CHAT_ABORT: 'chat:abort',
  CHAT_INTERJECT: 'chat:interject',
  CHAT_STREAM_EVENT: 'chat:stream-event', // main → renderer push

  // Plan mode (enforced read-only + ExitPlan approval gate)
  CHAT_PLAN_STATE: 'chat:plan-state', // main → renderer push: { sessionId, active, plan? }
  CHAT_PLAN_RESOLVE: 'chat:plan-resolve', // renderer → main: { sessionId, approved }

  // Blocking question cards (AskUserQuestion): the agent pauses until the user
  // answers. The request rides the chat event bus (CHAT_STREAM_EVENT with type
  // question_request); resolution comes back over this channel.
  CHAT_QUESTION_RESOLVE: 'chat:question-resolve', // renderer -> main: { id, answers, skipped }

  // Background tasks (detached chat runs with completion notifications)
  BACKGROUND_TASKS_LIST: 'chat:background-tasks',

  OPERATOR_BROWSER_SEARCH: 'operator:browser-search',
  OPERATOR_BROWSER_NAVIGATE: 'operator:browser-navigate',
  OPERATOR_BROWSER_SHUTDOWN: 'operator:browser-shutdown',

  // Sessions
  SESSION_LIST: 'session:list',
  SESSION_CREATE: 'session:create',
  SESSION_LOAD: 'session:load',
  SESSION_DELETE: 'session:delete',
  SESSION_CLEAR_ALL: 'session:clear-all',
  SESSION_RENAME: 'session:rename',
  SESSION_SEARCH: 'session:search',
  SESSION_PIN: 'session:pin',

  // ── Archive ──────────────────────────────────────────────────────────────
  SESSION_ARCHIVE_SET: 'session:archive:set',
  SESSION_ARCHIVE_LIST: 'session:archive:list',
  SESSION_ARCHIVE_SEARCH: 'session:archive:search',
  SESSION_EXPORT: 'session:export',
  SESSION_IMPORT: 'session:import',
  SESSION_SHARE: 'session:share',
  SESSION_BRANCH: 'session:branch',
  SESSION_UPDATE_MESSAGE: 'session:update-message',
  SESSION_APPEND: 'session:append',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_WATCH: 'settings:watch',

  // Providers
  PROVIDER_LIST: 'provider:list',
  PROVIDER_TEST: 'provider:test',
  PROVIDER_MODELS: 'provider:models',
  PROVIDER_SET_KEY: 'provider:set-key',
  PROVIDER_HAS_KEY: 'provider:has-key',
  OPENCODE_CLI_VERSION: 'opencode:cli-version',
  OPENCODE_CLI_UPGRADE: 'opencode:cli-upgrade',
  OPENCODE_SERVER_RESTART: 'opencode:server-restart',

  // Tools
  TOOLS_LIST: 'tools:list',
  TOOL_PERMISSIONS_GET: 'tools:permissions:get',
  TOOL_PERMISSIONS_SET: 'tools:permissions:set',

  // Action audit log (query the agent's black-box record)
  AUDIT_RECENT: 'audit:recent',
  AUDIT_QUERY: 'audit:query',
  AUDIT_DAY: 'audit:day',
  AUDIT_STATS: 'audit:stats',
  AUDIT_VERIFY: 'audit:verify',

  // Agents (multi-agent system)
  AGENT_LIST: 'agent:list',
  AGENT_RUNS: 'agent:runs',
  AGENT_SPAWN: 'agent:spawn',
  AGENT_ABORT: 'agent:abort',
  AGENT_EVENT: 'agent:event', // main → renderer push

  // Custom Agents
  CUSTOM_AGENT_CREATE: 'custom-agent:create',
  CUSTOM_AGENT_LIST: 'custom-agent:list',
  CUSTOM_AGENT_GET: 'custom-agent:get',
  CUSTOM_AGENT_UPDATE: 'custom-agent:update',
  CUSTOM_AGENT_DELETE: 'custom-agent:delete',

  // Memory
  MEMORY_CREATE: 'memory:create',
  MEMORY_LIST: 'memory:list',
  MEMORY_GET: 'memory:get',
  MEMORY_UPDATE: 'memory:update',
  MEMORY_DELETE: 'memory:delete',
  MEMORY_SEARCH: 'memory:search',
  MEMORY_STATS: 'memory:stats',

  // Evaluation (read-only history + catalog; runs happen in the CLI process so
  // approval bypass stays scoped to that process)
  EVALUATION_LIST: 'evaluation:list',
  EVALUATION_GET: 'evaluation:get',
  EVALUATION_CATALOG: 'evaluation:catalog',

  // Skills
  SKILLS_LIST: 'skills:list',
  SKILLS_GET: 'skills:get',
  SKILLS_CREATE: 'skills:create',
  SKILLS_UPDATE: 'skills:update',
  SKILLS_DELETE: 'skills:delete',
  SKILLS_TOGGLE: 'skills:toggle',
  SKILLS_SEARCH: 'skills:search',
  SKILLS_STATS: 'skills:stats',
  SKILLS_IMPORT_CLAUDE: 'skills:import-claude',
  SKILLS_RELEVANT: 'skills:relevant',
  SKILLS_EXPORT: 'skills:export',
  SKILLS_IMPORT: 'skills:import',

  // MCP
  MCP_LIST_SERVERS: 'mcp:list-servers',
  MCP_CONNECT: 'mcp:connect',
  MCP_DISCONNECT: 'mcp:disconnect',
  MCP_STATUS: 'mcp:status',
  MCP_LIST_TOOLS: 'mcp:list-tools',

  // Files
  FILE_READ: 'file:read',
  FILE_WRITE: 'file:write',
  FILE_OPEN: 'file:open',
  PICK_DIRECTORY: 'file:pick-directory',
  FILE_SYSTEM_ROOTS: 'file:system-roots',

  FILE_MKDIR: 'file:mkdir',
  FILE_DELETE: 'file:delete',
  FILE_RENAME: 'file:rename',
  FILE_COPY: 'file:copy',
  FILE_STAT: 'file:stat',

  TERMINAL_EXECUTE: 'terminal:execute',

  // Permissions
  PERMISSION_REQUEST: 'permission:request',
  PERMISSION_RESPONSE: 'permission:response',

  // App
  APP_VERSION: 'app:version',
  APP_OPEN_EXTERNAL: 'app:open-external',

  // System Metrics
  METRICS_GET: 'metrics:get',

  // Brain
  BRAIN_STATUS: 'brain:status',
  BRAIN_DECIDE: 'brain:decide',
  BRAIN_SAFETY_VALIDATE: 'brain:safety:validate',
  BRAIN_OFFLINE_STATUS: 'brain:offline:status',
  BRAIN_REASON: 'brain:reason',
  BRAIN_WORKFLOW_RUN: 'brain:workflow:run',
  BRAIN_WORKFLOW_STATUS: 'brain:workflow:status',
  BRAIN_MONITOR_METRICS: 'brain:monitor:metrics',
  BRAIN_MONITOR_ALERTS: 'brain:monitor:alerts',
  BRAIN_IMPROVE_STATS: 'brain:improve:stats',
  BRAIN_IMPROVE_RECORD: 'brain:improve:record',
  BRAIN_MARKETPLACE_LIST: 'brain:marketplace:list',
  BRAIN_MARKETPLACE_SEARCH: 'brain:marketplace:search',
  BRAIN_MARKETPLACE_INSTALL: 'brain:marketplace:install',
  BRAIN_SDK_INFO: 'brain:sdk:info',
  BRAIN_SDK_CREATE_TOOL: 'brain:sdk:create-tool',
  BRAIN_TEACH_START: 'brain:teach:start',
  BRAIN_TEACH_STOP: 'brain:teach:stop',
  BRAIN_TEACH_STATUS: 'brain:teach:status',
  BRAIN_TEACH_EVENT: 'brain:teach:event',
  BRAIN_LEARN_INTERACTION: 'brain:learn:interaction',
  BRAIN_LEARN_STATS: 'brain:learn:stats',

  // Browser Agent
  BROWSER_CREATE_SESSION: 'browser:create-session',
  BROWSER_NAVIGATE: 'browser:navigate',
  BROWSER_CLICK: 'browser:click',
  BROWSER_TYPE: 'browser:type',
  BROWSER_SCREENSHOT: 'browser:screenshot',
  BROWSER_EXTRACT: 'browser:extract',
  BROWSER_FILL_FORM: 'browser:fill-form',
  BROWSER_LIST_SESSIONS: 'browser:list-sessions',
  BROWSER_DELETE_SESSION: 'browser:delete-session',
  BROWSER_STATS: 'browser:stats',

  // The `COMPUTER_*` constants that used to live here are gone. They were a
  // second implementation of computer control, registered in main with no
  // preload exposure and no caller, so they could never run.
  //
  // Note that computer control is still exposed over IPC — just not here. The
  // live surface uses raw `computer:*` channels registered directly in
  // `ipc/computer-automation.ts` (computerMoveMouse, computerClick, and ~25
  // more), which the renderer uses. Any scan for dead handlers must therefore
  // match raw string channels too, not only `IPC.` constants.

  // Automation
  AUTOMATION_CREATE_WORKFLOW: 'automation:create-workflow',
  AUTOMATION_RUN_WORKFLOW: 'automation:run-workflow',
  AUTOMATION_RUN_EVENT: 'automation:run-event',
  AUTOMATION_LIST_WORKFLOWS: 'automation:list-workflows',
  AUTOMATION_GET_WORKFLOW: 'automation:get-workflow',
  AUTOMATION_ENABLE_WORKFLOW: 'automation:enable-workflow',
  AUTOMATION_DISABLE_WORKFLOW: 'automation:disable-workflow',
  AUTOMATION_DELETE_WORKFLOW: 'automation:delete-workflow',
  AUTOMATION_ADD_ACTION: 'automation:add-action',
  AUTOMATION_GET_TEMPLATES: 'automation:get-templates',
  AUTOMATION_GET_RUNS: 'automation:get-runs',
  AUTOMATION_LIST_RUNS: 'automation:list-runs',
  AUTOMATION_NEXT_RUNS: 'automation:next-runs',
  AUTOMATION_STATS: 'automation:stats',
  AUTOMATION_SCHEDULER_STATUS: 'automation:scheduler-status',
  AUTOMATION_SET_KEEP_AWAKE: 'automation:set-keep-awake',
  AUTOMATION_CANCEL_RUN: 'automation:cancel-run',
  AUTOMATION_CREATE_FROM_NL: 'automation:create-from-nl',
  AUTOMATION_APPROVE_ACTION: 'automation:approve-action',
  AUTOMATION_COMMENT_ACTION: 'automation:comment-action',
  AUTOMATION_GET_PENDING_APPROVALS: 'automation:get-pending-approvals',

  // Heartbeat (Hermes-inspired idle consolidation) runs in the background and is
  // not exposed over IPC: no renderer ever asked it for status, so the handler
  // was registered and unreachable.

  // Background build (app stays running while AI edits code)
  BUILD_START: 'build:start',
  BUILD_STATUS: 'build:status',
  BUILD_CANCEL: 'build:cancel',
  BUILD_HAS_UPDATE: 'build:has-update',
  BUILD_CLEAR_UPDATE: 'build:clear-update',

  // Phone remote (LAN companion)
  REMOTE_PHONE_INFO: 'remote:phone-info',

  // Website Builder
  WEBSITE_CREATE: 'website:create',
  WEBSITE_LIST: 'website:list',
  WEBSITE_GET: 'website:get',
  WEBSITE_ADD_PAGE: 'website:add-page',
  WEBSITE_ADD_COMPONENT: 'website:add-component',
  WEBSITE_GENERATE_CODE: 'website:generate-code',
  WEBSITE_PUBLISH: 'website:publish',
  WEBSITE_DEPLOY: 'website:deploy',
  WEBSITE_DELETE: 'website:delete',
  WEBSITE_TEMPLATES: 'website:templates',
  WEBSITE_STATS: 'website:stats',

  // App Builder
  APP_CREATE_PROJECT: 'app:create-project',
  APP_LIST_PROJECTS: 'app:list-projects',
  APP_GET_PROJECT: 'app:get-project',
  APP_ADD_FILE: 'app:add-file',
  APP_GENERATE_COMPONENT: 'app:generate-component',
  APP_GENERATE_PAGE: 'app:generate-page',
  APP_GENERATE_API: 'app:generate-api',
  APP_BUILD: 'app:build',
  APP_RENAME: 'app:rename',
  APP_MOVE: 'app:move',
  APP_RUN: 'app:run',
  APP_DELETE: 'app:delete',
  APP_TEMPLATES: 'app:templates',
  APP_STATS: 'app:stats',

  // Business Command Center
  BUSINESS_CREATE_CONTACT: 'business:create-contact',
  BUSINESS_UPDATE_CONTACT: 'business:update-contact',
  BUSINESS_DELETE_CONTACT: 'business:delete-contact',
  BUSINESS_LIST_CONTACTS: 'business:list-contacts',
  BUSINESS_CREATE_LEAD: 'business:create-lead',
  BUSINESS_UPDATE_LEAD_STATUS: 'business:update-lead-status',
  BUSINESS_LIST_LEADS: 'business:list-leads',
  BUSINESS_CREATE_INVOICE: 'business:create-invoice',
  BUSINESS_UPDATE_INVOICE_STATUS: 'business:update-invoice-status',
  BUSINESS_LIST_INVOICES: 'business:list-invoices',
  BUSINESS_CREATE_DEAL: 'business:create-deal',
  BUSINESS_UPDATE_DEAL_STAGE: 'business:update-deal-stage',
  BUSINESS_LIST_DEALS: 'business:list-deals',
  BUSINESS_ANALYTICS: 'business:analytics',
  BUSINESS_LIST_TASKS: 'business:tasks:list',
  BUSINESS_CREATE_TASK: 'business:tasks:create',
  BUSINESS_UPDATE_TASK: 'business:tasks:update',
  BUSINESS_DELETE_TASK: 'business:tasks:delete',
  BUSINESS_OVERVIEW: 'business:overview',
  BUSINESS_SEARCH: 'business:search',
  BUSINESS_ACTIVITIES: 'business:activities',
  BUSINESS_ADD_NOTE: 'business:note:add',
  BUSINESS_CONTACT_DETAIL: 'business:contact-detail',
  BUSINESS_ATTENTION: 'business:attention',
  BUSINESS_DELETE_LEAD: 'business:lead:delete',
  BUSINESS_DELETE_INVOICE: 'business:invoice:delete',
  BUSINESS_DELETE_DEAL: 'business:deal:delete',
  BUSINESS_LOG_SENT_EMAIL: 'business:email:log-sent',

  // ── Project board (the same store the `Project` tool writes to) ──────────
  PROJECTS_LIST: 'projects:list',
  PROJECTS_CREATE: 'projects:create',
  PROJECTS_UPDATE: 'projects:update',
  PROJECTS_DELETE: 'projects:delete',
  PROJECTS_WITH_FILES: 'projects:with-files',
  PROJECTS_BOARD: 'projects:board',
  PROJECTS_LIST_ALL: 'projects:tasks',
  PROJECTS_CREATE_TASK: 'projects:task:create',
  PROJECTS_UPDATE_TASK: 'projects:task:update',
  PROJECTS_DELETE_TASK: 'projects:task:delete',
  PROJECTS_ADD_CHECKLIST: 'projects:task:checklist:add',
  PROJECTS_TOGGLE_CHECKLIST: 'projects:task:checklist:toggle',
  PROJECTS_ADD_COMMENT: 'projects:task:comment:add',
  PROJECTS_ANALYTICS: 'projects:analytics',

  // ── Resume after a restart ───────────────────────────────────────────────
  /** Runs that a restart cut off, with what they had actually done. */
  RESUME_INTERRUPTED: 'resume:interrupted',
  BUSINESS_STATS: 'business:stats',
  BUSINESS_LIST_EMAILS: 'business:list-emails',
  BUSINESS_SAVE_EMAIL: 'business:save-email',
  BUSINESS_DELETE_EMAIL: 'business:delete-email',

  // Plugin Store
  PLUGIN_INSTALL: 'plugin:install',
  PLUGIN_UNINSTALL: 'plugin:uninstall',
  PLUGIN_ENABLE: 'plugin:enable',
  PLUGIN_DISABLE: 'plugin:disable',
  PLUGIN_UPDATE_CONFIG: 'plugin:update-config',
  PLUGIN_SEARCH: 'plugin:search',
  PLUGIN_LIST: 'plugin:list',
  PLUGIN_GET: 'plugin:get',
  PLUGIN_CATEGORIES: 'plugin:categories',
  PLUGIN_STATS: 'plugin:stats',

  // Cloud Sync
  CLOUD_REGISTER_DEVICE: 'cloud:register-device',
  CLOUD_SYNC_DATA: 'cloud:sync-data',
  CLOUD_CREATE_BACKUP: 'cloud:create-backup',
  CLOUD_RESTORE_BACKUP: 'cloud:restore-backup',
  CLOUD_LIST_DEVICES: 'cloud:list-devices',
  CLOUD_RECENT_RECORDS: 'cloud:recent-records',
  CLOUD_LIST_BACKUPS: 'cloud:list-backups',
  CLOUD_STATS: 'cloud:stats',

  // Multi-Agent
  MULTI_AGENT_CREATE_TEAM: 'multi-agent:create-team',
  MULTI_AGENT_UPDATE_TEAM: 'multi-agent:update-team',
  MULTI_AGENT_ADD_TO_TEAM: 'multi-agent:add-to-team',
  MULTI_AGENT_REMOVE_FROM_TEAM: 'multi-agent:remove-from-team',
  MULTI_AGENT_SET_ROLE: 'multi-agent:set-role',
  MULTI_AGENT_SET_LEADER: 'multi-agent:set-leader',
  MULTI_AGENT_LIST_TEAMS: 'multi-agent:list-teams',
  MULTI_AGENT_ORG: 'multi-agent:org',
  MULTI_AGENT_CREATE_TASK: 'multi-agent:create-task',
  MULTI_AGENT_ASSIGN_TASK: 'multi-agent:assign-task',
  MULTI_AGENT_START_TASK: 'multi-agent:start-task',
  MULTI_AGENT_COMPLETE_TASK: 'multi-agent:complete-task',
  MULTI_AGENT_LIST_TASKS: 'multi-agent:list-tasks',
  MULTI_AGENT_SEND_MESSAGE: 'multi-agent:send-message',
  MULTI_AGENT_GET_MESSAGES: 'multi-agent:get-messages',
  MULTI_AGENT_EXECUTE_TEAM_TASK: 'multi-agent:execute-team-task',
  MULTI_AGENT_RUN_ORG_MISSION: 'multi-agent:run-org-mission',
  MULTI_AGENT_STATS: 'multi-agent:stats',

  // Team Workspaces
  WORKSPACE_CREATE: 'workspace:create',
  WORKSPACE_LIST: 'workspace:list',
  WORKSPACE_GET: 'workspace:get',
  WORKSPACE_DELETE: 'workspace:delete',
  WORKSPACE_ADD_MEMBER: 'workspace:add-member',
  WORKSPACE_REMOVE_MEMBER: 'workspace:remove-member',
  WORKSPACE_UPDATE_MEMBER_ROLE: 'workspace:update-member-role',
  WORKSPACE_CREATE_PROJECT: 'workspace:create-project',
  WORKSPACE_DELETE_PROJECT: 'workspace:delete-project',
  WORKSPACE_ADD_RESOURCE: 'workspace:add-resource',
  WORKSPACE_REMOVE_RESOURCE: 'workspace:remove-resource',
  WORKSPACE_GET_ACTIVITY: 'workspace:get-activity',
  WORKSPACE_STATS: 'workspace:stats',

  // Orchestrator
  ORCHESTRATOR_START: 'orchestrator:start',
  ORCHESTRATOR_INTERJECT: 'orchestrator:interject',
  ORCHESTRATOR_STATUS: 'orchestrator:status',
  ORCHESTRATOR_EVENT: 'orchestrator:event', // main → renderer push

  // Crew (multi-agent, multi-model orchestration)
  CREW_START: 'crew:start',
  CREW_STATUS: 'crew:status',
  CREW_EVENT: 'crew:event', // main → renderer push

  // Session Board (kanban management of parallel agent sessions)
  SESSION_BOARD_CREATE: 'session-board:create',
  SESSION_BOARD_START: 'session-board:start',
  SESSION_BOARD_CANCEL: 'session-board:cancel',
  SESSION_BOARD_INTERJECT: 'session-board:interject',
  SESSION_BOARD_LIST: 'session-board:list',
  SESSION_BOARD_GET: 'session-board:get',
  SESSION_BOARD_EVENT: 'session-board:event', // main → renderer push

  // Free Model Selector
  MODEL_SELECT: 'model:select',
  MODEL_FREE_LIST: 'model:free-list',

  // Voice Assistant
  VOICE_CONFIG_GET: 'voice:config:get',
  VOICE_CONFIG_SET: 'voice:config:set',
  VOICE_START_LISTENING: 'voice:start-listening',
  VOICE_STOP_LISTENING: 'voice:stop-listening',
  VOICE_TRANSCRIPT_EVENT: 'voice:transcript-event',
  VOICE_PROCESS_TRANSCRIPT: 'voice:process-transcript',
  VOICE_SET_WAKE_WORD: 'voice:set-wake-word',
  VOICE_ADD_CUSTOM_COMMAND: 'voice:add-custom-command',
  VOICE_REMOVE_CUSTOM_COMMAND: 'voice:remove-custom-command',
  VOICE_CUSTOM_COMMANDS: 'voice:custom-commands',
  VOICE_HISTORY: 'voice:history',
  VOICE_CLEAR_HISTORY: 'voice:clear-history',
  VOICE_SPEAK: 'voice:speak',
  VOICE_STATUS: 'voice:status',
  /** Loopback static server for the workspace, so the tab browser can load a
   *  file the agent produced without opening an external browser window. */
  WORKSPACE_SERVE: 'workspace:serve',
  WORKSPACE_URL_FOR: 'workspace:url-for',

  /** In-app browser for the Tabs section (WebContentsView, main-owned). */
  TAB_BROWSER_CREATE: 'tab-browser:create',
  TAB_BROWSER_BOUNDS: 'tab-browser:bounds',
  TAB_BROWSER_NAVIGATE: 'tab-browser:navigate',
  TAB_BROWSER_BACK: 'tab-browser:back',
  TAB_BROWSER_FORWARD: 'tab-browser:forward',
  TAB_BROWSER_RELOAD: 'tab-browser:reload',
  TAB_BROWSER_STATE: 'tab-browser:state',
  TAB_BROWSER_CLOSE: 'tab-browser:close',
  TAB_BROWSER_EVENT: 'tab-browser:event',

  /** Real tab channel. Tabs previously had none — they were created by the
   *  renderer sniffing a JSON string out of a tool result. */
  TAB_CREATE: 'tab:create',
  TAB_UPDATE: 'tab:update',
  /** Renderer mirrors its tabs into main so the agent can list them and read
   *  their real address, which it could not do while they lived only in
   *  renderer localStorage. */
  TAB_INDEX_REPLACE: 'tab:index:replace',
  TAB_INDEX_UPSERT: 'tab:index:upsert',
  TAB_INDEX_REMOVE: 'tab:index:remove',
  /** Always-on voice: the loop lives in main, so it survives view changes. */
  VOICE_SESSION_STATE: 'voice:session:state',
  VOICE_SESSION_SET_ENABLED: 'voice:session:set-enabled',
  VOICE_SESSION_PAUSE: 'voice:session:pause',
  VOICE_SESSION_RESUME: 'voice:session:resume',
  VOICE_SESSION_INTERRUPT: 'voice:session:interrupt',
  VOICE_SESSION_SAY: 'voice:session:say',
  VOICE_SESSION_EVENT: 'voice:session:event',

  // Video Clipping
  VIDEO_CREATE_PROJECT: 'video:create-project',
  VIDEO_LIST_PROJECTS: 'video:list-projects',
  VIDEO_GET_PROJECT: 'video:get-project',
  VIDEO_DELETE_PROJECT: 'video:delete-project',
  VIDEO_ANALYZE: 'video:analyze',
  VIDEO_EXTRACT_CLIP: 'video:extract-clip',
  VIDEO_FIND_HIGHLIGHTS: 'video:find-highlights',
  VIDEO_ADD_TRANSCRIPT: 'video:add-transcript',
  VIDEO_SPLIT_BY_CHAPTERS: 'video:split-by-chapters',
  VIDEO_ADD_HIGHLIGHT: 'video:add-highlight',

  // Deployment
  DEPLOY_CREATE_TARGET: 'deploy:create-target',
  DEPLOY_LIST_TARGETS: 'deploy:list-targets',
  DEPLOY_GET_TARGET: 'deploy:get-target',
  DEPLOY_DELETE_TARGET: 'deploy:delete-target',
  DEPLOY_CREATE_PIPELINE: 'deploy:create-pipeline',
  DEPLOY_RUN_PIPELINE: 'deploy:run-pipeline',
  DEPLOY_CANCEL_PIPELINE: 'deploy:cancel-pipeline',
  DEPLOY_GET_PIPELINE: 'deploy:get-pipeline',
  DEPLOY_LIST_PIPELINES: 'deploy:list-pipelines',
  DEPLOY_DETECT_PROJECT: 'deploy:detect-project',
  DEPLOY_DEFAULT_CONFIG: 'deploy:default-config',
  DEPLOY_QUICK_PUSH: 'deploy:quick-push',
  DEPLOY_OS_STATUS: 'deploy:os-status',
  DEPLOY_OS_PUSH: 'deploy:os-push',


  // Enterprise
  ENTERPRISE_ADD_MEMBER: 'enterprise:add-member',
  ENTERPRISE_LIST_MEMBERS: 'enterprise:list-members',
  ENTERPRISE_GET_MEMBER: 'enterprise:get-member',
  ENTERPRISE_UPDATE_ROLE: 'enterprise:update-role',
  ENTERPRISE_REMOVE_MEMBER: 'enterprise:remove-member',
  ENTERPRISE_CREATE_PROJECT: 'enterprise:create-project',
  ENTERPRISE_LIST_PROJECTS: 'enterprise:list-projects',
  ENTERPRISE_ADD_MEMBER_TO_PROJECT: 'enterprise:add-to-project',
  ENTERPRISE_REMOVE_MEMBER_FROM_PROJECT: 'enterprise:remove-from-project',
  ENTERPRISE_AUDIT_LOG: 'enterprise:audit-log',
  ENTERPRISE_ADD_COMPLIANCE_RULE: 'enterprise:add-compliance-rule',
  ENTERPRISE_COMPLIANCE_RULES: 'enterprise:compliance-rules',
  ENTERPRISE_COMPLIANCE_STATUS: 'enterprise:compliance-status',
  ENTERPRISE_EXPORT_AUDIT: 'enterprise:export-audit',
  ENTERPRISE_COMPANY_GET: 'enterprise:company-get',
  ENTERPRISE_COMPANY_UPDATE: 'enterprise:company-update',
  ENTERPRISE_COMPANY_ADD_NOTE: 'enterprise:company-add-note',
  ENTERPRISE_COMPANY_DELETE_NOTE: 'enterprise:company-delete-note',
  KB_LIST: 'kb:list',
  KB_GET: 'kb:get',
  KB_SAVE: 'kb:save',
  KB_DELETE: 'kb:delete',
  KB_ATTACH: 'kb:attach',
  PICK_FILE: 'file:pick-file',

  // Call Center
  CALL_CREATE: 'call:create',
  CALL_ANSWER: 'call:answer',
  CALL_HOLD: 'call:hold',
  CALL_RESUME: 'call:resume',
  CALL_END: 'call:end',
  CALL_MISS: 'call:miss',
  CALL_GET: 'call:get',
  CALL_LIST: 'call:list',
  CALL_QUEUE_CREATE: 'call:queue:create',
  CALL_QUEUE_LIST: 'call:queue:list',
  CALL_QUEUE_ADD: 'call:queue:add',
  CALL_QUEUE_REMOVE: 'call:queue:remove',
  CALL_AGENT_CREATE: 'call:agent:create',
  CALL_AGENT_LIST: 'call:agent:list',
  CALL_AGENT_STATUS: 'call:agent:status',
  CALL_ASSIGN: 'call:assign',
  CALL_TEMPLATE_CREATE: 'call:template:create',
  CALL_TEMPLATE_LIST: 'call:template:list',
  CALL_ANALYTICS: 'call:analytics',

  // YouTube Learning
  YT_ANALYZE: 'yt:analyze',
  YT_LEARN: 'yt:learn',
  YT_LIST_TASKS: 'yt:list-tasks',
  YT_GET_TASK: 'yt:get-task',
  YT_DELETE_TASK: 'yt:delete-task',
  YT_LIST_ANALYSES: 'yt:list-analyses',
  YT_CREATE_TEMPLATE: 'yt:create-template',
  YT_LIST_TEMPLATES: 'yt:list-templates',
  YT_LEARN_DAILY: 'yt:learn-daily',

  // Activity Tracker
  TRACKER_START: 'tracker:start',
  TRACKER_STOP: 'tracker:stop',
  TRACKER_STATUS: 'tracker:status',
  TRACKER_RECORD: 'tracker:record',
  TRACKER_RECENT: 'tracker:recent',
  TRACKER_ANALYZE_DAY: 'tracker:analyze-day',
  TRACKER_PATTERNS: 'tracker:patterns',

  // Email
  EMAIL_LIST: 'email:list',
  EMAIL_READ: 'email:read',
  EMAIL_SEND: 'email:send',
  EMAIL_TEST: 'email:test',
  EMAIL_CONFIG_GET: 'email:config:get',
  EMAIL_CONFIG_SAVE: 'email:config:save',
  EMAIL_HAS_CONFIG: 'email:has-config',

  // Auth (file-based)
  AUTH_GET_USERS: 'auth:get-users',
  AUTH_SET_USERS: 'auth:set-users',
  AUTH_GET_SESSION: 'auth:get-session',
  AUTH_SET_SESSION: 'auth:set-session',
  AUTH_LIST_PROFILES: 'auth:list-profiles',

  // Owner System (owner of Infinite OS)
  OWNER_GET_PROFILE: 'owner:get-profile',
  OWNER_GET_PUBLIC_INFO: 'owner:get-public-info',
  OWNER_UPDATE_PROFILE: 'owner:update-profile',
  OWNER_LIST_DOCUMENTS: 'owner:list-documents',
  OWNER_GET_DOCUMENT: 'owner:get-document',
  OWNER_UPSERT_DOCUMENT: 'owner:upsert-document',
  OWNER_DELETE_DOCUMENT: 'owner:delete-document',
  OWNER_LIST_CAPABILITIES: 'owner:list-capabilities',
  OWNER_TOGGLE_CAPABILITY: 'owner:toggle-capability',
  OWNER_GET_AUDIT: 'owner:get-audit',

  // Task Replay
  REPLAY_EXECUTE: 'replay:execute',
  REPLAY_EXECUTE_TASK: 'replay:execute-task',
  REPLAY_EXECUTE_NL: 'replay:execute-nl',
  REPLAY_CANCEL: 'replay:cancel',
  REPLAY_PAUSE: 'replay:pause',
  REPLAY_RESUME: 'replay:resume',
  REPLAY_LIST: 'replay:list',
  REPLAY_GET: 'replay:get',
  REPLAY_BROWSER_TASK: 'replay:browser-task',
  REPLAY_COMPUTER_TASK: 'replay:computer-task',
  REPLAY_COMMAND: 'replay:command',

  // Ollama (local AI brain)
  OLLAMA_CHAT: 'ollama:chat',
  OLLAMA_ASK: 'ollama:ask',
  OLLAMA_ANALYZE_IMAGE: 'ollama:analyze-image',
  OLLAMA_TEACH: 'ollama:teach',
  OLLAMA_STATUS: 'ollama:status',
  OLLAMA_RECORD_API: 'ollama:record-api',
  OLLAMA_RECORD_CONVERSATION: 'ollama:record-conversation',
  OLLAMA_SYSTEM_PROMPT: 'ollama:system-prompt',
  /** What the machine can actually run, and the budget that follows from it. */
  OLLAMA_CAPABILITY: 'ollama:capability',
  /** Installed local models, cached server-side so this does not refetch. */
  OLLAMA_MODELS_LOCAL: 'ollama:models-local',
  /** What Ollama currently holds in RAM — the honest answer to "why is it slow?". */
  OLLAMA_LOADED: 'ollama:loaded',
  /** Load a model now so the next chat skips the cold load. */
  OLLAMA_PRELOAD: 'ollama:preload',
  /** Free a model's RAM immediately. */
  OLLAMA_UNLOAD: 'ollama:unload',
  /** Reachability check that never blocks and never launches anything. */
  OLLAMA_HEALTH: 'ollama:health',

  // ── Boot optimization ────────────────────────────────────────────────────
  /** What is making this PC slow, and what is safe to do about it. */
  OPTIMIZE_ANALYSE: 'optimize:analyse',
  /** Apply exactly one finding. Refused for report-only findings. */
  OPTIMIZE_APPLY: 'optimize:apply',
  OPTIMIZE_UNDO_LIST: 'optimize:undo:list',
  OPTIMIZE_UNDO: 'optimize:undo',
  OPTIMIZE_UNDO_ALL: 'optimize:undo:all',
  OPTIMIZE_DISMISS: 'optimize:dismiss',
  OPTIMIZE_SEEN: 'optimize:seen',
  OPTIMIZE_AUTO_ENABLED: 'optimize:auto-enabled',

  // System
  SYSTEM_OPEN_URL: 'system:open-url',

  // Clipboard
  CLIPBOARD_READ: 'clipboard:read',
  CLIPBOARD_WRITE: 'clipboard:write',

  // Messaging (unified Slack / Discord / Telegram / WhatsApp + Telegram inbound)
  MESSAGING_STATUS: 'messaging:status',
  MESSAGING_SEND: 'messaging:send',
  MESSAGING_INBOUND_GET: 'messaging:inbound:get',
  MESSAGING_INBOUND_SET: 'messaging:inbound:set',
  WHATSAPP_LINK_STATUS: 'whatsapp:link:status',
  WHATSAPP_LINK_START: 'whatsapp:link:start',
  WHATSAPP_LINK_STOP: 'whatsapp:link:stop',
  WHATSAPP_LINK_UNPAIR: 'whatsapp:link:unpair',

  // Custom slash commands (user-defined /commands from files)
  COMMANDS_CUSTOM_LIST: 'commands:custom:list',
  COMMANDS_CUSTOM_SAVE: 'commands:custom:save',

  // Notification
  NOTIFICATION_SHOW: 'notification:show',
  NOTIFICATION_STATUS: 'notification:status',
  NOTIFICATION_CLEAR: 'notification:clear',
  NOTIFICATION_ACTIVE_COUNT: 'notification:active-count',

  // Interactive Terminal (PTY-based)
  TERMINAL_CREATE_SESSION: 'terminal:create-session',
  TERMINAL_WRITE: 'terminal:write',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_CLOSE_SESSION: 'terminal:close-session',
  TERMINAL_LIST_SESSIONS: 'terminal:list-sessions',
  TERMINAL_GET_SESSION: 'terminal:get-session',
  TERMINAL_SUBSCRIBE: 'terminal:subscribe',
  TERMINAL_UNSUBSCRIBE: 'terminal:unsubscribe',
  TERMINAL_CLOSE_ALL: 'terminal:close-all',
  TERMINAL_DATA: 'terminal:data', // main → renderer push
  TERMINAL_EXIT: 'terminal:exit', // main → renderer push
  TERMINAL_SESSION_CREATED: 'terminal:session-created', // main → renderer push

  // Checkpoint System
  CHECKPOINT_CREATE: 'checkpoint:create',
  CHECKPOINT_LIST: 'checkpoint:list',
  CHECKPOINT_RESTORE: 'checkpoint:restore',
  CHECKPOINT_DELETE: 'checkpoint:delete',
  CHECKPOINT_DIFF: 'checkpoint:diff',
  CHECKPOINT_GET: 'checkpoint:get',

  // Task Queue
  QUEUE_CREATE: 'queue:create',
  QUEUE_LIST: 'queue:list',
  QUEUE_GET: 'queue:get',
  QUEUE_DELETE: 'queue:delete',
  QUEUE_ENQUEUE: 'queue:enqueue',
  QUEUE_DEQUEUE: 'queue:dequeue',
  QUEUE_PEEK: 'queue:peek',
  QUEUE_STATUS: 'queue:status',
  QUEUE_STATS: 'queue:stats',

  // Workspace Indexing
  INDEX_BUILD: 'index:build',
  INDEX_SEARCH: 'index:search',
  INDEX_STATUS: 'index:status',
  INDEX_CLEAR: 'index:clear',
  INDEX_FILE_ADD: 'index:file:add',
  INDEX_FILE_REMOVE: 'index:file:remove',
  INDEX_REBUILD: 'index:rebuild',

  // Engine
  ENGINE_STATUS: 'engine:status',
  ENGINE_BOOTSTRAP: 'engine:bootstrap',

  // Code Completion
  COMPLETION_REQUEST: 'completion:request',
  COMPLETION_CANCEL: 'completion:cancel',
  COMPLETION_LIST: 'completion:list',

  // Debug
  DEBUG_START: 'debug:start',
  DEBUG_STOP: 'debug:stop',
  DEBUG_STATUS: 'debug:status',
  DEBUG_BREAKPOINTS_SET: 'debug:breakpoints:set',
  DEBUG_BREAKPOINTS_LIST: 'debug:breakpoints:list',
  DEBUG_EVALUATE: 'debug:evaluate',
  DEBUG_STEP: 'debug:step',
  DEBUG_CONTINUE: 'debug:continue',
  DEBUG_PAUSE: 'debug:pause',

  // Git (additional channels beyond tool interface)
  GIT_STATUS: 'git:status',
  GIT_LOG: 'git:log',
  GIT_COMMIT: 'git:commit',
  GIT_BRANCH: 'git:branch',
  GIT_PUSH: 'git:push',
  GIT_PULL: 'git:pull',
  GIT_DIFF: 'git:diff',
  GIT_CLONE: 'git:clone',
  GIT_INIT: 'git:init',
  GIT_FETCH: 'git:fetch',
  GIT_MERGE: 'git:merge',
  GIT_REBASE: 'git:rebase',
  GIT_STASH: 'git:stash',
  GIT_REMOTE: 'git:remote',

  // Window controls
  WINDOW_SET_FULLSCREEN: 'window:setFullScreen',
  WINDOW_SET_ALWAYS_ON_TOP: 'window:setAlwaysOnTop',
  WINDOW_IS_ALWAYS_ON_TOP: 'window:isAlwaysOnTop',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_RESTORE: 'window:restore',
  WINDOW_CLOSE: 'window:close',
  WINDOW_TOGGLE_FULLSCREEN: 'window:toggle-fullscreen',
  WINDOW_ENTER_FULLSCREEN: 'window:enter-fullscreen',
  WINDOW_EXIT_FULLSCREEN: 'window:exit-fullscreen',
  WINDOW_IS_FULLSCREEN: 'window:is-fullscreen',
  WINDOW_UNMAXIMIZE: 'window:unmaximize',
  WINDOW_IS_MAXIMIZED: 'window:is-maximized',
  WINDOW_FULLSCREEN_CHANGED: 'window:fullscreen-changed', // main → renderer push

  // Mini Mode (desktop floating chat bar)
  MINI_TOGGLE: 'mini:toggle',
  MINI_SEND: 'mini:send',
  MINI_ABORT: 'mini:abort',
  MINI_STATE: 'mini:state', // main → mini push
  MINI_STREAM_EVENT: 'mini:stream', // main → mini push
  MINI_RESTORE: 'mini:restore', // mini → main: restore main window

  // Quick Capture — appends a timestamped entry to ~/Documents/Infinite OS/Quick Notes/<date>.md
  QUICK_CAPTURE_APPEND: 'quick-capture:append',
  QUICK_CAPTURE_OPEN: 'quick-capture:open',
  QUICK_CAPTURE_LATEST: 'quick-capture:latest',

  // Browser Bridge (Infinite OS Bridge browser extension)
  BRIDGE_STATUS: 'bridge:status',
  BRIDGE_EXEC: 'bridge:exec',
  BRIDGE_SETUP_STATUS: 'bridge:setup-status',
  BRIDGE_SETUP_LAUNCH: 'bridge:setup-launch',
  BRIDGE_SETUP_RESTART: 'bridge:setup-restart',
  BRIDGE_SETUP_INSTALL: 'bridge:setup-install',
  BRIDGE_SETUP_OPEN_FOLDER: 'bridge:setup-open-folder',
  BRIDGE_SETUP_COPY_PATH: 'bridge:setup-copy-path',

  // ============ OpenClaw Gateway/Node ============
  NODE_PAIRING_REQUEST: 'node:pairing-request',
  NODE_PAIRING_RESPONSE: 'node:pairing-response',
  NODE_LIST: 'node:list',
  NODE_INVOKE: 'node:invoke',
  NODE_INVOKE_PROGRESS: 'node:invoke-progress',
  NODE_INVOKE_RESULT: 'node:invoke-result',
  NODE_DISCONNECT: 'node:disconnect',
  NODE_APPROVAL_REQUEST: 'node:approval-request',
  NODE_APPROVAL_RESPONSE: 'node:approval-response',
  NODE_EXEC_ALLOWLIST: 'node:exec-allowlist',
  NODE_MCP_SERVER: 'node:mcp-server',
  NODE_SKILL: 'node:skill',
  NODE_SESSION: 'node:session',

  // Media
  MEDIA_UNDERSTAND: 'media:understand',
  MEDIA_LIMITS_GET: 'media:limits:get',
  MEDIA_LIMITS_SET: 'media:limits:set',

  // Session routing
  SESSION_ROUTING_CONFIG_GET: 'session:routing-config:get',
  SESSION_ROUTING_CONFIG_SET: 'session:routing-config:set',

  // Streaming
  STREAMING_CONFIG_GET: 'streaming:config:get',
  STREAMING_CONFIG_SET: 'streaming:config:set',

  // Queue
  QUEUE_CONFIG_GET: 'queue:config:get',
  QUEUE_CONFIG_SET: 'queue:config:set',
  QUEUE_OPTIONS_SET: 'queue:options:set',

  // Steering
  STEER_PAYLOAD: 'steer:payload',

  // Experimental
  EXPERIMENTAL_GET: 'experimental:get',
  /** Token and cost totals for the user's conversations. */
  USAGE_GET: 'usage:get',
  USAGE_RESET: 'usage:reset',
  /** Push: background-build progress. Separate from the request channels so
   *  its payload shape cannot collide with the invoke responses. */
  BUILD_STATUS_CHANGED: 'build:status-changed',
  EXPERIMENTAL_SET: 'experimental:set',

  // ============ OpenClaw Gateway/Node (continued) ============
  // Node commands
  NODE_COMMAND_EXECUTE: 'node:command:execute',
  NODE_COMMAND_APPROVE: 'node:command:approve',
  NODE_COMMAND_DENY: 'node:command:deny',

  // Media attachments
  MEDIA_ATTACHMENT_ADD: 'media:attachment:add',
  MEDIA_ATTACHMENT_REMOVE: 'media:attachment:remove',

  // Session management
  SESSION_RESET: 'session:reset',
  SESSION_INCOGNITO: 'session:incognito',
  SESSION_DM_SCOPE: 'session:dm-scope',
  SESSION_GROUP_SCOPE: 'session:group-scope',

  // Queue modes
  QUEUE_MODE_SET: 'queue:mode:set',

  // Experimental features
  EXPERIMENTAL_LOCAL_MODEL_LEAN: 'experimental:local-model-lean',
  EXPERIMENTAL_CODE_MODE: 'experimental:code-mode',
  EXPERIMENTAL_CLOUD_WORKERS_DESKTOP: 'experimental:cloud-workers-desktop',
  EXPERIMENTAL_SWARM: 'experimental:swarm',

  // Self-Evolution Engine
  SELF_EVOLVE_ANALYZE: 'self-evolve:analyze',
  SELF_EVOLVE_SUGGESTIONS: 'self-evolve:suggestions',
  SELF_EVOLVE_ACCEPT: 'self-evolve:accept',
  SELF_EVOLVE_DISMISS: 'self-evolve:dismiss',
  SELF_EVOLVE_STATUS: 'self-evolve:status',
  SELF_EVOLVE_PROMPT: 'self-evolve:prompt',
  SELF_EVOLVE_EVOLVE: 'self-evolve:evolve',

  // Continuous self-evolution loop (Settings → Self-Evolve toggle)
  EVOLVE_LOOP_START: 'evolve-loop:start',
  EVOLVE_LOOP_STOP: 'evolve-loop:stop',
  EVOLVE_LOOP_STATUS: 'evolve-loop:status',
  EVOLVE_LOOP_RUN_NOW: 'evolve-loop:run-now',

  // Self-apply: typecheck + rebuild + relaunch to load self-edits (packaged builds)
  SELF_APPLY_RUN: 'self-apply:run',
  SELF_APPLY_STATUS: 'self-apply:status',
  SELF_APPLY_EVENT: 'self-apply:event', // main → renderer push

  // Workers (Warmwind-style autonomous tasks with step lists)
  WORKERS_LIST: 'workers:list',
  WORKERS_GET: 'workers:get',
  WORKERS_CREATE: 'workers:create',
  WORKERS_UPDATE: 'workers:update',
  WORKERS_DELETE: 'workers:delete',
  WORKERS_RUN: 'workers:run',
  WORKERS_PAUSE: 'workers:pause',
  WORKERS_RESUME: 'workers:resume',
  WORKERS_CANCEL: 'workers:cancel',
  WORKERS_INTERJECT: 'workers:interject',
  WORKERS_HISTORY: 'workers:history',
  WORKERS_OPEN_FOLDER: 'workers:open-folder',
  WORKERS_EVENT: 'workers:event', // main → renderer push
  WORKERS_BACKGROUND_GET: 'workers:background:get',
  WORKERS_BACKGROUND_SET: 'workers:background:set',

  // Teaching mode (record a demo → compile → editable steps → Worker)
  TEACH_START: 'teach:start',
  TEACH_STOP: 'teach:stop',
  TEACH_NARRATE: 'teach:narrate',
  TEACH_RENAME: 'teach:rename',
  TEACH_LIST: 'teach:list',
  TEACH_GET: 'teach:get',
  TEACH_DELETE: 'teach:delete',
  TEACH_COMPILE: 'teach:compile',
  TEACH_FRAME: 'teach:frame',
  TEACH_UPDATE_STEPS: 'teach:update-steps',
  TEACH_CREATE_WORKER: 'teach:create-worker',
  TEACH_EVENT: 'teach:event', // main → renderer push

  // App catalog (winget) + Worker credential vault
  APPS_LIST: 'apps:list',
  APPS_INSTALL: 'apps:install',
  APPS_LAUNCH: 'apps:launch',
  VAULT_LIST: 'vault:list',
  VAULT_ADD: 'vault:add',
  VAULT_AUTHORIZE: 'vault:authorize',
  VAULT_DELETE: 'vault:delete',

  // Studio — documents, spreadsheets, decks, and their AI writing actions
  STUDIO_LIST: 'studio:list',
  STUDIO_GET: 'studio:get',
  STUDIO_CREATE: 'studio:create',
  STUDIO_UPDATE: 'studio:update',
  STUDIO_DELETE: 'studio:delete',
  STUDIO_DUPLICATE: 'studio:duplicate',
  STUDIO_AI: 'studio:ai',
  STUDIO_EXPORT: 'studio:export',

  // Pages — Notion-style pages, blocks, databases, comments, versions
  PAGES_LIST: 'pages:list',
  PAGES_GET: 'pages:get',
  PAGES_CREATE: 'pages:create',
  PAGES_UPDATE: 'pages:update',
  PAGES_DUPLICATE: 'pages:duplicate',
  PAGES_TRASH: 'pages:trash',
  PAGES_RESTORE: 'pages:restore',
  PAGES_DELETE: 'pages:delete',
  PAGES_EMPTY_TRASH: 'pages:empty-trash',
  PAGES_SEARCH: 'pages:search',
  PAGES_BACKLINKS: 'pages:backlinks',
  PAGES_COMMENT_ADD: 'pages:comment:add',
  PAGES_COMMENT_DELETE: 'pages:comment:delete',
  PAGES_COMMENT_RESOLVE: 'pages:comment:resolve',
  PAGES_VERSION_SAVE: 'pages:version:save',
  PAGES_VERSION_RESTORE: 'pages:version:restore',
  PAGES_ROW_CREATE: 'pages:row:create',
  PAGES_ROW_UPDATE: 'pages:row:update',
  PAGES_ROW_DELETE: 'pages:row:delete',
  PAGES_ROW_DUPLICATE: 'pages:row:duplicate',
  PAGES_ROW_OPEN: 'pages:row:open',
  PAGES_EXPORT: 'pages:export',

  // Planner — personal tasks, calendar events, reminders
  PLANNER_GET: 'planner:get',
  PLANNER_TASK_CREATE: 'planner:task:create',
  PLANNER_TASK_UPDATE: 'planner:task:update',
  PLANNER_TASK_TOGGLE: 'planner:task:toggle',
  PLANNER_TASK_DELETE: 'planner:task:delete',
  PLANNER_EVENT_CREATE: 'planner:event:create',
  PLANNER_EVENT_UPDATE: 'planner:event:update',
  PLANNER_EVENT_DELETE: 'planner:event:delete',
  PLANNER_REMINDER_CREATE: 'planner:reminder:create',
  PLANNER_REMINDER_UPDATE: 'planner:reminder:update',
  PLANNER_REMINDER_DELETE: 'planner:reminder:delete',
  PLANNER_DUE: 'planner:due',
  PLANNER_FIRED: 'planner:fired',
  PLANNER_STATS: 'planner:stats',
} as const;
