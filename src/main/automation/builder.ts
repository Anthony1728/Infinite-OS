/**
 * Automation Builder
 *
 * Create and manage automation workflows:
 * - Trigger-based automation
 * - Scheduled tasks
 * - Event-driven workflows
 * - Conditional logic
 * - Loop execution
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { infiniteHome } from '../profiles/home.js';
import { toolRegistry } from '../tools/base.js';
import { executeToolCall } from '../agent/tool-execution.js';
import { spawnSubagent } from '../agent/runtime.js';
import { settings } from '../settings/store.js';
import { execSync } from 'node:child_process';
import { deliverNotification } from './deliver.js';
import { resolveActiveModel } from '../agent/active-model.js';

export interface AutomationConfig {
  dataDir: string;
  maxConcurrent: number;
  defaultTimeout: number;
}

export interface Trigger {
  type:
    | 'manual'
    | 'schedule'
    | 'cron'
    | 'interval'
    | 'once'
    | 'event'
    | 'webhook'
    | 'file_change'
    | 'idle';
  config: Record<string, unknown>;
}

export interface Action {
  id: string;
  type: 'tool_call' | 'agent_run' | 'condition' | 'delay' | 'notify' | 'script' | 'computer_action';
  config: Record<string, unknown>;
  next?: string;
  onError?: 'stop' | 'continue' | 'retry';
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  trigger: Trigger;
  actions: Action[];
  variables: Record<string, unknown>;
  status: 'idle' | 'running' | 'paused' | 'error';
  enabled: boolean;
  createdAt: number;
  lastRun?: number;
  runCount: number;
  lastError?: string;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  completedAt?: number;
  result?: string;
  error?: string;
  actionResults: Array<{ actionId: string; status: string; result: string }>;
}

export interface AutomationRunProgress {
  type: 'run_started' | 'action_started' | 'action_progress' | 'action_completed' | 'action_failed' | 'run_completed';
  runId: string;
  workflowId: string;
  workflowName: string;
  actionId?: string;
  actionType?: Action['type'];
  actionIndex?: number;
  totalActions: number;
  message: string;
  result?: string;
  status?: WorkflowRun['status'];
  timestamp: number;
}

export interface AutomationTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  trigger: Trigger;
  actions: Action[];
  tags: string[];
}

/**
 * Quick NL → cron helper for prompts like "at 5am", "tomorrow at 4pm",
 * "every day at 9am", "every Monday". Used when the chat agent creates a
 * workflow from free-form scheduling language.
 */
