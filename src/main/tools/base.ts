// Tool interface — every tool (built-in or MCP) implements this.

import type { ContentBlock } from '../../shared/types.js';

export interface ToolContext {
  cwd: string;
  abortSignal: AbortSignal;
  sessionId: string;
  onUpdate: (partial: ToolResult) => void;
}

export interface ToolResult {
  content: string | ContentBlock[];
  is_error?: boolean;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  permission: 'none' | 'ask' | 'allow' | 'deny';

  execute(args: unknown, ctx: ToolContext): Promise<ToolResult>;
}

/** Lowercases a tool name and strips every non-alphanumeric character. */
export function normalizeToolName(name: string): string {
  return name.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let previous = new Uint16Array(n + 1);
  let current = new Uint16Array(n + 1);
  for (let j = 0; j <= n; j++) previous[j] = j;
  for (let i = 1; i <= m; i++) {
    current[0] = i;
    for (let j = 1; j <= n; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1),
      );
    }
    const swap = previous;
    previous = current;
    current = swap;
  }
  return previous[n];
}

/**
 * Maps tool-name variants that models commonly emit to the canonical
 * registered names (e.g. `bash` -> `Bash`, `read_file` -> `Read`,
 * `web_search` -> `WebSearch`). Keys are normalized (lowercase,
 * alphanumerics only) — lookup normalizes the same way.
 */
