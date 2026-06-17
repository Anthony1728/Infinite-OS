// Provider registry — resolves the adapter for a (provider, model) pair,
// looks up the API key from encrypted secrets, and exposes a single chat() helper.

import type { ProviderAdapter } from './base.js';
import { openaiCompatible } from './openai-compatible.js';
import { anthropic } from './anthropic.js';
import { gemini } from './gemini.js';
import { openai } from './openai.js';

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
  ollama: openaiCompatible({
    id: 'ollama',
    label: 'Ollama (local)',
    defaultBaseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.3',
    freeModels: [
      { id: 'llama3.3', label: 'Llama 3.3', provider: 'ollama', free: true },
      { id: 'qwen2.5-coder', label: 'Qwen 2.5 Coder', provider: 'ollama', free: true },
      { id: 'deepseek-coder-v2', label: 'DeepSeek Coder V2', provider: 'ollama', free: true },
    ],
    requiresApiKey: false,
    homepage: 'https://ollama.com',
  }),
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
