// Base adapter for any OpenAI-compatible API (OpenRouter, Groq, Ollama, Mistral, custom).
// Most providers expose the /v1/chat/completions SSE format.

import type { ProviderAdapter, ChatRequest, StreamChunk, ToolSpec } from './base.js';
import type { ModelInfo, Message } from '../../shared/types.js';

const TIMEOUT_RETRY_ATTEMPTS = 1;

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
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) return opts.freeModels;
        const raw = (await res.json()) as { data?: unknown[] };
        const list = Array.isArray(raw?.data) ? raw.data : [];
        if (list.length === 0) return opts.freeModels;
        const models = list
          .map((entry) => normalizeModel(entry, opts))
          .filter((m): m is ModelInfo => m !== null)
          .sort((a, b) => {
            if (a.free !== b.free) return a.free ? -1 : 1;
            return a.label.localeCompare(b.label);
          });
        return models.length ? models : opts.freeModels;
      } catch {
        return opts.freeModels;
      }
    },

    async *streamChat(req: ChatRequest, apiKey: string, baseUrl?: string): AsyncIterable<StreamChunk> {
      const url = `${baseUrl ?? opts.defaultBaseUrl}/chat/completions`;
      const maxRetries = 2;
      let disableToolsForRetry = false;
      let activeModel = req.model;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) {
          const delay = Math.min(500 * attempt, 1500);
          console.log(`[provider:${opts.id}] Retrying in ${delay / 1000}s (attempt ${attempt + 1}/${maxRetries + 1})...`);
          await new Promise(r => setTimeout(r, delay));
        }

        const body = {
          model: activeModel,
          messages: toOpenAIMessages(req.messages, req.system),
          max_tokens: req.max_tokens ?? 4096,
          temperature: req.temperature ?? 0.7,
          stream: true,
          tools: !disableToolsForRetry && req.tools?.length ? req.tools.map(toOpenAITool) : undefined,
        };

        console.log(`[provider:${opts.id}] POST ${url} model=${activeModel} messages=${body.messages.length} tools=${body.tools?.length ?? 0}`);

        // Tell the UI we're about to hit the network so the user gets feedback
        // immediately, before any DNS / TCP / TLS handshakes have even started.
        yield { type: 'provider_status', status: 'connecting', provider: opts.id, model: activeModel };

        // Do not impose a whole-response timeout here. Long reasoning and
        // build tasks may legitimately exceed 30 minutes. The agent loop owns
        // cancellation and recovery, while explicit user cancellation still
        // propagates through req.signal.
        const combinedSignal = req.signal;

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
        } catch (e: unknown) {
          const error = e instanceof Error ? e : new Error(String(e));
          if (error.name === 'AbortError') {
            if (!req.signal?.aborted && attempt < TIMEOUT_RETRY_ATTEMPTS) {
              console.warn(
                `[provider:${opts.id}] Connection timed out; retrying (attempt ${attempt + 2}/${maxRetries + 1})...`,
              );
              await new Promise((r) => setTimeout(r, 500));
              continue;
            }
            const errorMsg = req.signal?.aborted ? 'Request cancelled' : 'The provider connection was aborted.';
            console.error(`[provider:${opts.id}] ${errorMsg}`);
            yield { type: 'error', error: errorMsg };
          } else {
            console.error(`[provider:${opts.id}] Fetch error: ${error.message}`);
            yield { type: 'error', error: `Network error: ${error.message}` };
          }
          return;
        }
        // Rate limits are commonly account/provider-wide. Hand control back to
        // the recovery router immediately so it can switch providers instead
        // of making the user wait through repeated calls that cannot succeed.
        if (res.status === 429) {
          const errText = await res.text().catch(() => '');
          yield { type: 'provider_status', status: 'rate_limited', provider: opts.id, model: activeModel };
          yield { type: 'error', error: `API error (429): ${errText.slice(0, 200) || 'Rate limit reached'}` };
          return;
        }

        if (!res.ok || !res.body) {
          const errText = await res.text().catch(() => 'no body');
          console.error(`[provider:${opts.id}] HTTP ${res.status}: ${errText}`);
          if (body.tools?.length && isDegradedFunctionError(errText) && attempt < maxRetries) {
            console.warn(`[provider:${opts.id}] Tool/function calling is degraded; retrying without tools.`);
            disableToolsForRetry = true;
            continue;
          }
          if (res.status >= 500 && attempt < maxRetries) {
            console.warn(`[provider:${opts.id}] HTTP ${res.status} server error, retrying shortly...`);
            await new Promise((r) => setTimeout(r, 500));
            continue;
          }
          if (opts.id === 'openrouter' && res.status === 402 && isInsufficientCreditsError(errText) && attempt < maxRetries) {
            const freeModel = opts.freeModels.find((model) => model.free)?.id;
            if (freeModel && freeModel !== activeModel) {
              console.warn(`[provider:${opts.id}] Insufficient credits for ${activeModel}; retrying with free model ${freeModel}.`);
              activeModel = freeModel;
              continue;
            }
          }
          yield { type: 'error', error: `API error (${res.status}): ${res.status === 429 ? 'Rate limited — try again shortly or switch model' : errText.slice(0, 200)}` };
          return;
        }

        // Emit a status chunk immediately so the UI can replace the static
        // "Thinking…" copy with something specific to this provider/model.
        yield { type: 'provider_status', status: 'streaming', model: activeModel, provider: opts.id };

        console.log(`[provider:${opts.id}] Response OK, reading stream...`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const toolCalls = new Map<string, { name: string; json: string }>();
        // OpenAI-compatible streams send the tool-call `id` only in the first
        // delta chunk of each call; every later chunk carries just `index`.
        // Keying by `id` alone splits one call into two records (name + empty
        // args, then args + empty name), producing exactly the malformed tool
        // calls seen as `Bash {}` and "empty tool name" errors. Key by the
        // stable `index` and remember the id it belongs to.
        const callIdByIndex = new Map<number, string>();
        let fallbackCallIndex = 0;
        const callKeyFor = (toolCall: { id?: string; index?: number }): string => {
          if (typeof toolCall.index === 'number') {
            if (toolCall.id) {
              callIdByIndex.set(toolCall.index, toolCall.id);
              return toolCall.id;
            }
            const known = callIdByIndex.get(toolCall.index);
            if (known) return known;
            const id = `call-${toolCall.index}`;
            callIdByIndex.set(toolCall.index, id);
            return id;
          }
          if (toolCall.id) return toolCall.id;
          return `call-${fallbackCallIndex++}`;
        };
        let emittedMessageEnd = false;

        const flushToolCalls = function* (): Generator<StreamChunk> {
          for (const [id, call] of toolCalls) {
            try {
              yield { type: 'tool_use_end', id, name: call.name, input: JSON.parse(call.json) };
            } catch {
              yield { type: 'tool_use_end', id, name: call.name, input: {} };
            }
          }
          toolCalls.clear();
        };

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
            if (payload === '[DONE]') {
              yield* flushToolCalls();
              if (!emittedMessageEnd) {
                emittedMessageEnd = true;
                yield { type: 'message_end', stop_reason: 'end_turn', usage: { input: 0, output: 0 } };
              }
              return;
            }
            try {
              const obj = JSON.parse(payload);
              const choice = obj.choices?.[0];
              const delta = choice?.delta ?? {};
              if (delta.content) {
                yield { type: 'text_delta', text: delta.content };
              }
              if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const toolCallId = callKeyFor(tc);
                  const existing = toolCalls.get(toolCallId);
                  if (!existing) {
                    toolCalls.set(toolCallId, { name: tc.function?.name ?? '', json: '' });
                    yield { type: 'tool_use_start', id: toolCallId, name: tc.function?.name ?? '' };
                  } else if (tc.function?.name) {
                    existing.name = tc.function.name;
                  }
                  if (tc.function?.arguments) {
                    toolCalls.get(toolCallId)!.json += tc.function.arguments;
                    yield { type: 'tool_use_delta', id: toolCallId, partial_json: tc.function.arguments };
                  }
                }
              }
              if (choice?.finish_reason) {
                yield* flushToolCalls();
                emittedMessageEnd = true;
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
        return; // Successfully completed
      }
    },
  };
}

