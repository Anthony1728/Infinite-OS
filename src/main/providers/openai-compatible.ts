// Base adapter for any OpenAI-compatible API (OpenRouter, Groq, Ollama, Mistral, custom).
// Most providers expose the /v1/chat/completions SSE format.

import type { ProviderAdapter, ChatRequest, StreamChunk, ToolSpec } from './base.js';
import type { ModelInfo } from '../../shared/types.js';

interface Opts {
  id: string;
  label: string;
  defaultBaseUrl: string;
  defaultModel: string;
  freeModels: ModelInfo[];
  requiresApiKey?: boolean;
  homepage?: string;
}

export function openaiCompatible(opts: Opts): ProviderAdapter {
  return {
    id: opts.id,
    label: opts.label,
    requiresApiKey: opts.requiresApiKey ?? true,
    defaultBaseUrl: opts.defaultBaseUrl,
    defaultModel: opts.defaultModel,
    freeModels: opts.freeModels,
    homepage: opts.homepage,

    async testConnection(apiKey, baseUrl) {
      try {
        const url = `${baseUrl ?? opts.defaultBaseUrl}/models`;
        const res = await fetch(url, {
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        });
        return { ok: res.ok, error: res.ok ? undefined : `HTTP ${res.status}` };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },

    async listModels(apiKey, baseUrl) {
      const url = `${baseUrl ?? opts.defaultBaseUrl}/models`;
      try {
        const res = await fetch(url, {
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        });
        if (!res.ok) return opts.freeModels;
        const data = (await res.json()) as { data: Array<{ id: string }> };
        return data.data.map((m) => ({
          id: m.id,
          label: m.id,
          provider: opts.id,
          free: opts.freeModels.some((fm) => fm.id === m.id),
        }));
      } catch {
        return opts.freeModels;
      }
    },

    async *streamChat(req: ChatRequest, apiKey: string, baseUrl?: string): AsyncIterable<StreamChunk> {
      const url = `${baseUrl ?? opts.defaultBaseUrl}/chat/completions`;
      const body = {
        model: req.model,
        messages: toOpenAIMessages(req.messages, req.system),
        max_tokens: req.max_tokens ?? 4096,
        temperature: req.temperature ?? 0.7,
        stream: true,
        tools: req.tools?.length ? req.tools.map(toOpenAITool) : undefined,
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: req.signal,
      });

      if (!res.ok || !res.body) {
        yield { type: 'error', error: `HTTP ${res.status}: ${await res.text()}` };
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
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') return;
          try {
            const obj = JSON.parse(payload);
            const choice = obj.choices?.[0];
            const delta = choice?.delta ?? {};
            if (delta.content) {
              yield { type: 'text_delta', text: delta.content };
            }
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (tc.id) yield { type: 'tool_use_start', id: tc.id, name: tc.function.name };
                if (tc.function?.arguments) {
                  yield { type: 'tool_use_delta', id: tc.id, partial_json: tc.function.arguments };
                }
                if (tc.function?.name && tc.function?.arguments) {
                  try {
                    const args = JSON.parse(tc.function.arguments);
                    yield { type: 'tool_use_end', id: tc.id, name: tc.function.name, input: args };
                  } catch { /* still streaming */ }
                }
              }
            }
            if (choice?.finish_reason) {
              yield {
                type: 'message_end',
                stop_reason: choice.finish_reason,
                usage: obj.usage ?? { input: 0, output: 0 },
              };
            }
          } catch {
            // skip malformed line
          }
        }
      }
    },
  };
}

function toOpenAIMessages(_messages: unknown, system?: string) {
  const out: unknown[] = [];
  if (system) out.push({ role: 'system', content: system });
  return out;
}

function toOpenAITool(t: ToolSpec) {
  return { type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } };
}
