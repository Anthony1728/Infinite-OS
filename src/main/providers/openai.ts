import { openaiCompatible } from './openai-compatible.js';
import type { ProviderAdapter } from './base.js';

export const openai: ProviderAdapter = openaiCompatible({
  id: 'openai',
  label: 'OpenAI',
  defaultBaseUrl: 'https://api.openai.com/v1',
  defaultModel: 'gpt-4o',
  freeModels: [
    { id: 'gpt-4o', label: 'GPT-4o', provider: 'openai', free: false, supports_tools: true },
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini', provider: 'openai', free: false, supports_tools: true },
    { id: 'o1-preview', label: 'o1 Preview', provider: 'openai', free: false, supports_tools: false },
    { id: 'o1-mini', label: 'o1 Mini', provider: 'openai', free: false, supports_tools: false },
    { id: 'o3-mini', label: 'o3 Mini', provider: 'openai', free: false, supports_tools: false },
    { id: 'gpt-4-turbo', label: 'GPT-4 Turbo', provider: 'openai', free: false, supports_tools: true }
  ],
  homepage: 'https://platform.openai.com',
  requiresApiKey: true,
});