const TOOL_NAME_ALIASES: Record<string, string> = {
  // Files
  readfile: 'Read', read_file: 'Read', openfile: 'Read', open_file: 'Read', cat: 'Read',
  writefile: 'Write', write_file: 'Write', createfile: 'Write', create_file: 'Write', newfile: 'Write', new_file: 'Write', mkdir: 'Write',
  editfile: 'Edit', edit_file: 'Edit', applypatch: 'Edit', apply_patch: 'Edit', modifyfile: 'Edit', modify_file: 'Edit',
  deletefile: 'Delete', delete_file: 'Delete', removefile: 'Delete', remove_file: 'Delete', remove: 'Delete', rm: 'Delete',
  listfiles: 'Glob', list_files: 'Glob', listdir: 'Glob', ls: 'Glob', listdirectory: 'Glob', list_directory: 'Glob', globsearch: 'Glob', glob_search: 'Glob',
  search: 'Grep', searchfiles: 'Grep', search_files: 'Grep', grepesearch: 'Grep', grep_search: 'Grep', regexsearch: 'Grep', regex_search: 'Grep', ripgrep: 'Grep',
  fileops: 'FileOps', file_ops: 'FileOps', movefile: 'FileOps', move_file: 'FileOps', copyfile: 'FileOps', copy_file: 'FileOps', renamefile: 'FileOps', rename_file: 'FileOps',
  // Web
  websearch: 'WebSearch', web_search: 'WebSearch', searchweb: 'WebSearch', search_web: 'WebSearch', googlesearch: 'WebSearch', google_search: 'WebSearch',
  fetch: 'WebFetch', fetchurl: 'WebFetch', fetch_url: 'WebFetch', fetchpage: 'WebFetch', fetch_page: 'WebFetch', geturl: 'WebFetch', get_url: 'WebFetch', httpget: 'WebFetch', http_get: 'WebFetch', webfetch: 'WebFetch', browseurl: 'WebFetch', browse_url: 'WebFetch',
  // Shell
  runcommand: 'Bash', run_command: 'Bash', executecommand: 'Bash', execute_command: 'Bash', runbash: 'Bash', run_bash: 'Bash', bashcommand: 'Bash', bash_command: 'Bash', shell: 'Bash', terminal: 'Bash', execute: 'Bash', cmd: 'Bash', powershell: 'Bash', command: 'Bash',
  // Planning
  todowrite: 'TodoWrite', todo_write: 'TodoWrite', todo: 'TodoWrite', updatetodos: 'TodoWrite', update_todos: 'TodoWrite', todolist: 'TodoWrite', plan: 'TodoWrite',
  // Skills / agents
  createskill: 'SkillManage', create_skill: 'SkillManage', skillmanage: 'SkillManage', skill_manage: 'SkillManage', manageskill: 'SkillManage', manage_skill: 'SkillManage',
  listskills: 'Skills', list_skills: 'Skills', getskills: 'Skills', get_skills: 'Skills', searchskills: 'Skills', search_skills: 'Skills',
  delegate: 'Agent', runagent: 'Agent', run_agent: 'Agent', spawnagent: 'Agent', spawn_agent: 'Agent', createagent: 'Agent', create_agent: 'Agent', runtask: 'Agent', run_task: 'Agent', task: 'Agent',
  crew: 'Crew', crewinfo: 'Crew', teamup: 'Crew', multiagent: 'Crew',
  customagent: 'create_custom_agent', custom_agent: 'create_custom_agent', createcustomagent: 'create_custom_agent', create_custom_agent: 'create_custom_agent',
  // Computer / browser
  computercontrol: 'Computer', computer_control: 'Computer', controlcomputer: 'Computer', control_computer: 'Computer', computeraction: 'Computer', computer_action: 'Computer', takescreenshot: 'Computer', take_screenshot: 'Computer', screenshot: 'Computer',
  browseraction: 'Browser', browser_action: 'Browser', navigate: 'Browser', openbrowser: 'Browser', open_browser: 'Browser', browsepage: 'Browser', browse_page: 'Browser',
  browserextensiontool: 'browser_extension', browser_extension_tool: 'browser_extension',
  browse: 'Operator', operatoraction: 'Operator', operator_action: 'Operator', weboperator: 'Operator', web_operator: 'Operator',
  operatornavigate: 'Operator', operatorgo: 'Operator', operatorclick: 'Operator', operator_click: 'Operator', operatortype: 'Operator', operator_type: 'Operator', operatorextract: 'Operator', operator_extract: 'Operator', operatormonitor: 'Operator', operator_monitor: 'Operator', operatorsearch: 'Operator', operator_search: 'Operator', operatorcapture: 'Operator', operator_capture: 'Operator', operatoropen: 'Operator', operator_open: 'Operator',
  computerclick: 'Computer', computer_click: 'Computer', computermove: 'Computer', computer_move: 'Computer', computertype: 'Computer', computer_type: 'Computer', computerscroll: 'Computer', computer_scroll: 'Computer', computerkey: 'Computer', computer_key: 'Computer', computerpress: 'Computer', computer_press: 'Computer', computerread: 'Computer', computer_read: 'Computer', computervisual: 'Computer', computer_visual: 'Computer',
  browseropen: 'Browser', browser_open: 'Browser', browserclick: 'Browser', browser_click: 'Browser', browsertype: 'Browser', browser_type: 'Browser', browserscroll: 'Browser', browser_scroll: 'Browser', browserextract: 'Browser', browser_extract: 'Browser',
  // Notifications
  notify: 'Notification', sendnotification: 'Notification', send_notification: 'Notification', notifyprogress: 'NotificationProgress', notify_progress: 'NotificationProgress', notifyaction: 'NotificationAction', notify_action: 'NotificationAction', notifystatus: 'NotificationStatus', notify_status: 'NotificationStatus', notifyclear: 'NotificationClear', notify_clear: 'NotificationClear',
  // Git
  gitstatus: 'GitStatus', git_status: 'GitStatus', gitlog: 'GitLog', git_log: 'GitLog', gitcommit: 'GitCommit', git_commit: 'GitCommit', gitbranch: 'GitBranch', git_branch: 'GitBranch', gitpush: 'GitPush', git_push: 'GitPush', gitpull: 'GitPull', git_pull: 'GitPull', gitdiff: 'GitDiff', git_diff: 'GitDiff', gitcheckout: 'Git', git_checkout: 'Git', repostatus: 'GitStatus', repo_status: 'GitStatus',
  pclivemap: 'PCLiveMap', pc_live_map: 'PCLiveMap', live_map: 'PCLiveMap', pcmap: 'PCLiveMap', live: 'PCLiveMap', // Infinite OS vector eyes+hands (preferred over Computer screenshots)
  // Misc
  sendemail: 'Email', send_email: 'Email', mail: 'Email', composeemail: 'Email', compose_email: 'Email',
  gettime: 'Time', get_time: 'Time', currenttime: 'Time', current_time: 'Time', timestamp: 'Time', datetime: 'Time', date_time: 'Time',
  calculate: 'Math', domath: 'Math', do_math: 'Math', calculator: 'Math', arithmetic: 'Math',
  settimer: 'Timer', set_timer: 'Timer',
  clipboardread: 'ClipboardRead', clipboard_read: 'ClipboardRead', clipboardwrite: 'ClipboardWrite', clipboard_write: 'ClipboardWrite', clipboardimage: 'ClipboardImage', clipboard_image: 'ClipboardImage',
  securityscan: 'Security', security_scan: 'Security', audit: 'Security',
  recall: 'Knowledge', remember: 'Knowledge', memory: 'Knowledge',
  systeminfo: 'System', system_info: 'System', machineinfo: 'System', osinfo: 'System', os_info: 'System',
  projectmanage: 'Project', project_manage: 'Project',
  automate: 'Automation',
  deployapp: 'Deploy', deploy_app: 'Deploy',
  businessadvisor: 'BusinessAdvisor', business_advisor: 'BusinessAdvisor',
  buildfeature: 'BuildFeature', build_feature: 'BuildFeature', rollback: 'RollbackFeature', rollbackfeature: 'RollbackFeature', rollback_feature: 'RollbackFeature',
  selfimprove: 'SelfImprove', self_improve: 'SelfImprove',
  gameassistant: 'GameAssistant', game_assistant: 'GameAssistant',
  taskexecutor: 'TaskExecutor', task_executor: 'TaskExecutor',
  jsonops: 'Json', json_ops: 'Json', textops: 'Text', text_ops: 'Text', encrypt: 'Crypto',
  // Document/Chart/Image/API tools
  createdocument: 'DocumentGenerator', create_document: 'DocumentGenerator', generatepdf: 'DocumentGenerator', generate_pdf: 'DocumentGenerator', generateexcel: 'DocumentGenerator', generate_excel: 'DocumentGenerator', generatepowerpoint: 'DocumentGenerator', generate_powerpoint: 'DocumentGenerator', generateword: 'DocumentGenerator', generate_word: 'DocumentGenerator', createdoc: 'DocumentGenerator', create_doc: 'DocumentGenerator', createpptx: 'DocumentGenerator', createxlsx: 'DocumentGenerator', createdocx: 'DocumentGenerator', pdf: 'DocumentGenerator', excel: 'DocumentGenerator', powerpoint: 'DocumentGenerator', word: 'DocumentGenerator', pptx: 'DocumentGenerator', xlsx: 'DocumentGenerator', docx: 'DocumentGenerator',
  createchart: 'ChartGenerator', create_chart: 'ChartGenerator', generatechart: 'ChartGenerator', generate_chart: 'ChartGenerator', chart: 'ChartGenerator', barchart: 'ChartGenerator', linechart: 'ChartGenerator', piechart: 'ChartGenerator', graph: 'ChartGenerator', visualization: 'ChartGenerator',
  editimage: 'ImageEditor', edit_image: 'ImageEditor', imageeditor: 'ImageEditor', image_editor: 'ImageEditor', resizeimage: 'ImageEditor', resize_image: 'ImageEditor', cropimage: 'ImageEditor', crop_image: 'ImageEditor', convertimage: 'ImageEditor', convert_image: 'ImageEditor', image: 'ImageEditor', photo: 'ImageEditor', picture: 'ImageEditor',
  apitest: 'APITester', api_test: 'APITester', httpclient: 'APITester', http_client: 'APITester', testapi: 'APITester', test_api: 'APITester', restclient: 'APITester', rest_client: 'APITester', api: 'APITester', http: 'APITester',
  // Docker/CI/CD/Calendar tools
  container: 'Docker', containers: 'Docker', dockerps: 'Docker', docker_ps: 'Docker', dockerrun: 'Docker', docker_run: 'Docker', dockerlogs: 'Docker', docker_logs: 'Docker', compose: 'Docker', dockercompose: 'Docker', docker_compose: 'Docker',
  githubactions: 'CICD', github_actions: 'CICD', actions: 'CICD', gitlabci: 'CICD', gitlab_ci: 'CICD', pipeline: 'CICD', workflow: 'CICD', cicd: 'CICD', ci_cd: 'CICD',
  // Network / router self-help
  network: 'Network', netinfo: 'Network', net_info: 'Network', networkinfo: 'Network', network_info: 'Network', wifi: 'Network', wifipassword: 'Network', wifi_password: 'Network', getwifipassword: 'Network', get_wifi_password: 'Network', findwifipassword: 'Network', find_wifi_password: 'Network', networkselfhelp: 'Network', network_self_help: 'Network', networkdiagnostics: 'Network', network_diagnostics: 'Network', networkdiagnose: 'Network', network_diagnose: 'Network', wifiprofiles: 'Network', wifi_profiles: 'Network', nslookup: 'Network', traceroute: 'Network', tracert: 'Network', pinghost: 'Network', ping_host: 'Network', flushdns: 'Network', flush_dns: 'Network', dnstest: 'Network', dns_test: 'Network', setdns: 'Network', set_dns: 'Network', checkports: 'Network', check_ports: 'Network', portcheck: 'Network', port_check: 'Network',
  router: 'RouterAdmin', routeradmin: 'RouterAdmin', router_admin: 'RouterAdmin', routerhelp: 'RouterAdmin', router_help: 'RouterAdmin', routeraccess: 'RouterAdmin', router_access: 'RouterAdmin', recoverrouter: 'RouterAdmin', recover_router: 'RouterAdmin', resetrouter: 'RouterAdmin', reset_router: 'RouterAdmin', portforward: 'RouterAdmin', port_forward: 'RouterAdmin', routerguidance: 'RouterAdmin', router_guidance: 'RouterAdmin', gatewayinfo: 'RouterAdmin', gateway_info: 'RouterAdmin', defaultgateway: 'RouterAdmin', default_gateway: 'RouterAdmin', changewifipassword: 'RouterAdmin', change_wifi_password: 'RouterAdmin',
  // Hermes parity tools
  messaging: 'Messaging', slack: 'Messaging', sendslack: 'Messaging', send_slack: 'Messaging', discord: 'Messaging', senddiscord: 'Messaging', send_discord: 'Messaging', telegram: 'Messaging', sendtelegram: 'Messaging', send_telegram: 'Messaging',
  imagegenerator: 'ImageGenerator', image_generate: 'ImageGenerator', generateimage: 'ImageGenerator', generate_image: 'ImageGenerator', dalle: 'ImageGenerator', stablediffusion: 'ImageGenerator', stable_diffusion: 'ImageGenerator',
  device: 'Device', devicecontrol: 'Device', device_control: 'Device', smarthome: 'Device', smart_home: 'Device', homeassistant: 'Device', home_assistant: 'Device', iot: 'Device',
  vision: 'Vision', describeimage: 'Vision', describe_image: 'Vision', ocr: 'Vision',
  sandbox: 'Sandbox', sandboxed: 'Sandbox', sandboxexec: 'Sandbox', sandbox_exec: 'Sandbox', isolateshell: 'Sandbox',
  batch: 'Batch', batchexecute: 'Batch', batch_execute: 'Batch', parallel: 'Batch', fanout: 'Batch',
  ultimateplanner: 'UltimatePlanner', ultimate_planner: 'UltimatePlanner', taskplanner: 'UltimatePlanner', task_planner: 'UltimatePlanner',
  compute: 'Compute', hardware: 'Compute', computemanager: 'Compute', compute_manager: 'Compute', intelligentcompute: 'Compute', intelligent_compute: 'Compute',
  // New tools
  codereview: 'CodeReview', code_review: 'CodeReview', reviewcode: 'CodeReview', review_code: 'CodeReview', lint: 'CodeReview', analyze: 'CodeReview',
  regex: 'Regex', regexp: 'Regex', regextest: 'Regex', regex_test: 'Regex', pattern: 'Regex',
  csv: 'CSV', csvtool: 'CSV', csv_tool: 'CSV', parsecsv: 'CSV', parse_csv: 'CSV', dataframe: 'CSV',
  translate: 'Translate', translation: 'Translate', translator: 'Translate', localize: 'Translate', i18n: 'Translate',
  color: 'Color', colours: 'Color', palette: 'Color', hexcolor: 'Color', hex_color: 'Color', rgbcolor: 'Color', rgb_color: 'Color', hslcolor: 'Color', hsl_color: 'Color', contrast: 'Color',
};

