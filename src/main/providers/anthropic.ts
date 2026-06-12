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
      const stream = client.messages.stream({
        model: req.model,
        max_tokens: req.max_tokens ?? 4096,
        system: req.system,
        messages: toAnthropicMessages(req.messages),
        tools: req.tools?.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema as Anthropic.Tool.InputSchema,
        })),
      } as never);

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'text_delta', text: event.delta.text };
        }
        if (event.type === 'message_stop') {
          const final = await stream.finalMessage();
          yield {
            type: 'message_end',
            stop_reason: final.stop_reason ?? 'end_turn',
            usage: {
              input: final.usage.input_tokens,
              output: final.usage.output_tokens,
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
      const content: any[] = [];
      for (const b of m.content) {
        if (b.type === 'text') {
          content.push({ type: 'text', text: b.text });
        } else if (b.type === 'image') {
          content.push({ type: 'image', source: { type: 'base64', media_type: b.source.mediaType as any, data: b.source.data } });
        } else if (b.type === 'tool_use') {
          content.push({ type: 'tool_use', id: b.id, name: b.name, input: typeof b.input === 'string' ? JSON.parse(b.input) : b.input as any });
        } else if (b.type === 'tool_result') {
          content.push({ type: 'tool_result', tool_use_id: b.tool_use_id, is_error: b.is_error, content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content) });
        }
      }
      out.push({ role: m.role, content });
    }
  }
  return out;
}
