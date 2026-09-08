// Provider registry — resolves the adapter for a (provider, model) pair,
// looks up the API key from encrypted secrets, and exposes a single chat() helper.

import type { ProviderAdapter } from './base.js';
import { openaiCompatible } from './openai-compatible.js';
import { anthropic } from './anthropic.js';
import { gemini } from './gemini.js';
import { openai } from './openai.js';
import { opencode } from './opencode.js';
import type { Message } from '../../shared/types.js';
import { ensureOllamaRunning, OLLAMA_URL, resolveOllamaModel } from '../ollama/utils.js';

// Ollama provider — auto-detects installed models from local Ollama API
/**
 * Stateful <think>…</think> stripper for reasoning models (qwen3, deepseek-r1).
 * Even with think:false some servers leak the reasoning channel into content —
 * sometimes split across stream chunks. Thinking is swallowed; only the final
 * answer passes through. Call flush() at stream end to release held text.
 */
export function createThinkingStripper(): { push(chunk: string): string; flush(): string } {
  let buf = '';
  let inThink = false;
  // Longest tag we may be holding half of.
  const HOLD = '</think>'.length;
  function drain(): string {
    let out = '';
    for (;;) {
      if (!inThink) {
        const i = buf.indexOf('<think>');
        // Some servers emit the thinking trace with no opening tag, closed
        // only by </think> — treat everything up to that close as thinking.
        const j = buf.indexOf('</think>');
        if (i < 0 && j >= 0) {
          buf = buf.slice(j + '</think>'.length);
          continue;
        }
        if (i < 0) {
          // Hold back a tail that could be a split tag opener.
          const keep = Math.min(buf.length, HOLD);
          out += buf.slice(0, buf.length - keep);
          buf = buf.slice(buf.length - keep);
          return out;
        }
        out += buf.slice(0, i);
        buf = buf.slice(i + '<think>'.length);
        inThink = true;
      } else {
        const j = buf.indexOf('</think>');
        if (j < 0) {
          // Thinking content: drop it, but keep a tail that could complete
          // a close tag split across chunks.
          buf = buf.slice(-HOLD);
          return out;
        }
        buf = buf.slice(j + '</think>'.length);
        inThink = false;
      }
    }
  }
  return {
    push(chunk: string): string {
      buf += chunk;
      return drain();
    },
    flush(): string {
      // Stream over with no close tag: outside thinking, the held tail is
      // real answer text — release it. Inside thinking, drop it.
      if (!inThink) {
        const out = buf;
        buf = '';
        return out;
      }
      buf = '';
      return '';
    },
  };
}

const ollamaAdapter: ProviderAdapter = {
  id: 'ollama',
  label: 'Ollama (local)',
  requiresApiKey: false,
  homepage: 'https://ollama.com',
  defaultModel: '',
  freeModels: [],

  async testConnection() {
    // Auto-start Ollama if not running
    await ensureOllamaRunning();
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
    // Auto-start Ollama if not running
    await ensureOllamaRunning();
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
        // Matches the adapter's num_ctx: buildContext truncates history to
        // fit, so a long session can never crawl-or-stall a small local model.
        context_window: 8192,
        supports_tools: true,
      }));
    } catch {
      return [];
    }
  },

  async *streamChat(req) {
    // Auto-start Ollama if not running before attempting to stream
    await ensureOllamaRunning();
    // Never send a stale model name to Ollama (404 = silent dead chat).
    // Resolve against actually-installed models first.
    let model = req.model;
    try {
      const tags = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (tags.ok) {
        const data = (await tags.json()) as { models?: Array<{ name: string }> };
        model = resolveOllamaModel(req.model, (data.models ?? []).map((m) => m.name));
      }
    } catch {
      /* keep requested model on listing failure */
    }
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
          model,
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
      const think = createThinkingStripper();

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
              const clean = think.push(parsed.message.content);
              if (clean) yield { type: 'text_delta', text: clean };
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
      const tail = think.flush();
      if (tail) yield { type: 'text_delta', text: tail };
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
    defaultModel: 'google/gemma-4-31b-it:free',
    freeModels: [
      { id: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B (free)', provider: 'openrouter', free: true, supports_tools: true },
      { id: 'google/gemma-4-26b-a4b-it:free', label: 'Gemma 4 26B (free)', provider: 'openrouter', free: true, supports_tools: true },
      { id: 'cohere/north-mini-code:free', label: 'North Mini Code (free)', provider: 'openrouter', free: true, supports_tools: true },
      { id: 'nvidia/nemotron-3-super-120b-a12b:free', label: 'Nemotron 3 Super 120B (free)', provider: 'openrouter', free: true, supports_tools: true },
    ],
    homepage: 'https://openrouter.ai',
  }),
  nvidia: openaiCompatible({
    id: 'nvidia',
    label: 'NVIDIA NIM',
    defaultBaseUrl: 'https://integrate.api.nvidia.com/v1',
    defaultModel: 'mistralai/mistral-large',
    freeModels: [
      { id: 'mistralai/mistral-large', label: 'Mistral Large', provider: 'nvidia', free: true, supports_tools: true },
      { id: 'nvidia/nemotron-3-super-120b-a12b', label: 'Nemotron 3 Super 120B', provider: 'nvidia', free: true, supports_tools: true },
      { id: 'google/gemma-3-12b-it', label: 'Gemma 3 12B', provider: 'nvidia', free: true, supports_tools: true },
      { id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', label: 'Nemotron 3 Nano Reasoning', provider: 'nvidia', free: true, supports_tools: false },
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