class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  /**
   * Tolerant lookup: exact match first, then case-insensitive, normalized
   * (alphanumerics only), alias, and finally a small fuzzy edit-distance
   * match. This keeps execution working when models emit variant spellings
   * such as `bash`, `Read_File`, or `webSearch`.
   */
  resolve(name: string): Tool | undefined {
    if (!name) return undefined;
    const exact = this.tools.get(name);
    if (exact) return exact;
    const normalized = normalizeToolName(name);
    if (!normalized) return undefined;

    let caseInsensitive: Tool | undefined;
    for (const tool of this.tools.values()) {
      if (tool.name.toLowerCase() === name.toLowerCase()) {
        caseInsensitive = tool;
        break;
      }
    }
    if (caseInsensitive) return caseInsensitive;

    const normalizedNames = new Map<string, Tool>();
    for (const tool of this.tools.values()) normalizedNames.set(normalizeToolName(tool.name), tool);
    const byNormalized = normalizedNames.get(normalized);
    if (byNormalized) return byNormalized;

    const aliased = TOOL_NAME_ALIASES[normalized];
    if (aliased) {
      const target = this.tools.get(aliased);
      if (target) return target;
    }

    let best: Tool | undefined;
    let bestDistance = 2;
    for (const tool of this.tools.values()) {
      const candidate = normalizeToolName(tool.name);
      if (candidate === normalized) { best = tool; break; }
      const distance = levenshtein(normalized, candidate);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = tool;
      } else if (distance === bestDistance && best) {
        best = undefined;
      }
    }
    return best;
  }

  get(name: string): Tool | undefined {
    return this.resolve(name);
  }

  /** Returns up to `limit` nearest registered tool names for diagnostics. */
  suggest(name: string, limit = 3): string[] {
    const normalized = normalizeToolName(name);
    if (!normalized) return [];
    return this.list()
      .map((tool) => ({ tool, distance: levenshtein(normalized, normalizeToolName(tool.name)) }))
      .filter((entry) => entry.distance <= 3)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit)
      .map((entry) => entry.tool.name);
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  asProviderTools() {
    return this.list().map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));
  }
}

