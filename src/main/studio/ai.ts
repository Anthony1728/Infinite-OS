/**
 * Studio AI — one-shot writing actions for the document/sheet/deck editors.
 *
 * This deliberately does NOT open a chat session. The editor needs a bounded
 * transformation ("fix the grammar of this selection", "turn this brief into a
 * deck") with a predictable output shape, not an agent loop that can call
 * tools. Provider failover is reused so a dead primary still produces text.
 */

import { randomUUID } from 'node:crypto';
import type { Message } from '../../shared/types.js';
import type { StudioAiRequest, StudioAiResult } from '../../shared/studio.js';
import { settings } from '../settings/store.js';
import {
  buildProviderFailoverPlan,
  recordProviderFailure,
  recordProviderSuccess,
} from '../providers/failover.js';
import { getProvider } from '../providers/registry.js';

/** Long enough for a full deck outline, short enough that a dead key is not a hang. */
const PER_CANDIDATE_TIMEOUT_MS = 45_000;
const TOTAL_TIMEOUT_MS = 100_000;
const MAX_CANDIDATES = 4;

const ACTION_INSTRUCTIONS: Record<StudioAiRequest['action'], string> = {
  write: 'Write the requested piece from scratch.',
  continue: 'Continue the supplied text naturally from where it stops. Do not repeat what is already there.',
  rewrite: 'Rewrite the supplied text so it is clearer and stronger while preserving its meaning and facts.',
  grammar: 'Correct spelling, grammar, punctuation, and awkward phrasing. Preserve the author\'s voice, meaning, and formatting. Return the corrected text only.',
  summarize: 'Summarize the supplied text in a compact form that keeps the key facts.',
  shorten: 'Shorten the supplied text without losing important information.',
  expand: 'Expand the supplied text with useful detail, staying faithful to its facts.',
  formal: 'Rewrite the supplied text in a polished, professional register.',
  poem: 'Write a poem about the requested subject. Make it vivid and specific, not generic.',
  story: 'Write a short story from the requested premise. Show rather than explain; give it a real ending.',
  translate: 'Translate the supplied text. Preserve meaning, tone, and formatting.',
  sheet: 'Produce tabular data as RFC-4180 CSV. Put a header row first. No prose, no code fences.',
  deck: 'Produce a presentation outline as strict JSON: {"slides":[{"title":"…","body":"…","notes":"…"}]}. 6-10 slides, concise bodies. No prose, no code fences.',
  custom: 'Follow the instruction exactly.',
};

export function buildStudioPrompt(request: StudioAiRequest): { system: string; user: string } {
  const kind = request.kind === 'sheet' ? 'spreadsheet' : request.kind === 'slides' ? 'presentation' : 'document';
  const system = [
    'You are the writing engine inside Infinite OS Studio.',
    `The user is editing a ${kind}.`,
    'Return only the finished content. Never add a preamble, explanation, quotation marks, or markdown fences.',
    'Never invent citations or facts. If the request needs current facts you do not have, say so plainly inside the content.',
    ACTION_INSTRUCTIONS[request.action] ?? ACTION_INSTRUCTIONS.custom,
  ].join(' ');

  const parts: string[] = [];
  if (request.language) parts.push(`Target language: ${request.language}`);
  if (request.prompt.trim()) parts.push(`Instruction:\n${request.prompt.trim()}`);
  if (request.context?.trim()) parts.push(`Text to work on:\n${request.context.trim()}`);
  if (parts.length === 0) parts.push('Instruction:\nWrite something useful for this page.');
  return { system, user: parts.join('\n\n') };
}

/** Remove a wrapping code fence without touching legitimate inner backticks. */
export function unwrapModelText(raw: string): string {
  const text = raw.trim();
  const fenced = /^```[a-zA-Z0-9_-]*\s*\n?([\s\S]*?)\n?```$/.exec(text);
  return (fenced ? fenced[1] : text).trim();
}

function activeSelection(): { provider: string; model: string } {
  const provider = (settings.get<string>('provider') ?? 'ollama').trim() || 'ollama';
  const model = (settings.get<string>('model') ?? '').trim();
  if (model) return { provider, model };
  const adapter = getProvider(provider);
  return { provider, model: adapter?.defaultModel || adapter?.freeModels[0]?.id || 'qwen3:4b' };
}

export async function completeStudioText(request: StudioAiRequest): Promise<StudioAiResult> {
  const { system, user } = buildStudioPrompt(request);
  const selected = activeSelection();
  const plan = await buildProviderFailoverPlan(selected);
  if (!plan.length) {
    throw new Error('No AI model is connected. Open Settings → Providers and add a key or start Ollama.');
  }

  const started = Date.now();
  let lastError = 'The model produced no text.';
  const candidates = plan.slice(0, MAX_CANDIDATES);

  for (const candidate of candidates) {
    if (Date.now() - started > TOTAL_TIMEOUT_MS) break;
    const adapter = getProvider(candidate.provider);
    if (!adapter) continue;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PER_CANDIDATE_TIMEOUT_MS);
    timer.unref?.();
    const message: Message = {
      id: randomUUID(),
      role: 'user',
      timestamp: Date.now(),
      content: [{ type: 'text', text: user }],
    };

    try {
      let output = '';
      let failure = '';
      for await (const chunk of adapter.streamChat({
        model: candidate.model,
        messages: [message],
        system,
        max_tokens: request.kind === 'slides' ? 2_400 : 1_800,
        temperature: request.action === 'grammar' ? 0.1 : request.action === 'sheet' ? 0.2 : 0.7,
        stream: true,
        signal: controller.signal,
      }, candidate.apiKey)) {
        if (chunk.type === 'text_delta') output += chunk.text;
        else if (chunk.type === 'error') {
          failure = chunk.error;
          break;
        } else if (chunk.type === 'message_end') break;
      }
      const text = unwrapModelText(output);
      if (failure) {
        lastError = failure;
        recordProviderFailure(candidate, failure);
        continue;
      }
      if (!text) {
        lastError = `${candidate.label} returned an empty response.`;
        recordProviderFailure(candidate, lastError);
        continue;
      }
      recordProviderSuccess(candidate);
      return { text, provider: candidate.provider, model: candidate.model };
    } catch (error) {
      const raw = (error as Error)?.message ?? String(error);
      lastError = /abort|timed out/i.test(raw)
        ? `${candidate.label} timed out after ${Math.round(PER_CANDIDATE_TIMEOUT_MS / 1000)}s.`
        : raw;
      recordProviderFailure(candidate, lastError);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(lastError);
}
