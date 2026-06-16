// Base adapter for any OpenAI-compatible API (OpenRouter, Groq, Ollama, Mistral, custom).
// Most providers expose the /v1/chat/completions SSE format.

import type { ProviderAdapter, ChatRequest, StreamChunk, ToolSpec } from './base.js';
import type { ModelInfo, Message } from '../../shared/types.js';

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

      console.log(`[provider:${opts.id}] POST ${url} model=${req.model} messages=${body.messages.length} tools=${body.tools?.length ?? 0}`);

      // Create a timeout controller (30 seconds)
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => timeoutController.abort(), 30000);
      
      // Combine with user's abort signal
      const combinedSignal = req.signal 
        ? AbortSignal.any([req.signal, timeoutController.signal])
        : timeoutController.signal;

      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify(body),
          signal: combinedSignal,
        });
      } catch (e: any) {
        clearTimeout(timeoutId);
        if (e.name === 'AbortError') {
          const errorMsg = timeoutController.signal.aborted 
            ? `Connection timeout after 30s — check your internet connection and API key`
            : 'Request cancelled';
          console.error(`[provider:${opts.id}] ${errorMsg}`);
          yield { type: 'error', error: errorMsg };
        } else {
          console.error(`[provider:${opts.id}] Fetch error: ${e.message}`);
          yield { type: 'error', error: `Network error: ${e.message}` };
        }
        return;
      }
      clearTimeout(timeoutId);

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => 'no body');
        console.error(`[provider:${opts.id}] HTTP ${res.status}: ${errText}`);
        yield { type: 'error', error: `HTTP ${res.status}: ${errText}` };
        return;
      }

      console.log(`[provider:${opts.id}] Response OK, reading stream...`);

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
              let lastToolCallId = '';
              for (const tc of delta.tool_calls) {
                const toolCallId = tc.id || lastToolCallId;
                if (tc.id) {
                  lastToolCallId = tc.id;
                  yield { type: 'tool_use_start', id: tc.id, name: tc.function.name };
                }
                if (tc.function?.arguments) {
                  yield { type: 'tool_use_delta', id: toolCallId, partial_json: tc.function.arguments };
                }
                if (tc.function?.name && tc.function?.arguments) {
                  try {
                    const args = JSON.parse(tc.function.arguments);
                    yield { type: 'tool_use_end', id: toolCallId, name: tc.function.name, input: args };
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

function toOpenAIMessages(messages: Message[], system?: string) {
  const out: any[] = [];
  if (system) out.push({ role: 'system', content: system });

  for (const m of messages) {
    if (m.role === 'user') {
      // In this app, tool_result blocks are pushed into a user message by the store.
      const hasToolResult = m.content.some((b) => b.type === 'tool_result');
      if (hasToolResult) {
        // OpenAI wants tool results as separate messages with role: 'tool'
        for (const b of m.content) {
          if (b.type === 'tool_result') {
            out.push({
              role: 'tool',
              tool_call_id: b.tool_use_id,
              content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content),
            });
          } else if (b.type === 'text') {
            out.push({ role: 'user', content: b.text });
          }
        }
      } else {
        const textParts = m.content.filter(b => b.type === 'text').map((b: any) => b.text).join('\n');
        out.push({ role: 'user', content: textParts });
      }
    } else if (m.role === 'assistant') {
      const textParts = m.content.filter((b) => b.type === 'text').map((b: any) => b.text).join('\n');
      const toolUses = m.content.filter((b) => b.type === 'tool_use');
      const msg: any = { role: 'assistant', content: textParts || null };
      
      if (toolUses.length > 0) {
        msg.tool_calls = toolUses.map((tu: any) => ({
          id: tu.id,
          type: 'function',
          function: {
            name: tu.name,
            arguments: typeof tu.input === 'string' ? tu.input : JSON.stringify(tu.input),
          },
        }));
      }
      out.push(msg);
    }
  }

  return out;
}

function toOpenAITool(t: ToolSpec) {
  return { type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } };
}
