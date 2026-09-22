// Auto-compaction — keeps long agent runs inside the model's context window
// without losing the task. When history approaches the budget, the oldest
// ~60% of turns are summarized into a structured handoff (task, decisions,
// files touched, open threads, next steps) and pinned at the top; recent turns
// stay verbatim. Claude Code ships this as "auto-compact"; here it works for
// every provider, including local models.
//
// Design constraints:
// - Tool-call integrity: a summary boundary never splits an assistant tool_use
//   from its tool_result — compaction cuts only at "safe points" (before a
//   user message that carries no tool_result blocks).
// - Failure-tolerant: if the summarizer call fails, fall back to the previous
//   behavior (plain truncation in buildContext) so a compaction outage can
//   never kill a run.
// - Deterministic core: the threshold/boundary math is pure and unit-tested.

import type { Message } from '../../shared/types.js';

/** Rough char→token ratio for mixed code/prose. Used for budget math only. */
const CHARS_PER_TOKEN = 4;
/** Keep this fraction of the budget as headroom for the new response. */
const RESPONSE_HEADROOM_RATIO = 0.25;
/** Compaction triggers when history would exceed this share of the budget. */
const COMPACTION_TRIGGER_RATIO = 0.75;
/** After compaction, history occupies at most this share of the budget. */
const POST_COMPACTION_TARGET_RATIO = 0.45;
/** Minimum turns kept verbatim after the boundary (never summarize the newest). */
const MIN_RECENT_TURNS = 8;

export interface CompactionStats {
  originalMessages: number;
  compactedMessages: number;
  summarizedTurns: number;
  originalChars: number;
  compactedChars: number;
}

