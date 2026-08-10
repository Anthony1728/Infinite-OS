// Provider registry — resolves the adapter for a (provider, model) pair,
// looks up the API key from encrypted secrets, and exposes a single chat() helper.

import type { ProviderAdapter } from './base.js';
import { openaiCompatible } from './openai-compatible.js';
import { anthropic } from './anthropic.js';
import { gemini } from './gemini.js';
import { openai } from './openai.js';
import { opencode } from './opencode.js';
import type { Message } from '../../shared/types.js';

const OLLAMA_URL = 'http://localhost:11434';

// Ollama provider — auto-detects installed models from local Ollama API
const ollamaAdapter: ProviderAdapter = {
  id: 'ollama',
  label: 'Ollama (local)',
  requiresApiKey: false,
  homepage: 'https://ollama.com',
  defaultModel: '',
  freeModels: [],

  async testConnection() {
    try {
      const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return { ok: false, error: `Ollama returned HTTP ${res.status}.` };
      const data = (await res.json()) as { models?: unknown[] };
      return data.models?.length
        ? { ok: true }
        : { ok: false, error: 'Ollama is running, but no models are installed.' };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },

  async listModels() {
    try {
      const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return [];
      const data = (await res.json()) as { models?: Array<{ name: string; size?: number; modified_at?: string }> };
      const models = data.models ?? [];
      return models.map((m) => ({
        id: m.name,
        label: m.name.replace(':latest', ''),
        provider: 'ollama',
        free: true,
      }));
    } catch {
      return [];
    }
  },

  async *streamChat(req) {
    const ollamaMessages = toOllamaMessages(req.messages, req.system);
    const tools = req.tools?.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      },
    }));

    try {
      const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: req.model,
          messages: ollamaMessages,
          stream: true,
          tools: tools?.length ? tools : undefined,
          // Small local agents are fastest and most reliable when the model
          // emits an answer/tool call directly instead of spending the user's
          // latency budget in a hidden reasoning channel.
          think: false,
          keep_alive: '30m',
          options: {
            temperature: req.temperature ?? 0.2,
            num_ctx: 8_192,
            num_predict: req.max_tokens ?? 2048,
            repeat_penalty: 1.05,
          },
        }),
        signal: req.signal,
      });

      if (!res.ok || !res.body) {
        const details = await res.text().catch(() => '');
        yield { type: 'error', error: `Ollama error (${res.status}): ${details.slice(0, 240) || 'No response body'}` };
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line) as {
              message?: {
                content?: string;
                tool_calls?: Array<{ function?: { name?: string; arguments?: Record<string, unknown> } }>;
              };
              done?: boolean;
              prompt_eval_count?: number;
              eval_count?: number;
            };
            if (parsed.message?.content) {
              yield { type: 'text_delta', text: parsed.message.content };
            }
            for (const call of parsed.message?.tool_calls ?? []) {
              const name = call.function?.name ?? '';
              if (!name) continue;
              const id = crypto.randomUUID();
              const args = call.function?.arguments ?? {};
              yield { type: 'tool_use_start', id, name };
              yield { type: 'tool_use_delta', id, partial_json: JSON.stringify(args) };
              yield { type: 'tool_use_end', id, name, input: args };
            }
            if (parsed.done) {
              yield {
                type: 'message_end',
                stop_reason: parsed.message?.tool_calls?.length ? 'tool_use' : 'end_turn',
                usage: { input: parsed.prompt_eval_count ?? 0, output: parsed.eval_count ?? 0 },
              };
            }
          } catch { /* skip malformed lines */ }
        }
      }
    } catch (e) {
      yield { type: 'error', error: (e as Error).message };
    }
  },
};

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_name?: string;
  tool_calls?: Array<{
    type: 'function';
    function: { name: string; arguments: Record<string, unknown> };
  }>;
}