export const toolRegistry = new ToolRegistry();

/**
 * CORE TOOL SET — the ~25 essential tools sent every turn (cuts ~15k tokens
 * vs the full 50+). Single source of truth shared by the agent loop and the
 * custom-agent runtime so a rename can never silently orphan a tool again
 * (AskUserQuestion was once referenced as AskQuestion and never reached models).
 */
export const CORE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
  'WebFetch', 'WebSearch', 'TodoWrite', 'Agent', 'Crew',
  'PCLiveMap', 'Computer', 'browser_extension', 'Operator', 'Verify',
  'FileOps', 'Knowledge', 'System',
  'Git', 'CreateTab', 'BuildFeature',
  'Batch', 'AskUserQuestion', 'TaskGroup', 'Snapshot', 'Appointments', 'EnterpriseCompany',
]);

/**
 * Builds the error fed back to the model when it emits an unresolvable tool
 * name, including close matches and the complete canonical name list so it
 * can immediately self-correct.
 */
export function unknownToolMessage(name: string): string {
  const suggestions = toolRegistry.suggest(name);
  const hint = suggestions.length
    ? ` Did you mean: ${suggestions.join(', ')}?`
    : '';
  const available = toolRegistry.list().map((tool) => tool.name).join(', ');
  return `Unknown tool: "${name}".${hint} Registered tools: ${available}`;
}

export { ToolRegistry };