function isDegradedFunctionError(text: string): boolean {
  return /\bDEGRADED\b/i.test(text) && /\bfunction\b/i.test(text);
}

interface RawModel {
  id?: string;
  name?: string;
  context_length?: number;
  pricing?: {
    prompt?: string | number;
    completion?: string | number;
    input?: string | number;
    output?: string | number;
  };
}

// Convert a provider's raw /models entry into our ModelInfo, categorizing
// free vs paid from pricing data (OpenRouter) or free-tier platforms.
function normalizeModel(entry: unknown, opts: Opts): ModelInfo | null {
  const e = entry as RawModel;
  if (!e?.id) return null;
  const id = e.id;
  const known = opts.freeModels.find((fm) => fm.id === id);
  let free = known?.free ?? false;

  if (!free) {
    if (e.pricing) {
      const prompt = Number(e.pricing.prompt ?? e.pricing.input ?? 0);
      const completion = Number(e.pricing.completion ?? e.pricing.output ?? 0);
      free = prompt === 0 && completion === 0;
    } else if (opts.id === 'nvidia' || opts.id === 'groq') {
      // NVIDIA NIM and Groq expose no pricing — their catalog is free-tier.
      free = true;
    }
  }

  const supportsTools = known?.supports_tools;
  return {
    id,
    label: e.name || id,
    provider: opts.id,
    free,
    ...(e.context_length ? { context_window: e.context_length } : {}),
    ...(supportsTools !== undefined ? { supports_tools: supportsTools } : {}),
  };
}