function toOllamaMessages(messages: Message[], system?: string): OllamaMessage[] {
  const result: OllamaMessage[] = [];
  const toolNames = new Map<string, string>();
  if (system) result.push({ role: 'system', content: system });

  for (const message of messages) {
    if (message.role === 'assistant') {
      const toolCalls = message.content
        .filter((block) => block.type === 'tool_use')
        .map((block) => {
          if (block.type !== 'tool_use') return null;
          toolNames.set(block.id, block.name);
          return {
            type: 'function' as const,
            function: {
              name: block.name,
              arguments:
                typeof block.input === 'object' && block.input !== null
                  ? (block.input as Record<string, unknown>)
                  : {},
            },
          };
        })
        .filter((call): call is NonNullable<typeof call> => Boolean(call));
      const content = message.content
        .filter((block) => block.type === 'text')
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('\n');
      result.push({ role: 'assistant', content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
      continue;
    }

    for (const block of message.content) {
      if (block.type === 'tool_result') {
        result.push({
          role: 'tool',
          tool_name: toolNames.get(block.tool_use_id) ?? 'tool',
          content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
        });
      } else if (block.type === 'text') {
        result.push({ role: 'user', content: block.text });
      }
    }
  }
  return result;
}

const REGISTRY: Record<string, ProviderAdapter> = {
  openrouter: openaiCompatible({
    id: 'openrouter',
    label: 'OpenRouter',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    freeModels: [
      { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B (free)', provider: 'openrouter', free: true, supports_tools: true },
      { id: 'qwen/qwen-2.5-72b-instruct:free', label: 'Qwen 2.5 72B (free)', provider: 'openrouter', free: true, supports_tools: true },
      { id: 'deepseek/deepseek-chat:free', label: 'DeepSeek V3 (free)', provider: 'openrouter', free: true, supports_tools: true },
      { id: 'google/gemini-2.0-flash-exp:free', label: 'Gemini 2.0 Flash (free)', provider: 'openrouter', free: true, supports_tools: true },
    ],
    homepage: 'https://openrouter.ai',
  }),
  nvidia: openaiCompatible({
    id: 'nvidia',
    label: 'NVIDIA NIM',
    defaultBaseUrl: 'https://integrate.api.nvidia.com/v1',
    defaultModel: 'meta/llama-3.3-70b-instruct',
    freeModels: [
      { id: 'meta/llama-3.3-70b-instruct', label: 'Llama 3.3 70B Instruct', provider: 'nvidia', free: true, supports_tools: false },
      { id: 'meta/llama-3.1-8b-instruct', label: 'Llama 3.1 8B Instruct', provider: 'nvidia', free: true, supports_tools: false },
      { id: 'meta/llama-3.1-405b-instruct', label: 'Llama 3.1 405B Instruct', provider: 'nvidia', free: true, supports_tools: false },
      { id: 'nvidia/llama-3.1-nemotron-70b-instruct', label: 'Nemotron 70B', provider: 'nvidia', free: true, supports_tools: false },
      { id: 'mistralai/mistral-large-2-instruct', label: 'Mistral Large 2', provider: 'nvidia', free: true, supports_tools: false },
      { id: 'google/gemma-2-27b-it', label: 'Gemma 2 27B', provider: 'nvidia', free: true, supports_tools: false },
    ],
    homepage: 'https://build.nvidia.com',
  }),
  groq: openaiCompatible({
    id: 'groq',
    label: 'Groq',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    freeModels: [
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', provider: 'groq', free: true, supports_tools: true },
      { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (instant)', provider: 'groq', free: true, supports_tools: true },
      { id: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B', provider: 'groq', free: true, supports_tools: false },
    ],
    homepage: 'https://console.groq.com',
  }),
  ollama: ollamaAdapter,
  opencode,
  gemini,
  anthropic,
  openai,
};

export function getProvider(id: string): ProviderAdapter | undefined {
  return REGISTRY[id];
}

export function listProviders(): ProviderAdapter[] {
  return Object.values(REGISTRY);
}

export { REGISTRY as providerRegistry };
export type { ProviderAdapter } from './base.js';
