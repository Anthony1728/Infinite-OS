// Provider registry — resolves the adapter for a (provider, model) pair,
// looks up the API key from encrypted secrets, and exposes a single chat() helper.

import type { ProviderAdapter } from './base.js';
import { openaiCompatible } from './openai-compatible.js';
import { anthropic } from './anthropic.js';
import { gemini } from './gemini.js';
import { openai } from './openai.js';
import { opencode } from './opencode.js';
import { cloudflare } from './cloudflare.js';
import { custom } from './custom.js';
import { freebuff } from './freebuff.js';
import type { Message } from '../../shared/types.js';
import { OLLAMA_URL, budgetForModel, getInstalledModels, isModelComfortable, isOllamaReachable, resolveOllamaModel } from '../ollama/utils.js';

/**
 * Cap on how much streamed reasoning is kept for display.
 *
 * Reasoning is shown to the user and stored, but there is no value in keeping
 * 200k characters of a model talking itself in circles: it bloats the
 * transcript, and on a CPU machine that transcript is replayed on every turn.
 */
const MAX_THINKING_CHARS = 24_000;

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
    // Deliberately does NOT try to start Ollama. Launching a server as a side
    // effect of pressing "Test" is surprising, and this used to block the
    // settings dialog for up to 10 seconds while polling for a launch that was
    // almost never the thing the user wanted.
    if (!(await isOllamaReachable())) {
      return {
        ok: false,
        error:
          'Ollama is not running. Open the Ollama app (it lives in the tray), then test again. Cloud models work without it.',
      };
    }
    const installed = await getInstalledModels(true);
    if (installed.length === 0) {
      return { ok: false, error: 'Ollama is running, but no models are installed. Run: ollama pull qwen3:1.7b' };
    }
    return { ok: true };
  },

  async listModels() {
    // No auto-start and no blocking probe: listing models must answer "it is not
    // running" in milliseconds, not hang the picker for 10 seconds.
    const installed = await getInstalledModels();
    const budget = budgetForModel();
    return installed.map((m) => ({
      id: m.name,
      label: m.name.replace(':latest', ''),
      provider: 'ollama',
      free: true,
      // Matches what the adapter actually requests, so the UI never advertises
      // more context than the model will get.
      context_window: budget.numCtx,
      supports_tools: m.supportsTools,
      supports_thinking: m.supportsThinking,
      // Flagged rather than hidden: a 27b model on a CPU-only laptop is not
      // unusable by accident, it is just extraordinarily slow, and a warning
      // beats a model quietly disappearing from a list.
      warning: isModelComfortable(m.name) ? undefined : 'Large for this machine - expect it to be slow.',
    }));
  },

  async *streamChat(req) {
    // Fail fast and legibly rather than hanging: if Ollama is not up, say so in
    // one line instead of silently polling for a launch nobody asked for.
    if (!(await isOllamaReachable())) {
      yield {
        type: 'error',
        error:
          'Ollama is not running, so the local model cannot answer. Open the Ollama app, or pick a cloud model in Settings then Provider.',
      };
      return;
    }

    // Cached, so this is not a wasted round trip on every single turn.
    const installed = await getInstalledModels();
    // Never send a stale model name to Ollama (404 = silent dead chat).
    const model = resolveOllamaModel(
      req.model,
      installed.map((m) => m.name),
    );

    // Every number below comes from the measured machine profile, not a guess.
    const budget = budgetForModel();

    // `max_tokens` from the agent can be far larger than a CPU machine can
    // produce in a usable time, so it is capped. A truncated answer arrives; an
    // answer that takes ten minutes does not.
    const requested = Number(req.max_tokens ?? 0);
    const numPredict =
      Number.isFinite(requested) && requested > 0
        ? Math.min(requested, budget.numPredict)
        : budget.numPredict;

    // Reasoning gets a HARD share of the budget, and the answer keeps the rest.
    //
    // Measured on the dev machine (i5-4210U, CPU only), qwen3:1.7b on
    // "What is 17*23? Answer with just the number.":
    //
    //   num_predict 400  ->  41 s, thinking 1165 chars, content EMPTY
    //   num_predict 512  ->  53 s, thinking 1308 chars, content EMPTY, eval_count 512
    //   num_predict 1200 -> 124 s, thinking 2179 chars, content "391"
    //
    // The key line is `eval_count 512` with empty content: Ollama has ONE
    // num_predict covering reasoning AND the answer, so a reasoning model will
    // happily spend all of it thinking and return nothing. There is no way to
    // express "100 for thinking, 400 for the answer" in a single request, which
    // is exactly why this used to send `think: false` and then delete whatever
    // reasoning leaked through - showing thinking was impossible without the UI
    // hanging on an empty answer.
    //
    // So the thinking request is given its own small budget and the answer is
    // fetched separately with the reasoning in context. See streamWithThinking.
    const modelMeta = installed.find((m) => m.name === model);
    const wantsThinking = req.thinking === true && modelMeta?.supportsThinking === true;
    // Reasoning budget in TOKENS, kept small on purpose: on a CPU machine every
    // one of these is real seconds, and the point is to show the shape of the
    // reasoning, not to let the model deliberate indefinitely.
    const thinkingTokens = wantsThinking
      ? Math.max(48, Math.min(req.thinkingBudget ?? Math.floor(numPredict * budget.thinkingFraction), Math.floor(numPredict * 0.4)))
      : 0;

    const ollamaMessages = toOllamaMessages(req.messages, req.system);
    const tools = req.tools?.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      },
    }));

    /**
     * The generation options every request uses.
     *
     * `num_predict` is what differs between the two passes: the reasoning pass
     * gets a small slice of it, the answer pass gets the rest. That split is the
     * whole reason thinking can be shown at all on a machine this slow.
     */
    const baseOptions = (predict: number) => ({
      temperature: req.temperature ?? 0.2,
      num_ctx: budget.numCtx,
      num_predict: predict,
      // Physical cores rather than logical threads: SMT rarely helps a GEMM, and
      // oversubscribing a 2-core machine makes it slower.
      num_thread: budget.numThread,
      repeat_penalty: 1.05,
    });

    /**
     * Pass 1: reasoning only, on a short leash.
     *
     * Returns the reasoning text, or '' if the model declined to think. Never
     * throws and never blocks the answer — if this pass fails the turn simply
     * proceeds without thinking, which is the behaviour we had before.
     */
    const collectThinking = async (): Promise<string> => {
      let text = '';
      try {
        const res = await fetch(`${OLLAMA_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: ollamaMessages,
            stream: true,
            // No tools here on purpose: a tool call during the reasoning pass
            // would be a half-formed action, and the answer pass is what decides.
            think: true,
            keep_alive: budget.keepAlive,
            options: baseOptions(thinkingTokens),
          }),
          signal: req.signal,
        });
        if (!res.ok || !res.body) return '';
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finished = false;
        while (!finished) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line) as { message?: { thinking?: string }; done?: boolean };
              const thought = parsed.message?.thinking;
              if (thought) {
                text += thought;
                // Hard ceiling in characters as well, in case a server ignores
                // num_predict. ~4 characters per token.
                if (text.length >= thinkingTokens * 4) {
                  await reader.cancel().catch(() => undefined);
                  return text.slice(0, MAX_THINKING_CHARS);
                }
              }
              if (parsed.done) return text.slice(0, MAX_THINKING_CHARS);
            } catch {
              /* skip malformed */
            }
          }
          // The stream closed without a `done` frame; stop rather than spin.
          if (!value) finished = true;
        }
      } catch {
        // Reasoning is a bonus. If it cannot be fetched, answer without it.
        return '';
      }
      return text.slice(0, MAX_THINKING_CHARS);
    };

    // Reasoning first, so the user sees it stream in before the answer starts.
    // This is what makes a slow local turn legible instead of a frozen bubble.
    let reasoning = '';
    if (wantsThinking) {
      yield {
        type: 'provider_status',
        status: 'streaming',
        provider: 'ollama',
        model,
        reason: 'Letting the local model think first.',
      };
      reasoning = await collectThinking();
      if (reasoning) yield { type: 'thinking_delta', text: reasoning };
    }

    // Pass 2: the answer, with the reasoning supplied as a draft note.
    //
    // The shape of this message was measured, not guessed. Given the reasoning as
    // an ASSISTANT message the model simply continues it — 22-31s and no answer.
    // Given it in a system message, same thing. Framing it as a note inside a
    // follow-up USER turn and asking for the final answer is what works: 5-7s and
    // the correct result.
    const answerMessages = reasoning
      ? [
          ...ollamaMessages,
          {
            role: 'user' as const,
            content: `Draft reasoning (may be incomplete):\n---\n${reasoning}\n---\n\nNow give the final answer only.`,
          },
        ]
      : ollamaMessages;

    try {
      const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: answerMessages,
          tools: tools?.length ? tools : undefined,
          // Reasoning is NEVER requested on the answer pass. It was already
          // gathered deliberately in pass 1; asking again here would let the
          // model spend the answer budget thinking all over again, which is the
          // exact failure this two-pass split exists to prevent.
          think: false,
          // Was a flat 30 minutes, on every turn, forever. That pinned 1.5-2.5 GB
          // of the user's RAM long after they stopped chatting, which is a large
          // part of why local models made the whole machine feel slow. Now it
          // follows the machine tier: 5 minutes on a low-end box, so the memory
          // goes back to the OS.
          keep_alive: budget.keepAlive,
          options: baseOptions(numPredict),
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
      let sawAnswer = false;
      let stopped = false;
      let lastHeartbeat = Date.now();

      // Even with think:false some builds of reasoning models leak the reasoning
      // channel into `content`. Those are split out into the thinking channel
      // rather than shown to the user as if they were the answer.
      const inlineThink = createThinkingStripper();

      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          let parsed: {
            message?: {
              content?: string;
              thinking?: string;
              tool_calls?: Array<{ function?: { name?: string; arguments?: Record<string, unknown> } }>;
            };
            done?: boolean;
            done_reason?: string;
            prompt_eval_count?: number;
            eval_count?: number;
          };
          try {
            parsed = JSON.parse(line);
          } catch {
            continue;
          }

          // A model can still leak reasoning into `thinking` even with think:false.
          // Route it to the thinking channel so it is never mistaken for the
          // answer, and so the user sees the reasoning rather than losing it.
          if (parsed.message?.thinking) {
            lastHeartbeat = Date.now();
            yield { type: 'thinking_delta', text: parsed.message.thinking };
          }

            if (parsed.message?.content) {
              const clean = inlineThink.push(parsed.message.content);
              if (clean && clean.trim()) {
              sawAnswer = true;
              lastHeartbeat = Date.now();
              yield { type: 'text_delta', text: clean };
            } else if (Date.now() - lastHeartbeat > 8000) {
              lastHeartbeat = Date.now();
              yield {
                type: 'provider_status',
                status: 'streaming',
                provider: 'ollama',
                model,
                reason: 'The local model is still thinking - the answer streams when it is ready.',
              };
            }
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
            // `length` with no answer means the budget ran out before the model
            // got to the answer. Named explicitly so the UI can say what happened
            // rather than showing an empty bubble.
            const starved = parsed.done_reason === 'length' && !sawAnswer;
            stopped = true;
            yield {
              type: 'message_end',
              stop_reason: parsed.message?.tool_calls?.length ? 'tool_use' : starved ? 'max_tokens' : 'end_turn',
              usage: { input: parsed.prompt_eval_count ?? 0, output: parsed.eval_count ?? 0 },
            };
            break;
          }
        }
      }
      const tail = inlineThink.flush();
      if (tail && tail.trim()) yield { type: 'text_delta', text: tail.trimStart() };
      // A stream that ended without a `done` frame still has to close the turn,
      // or the UI waits forever for a message_end that never arrives.
      if (!stopped) {
        yield { type: 'message_end', stop_reason: 'end_turn', usage: { input: 0, output: 0 } };
      }
    } catch (e) {
      // An abort is the user stopping the run, not a failure worth reporting.
      if (req.signal?.aborted) return;
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

// Exported so the "reasoning is not replayed to the model" rule can be pinned by
// a test — it is a property that is easy to break by adding another block type.
export function toOllamaMessages(messages: Message[], system?: string): OllamaMessage[] {
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
  apinex: openaiCompatible({
    id: 'apinex',
    label: 'APInex',
    defaultBaseUrl: 'https://api.apinex.bond/v1',
    defaultModel: 'free/muse-spark-1.3',
    freeModels: [
      { id: 'free/muse-spark-1.3', label: 'Muse Spark 1.3 (free)', provider: 'apinex', free: true, supports_tools: true },
      { id: 'free/gemini-3.8-flash', label: 'Gemini 3.8 Flash (free)', provider: 'apinex', free: true, supports_tools: true },
      { id: 'free/glm-5.3-flash', label: 'GLM 5.3 Flash (free)', provider: 'apinex', free: true, supports_tools: true },
      { id: 'free/gemini-3.1-pro', label: 'Gemini 3.1 Pro (free)', provider: 'apinex', free: true, supports_tools: true },
      { id: 'free/deepseek-v4-pro-0813', label: 'DeepSeek V4 Pro (free)', provider: 'apinex', free: true, supports_tools: true },
      { id: 'free/gpt-5.6-luna', label: 'GPT 5.6 Luna (free)', provider: 'apinex', free: true, supports_tools: true },
      { id: 'free/qwen-3.8-max', label: 'Qwen 3.8 Max (free)', provider: 'apinex', free: true, supports_tools: true },
      { id: 'free/deepseek-v4-flash-0731', label: 'DeepSeek V4 Flash (free)', provider: 'apinex', free: true, supports_tools: true },
      { id: 'free/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash (free)', provider: 'apinex', free: true, supports_tools: true },
    ],
    homepage: 'https://apinex.bond',
    gatewayCatalog: true,
    // APInex marks included models `free/…` — only those get the Free badge.
    // Paid ids still list (selectable) without it.
    freePattern: /^free\//,
  }),
  cloudflare,
  custom,
  bluesminds: openaiCompatible({
    id: 'bluesminds',
    label: 'BlueSminds',
    defaultBaseUrl: 'https://api.bluesminds.com/v1',
    defaultModel: 'gpt-4o',
    // Authoritative ids + capabilities from the BlueSminds API docs model
    // table (doc.bluesminds.com). `default` group works on the free plan;
    // `vip` needs a paid plan and 404s otherwise — labelled VIP so the pane
    // never promises a model the key cannot use.
    freeModels: [
      { id: 'gpt-4o', label: 'GPT-4o', provider: 'bluesminds', free: true, supports_tools: true },
      { id: 'gpt-4.1', label: 'GPT-4.1', provider: 'bluesminds', free: true, supports_tools: false },
      { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', provider: 'bluesminds', free: true, supports_tools: true },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'bluesminds', free: true, supports_tools: true },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', provider: 'bluesminds', free: true, supports_tools: false },
      { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner', provider: 'bluesminds', free: true, supports_tools: true },
      { id: 'gpt-5.1', label: 'GPT-5.1 (VIP)', provider: 'bluesminds', free: false, supports_tools: true },
      { id: 'claude-opus-4-5', label: 'Claude Opus 4.5 (VIP)', provider: 'bluesminds', free: false, supports_tools: true },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (VIP)', provider: 'bluesminds', free: false, supports_tools: false },
      { id: 'grok-3', label: 'Grok 3 (VIP)', provider: 'bluesminds', free: false, supports_tools: true },
      { id: 'qwen-max', label: 'Qwen Max (VIP)', provider: 'bluesminds', free: false, supports_tools: true },
    ],
    homepage: 'https://api.bluesminds.com',
    gatewayCatalog: true,
  }),
  ollama: ollamaAdapter,
  opencode,
  // FreeBuff was fully implemented in ./freebuff.ts and referenced by the
  // failover order and the model selector, but never added here — so
  // getProvider('freebuff') returned undefined and the adapter was
  // unreachable dead code. Nothing in the app could ever select it.
  freebuff,
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