function isInsufficientCreditsError(text: string): boolean {
  return /\binsufficient\s+credits\b/i.test(text) || /\bnever\s+purchased\s+credits\b/i.test(text);
}

interface OpenAIContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | OpenAIContentPart[] | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

function toOpenAIMessages(messages: Message[], system?: string): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  if (system) out.push({ role: 'system', content: system });

  for (const m of messages) {
    if (m.role === 'user') {
      const hasToolResult = m.content.some((b) => b.type === 'tool_result');
      if (hasToolResult) {
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
        const textParts = m.content.filter((b) => b.type === 'text').map((b) => b.type === 'text' ? b.text : '').join('\n');
        const images = m.content.filter((b) => b.type === 'image');
        if (images.length > 0) {
          const parts: OpenAIContentPart[] = [];
          if (textParts.trim()) parts.push({ type: 'text', text: textParts });
          for (const image of images) {
            if (image.type === 'image') {
              parts.push({
                type: 'image_url',
                image_url: { url: `data:${image.source.mediaType};base64,${image.source.data}` },
              });
            }
          }
          out.push({ role: 'user', content: parts });
        } else {
          out.push({ role: 'user', content: textParts });
        }
      }
    } else if (m.role === 'assistant') {
      const textParts = m.content.filter((b) => b.type === 'text').map((b) => b.type === 'text' ? b.text : '').join('\n');
      const toolUses = m.content.filter((b) => b.type === 'tool_use');
      const msg: OpenAIMessage = { role: 'assistant', content: textParts || null };
      
      if (toolUses.length > 0) {
        msg.tool_calls = toolUses.map((tu) => ({
          id: tu.type === 'tool_use' ? tu.id : '',
          type: 'function' as const,
          function: {
            name: tu.type === 'tool_use' ? tu.name : '',
            arguments: tu.type === 'tool_use' ? (typeof tu.input === 'string' ? tu.input : JSON.stringify(tu.input)) : '{}',
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

