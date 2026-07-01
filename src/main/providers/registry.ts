// Provider registry — resolves the adapter for a (provider, model) pair,
// looks up the API key from encrypted secrets, and exposes a single chat() helper.

import type { ProviderAdapter } from './base.js';
import { openaiCompatible } from './openai-compatible.js';
import { anthropic } from './anthropic.js';
import { gemini } from './gemini.js';
import { openai } from './openai.js';

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
      const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(5000) });
      return { ok: res.ok };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },

  async listModels() {
    try {
      const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(5000) });
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
    const ollamaMessages = req.messages.map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : m.content.map((b: { type: string; text?: string }) => b.text ?? '').join(''),
    }));

    try {
      const res = await fetch('http://localhost:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: req.model,
          messages: ollamaMessages,
          stream: true,
        }),
      });

      if (!res.ok || !res.body) {
        yield { type: 'error', error: `Ollama API error: ${res.status}` };
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
            const parsed = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
            if (parsed.message?.content) {
              yield { type: 'text_delta', text: parsed.message.content };
            }
            if (parsed.done) {
              yield { type: 'message_end', stop_reason: 'end_turn', usage: { input: 0, output: 0 } };
            }
          } catch { /* skip malformed lines */ }
        }
      }
    } catch (e) {
      yield { type: 'error', error: (e as Error).message };
    }
  },
};

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
    defaultModel: 'nvidia/llama-3.3-70b-instruct',
    freeModels: [
      { id: 'nvidia/llama-3.3-70b-instruct', label: 'Llama 3.3 70B Instruct', provider: 'nvidia', free: true, supports_tools: true },
      { id: 'nvidia/llama-3.1-8b-instruct', label: 'Llama 3.1 8B Instruct', provider: 'nvidia', free: true, supports_tools: true },
      { id: 'meta/llama-3.1-405b-instruct', label: 'Llama 3.1 405B Instruct', provider: 'nvidia', free: true, supports_tools: false },
      { id: 'nvidia/nemotron-4-340b-instruct', label: 'Nemotron 4 340B', provider: 'nvidia', free: true, supports_tools: false },
      { id: 'mistralai/mistral-large-2-instruct', label: 'Mistral Large 2', provider: 'nvidia', free: true, supports_tools: false },
      { id: 'google/gemma-2-27b-it', label: 'Gemma 2 27B', provider: 'nvidia', free: true, supports_tools: false },
      { id: 'nvidia/llama-3.1-8b-instruct:free', label: 'Llama 3.1 8B (free tier)', provider: 'nvidia', free: true, supports_tools: true },
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
