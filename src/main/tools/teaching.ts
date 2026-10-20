/**
 * Teaching tool — record a desktop demonstration and turn it into a Worker.
 *
 * Non-core (UI-first, core prompt budget is full) but reachable by subagents.
 * permission 'ask': recording the user's screen, clicks, and window titles is
 * exactly the kind of action that must never start silently.
 */

import type { Tool, ToolResult } from './base.js';
import { getTeachingRecorder } from '../teaching/recorder.js';
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

export const teachingTool: Tool = {
  name: 'Teaching',
  description:
    'Teaching mode: record what the user demonstrates on the desktop (focused windows, clicks, narration, screenshots), compile it deterministically into an editable step list, and turn that into a Worker. Actions: start {name}, narrate {recording_id, text} (attach narration while the user demonstrates), stop {recording_id} (compiles steps), list, get, compile, create_worker {recording_id, name?, schedule?}, delete. All capture is local to this machine; recordings live under ~/.infinite-ai/teaching/. Only one recording may be active.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['start', 'narrate', 'stop', 'list', 'get', 'compile', 'create_worker', 'delete'] },
      recording_id: { type: 'string', description: 'Recording ID' },
      name: { type: 'string', description: 'Recording name (start) or worker name (create_worker)' },
      text: { type: 'string', description: 'Narration text to attach (narrate)' },
      schedule: { type: 'object', description: 'Optional trigger for create_worker' },
      steps: {
        type: 'array',
        items: { type: 'string' },
        description: 'Override the compiled steps with explicit instructions (create_worker)',
      },
    },
    required: ['action'],
  },
  permission: 'ask',

  async execute(args): Promise<ToolResult> {
    const input = args as {
      action: string;
      recording_id?: string;
      name?: string;
      text?: string;
      schedule?: WorkerCreateInput['trigger'];
      steps?: string[];
    };
    try {
      const teach = getTeachingRecorder();
      switch (input.action) {
        case 'start':
          return json(teach.start({ name: str(input.name) }));
        case 'narrate':
          if (!input.recording_id || !str(input.text)) return bad('narrate requires recording_id and text.');
          return json(teach.addNarration(input.recording_id, str(input.text)));
        case 'stop':
          if (!input.recording_id) return bad('stop requires recording_id.');
          return json(teach.stop(input.recording_id));
        case 'list':
          return json(teach.list());
        case 'get':
          if (!input.recording_id) return bad('get requires recording_id.');
          return teach.get(input.recording_id) ? json(teach.get(input.recording_id)) : bad('Recording not found.');
        case 'compile':
          if (!input.recording_id) return bad('compile requires recording_id.');
          return json(teach.compile(input.recording_id));
        case 'delete':
          if (!input.recording_id) return bad('delete requires recording_id.');
          return json({ deleted: teach.remove(input.recording_id) });
        case 'create_worker': {
          if (!input.recording_id) return bad('create_worker requires recording_id.');
          const view = teach.get(input.recording_id) ?? teach.compile(input.recording_id);
          if (!view) return bad('Recording not found.');
          const steps = Array.isArray(input.steps) && input.steps.length
            ? input.steps.map((title) => ({ title, instruction: title }))
            : view.compiledSteps.map((step) => ({ title: step.title, instruction: step.instruction, referenceFrame: step.referenceFrame }));
          if (!steps.length) return bad('This recording has no steps yet — narrate during the demo or pass steps.');
          const taskSource = view.narration.trim() || steps.map((step) => step.title).join('; ');
          const worker = getWorkerManager().create({
            name: str(input.name) || view.name,
            description: `Created from a recorded demonstration on ${new Date(view.startedAt).toLocaleString()}.`,
            task: taskSource.slice(0, 4_000) || view.name,
            steps,
            trigger: input.schedule,
          });
          return json({ recording: view, worker });
        }
        default:
          return bad(`Unknown teaching action: ${input.action}`);
      }
    } catch (error) {
      return { content: error instanceof Error ? error.message : String(error), is_error: true };
    }
  },
};
