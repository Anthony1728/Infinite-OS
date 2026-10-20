// Context editing — clears stale tool outputs from older turns while keeping
// every message, instruction, and tool_use/tool_result pairing intact.
//
// This is the feature Claude Code / the Claude API shipped in 2025-2026 as
// "context editing": instead of dropping whole messages when the context
// budget fills (which silently loses the original task and early decisions),
// we keep the structure and hollow out the payloads that are cheapest to
// regenerate — old tool results. The model can always re-run a tool to get a
// fresh copy; it cannot re-ask a question the user answered ten turns ago.
//
// How it complements the existing pipeline:
// - buildContext's budget walk drops OLDEST MESSAGES first when over budget.
//   With edited payloads the walk almost always fits — early instructions stay.
// - compaction.ts summarizes history when it approaches the window; context
//   editing shrinks history first, so compaction (an LLM call) fires less.
// - compactMessage() still head/tail-trims individual >40k tool outputs;
//   that remains the safety net for very recent (un-editable) results.
//
// Guarantees (unit-tested):
// - The newest N tool results are never touched (active work stays verbatim).
// - Blocks are never removed or reordered; only `content` shrinks, so
//   Anthropic-style tool_use ↔ tool_result pairing can never orphan.
// - Idempotent: a placeholder is smaller than the clear threshold, so
//   re-running the pass never double-truncates.

import type { ContentBlock, Message } from '../../shared/types.js';

export interface ContextEditingOptions {
  /** Newest tool_result blocks kept verbatim. Default 12. */
  keepRecentToolResults?: number;
  /** Results at or below this size are kept (they're nearly free). Default 1000 chars. */
  minClearChars?: number;
  /** Head snippet kept so the model still knows what the output was. Default 240 chars. */
  headChars?: number;
}

export interface ContextEditingStats {
  cleared: number;
  charsFreed: number;
}

const DEFAULT_KEEP_RECENT = 12;
const DEFAULT_MIN_CLEAR_CHARS = 1_000;
const DEFAULT_HEAD_CHARS = 240;

function placeholder(length: number): string {
  return `[stale tool output cleared to fit context — ${length} chars; re-run the tool if you need it again]`;
}

function clearText(text: string, minClearChars: number, headChars: number): { text: string; freed: number } | null {
  if (text.length <= minClearChars) return null;
  const head = text.slice(0, headChars);
  return { text: `${head}\n${placeholder(text.length)}`, freed: text.length - headChars - placeholder(text.length).length };
}

/**
 * Hollow out tool results older than the recent window. Returns the edited
 * list (same message ids/order) plus stats. Input is never mutated.
 */
export function editStaleToolResults(
  messages: Message[],
  opts: ContextEditingOptions = {},
): { messages: Message[]; stats: ContextEditingStats } {
  const keepRecent = opts.keepRecentToolResults ?? DEFAULT_KEEP_RECENT;
  const minClearChars = opts.minClearChars ?? DEFAULT_MIN_CLEAR_CHARS;
  const headChars = opts.headChars ?? DEFAULT_HEAD_CHARS;

  // Walk from the end so the newest tool results are the ones we protect.
  const protectedIds = new Set<string>();
  for (let i = messages.length - 1; i >= 0 && protectedIds.size < keepRecent; i--) {
    for (const block of messages[i].content) {
      if (block.type === 'tool_result') {
        protectedIds.add(block.tool_use_id);
        if (protectedIds.size >= keepRecent) break;
      }
    }
  }

  let cleared = 0;
  let charsFreed = 0;
  const edited = messages.map((message) => {
    let messageChanged = false;
    const content = message.content.map((block): ContentBlock => {
      if (block.type !== 'tool_result') return block;
      if (protectedIds.has(block.tool_use_id)) return block;

      if (typeof block.content === 'string') {
        const result = clearText(block.content, minClearChars, headChars);
        if (!result) return block;
        messageChanged = true;
        cleared++;
        charsFreed += result.freed;
        return { ...block, content: result.text };
      }

      // Array content: clear oversized text parts, drop stale images (base64
      // images are the single biggest context cost in tool results).
      let blockChanged = false;
      const parts = block.content.map((part): ContentBlock => {
        if (part.type === 'image') {
          blockChanged = true;
          cleared++;
          const freed = part.source.data.length;
          charsFreed += freed;
          return { type: 'text', text: '[stale image cleared from context]' };
        }
        if (part.type === 'text') {
          const result = clearText(part.text, minClearChars, headChars);
          if (!result) return part;
          blockChanged = true;
          cleared++;
          charsFreed += result.freed;
          return { ...part, text: result.text };
        }
        return part;
      });
      if (!blockChanged) return block;
      messageChanged = true;
      return { ...block, content: parts };
    });
    return messageChanged ? { ...message, content } : message;
  });

  return { messages: edited, stats: { cleared, charsFreed } };
}