export function nlToCron(nl: string): string | null {
  const s = nl.toLowerCase().trim();
  // "every day at 5am" / "daily at 17:00" / "at 5am"
  const atMatch = s.match(/at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (atMatch) {
    let h = parseInt(atMatch[1], 10);
    const m = parseInt(atMatch[2] ?? '0', 10);
    const ap = atMatch[3];
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return `${m} ${h} * * *`;
  }
  // "every monday" / "every friday"
  const dayNames: Record<string,number> = { sunday:0, monday:1, tuesday:2, wednesday:3, thursday:4, friday:5, saturday:6 };
  const everyDay = s.match(/every\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/);
  if (everyDay) return `0 9 * * ${dayNames[everyDay[1]]}`;
  // "tomorrow at 4pm" -> one-shot, not cron — caller should use trigger type once
  return null;
}

export class AutomationBuilder {
  private config: AutomationConfig;
  private workflows: Map<string, Workflow> = new Map();
  private runs: Map<string, WorkflowRun> = new Map();
  private templates: AutomationTemplate[] = [];
  private dataDir: string;
  private activeControllers: Map<string, AbortController> = new Map();

  constructor(config?: Partial<AutomationConfig>) {
    this.config = {
      dataDir: config?.dataDir ?? join(infiniteHome(), 'automation'),
      maxConcurrent: config?.maxConcurrent ?? 5,
      defaultTimeout: config?.defaultTimeout ?? 60000,
    };
    this.dataDir = this.config.dataDir;
    this.ensureDir();
    this.loadData();
    this.initTemplates();
  }

  private ensureDir(): void {
    if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });
  }

  private loadData(): void {
    try {
      const wfPath = join(this.dataDir, 'workflows.json');
      if (existsSync(wfPath)) {
        const data = JSON.parse(readFileSync(wfPath, 'utf-8'));
        this.workflows = new Map(data);
      }
      const runsPath = join(this.dataDir, 'runs.json');
      if (existsSync(runsPath)) {
        const data = JSON.parse(readFileSync(runsPath, 'utf-8'));
        this.runs = new Map(data);
      }
    } catch { /* silent */ }
  }

  private saveData(): void {
    try {
      writeFileSync(join(this.dataDir, 'workflows.json'), JSON.stringify(Array.from(this.workflows.entries()), null, 2));
      writeFileSync(join(this.dataDir, 'runs.json'), JSON.stringify(Array.from(this.runs.entries()).slice(-500), null, 2));
    } catch { /* silent */ }
  }

  private initTemplates(): void {
    this.templates = [
      {
        id: 'auto_backup',
        name: 'Auto Backup',
        description: 'Automatically backup files on schedule',
        category: 'productivity',
        trigger: { type: 'schedule', config: { cron: '0 2 * * *' } },
        actions: [
          { id: 'backup', type: 'tool_call', config: { tool: 'bash', command: 'backup.sh' } },
          { id: 'notify', type: 'notify', config: { message: 'Backup completed' } },
        ],
        tags: ['backup', 'schedule'],
      },
      {
        id: 'code_review',
        name: 'Auto Code Review',
        description: 'Review code on file change',
        category: 'development',
        trigger: { type: 'file_change', config: { pattern: '**/*.ts' } },
        actions: [
          { id: 'read', type: 'tool_call', config: { tool: 'read_file' } },
          { id: 'review', type: 'agent_run', config: { agent: 'code', task: 'Review this code' } },
        ],
        tags: ['code', 'review'],
      },
      {
        id: 'monitor_alerts',
        name: 'System Monitor',
        description: 'Monitor system and send alerts',
        category: 'system',
        trigger: { type: 'schedule', config: { cron: '*/5 * * * *' } },
        actions: [
          { id: 'check', type: 'script', config: { script: 'check_system.js' } },
          { id: 'alert', type: 'condition', config: { condition: 'cpu > 80', trueAction: 'notify' } },
        ],
        tags: ['monitor', 'alerts'],
      },
      {
        id: 'security_audit',
        name: 'Security Audit',
        description: 'Weekly security scan of dependencies and secrets',
        category: 'security',
        trigger: { type: 'schedule', config: { cron: '0 8 * * 1' } },
        actions: [
          { id: 'audit_deps', type: 'agent_run', config: { agent: 'general', task: 'Run npm audit and check for known vulnerabilities in dependencies. Report any high or critical issues found.' } },
          { id: 'check_secrets', type: 'agent_run', config: { agent: 'general', task: 'Scan the codebase for accidentally committed secrets, API keys, or credentials. Check .env files, config files, and git history.' } },
          { id: 'report', type: 'notify', config: { message: 'Security audit complete. Check the report for details.' } },
        ],
        tags: ['security', 'audit', 'weekly'],
      },
      {
        id: 'performance_benchmark',
        name: 'Performance Benchmark',
        description: 'Run performance tests and track metrics',
        category: 'development',
        trigger: { type: 'schedule', config: { cron: '0 6 * * 0' } },
        actions: [
          { id: 'build', type: 'tool_call', config: { tool: 'bash', input: { command: 'npm run build 2>&1 | tail -20' } } },
          { id: 'test', type: 'tool_call', config: { tool: 'bash', input: { command: 'npx vitest run 2>&1 | tail -20' } } },
          { id: 'bundle_check', type: 'agent_run', config: { agent: 'general', task: 'Analyze the build output and test results. Compare with previous runs if available. Report bundle size, test pass rate, and any performance regressions.' } },
        ],
        tags: ['performance', 'benchmark', 'weekly'],
      },
      {
        id: 'dependency_updates',
        name: 'Dependency Updates',
        description: 'Check and propose dependency updates',
        category: 'maintenance',
        trigger: { type: 'schedule', config: { cron: '0 9 * * 3' } },
        actions: [
          { id: 'check_updates', type: 'agent_run', config: { agent: 'general', task: 'Run npm outdated to check for available dependency updates. Categorize updates as major, minor, or patch. List any breaking changes.' } },
          { id: 'security_check', type: 'agent_run', config: { agent: 'general', task: 'Run npm audit to check if any updates fix security vulnerabilities. Prioritize security updates.' } },
          { id: 'report', type: 'notify', config: { message: 'Dependency update check complete. Review the proposed updates.' } },
        ],
        tags: ['dependencies', 'updates', 'weekly'],
      },
      {
        id: 'code_quality',
        name: 'Code Quality Report',
        description: 'Analyze code quality metrics and technical debt',
        category: 'development',
        trigger: { type: 'schedule', config: { cron: '0 7 * * 2' } },
        actions: [
          { id: 'lint', type: 'tool_call', config: { tool: 'bash', input: { command: 'npx eslint src/ --format json 2>/dev/null | head -100' } } },
          { id: 'analyze', type: 'agent_run', config: { agent: 'general', task: 'Analyze the codebase for code quality issues: complexity, duplication, dead code, type safety. Suggest improvements and prioritize by impact.' } },
          { id: 'report', type: 'notify', config: { message: 'Code quality report generated.' } },
        ],
        tags: ['code quality', 'analysis', 'weekly'],
      },
      {
        id: 'disk_cleanup',
        name: 'Disk Cleanup',
        description: 'Clean temporary files and caches',
        category: 'system',
        trigger: { type: 'schedule', config: { cron: '0 4 * * 0' } },
        actions: [
          { id: 'clean_npm', type: 'tool_call', config: { tool: 'bash', input: { command: 'npm cache clean --force 2>/dev/null; echo "npm cache cleaned"' } } },
          { id: 'clean_temp', type: 'tool_call', config: { tool: 'bash', input: { command: 'Remove-Item -Path "$env:TEMP\\*" -Recurse -Force -ErrorAction SilentlyContinue; Write-Output "Temp files cleaned"' } } },
          { id: 'report', type: 'agent_run', config: { agent: 'general', task: 'Check disk space before and after cleanup. Report how much space was freed.' } },
        ],
        tags: ['cleanup', 'system', 'weekly'],
      },
      {
        id: 'git_sync',
        name: 'Git Sync',
        description: 'Auto-fetch and report git status',
        category: 'development',
        trigger: { type: 'schedule', config: { cron: '*/30 * * * *' } },
        actions: [
          { id: 'fetch', type: 'tool_call', config: { tool: 'git', input: { action: 'fetch' } } },
          { id: 'status', type: 'tool_call', config: { tool: 'git', input: { action: 'status' } } },
          { id: 'report', type: 'agent_run', config: { agent: 'general', task: 'Summarize the git status. Are there uncommitted changes? Is the branch ahead/behind remote? Any merge conflicts?' } },
        ],
        tags: ['git', 'sync', 'monitoring'],
      },
      {
        id: 'docs_generator',
        name: 'Auto Documentation',
        description: 'Generate documentation from code comments',
        category: 'development',
        trigger: { type: 'schedule', config: { cron: '0 22 * * 5' } },
        actions: [
          { id: 'scan', type: 'agent_run', config: { agent: 'general', task: 'Scan the codebase for JSDoc/TSDoc comments and exported functions. Identify which functions lack documentation.' } },
          { id: 'generate', type: 'agent_run', config: { agent: 'general', task: 'Generate documentation for undocumented functions. Add JSDoc comments to source files or create a docs folder with markdown files.' } },
          { id: 'report', type: 'notify', config: { message: 'Documentation generation complete.' } },
        ],
        tags: ['documentation', 'automation', 'weekly'],
      },
      {
        id: 'standup_git_summary',
        name: 'Standup Git Summary',
        description: 'Morning digest of commits, branches, and open changes for standup',
        category: 'development',
        trigger: { type: 'schedule', config: { cron: '30 8 * * 1-5' } },
        actions: [
          { id: 'collect', type: 'tool_call', config: { tool: 'git', input: { action: 'status' } } },
          { id: 'summarize', type: 'agent_run', config: { agent: 'general', task: 'Summarize the last 24 hours of git activity for a standup: commits made, branches created/merged, uncommitted changes, and anything blocked. Keep it to five bullet points.' } },
          { id: 'report', type: 'notify', config: { message: 'Standup summary ready.' } },
        ],
        tags: ['git', 'standup', 'daily'],
      },
      {
        id: 'ci_failures_report',
        name: 'CI Failures & Flaky Test Report',
        description: 'Collect recent CI failures and flag flaky tests',
        category: 'development',
        trigger: { type: 'schedule', config: { cron: '0 * * * *' } },
        actions: [
          { id: 'scan_ci', type: 'agent_run', config: { agent: 'general', task: 'Look at recent CI runs (gh run list or local test logs). List failures with their likely cause. Identify tests that failed intermittently across runs — those are flaky. Suggest next actions.' } },
          { id: 'report', type: 'notify', config: { message: 'CI failure report updated.' } },
        ],
        tags: ['ci', 'testing', 'monitoring'],
      },
      {
        id: 'documentation_sync_check',
        name: 'Documentation Sync Check',
        description: 'Verify README and docs match the current code',
        category: 'maintenance',
        trigger: { type: 'schedule', config: { cron: '0 10 * * 4' } },
        actions: [
          { id: 'diff_docs', type: 'agent_run', config: { agent: 'general', task: 'Compare README.md and docs/ against the current source: commands that changed, renamed APIs, removed features, new setup steps. Report every place the documentation is out of date, most important first.' } },
          { id: 'report', type: 'notify', config: { message: 'Documentation sync check complete.' } },
        ],
        tags: ['documentation', 'sync', 'weekly'],
      },
    ];
  }

  createWorkflow(data: {
    name: string;
    description?: string;
    trigger: Trigger;
    actions?: Action[];
  }): Workflow {
    const workflow: Workflow = {
      id: randomUUID(),
      name: data.name,
      description: data.description ?? '',
      trigger: data.trigger,
      actions: data.actions ?? [],
      variables: {},
      status: 'idle',
      enabled: true,
      createdAt: Date.now(),
      runCount: 0,
    };

    this.workflows.set(workflow.id, workflow);
    this.saveData();
    return workflow;
  }

  createFromTemplate(templateId: string, customConfig?: Record<string, unknown>): Workflow | null {
    const template = this.templates.find((t) => t.id === templateId);
    if (!template) return null;

    return this.createWorkflow({
      name: template.name,
      description: template.description,
      trigger: { ...template.trigger, config: { ...template.trigger.config, ...customConfig } },
      actions: [...template.actions],
    });
  }

  addAction(workflowId: string, action: Omit<Action, 'id'>): Action | null {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) return null;

    const fullAction: Action = { ...action, id: randomUUID() };
    workflow.actions.push(fullAction);
    this.saveData();
    return fullAction;
  }

  removeAction(workflowId: string, actionId: string): boolean {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) return false;

    workflow.actions = workflow.actions.filter((a) => a.id !== actionId);
    this.saveData();
    return true;
  }

  enableWorkflow(workflowId: string): boolean {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) return false;
    workflow.enabled = true;
    this.saveData();
    return true;
  }

  disableWorkflow(workflowId: string): boolean {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) return false;
    workflow.enabled = false;
    this.saveData();
    return true;
  }

  deleteWorkflow(workflowId: string): boolean {
    const deleted = this.workflows.delete(workflowId);
    if (deleted) this.saveData();
    return deleted;
  }

  async runWorkflow(workflowId: string, onProgress?: (event: AutomationRunProgress) => void): Promise<WorkflowRun> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) throw new Error('Workflow not found');

    const run: WorkflowRun = {
      id: randomUUID(),
      workflowId,
      status: 'running',
      startedAt: Date.now(),
      actionResults: [],
    };

    workflow.status = 'running';
    workflow.lastRun = Date.now();
    workflow.runCount++;
    const emit = (event: Omit<AutomationRunProgress, 'runId' | 'workflowId' | 'workflowName' | 'totalActions' | 'timestamp'>) => {
      onProgress?.({
        ...event,
        runId: run.id,
        workflowId,
        workflowName: workflow.name,
        totalActions: workflow.actions.length,
        timestamp: Date.now(),
      });
    };
    const runController = new AbortController();
    this.activeControllers.set(run.id, runController);
    emit({ type: 'run_started', message: `Started ${workflow.name}` });

    // Execute actions sequentially with durable per-action retry counts.
    const actionAttempts = new Map<string, number>();
    // Result of the most recent completed action — notify steps reference it
    // as {{previous}} so agent_run → notify chains deliver the actual content.
    let previousResult = '';
    let actionIndex = 0;
    while (actionIndex < workflow.actions.length) {
      if (runController.signal.aborted) {
        run.status = 'cancelled';
        run.error = 'Cancelled by user.';
        workflow.status = 'idle';
        this.runs.set(run.id, run);
        this.activeControllers.delete(run.id);
        emit({ type: 'run_completed', message: 'Cancelled by user.', result: 'Cancelled', status: 'cancelled' });
        return run;
      }
      const action = workflow.actions[actionIndex];
      const attempt = (actionAttempts.get(action.id) ?? 0) + 1;
      actionAttempts.set(action.id, attempt);
      emit({
        type: 'action_started',
        actionId: action.id,
        actionType: action.type,
        actionIndex,
        message: `Running ${action.type.replace(/_/g, ' ')}`,
      });
      try {
        let result = '';

        switch (action.type) {
          case 'tool_call': {
            const toolName = action.config.tool as string;
            const toolInput = (action.config.input as Record<string, unknown>) || {};
            const tool = toolRegistry.get(toolName);
            if (tool) {
              const toolResult = await executeToolCall({
                tool,
                toolUse: { type: 'tool_use', id: action.id, name: toolName, input: toolInput },
                cwd: homedir(),
                parentSignal: runController.signal,
                sessionId: workflow.id,
                onUpdate: (update) => emit({
                  type: 'action_progress',
                  actionId: action.id,
                  actionType: action.type,
                  actionIndex,
                  message: typeof update.content === 'string' ? update.content : JSON.stringify(update.content),
                }),
              });
              result = typeof toolResult.content === 'string' ? toolResult.content : JSON.stringify(toolResult.content);
              if (toolResult.is_error) throw new Error(result);
            } else {
              throw new Error(`Tool not found: ${toolName}`);
            }
            break;
          }
          case 'agent_run': {
            const agentId = String(action.config.agent ?? 'general') as Parameters<typeof spawnSubagent>[0]['agentId'];
            const task = String(action.config.task ?? '');
            if (!task.trim()) throw new Error('agent_run requires a task.');
            // Scheduled runs answer on the user's SELECTED model — never a
            // silent local fallback that hogs the machine. Nothing selected
            // fails the action loudly instead of burning CPU unasked.
            const { provider, model, cwd } = resolveActiveModel((key) => settings.get(key));
            const spawned = spawnSubagent({
              agentId,
              task,
              sessionId: workflow.id,
              cwd,
              provider,
              model,
              parentHistory: [],
              background: false,
              retry: { maxAttempts: 3, backoff: true },
              sink: (event) => emit({
                type: 'action_progress',
                actionId: action.id,
                actionType: action.type,
                actionIndex,
                message: JSON.stringify(event).slice(0, 2_000),
              }),
            });
            result = await spawned.done;
            if (!result.trim()) throw new Error(`Agent ${agentId} did not produce a verified result.`);
            break;
          }
          case 'condition': {
            const condition = action.config.condition as string;
            const condResult = evaluateCondition(condition);
            result = `Evaluated condition: ${condition} → ${condResult}`;
            if (!condResult) throw new Error(`Condition false: ${condition}`);
            break;
          }
          case 'delay': {
            const ms = (action.config.ms as number) || 1000;
            await new Promise(resolve => setTimeout(resolve, ms));
            result = `Delayed ${ms}ms`;
            break;
          }
          case 'notify': {
            const template = String(action.config.message ?? '');
            const message = template.includes('{{previous}}')
              ? template.split('{{previous}}').join(previousResult)
              : template;
            if (!message.trim()) throw new Error('notify requires a message.');
            // Real delivery (desktop toast by default; whatsapp / telegram /
            // email on request). A notification that cannot be delivered fails
            // the action loudly — scheduled briefs must never "succeed" into
            // the void the way the old no-op string did.
            const delivery = await deliverNotification({
              message,
              title: typeof action.config.title === 'string' ? action.config.title : workflow.name,
              channel: typeof action.config.channel === 'string' ? action.config.channel : undefined,
              to: typeof action.config.to === 'string' ? action.config.to : undefined,
              subject: typeof action.config.subject === 'string' ? action.config.subject : undefined,
            });
            result = delivery.detail;
            if (!delivery.delivered) throw new Error(delivery.detail);
            break;
          }
          case 'script': {
            const script = action.config.script as string;
            try {
              if (script.endsWith('.ts')) {
                const { execSync: runTs } = await import('node:child_process');
                result = runTs(`npx tsx "${script}"`, { encoding: 'utf-8', timeout: 30_000, cwd: homedir() });
              } else if (script.endsWith('.js')) {
                const { execSync: runJs } = await import('node:child_process');
                result = runJs(`node "${script}"`, { encoding: 'utf-8', timeout: 30_000, cwd: homedir() });
              } else {
                result = execSync(script, { encoding: 'utf-8', timeout: 30_000 });
              }
            } catch (e) {
              result = `Script error: ${(e as Error).message}`;
              throw new Error(result);
            }
            break;
          }
          case 'computer_action': {
            const { getComputerAutomation } = await import('../automation/computer-automation.js');
            const computer = getComputerAutomation();
            const actionType = action.config.action as string;
            switch (actionType) {
              case 'mouse_click':
                await computer.click(
                  Number(action.config.x) || 0,
                  Number(action.config.y) || 0,
                  (action.config.button as 'left' | 'right' | 'middle') || 'left',
                );
                result = `Clicked at (${action.config.x}, ${action.config.y})`;
                break;
              case 'mouse_move':
                await computer.moveMouse(
                  Number(action.config.x) || 0,
                  Number(action.config.y) || 0,
                );
                result = `Moved mouse to (${action.config.x}, ${action.config.y})`;
                break;
              case 'type_text':
                await computer.typeText(String(action.config.text || ''));
                result = `Typed: ${action.config.text}`;
                break;
              case 'key_press':
                await computer.pressKey(String(action.config.key || 'enter'));
                result = `Pressed key: ${action.config.key}`;
                break;
              case 'screenshot':
                await computer.captureScreen();
                result = 'Screenshot captured';
                break;
              case 'open_app':
                await computer.openApp(
                  String(action.config.name || action.config.path || ''),
                );
                result = `Opened app: ${action.config.name || action.config.path}`;
                break;
              default:
                result = `Unknown computer action: ${actionType}`;
            }
            break;
          }
        }

        run.actionResults.push({ actionId: action.id, status: 'completed', result });
        previousResult = result;
        emit({ type: 'action_completed', actionId: action.id, actionType: action.type, actionIndex, message: `${action.type.replace(/_/g, ' ')} completed`, result });
        actionIndex++;
      } catch (err) {
        const result = err instanceof Error ? err.message : String(err);
        if (action.onError === 'retry' && attempt < 3) {
          emit({ type: 'action_progress', actionId: action.id, actionType: action.type, actionIndex, message: `Retrying ${action.type.replace(/_/g, ' ')} (attempt ${attempt + 1}/3): ${result}` });
          continue;
        }
        run.actionResults.push({ actionId: action.id, status: 'failed', result });
        emit({ type: 'action_failed', actionId: action.id, actionType: action.type, actionIndex, message: `${action.type.replace(/_/g, ' ')} failed`, result });
        if (action.onError === 'stop') break;
        actionIndex++;
      }
    }

    const failures = run.actionResults.filter((action) => action.status === 'failed');
    run.status = failures.length ? 'failed' : 'completed';
    run.completedAt = Date.now();
    run.result = run.status === 'completed'
      ? `${run.actionResults.length} of ${workflow.actions.length} actions completed successfully.`
      : `${failures.length} action${failures.length === 1 ? '' : 's'} failed.`;
    if (failures.length) run.error = failures.map((failure) => failure.result).join('\n');
    workflow.status = 'idle';
    workflow.lastError = run.error;

    this.runs.set(run.id, run);
    this.saveData();
    this.activeControllers.delete(run.id);
    emit({ type: 'run_completed', message: run.result, result: run.error ?? run.result, status: run.status });
    return run;
  }

  cancelRun(runId: string): boolean {
    const c = this.activeControllers.get(runId);
    if (c) { c.abort(); return true; }
    return false;
  }

  /** If the user says "at 5am" or "tomorrow at 4pm", produce a trigger. Used by the agent. */
  triggerFromNaturalLanguage(nl: string): Trigger | null {
    const lower = nl.toLowerCase();
    // "tomorrow at 4pm" -> once
    if (/tomorrow/.test(lower)) {
      const at = nlToCron(nl);
      if (at) {
        const m = parseInt(at.split(' ')[0], 10);
        const h = parseInt(at.split(' ')[1], 10);
        const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(h, m, 0, 0);
        return { type: 'once', config: { onceAt: d.toISOString() } };
      }
    }
    const cron = nlToCron(nl);
    if (cron) return { type: 'cron', config: { cron } };
    // fallback: interval like "every 2 hours"
    const everyH = lower.match(/every\s+(\d+)\s*hours?/);
    if (everyH) return { type: 'interval', config: { intervalMs: parseInt(everyH[1], 10) * 3600000 } };
    return null;
  }

  getWorkflow(workflowId: string): Workflow | undefined {
    return this.workflows.get(workflowId);
  }

  listWorkflows(): Workflow[] {
    return Array.from(this.workflows.values());
  }

  getTemplates(): AutomationTemplate[] {
    return this.templates;
  }

  getRuns(workflowId?: string): WorkflowRun[] {
    const runs = Array.from(this.runs.values());
    return workflowId ? runs.filter((r) => r.workflowId === workflowId) : runs;
  }

  getStats(): {
    totalWorkflows: number;
    enabledWorkflows: number;
    totalRuns: number;
    completedRuns: number;
    failedRuns: number;
  } {
    const workflows = Array.from(this.workflows.values());
    const runs = Array.from(this.runs.values());
    return {
      totalWorkflows: workflows.length,
      enabledWorkflows: workflows.filter((w) => w.enabled).length,
      totalRuns: runs.length,
      completedRuns: runs.filter((r) => r.status === 'completed').length,
      failedRuns: runs.filter((r) => r.status === 'failed').length,
    };
  }
}

