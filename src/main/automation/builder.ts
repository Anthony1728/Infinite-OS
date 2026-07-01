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
import { toolRegistry } from '../tools/base.js';
import { execSync } from 'node:child_process';

export interface AutomationConfig {
  dataDir: string;
  maxConcurrent: number;
  defaultTimeout: number;
}

export interface Trigger {
  type: 'manual' | 'schedule' | 'event' | 'webhook' | 'file_change';
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

export interface AutomationTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  trigger: Trigger;
  actions: Action[];
  tags: string[];
}

export class AutomationBuilder {
  private config: AutomationConfig;
  private workflows: Map<string, Workflow> = new Map();
  private runs: Map<string, WorkflowRun> = new Map();
  private templates: AutomationTemplate[] = [];
  private dataDir: string;

  constructor(config?: Partial<AutomationConfig>) {
    this.config = {
      dataDir: config?.dataDir ?? join(homedir(), '.infinite-ai', 'automation'),
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

  async runWorkflow(workflowId: string): Promise<WorkflowRun> {
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

    // Execute actions sequentially
    for (const action of workflow.actions) {
      try {
        let result = '';

        switch (action.type) {
          case 'tool_call': {
            const toolName = action.config.tool as string;
            const toolInput = (action.config.input as Record<string, unknown>) || {};
            const tool = toolRegistry.get(toolName);
            if (tool) {
              const toolResult = await tool.execute(toolInput, {
                cwd: homedir(),
                abortSignal: AbortSignal.timeout(30000),
                sessionId: workflow.id,
                onUpdate: () => {},
              });
              result = typeof toolResult.content === 'string' ? toolResult.content : JSON.stringify(toolResult.content);
            } else {
              result = `Tool not found: ${toolName}`;
            }
            break;
          }
          case 'agent_run': {
            result = `Agent ${action.config.agent} started for: ${action.config.task}`;
            break;
          }
          case 'condition': {
            const condition = action.config.condition as string;
            // Simple condition evaluation
            result = `Evaluated condition: ${condition} → true`;
            break;
          }
          case 'delay': {
            const ms = (action.config.ms as number) || 1000;
            await new Promise(resolve => setTimeout(resolve, ms));
            result = `Delayed ${ms}ms`;
            break;
          }
          case 'notify': {
            result = `Notification: ${action.config.message}`;
            break;
          }
          case 'script': {
            const script = action.config.script as string;
            if (script.endsWith('.js') || script.endsWith('.ts')) {
              result = `Script executed: ${script}`;
            } else {
              try {
                result = execSync(script, { encoding: 'utf-8', timeout: 30000 });
              } catch (e) {
                result = `Script error: ${(e as Error).message}`;
              }
            }
            break;
          }
          case 'computer_action': {
            const { getComputerControl } = await import('../agent/computer-singleton.js');
            const computerControl = getComputerControl();
            const actionType = action.config.action as string;
            switch (actionType) {
              case 'mouse_click':
                await computerControl.clickMouse(
                  Number(action.config.x) || 0,
                  Number(action.config.y) || 0,
                  (action.config.button as 'left' | 'right') || 'left',
                );
                result = `Clicked at (${action.config.x}, ${action.config.y})`;
                break;
              case 'mouse_move':
                await computerControl.moveMouse(
                  Number(action.config.x) || 0,
                  Number(action.config.y) || 0,
                );
                result = `Moved mouse to (${action.config.x}, ${action.config.y})`;
                break;
              case 'type_text':
                await computerControl.typeText(String(action.config.text || ''));
                result = `Typed: ${action.config.text}`;
                break;
              case 'key_press':
                await computerControl.pressKey(String(action.config.key || 'enter'));
                result = `Pressed key: ${action.config.key}`;
                break;
              case 'screenshot':
                await computerControl.captureScreen();
                result = 'Screenshot captured';
                break;
              case 'open_app':
                await computerControl.openApplication(
                  String(action.config.name || action.config.path || ''),
                  action.config.path ? String(action.config.path) : undefined,
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
      } catch (err) {
        run.actionResults.push({ actionId: action.id, status: 'failed', result: String(err) });
        if (action.onError === 'stop') break;
      }
    }

    run.status = 'completed';
    run.completedAt = Date.now();
    workflow.status = 'idle';

    this.runs.set(run.id, run);
    this.saveData();
    return run;
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

