// The core agentic loop: think → tool_use → tool_result → think → ... → end_turn
// Streams events to the renderer via the event bus so the UI updates live.

import type { Message, ContentBlock } from '../../shared/types.js';
import { getProvider } from '../providers/registry.js';
import { getApiKey } from '../settings/secrets.js';
import { toolRegistry } from '../tools/base.js';
import { checkPermission } from './permissions.js';
import { runHooks } from './hooks.js';
import { buildSystemPrompt, buildContext } from './context.js';
import { DecisionRouter } from '../brain/router.js';
import { SafetyGovernor } from '../brain/safety.js';

const decisionRouter = new DecisionRouter({ costOptimization: true, fallbackToLocal: true });
const safetyGovernor = new SafetyGovernor({ level: 'medium', auditLog: true });

export { decisionRouter, safetyGovernor };

export interface AgentEvent {
  type:
    | 'message_start'
    | 'text_delta'
    | 'tool_use_start'
    | 'tool_use_delta'
    | 'tool_use_end'
    | 'tool_result'
    | 'message_end'
    | 'error'
    | 'done';
  [k: string]: unknown;
}

export interface AgentRunOptions {
  sessionId: string;
  cwd: string;
  provider: string;
  model: string;
  signal: AbortSignal;
  onEvent: (e: AgentEvent) => void;
}

export async function runAgent(
  history: Message[],
  userMessage: Message,
  opts: AgentRunOptions,
): Promise<Message[]> {
  const messages = [...history, userMessage];
  const provider = getProvider(opts.provider);
  if (!provider) {
    opts.onEvent({ type: 'error', error: `Unknown provider: ${opts.provider}` });
    return messages;
  }

  const apiKey = await getApiKey(opts.provider);
  console.log(`[agent] Provider: ${opts.provider}, Model: ${opts.model}, HasKey: ${Boolean(apiKey)}`);
  
  if (!apiKey) {
    opts.onEvent({ type: 'error', error: `No API key for provider "${opts.provider}". Go to Settings and add your API key.` });
    return messages;
  }
  
  const tools = toolRegistry.asProviderTools();
  const system = await buildSystemPrompt(opts);

  const MAX_TURNS = 100;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (opts.signal.aborted) break;

    const assistant: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: [],
      timestamp: Date.now(),
      model: opts.model,
      provider: opts.provider,
    };
    messages.push(assistant);
    opts.onEvent({ type: 'message_start', message_id: assistant.id });

    const stream = provider.streamChat(
      {
        model: opts.model,
        messages: await buildContext(messages, { cwd: opts.cwd }),
        system,
        tools,
        stream: true,
        signal: opts.signal,
      },
      apiKey,
    );

    const pendingToolCalls: Map<string, { name: string; json: string }> = new Map();

    try {
      for await (const chunk of stream) {
        if (opts.signal.aborted) break;
        switch (chunk.type) {
          case 'text_delta':
            appendOrCreate(assistant.content, { type: 'text', text: chunk.text });
            opts.onEvent({ type: 'text_delta', message_id: assistant.id, text: chunk.text });
            break;
          case 'tool_use_start':
            pendingToolCalls.set(chunk.id, { name: chunk.name, json: '' });
            opts.onEvent({ type: 'tool_use_start', message_id: assistant.id, tool_use_id: chunk.id, name: chunk.name });
            break;
          case 'tool_use_delta': {
            const existing = pendingToolCalls.get(chunk.id);
            if (existing) {
              existing.json += chunk.partial_json;
            } else {
              pendingToolCalls.set(chunk.id, { name: '', json: chunk.partial_json });
            }
            opts.onEvent({ type: 'tool_use_delta', tool_use_id: chunk.id, partial_json: chunk.partial_json });
            break;
          }
          case 'tool_use_end': {
            const pending = pendingToolCalls.get(chunk.id);
            const name = pending?.name ?? chunk.name ?? '';
            const jsonStr = pending?.json ?? '';
            let parsed: unknown = {};
            try { parsed = JSON.parse(jsonStr); } catch { /* leave as {} */ }
            if (pending) {
              pending.name = name;
            }
            const block: ContentBlock = { type: 'tool_use', id: chunk.id, name, input: parsed };
            assistant.content.push(block);
            pendingToolCalls.delete(chunk.id);
            opts.onEvent({ type: 'tool_use_end', message_id: assistant.id, tool_use_id: chunk.id, name, input: parsed });
            break;
          }
          case 'message_end':
            assistant.stop_reason = chunk.stop_reason as Message['stop_reason'];
            assistant.usage = chunk.usage;
            opts.onEvent({ type: 'message_end', message_id: assistant.id, stop_reason: chunk.stop_reason, usage: chunk.usage });
            break;
          case 'error':
            opts.onEvent({ type: 'error', error: chunk.error });
            return messages;
        }
      }
    } catch (e) {
      opts.onEvent({ type: 'error', error: (e as Error).message });
      return messages;
    }

    if (opts.signal.aborted) break;

    // If no tool calls → done
    const toolUses = assistant.content.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
    if (!toolUses.length) {
      decisionRouter.recordTask(opts.model, true);
      opts.onEvent({ type: 'done' });
      return messages;
    }

    // Execute each tool call
    for (const tu of toolUses) {
      await runHooks('PreToolUse', { tool: tu.name, input: tu.input }, { sessionId: opts.sessionId, cwd: opts.cwd });

      // Safety Governor risk assessment
      const riskLevel = getRiskLevel(tu.name);
      const safetyResult = safetyGovernor.validate({
        id: tu.id,
        type: getActionType(tu.name),
        target: tu.name,
        payload: tu.input as Record<string, unknown>,
        source: 'agent-loop',
        timestamp: Date.now(),
        riskLevel,
      });

      if (!safetyResult.approved) {
        messages.push({
          id: crypto.randomUUID(),
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: tu.id, content: `Blocked by safety governor: ${safetyResult.reason}`, is_error: true }],
          timestamp: Date.now(),
        });
        opts.onEvent({ type: 'tool_result', tool_use_id: tu.id, content: `Blocked: ${safetyResult.reason}`, is_error: true });
        continue;
      }

      const allowed = await checkPermission(tu, { sessionId: opts.sessionId, cwd: opts.cwd });
      if (!allowed) {
        messages.push({
          id: crypto.randomUUID(),
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: tu.id, content: 'Permission denied by user.', is_error: true }],
          timestamp: Date.now(),
        });
        continue;
      }

      const tool = toolRegistry.get(tu.name);
      if (!tool) {
        messages.push({
          id: crypto.randomUUID(),
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: tu.id, content: `Unknown tool: ${tu.name}`, is_error: true }],
          timestamp: Date.now(),
        });
        continue;
      }

      let result;
      try {
        result = await tool.execute(tu.input, {
          cwd: opts.cwd,
          abortSignal: opts.signal,
          sessionId: opts.sessionId,
          onUpdate: (partial) => opts.onEvent({ type: 'tool_result', tool_use_id: tu.id, partial: true, content: partial.content }),
        });
      } catch (e) {
        result = { content: (e as Error).message, is_error: true };
      }

      messages.push({
        id: crypto.randomUUID(),
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: tu.id, content: result.content, is_error: result.is_error }],
        timestamp: Date.now(),
      });
      opts.onEvent({ type: 'tool_result', tool_use_id: tu.id, content: result.content, is_error: result.is_error });
      await runHooks('PostToolUse', { tool: tu.name, input: tu.input, result }, { sessionId: opts.sessionId, cwd: opts.cwd });
    }
  }

  opts.onEvent({ type: 'done' });
  return messages;
}