export function estimateTokens(messages: Message[]): number {
  let chars = 0;
  for (const m of messages) {
    chars += 32; // per-message envelope
    for (const block of m.content) {
      if (block.type === 'text') chars += block.text.length;
      else if (block.type === 'tool_result') {
        chars += typeof block.content === 'string' ? block.content.length : JSON.stringify(block.content).length;
      } else if (block.type === 'tool_use') chars += JSON.stringify(block.input ?? {}).length + block.name.length;
      else if (block.type === 'image') chars += (block.source?.data?.length ?? 0);
      else if (block.type === 'file') chars += (block.data?.length ?? 0);
    }
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * A boundary index is "safe" when messages[0..index) can be summarized without
 * orphaning tool_use blocks: the message AT the boundary must not carry
 * tool_results for tool calls that live after it (impossible) and the last
 * summarized message must not end with an un-answered tool_use.
 */
export function findSafeBoundary(messages: Message[], candidateIndex: number): number {
  let index = Math.min(candidateIndex, messages.length);
  while (index > 0) {
    const msg = messages[index];
    // Walk back until the boundary sits right before a plain user turn.
    if (msg.role === 'user') {
      const hasToolResult = msg.content.some((b) => b.type === 'tool_result');
      if (!hasToolResult) return index;
    }
    // Boundary before a user message that opens with a text block is also fine
    // only if the previous message is not an unanswered tool_use.
    const prev = messages[index - 1];
    if (prev) {
      const prevHasToolUse = prev.content.some((b) => b.type === 'tool_use');
      const prevIsUserToolResults = prev.role === 'user' && prev.content.some((b) => b.type === 'tool_result');
      if (prevHasToolUse && !prevIsUserToolResults) {
        index--;
        continue;
      }
    }
    index--;
  }
  return 0;
}

export function shouldCompact(messages: Message[], contextTokenBudget: number): boolean {
  if (!Number.isFinite(contextTokenBudget) || contextTokenBudget <= 0) return false;
  const budget = contextTokenBudget * (1 - RESPONSE_HEADROOM_RATIO);
  return estimateTokens(messages) > budget * COMPACTION_TRIGGER_RATIO;
}

/**
 * Split history into (toSummarize, keptVerbatim) at a safe boundary chosen so
 * that kept turns ≈ target share of the budget, or the newest MIN_RECENT_TURNS,
 * whichever is larger.
 */
export function partitionForCompaction(messages: Message[], contextTokenBudget: number): {
  toSummarize: Message[];
  kept: Message[];
} {
  const targetKeptTokens = contextTokenBudget * POST_COMPACTION_TARGET_RATIO;
  // Walk from the end accumulating tokens until the target is reached.
  let acc = 0;
  let cutFromEnd = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    acc += estimateTokens([messages[i]]);
    cutFromEnd = messages.length - i;
    if (acc >= targetKeptTokens) break;
  }
  cutFromEnd = Math.max(cutFromEnd, MIN_RECENT_TURNS);
  const boundaryCandidate = Math.max(0, messages.length - cutFromEnd);
  const boundary = findSafeBoundary(messages, boundaryCandidate);
  return {
    toSummarize: messages.slice(0, boundary),
    kept: messages.slice(boundary),
  };
}

/** Structured summary format the summarizer prompt asks for. */
export function buildSummarizerPrompt(toSummarize: Message[], originalRequest: string): string {
  const transcript = toSummarize
    .map((m) => {
      const role = m.role === 'assistant' ? 'ASSISTANT' : m.role === 'user' ? 'USER/TOOL' : m.role.toUpperCase();
      const text = m.content
        .map((b) => {
          if (b.type === 'text') return b.text;
          if (b.type === 'tool_use') return `[tool_use: ${b.name} ${JSON.stringify(b.input).slice(0, 300)}]`;
          if (b.type === 'tool_result') {
            const content = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
            return `[tool_result${b.is_error ? ' ERROR' : ''}: ${content.slice(0, 400)}]`;
          }
          return `[${b.type}]`;
        })
        .filter(Boolean)
        .join('\n');
      return `${role}:\n${text.slice(0, 2_000)}`;
    })
    .join('\n\n')
    .slice(0, 60_000);

  return [
    'Summarize this agent-work transcript so work can continue seamlessly. Be specific and terse.',
    'Output EXACTLY these sections:',
    'TASK: the original user objective (one sentence).',
    'DONE: completed steps with file paths / commands / outcomes (bullets).',
    'DECISIONS: choices made and why (bullets).',
    'FILES: every file created/modified/deleted with what happened (bullets).',
    'OPEN: unfinished steps, errors not yet fixed, things to verify (bullets).',
    'NEXT: the immediate next action (one line).',
    '',
    `Original user objective: ${originalRequest.slice(0, 500)}`,
    '',
    'TRANSCRIPT:',
    transcript,
  ].join('\n');
}

/** Compact system prompt for the summarizer call — cheap, local-first. */
export const SUMMARIZER_SYSTEM =
  'You compress agent-work transcripts into structured handoff notes. Keep file paths, commands, error messages, and decisions exact. No preamble, no commentary — only the requested sections.';

/**
 * Run compaction for a message list. Returns null when the summarizer fails
 * (caller falls back to truncation).
 */
export async function compactMessages(opts: {
  messages: Message[];
  contextTokenBudget: number;
  originalRequest: string;
  summarize: (prompt: string) => Promise<string>;
  onEvent?: (detail: string) => void;
}): Promise<{ messages: Message[]; stats: CompactionStats } | null> {
  const { messages, contextTokenBudget, originalRequest, summarize, onEvent } = opts;
  if (!shouldCompact(messages, contextTokenBudget)) return null;
  const { toSummarize, kept } = partitionForCompaction(messages, contextTokenBudget);
  // Nothing meaningful to summarize (e.g. boundary hit zero) — no compaction.
  if (toSummarize.length < 2) return null;

  onEvent?.('Compacting context — summarizing earlier turns…');
  let summary: string;
  try {
    summary = await summarize(buildSummarizerPrompt(toSummarize, originalRequest));
  } catch (e) {
    console.warn('[compaction] summarizer failed, falling back to truncation:', (e as Error).message);
    return null;
  }
  if (!summary.trim()) return null;

  const summaryMessage: Message = {
    id: `compaction-${Date.now()}`,
    role: 'user',
    timestamp: Date.now(),
    content: [{
      type: 'text',
      text: [
        '[Conversation compacted — earlier turns summarized to fit the context window. The summary below is authoritative history; recent turns follow verbatim.]',
        '',
        summary.trim(),
      ].join('\n'),
    }],
  };

  const compacted = [summaryMessage, ...kept];
  return {
    messages: compacted,
    stats: {
      originalMessages: messages.length,
      compactedMessages: compacted.length,
      summarizedTurns: toSummarize.length,
      originalChars: estimateTokens(messages),
      compactedChars: estimateTokens(compacted),
    },
  };
}
