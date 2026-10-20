/**
 * Worker tool — the agent-facing surface for first-class Workers.
 *
 * Non-core on purpose: the worker runtime is a UI-first product surface, and
 * the per-request core prompt budget is nearly full. Subagents (Agent tool)
 * can still reach it because they attach the full tool registry.
 *
 * Permission is 'ask', matching Automation: creating a scheduled autonomous
 * task is an app-level mutation the user should see.
 */

import type { Tool, ToolResult } from './base.js';
import { getWorkerManager, type WorkerCreateInput } from '../workers/manager.js';

function json(value: unknown): ToolResult {
  return { content: JSON.stringify(value, null, 2) };
}

function bad(message: string): ToolResult {
  return { content: message, is_error: true };
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export const workerTool: Tool = {
  name: 'Worker',
  description:
    'Manage digital workers: named autonomous tasks with an editable step list, an isolated workspace, optional schedule (manual / every-N-minutes / cron / once), pause+resume, live progress, confidence after repeated clean runs, and run history. Actions: list, get, create, update, run, pause, resume, stop, interject (add guidance to pending steps of a live run), history, stats. create needs name + task; optional steps (strings or {title,instruction}), schedule {type, config} (types: manual, interval{intervalMs>=60000}, cron{cron}, once{onceAt}). Prefer Worker over raw Automation workflows when the user talks about a recurring "task/job/worker" — Worker compiles to one agent step per task step.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'get', 'create', 'update', 'run', 'pause', 'resume', 'stop', 'interject', 'history', 'stats'],
        description: 'Worker action to perform',
      },
      worker_id: { type: 'string', description: 'Target worker ID' },
      name: { type: 'string', description: 'Worker name (create/update)' },
      task: { type: 'string', description: 'The overall mission, in the user own words (create/update)' },
      description: { type: 'string', description: 'Short summary shown in the Workers view' },
      steps: {
        type: 'array',
        items: { type: 'string' },
        description: 'Ordered step instructions. One agent run per step.',
      },
      schedule: {
        type: 'object',
        description: 'Trigger: {type:"manual"|"interval"|"cron"|"once", config:{...}}',
      },
      notify: { type: 'boolean', description: 'Desktop notification when a run finishes (default true)' },
      message: { type: 'string', description: 'Guidance for interject' },
    },
    required: ['action'],
  },
  permission: 'ask',

  async execute(args): Promise<ToolResult> {
    const input = args as {
      action: string;
      worker_id?: string;
      name?: string;
      task?: string;
      description?: string;
      steps?: string[];
      schedule?: WorkerCreateInput['trigger'];
      notify?: boolean;
      message?: string;
    };
    const manager = getWorkerManager();
    try {
      switch (input.action) {
        case 'list':
          return json(manager.list());
        case 'stats':
          return json(manager.stats());
        case 'get': {
          const worker = input.worker_id ? manager.get(input.worker_id) : null;
          return worker ? json(worker) : bad('Worker not found.');
        }
        case 'create': {
          if (!str(input.name) || !str(input.task)) return bad('create requires name and task.');
          return json(manager.create({
            name: str(input.name),
            task: str(input.task),
            description: str(input.description),
            steps: Array.isArray(input.steps) ? input.steps : undefined,
            trigger: input.schedule,
            notifyOnFinish: input.notify,
          }));
        }
        case 'update': {
          if (!input.worker_id) return bad('update requires worker_id.');
          return json(manager.update(input.worker_id, {
            name: str(input.name) || undefined,
            task: str(input.task) || undefined,
            description: str(input.description) || undefined,
            steps: Array.isArray(input.steps) ? input.steps : undefined,
            trigger: input.schedule,
            notifyOnFinish: input.notify,
          }));
        }
        case 'run': {
          if (!input.worker_id) return bad('run requires worker_id.');
          const worker = manager.startRun(input.worker_id);
          return json({ started: true, worker });
        }
        case 'pause':
          if (!input.worker_id) return bad('pause requires worker_id.');
          return json(manager.pause(input.worker_id));
        case 'resume':
          if (!input.worker_id) return bad('resume requires worker_id.');
          return json(manager.resume(input.worker_id));
        case 'stop':
          if (!input.worker_id) return bad('stop requires worker_id.');
          return json({ cancelled: manager.cancel(input.worker_id) });
        case 'interject': {
          if (!input.worker_id) return bad('interject requires worker_id.');
          if (!str(input.message)) return bad('interject requires message.');
          return json(manager.interject(input.worker_id, str(input.message)));
        }
        case 'history': {
          if (!input.worker_id) return bad('history requires worker_id.');
          return json(manager.getHistory(input.worker_id));
        }
        default:
          return bad(`Unknown worker action: ${input.action}`);
      }
    } catch (error) {
      return { content: error instanceof Error ? error.message : String(error), is_error: true };
    }
  },
};