function appendOrCreate(blocks: ContentBlock[], block: ContentBlock) {
  const last = blocks[blocks.length - 1];
  if (last && last.type === 'text' && block.type === 'text') {
    last.text += block.text;
  } else {
    blocks.push(block);
  }
}

function getRiskLevel(toolName: string): 'low' | 'medium' | 'high' | 'critical' {
  const highRisk = ['bash', 'execute_command', 'delete_file', 'write_file'];
  const mediumRisk = ['edit_file', 'create_file', 'browser_navigate', 'computer_control'];
  const lowRisk = ['read_file', 'list_files', 'search_files', 'browser_click', 'browser_extract'];
  
  if (highRisk.some(t => toolName.toLowerCase().includes(t))) return 'high';
  if (mediumRisk.some(t => toolName.toLowerCase().includes(t))) return 'medium';
  if (lowRisk.some(t => toolName.toLowerCase().includes(t))) return 'low';
  return 'medium';
}

function getActionType(toolName: string): string {
  const name = toolName.toLowerCase();
  if (name.includes('read') || name.includes('list') || name.includes('search') || name.includes('extract')) return 'read';
  if (name.includes('write') || name.includes('create') || name.includes('save')) return 'write';
  if (name.includes('edit') || name.includes('update') || name.includes('modify')) return 'update';
  if (name.includes('delete') || name.includes('remove')) return 'delete';
  if (name.includes('execute') || name.includes('bash') || name.includes('run')) return 'execute';
  if (name.includes('navigate') || name.includes('click') || name.includes('type')) return 'system';
  return 'read';
}
