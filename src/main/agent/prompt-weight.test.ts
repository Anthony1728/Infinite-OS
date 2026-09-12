import { describe, expect, it } from 'vitest';
import { registerBuiltinTools } from '../tools/registry.js';
import { toolRegistry, CORE_TOOL_NAMES } from '../tools/base.js';
import { buildSystemPrompt, renderStaticSystemPrompt } from './context.js';
import { getSelfModel } from './self-model.js';

// Payload diet guard: every request ships the system prompt + attached tool
// schemas before a single word of conversation, and providers bill latency on
// input tokens. These budgets stop the prompt from silently fattening again.
const SYSTEM_BUDGET = 22_000;
const STATIC_BUDGET = 8_000;
const CORE_TOOLS_BUDGET = 36_000;

describe('prompt weight budget', () => {
  it('stays within per-request char budgets', async () => {
    registerBuiltinTools();
    const tools = toolRegistry.list();
    const statik = renderStaticSystemPrompt({
      permissionProfile: ':workspace',
      toolsEnabled: true,
      provider: 'openrouter',
      toolCatalog: tools,
      attachedToolNames: tools.map((t) => t.name),
    });
    const full = await buildSystemPrompt({
      sessionId: 'probe',
      cwd: process.cwd(),
      model: 'probe-model',
      provider: 'openrouter',
    });
    const core = tools.filter((t) => CORE_TOOL_NAMES.has(t.name));
    const coreJson = JSON.stringify(core.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })));
    console.log(`WEIGHT static=${statik.length} selfmodel=${getSelfModel().length} full=${full.length} core=${core.length} corejson=${coreJson.length}`);
    expect(statik.length).toBeLessThan(STATIC_BUDGET);
    expect(full.length).toBeLessThan(SYSTEM_BUDGET);
    expect(coreJson.length).toBeLessThan(CORE_TOOLS_BUDGET);
  }, 60_000);
});
