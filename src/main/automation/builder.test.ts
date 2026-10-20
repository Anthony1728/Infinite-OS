import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AutomationBuilder, type AutomationRunProgress } from './builder.js';
import { setNotificationDeliverer } from './deliver.js';

const temporaryDirectories: string[] = [];

async function createBuilder() {
  const dataDir = await mkdtemp(join(tmpdir(), 'infinite-automation-test-'));
  temporaryDirectories.push(dataDir);
  return new AutomationBuilder({ dataDir });
}

afterEach(async () => {
  setNotificationDeliverer(null);
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('automation run progress', () => {
  it('streams each action and returns a useful completion result', async () => {
    const delivered: string[] = [];
    setNotificationDeliverer(async (req) => {
      delivered.push(req.message);
      return { delivered: true, channel: 'desktop', detail: `sent:${req.message}` };
    });
    const builder = await createBuilder();
    const workflow = builder.createWorkflow({
      name: 'Visible success',
      trigger: { type: 'manual', config: {} },
      actions: [
        { id: 'wait', type: 'delay', config: { ms: 5 } },
        { id: 'notice', type: 'notify', config: { message: 'Done' } },
      ],
    });
    const events: AutomationRunProgress[] = [];
    const run = await builder.runWorkflow(workflow.id, (event) => events.push(event));

    expect(run.status).toBe('completed');
    expect(run.result).toContain('2 of 2 actions completed');
    // The notify step really delivered instead of formatting a dead string.
    expect(delivered).toEqual(['Done']);
    expect(events.map((event) => event.type)).toEqual([
      'run_started',
      'action_started',
      'action_completed',
      'action_started',
      'action_completed',
      'run_completed',
    ]);
  });

  it('fails the run when delivery is impossible instead of succeeding silently', async () => {
    setNotificationDeliverer(async () => ({
      delivered: false,
      channel: 'whatsapp',
      detail: 'WhatsApp delivery failed: WhatsApp is not linked (state: off).',
    }));
    const builder = await createBuilder();
    const workflow = builder.createWorkflow({
      name: 'Undeliverable',
      trigger: { type: 'manual', config: {} },
      actions: [{ id: 'notice', type: 'notify', config: { message: 'Hi', channel: 'whatsapp' }, onError: 'stop' }],
    });
    const run = await builder.runWorkflow(workflow.id, () => {});
    expect(run.status).toBe('failed');
    expect(run.error).toMatch(/WhatsApp is not linked/);
  });

  it('substitutes {{previous}} with the prior action result', async () => {
    const delivered: string[] = [];
    setNotificationDeliverer(async (req) => {
      delivered.push(req.message);
      return { delivered: true, channel: 'desktop', detail: `sent:${req.message}` };
    });
    const builder = await createBuilder();
    const workflow = builder.createWorkflow({
      name: 'Chained brief',
      trigger: { type: 'manual', config: {} },
      actions: [
        { id: 'gather', type: 'delay', config: { ms: 1 } },
        { id: 'brief', type: 'notify', config: { message: 'Brief: {{previous}}' } },
      ],
    });
    const run = await builder.runWorkflow(workflow.id, () => {});
    expect(run.status).toBe('completed');
    // First notify delivers literally; the delay result feeds the template.
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatch(/^Brief: Delayed 1ms$/);
  });

  it('marks a failed action and final run as failed', async () => {
    const builder = await createBuilder();
    const workflow = builder.createWorkflow({
      name: 'Visible failure',
      trigger: { type: 'manual', config: {} },
      actions: [{ id: 'missing', type: 'tool_call', config: { tool: 'DefinitelyMissingTool' }, onError: 'stop' }],
    });
    const events: AutomationRunProgress[] = [];
    const run = await builder.runWorkflow(workflow.id, (event) => events.push(event));

    expect(run.status).toBe('failed');
    expect(run.error).toContain('Tool not found');
    expect(events.some((event) => event.type === 'action_failed')).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'run_completed', status: 'failed' });
  });

  /**
   * The step shape the Workflow Builder UI produces must actually execute.
   *
   * The editor used to write `config.command` and never a tool name, so every
   * Tool Call step it saved had `config.tool === undefined`, missed the registry
   * lookup, and did nothing while looking correctly configured. These pin the
   * contract between the editor (`tool` + `input`) and the executor.
   */
  it('runs a tool_call step built the way the editor builds it', async () => {
    const { toolRegistry } = await import('../tools/base.js');
    let received: unknown;
    toolRegistry.register({
      name: 'TestWorkflowTool',
      description: 'Records what it was given.',
      permission: 'allow',
      inputSchema: { type: 'object', properties: {} },
      async execute(input: unknown) {
        received = input;
        return { content: 'ran' };
      },
    });

    const builder = await createBuilder();
    const workflow = builder.createWorkflow({
      name: 'UI-shaped tool call',
      trigger: { type: 'manual', config: {} },
      // Exactly what StepConfigEditor now saves.
      actions: [{ id: 'call', type: 'tool_call', config: { tool: 'TestWorkflowTool', input: { command: 'npm test' } }, onError: 'stop' }],
    });

    const run = await builder.runWorkflow(workflow.id, () => {});
    expect(run.status).toBe('completed');
    // The tool must have been found AND given the input the editor collected.
    expect(received).toEqual({ command: 'npm test' });
  });

  it('fails visibly when a tool_call step has no tool, rather than doing nothing', async () => {
    const builder = await createBuilder();
    const workflow = builder.createWorkflow({
      name: 'Missing tool',
      trigger: { type: 'manual', config: {} },
      actions: [{ id: 'call', type: 'tool_call', config: { command: 'npm test' }, onError: 'stop' }],
    });
    const run = await builder.runWorkflow(workflow.id, () => {});
    // A step with only a `command` and no tool cannot run — it must say so.
    expect(run.status).toBe('failed');
  });
});
