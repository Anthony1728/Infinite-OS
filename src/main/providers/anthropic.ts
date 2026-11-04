// Anthropic Messages API adapter — native SDK, not OpenAI-compatible.

import Anthropic from '@anthropic-ai/sdk';
import type { ProviderAdapter, ChatRequest, StreamChunk } from './base.js';
import type { ModelInfo, Message } from '../../shared/types.js';

const FREE_MODELS: ModelInfo[] = []; // Anthropic has no free tier

export const anthropic: ProviderAdapter = {
  id: 'anthropic',
  label: 'Anthropic',
  requiresApiKey: true,
  defaultModel: 'claude-sonnet-4-5',
  freeModels: FREE_MODELS,
  homepage: 'https://console.anthropic.com',

  async testConnection(apiKey) {
    try {
      const client = new Anthropic({ apiKey });
      await client.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 8,
        messages: [{ role: 'user', content: 'ping' }],
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },

  async listModels() {
    return [
      { id: 'claude-opus-4-1', label: 'Claude Opus 4.1', provider: 'anthropic', free: false, supports_tools: true, supports_vision: true },
      { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', provider: 'anthropic', free: false, supports_tools: true, supports_vision: true },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'anthropic', free: false, supports_tools: true, supports_vision: true },
    ];
  },

  async *streamChat(req: ChatRequest, apiKey): AsyncIterable<StreamChunk> {
    const client = new Anthropic({ apiKey });
    try {
      // Prompt caching: the system prompt is static per session and the tail
      // of the conversation is stable between loop turns, so a cache breakpoint
      // on the system prompt saves ~90% of input tokens on multi-turn agent
      // runs. (The older bundled SDK types lack cache_control — cast.)
      const systemBlocks = req.system
        ? [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } } as unknown as Anthropic.TextBlockParam]
        : [];
      const stream = client.messages.stream({
        model: req.model,
        max_tokens: req.max_tokens ?? 4096,
        system: systemBlocks.length ? systemBlocks : undefined,
        messages: toAnthropicMessages(req.messages),
        tools: req.tools?.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema as Anthropic.Tool.InputSchema,
        })),
      } as never, { signal: req.signal });

      const toolCalls = new Map<string, { id: string; name: string; json: string }>();

      for await (const event of stream) {
        if (event.type === 'message_start') {
          yield { type: 'message_start', id: event.message.id, model: event.message.model };
        }
        if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
          toolCalls.set(event.index.toString(), { id: event.content_block.id, name: event.content_block.name, json: '' });
          yield { type: 'tool_use_start', id: event.content_block.id, name: event.content_block.name };
        }
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta' && typeof event.delta.text === 'string' && event.delta.text.trim()) {
          yield { type: 'text_delta', text: event.delta.text };
        }
        if (event.type === 'content_block_delta' && event.delta.type === 'input_json_delta') {
          const call = toolCalls.get(event.index.toString());
          if (call) call.json += event.delta.partial_json;
          if (call) yield { type: 'tool_use_delta', id: call.id, partial_json: event.delta.partial_json };
        }
        if (event.type === 'content_block_stop') {
          const call = toolCalls.get(event.index.toString());
          if (call) {
            try {
              yield { type: 'tool_use_end', id: call.id, name: call.name, input: JSON.parse(call.json) };
            } catch {
              yield { type: 'tool_use_end', id: call.id, name: call.name, input: {} };
            }
            toolCalls.delete(event.index.toString());
          }
        }
        if (event.type === 'message_stop') {
          const final = await stream.finalMessage();
          const usage = final.usage as typeof final.usage & {
            cache_read_input_tokens?: number;
            cache_creation_input_tokens?: number;
          };
          yield {
            type: 'message_end',
            stop_reason: final.stop_reason ?? 'end_turn',
            usage: {
              input: final.usage.input_tokens,
              output: final.usage.output_tokens,
              cache_read: usage.cache_read_input_tokens ?? 0,
              cache_write: usage.cache_creation_input_tokens ?? 0,
            },
          };
        }
      }
    } catch (e) {
      yield { type: 'error', error: (e as Error).message };
    }
  },
};

function toAnthropicMessages(messages: Message[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const m of messages) {
    if (m.role === 'user' || m.role === 'assistant') {
      const content: Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.ToolUseBlockParam | Anthropic.ToolResultBlockParam> = [];
      for (const b of m.content) {
        if (b.type === 'text') {
          content.push({ type: 'text', text: b.text });
        } else if (b.type === 'image') {
          content.push({ type: 'image', source: { type: 'base64', media_type: b.source.mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: b.source.data } });
        } else if (b.type === 'tool_use') {
          content.push({ type: 'tool_use', id: b.id, name: b.name, input: typeof b.input === 'string' ? JSON.parse(b.input) : (b.input as Record<string, unknown>) });
        } else if (b.type === 'tool_result') {
          content.push({ type: 'tool_result', tool_use_id: b.tool_use_id, is_error: b.is_error, content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content) });
        }
      }
      out.push({ role: m.role, content });
    }
  }
  return out;
}

