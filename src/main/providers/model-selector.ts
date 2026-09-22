// Model selector — always picks free models first.
// Notifies the user when paid models are required.

import { providerRegistry } from './registry.js';
import type { ModelInfo } from '../../shared/types.js';

export interface ModelSelection {
  provider: string;
  model: string;
  free: boolean;
  reason: string;
}

// Priority order: free models that support tools, then free without tools, then paid
// nvidia first: free-tier NIM with tool support; ollama keyless local next.
const FREE_PROVIDER_PRIORITY = ['nvidia', 'ollama', 'opencode', 'freebuff', 'openrouter', 'groq', 'apinex', 'bluesminds', 'cloudflare', 'custom'];

export function selectBestModel(
  taskType: 'code' | 'research' | 'design' | 'data' | 'seo' | 'general',
  availableProviders: Map<string, { apiKey?: string; baseUrl?: string }>,
): ModelSelection {
  // 1. Try free models from providers we have keys for (or that don't need keys)
  for (const providerId of FREE_PROVIDER_PRIORITY) {
    const adapter = providerRegistry[providerId];
    if (!adapter) continue;

    const config = availableProviders.get(providerId);
    const needsKey = adapter.requiresApiKey && !config?.apiKey;
    if (needsKey) continue;

    // Find free models that support tools
    const freeToolModels = adapter.freeModels.filter((m: ModelInfo) => m.free && m.supports_tools);
    if (freeToolModels.length > 0) {
      const model = pickForTask(taskType, freeToolModels);
      return {
        provider: providerId,
        model: model.id,
        free: true,
        reason: `Using free model ${model.label} from ${adapter.label}`,
      };
    }

    // Free models without tool support (still useful for simple tasks)
    const freeModels = adapter.freeModels.filter((m: ModelInfo) => m.free);
    if (freeModels.length > 0 && taskType === 'general') {
      const model = freeModels[0];
      return {
        provider: providerId,
        model: model.id,
        free: true,
        reason: `Using free model ${model.label} from ${adapter.label}`,
      };
    }
  }

  // 2. Check Ollama (always free, local)
  const ollama = providerRegistry.ollama;
  if (ollama?.defaultModel) {
    return {
      provider: 'ollama',
      model: ollama.defaultModel,
      free: true,
      reason: `Using local Ollama model ${ollama.defaultModel} (always free)`,
    };
  }

  // 3. Fallback to first available free model from any provider
  for (const [id, adapter] of Object.entries(providerRegistry)) {
    const config = availableProviders.get(id);
    const needsKey = adapter.requiresApiKey && !config?.apiKey;
    if (needsKey) continue;

    const freeModels = adapter.freeModels.filter((m: ModelInfo) => m.free);
    if (freeModels.length > 0) {
      return {
        provider: id,
        model: freeModels[0].id,
        free: true,
        reason: `Using free model ${freeModels[0].label} from ${adapter.label}`,
      };
    }
  }

  // 4. No free models available — use OpenRouter default (paid)
  return {
    provider: 'openrouter',
    model: 'google/gemma-4-31b-it:free',
    free: false,
    reason: 'No free models available. Using paid model. Consider adding a free provider API key.',
  };
}

function pickForTask(taskType: string, models: ModelInfo[]): ModelInfo {
  // Prefer code-specialized models for code tasks
  if (taskType === 'code' || taskType === 'data') {
    const codeModel = models.find((m: ModelInfo) => m.id.includes('coder') || m.id.includes('deepseek'));
    if (codeModel) return codeModel;
  }

  // Prefer larger models for complex tasks
  if (taskType === 'design' || taskType === 'seo') {
    const large = models.find((m: ModelInfo) => m.id.includes('72b') || m.id.includes('70b'));
    if (large) return large;
  }

  // Default: first model (usually the best free one)
  return models[0];
}

// Check if a model is free
export function isModelFree(provider: string, model: string): boolean {
  const adapter = providerRegistry[provider];
  if (!adapter) return false;
  return adapter.freeModels.some((m: ModelInfo) => m.id === model && m.free);
}

// Get all free models across all providers
export function getAllFreeModels(): Array<{ provider: string; model: ModelInfo }> {
  const result: Array<{ provider: string; model: ModelInfo }> = [];
  for (const [id, adapter] of Object.entries(providerRegistry)) {
    for (const m of adapter.freeModels) {
      if (m.free) result.push({ provider: id, model: m });
    }
  }
  return result;
}

// Notify user about model selection (for UI display)
export function getModelNotification(selection: ModelSelection): string | null {
  if (selection.free) return null;
  return `Using paid model: ${selection.model} (${selection.provider}). ${selection.reason}`;
}