/** Simple condition evaluator for automation workflows. */
function evaluateCondition(condition: string): boolean {
  const trimmed = condition.trim().toLowerCase();
  // Handle simple boolean strings
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  // Handle comparison patterns: "metric operator value"
  const match = trimmed.match(/^(.+?)\s*(>=|<=|!=|>|<|==|contains|equals)\s*(.+)$/);
  if (match) {
    const [, left, op, right] = match;
    const leftVal = resolveMetric(left!.trim());
    const rightNum = parseFloat(right!);
    const rightStr = right!.trim();
    if (typeof leftVal === 'number' && !isNaN(rightNum)) {
      switch (op) {
        case '>': return leftVal > rightNum;
        case '<': return leftVal < rightNum;
        case '>=': return leftVal >= rightNum;
        case '<=': return leftVal <= rightNum;
        case '==': return leftVal === rightNum;
        case '!=': return leftVal !== rightNum;
      }
    }
    if (typeof leftVal === 'string') {
      if (op === 'contains') return leftVal.includes(rightStr);
      if (op === '==') return leftVal === rightStr;
      if (op === '!=') return leftVal !== rightStr;
    }
  }
  // Fallback: treat non-empty non-"false" as true
  return trimmed !== '' && trimmed !== 'false';
}

/** Resolve simple metric names to live values. */
function resolveMetric(name: string): string | number {
  switch (name) {
    case 'hour': return new Date().getHours();
    case 'day': return new Date().getDay();
    case 'timestamp': return Date.now();
    default: return name;
  }
}

export const automationBuilder = new AutomationBuilder();

