import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  shouldCompact,
  findSafeBoundary,
  partitionForCompaction,
  compactMessages,
  buildSummarizerPrompt,
} from './compaction.js';
import type { Message } from '../../shared/types.js';

function userMsg(text: string, id: string = crypto.randomUUID()): Message {
  return { id, role: 'user', timestamp: Date.now(), content: [{ type: 'text', text }] };
}
function assistantMsg(text: string, id: string = crypto.randomUUID()): Message {
  return { id, role: 'assistant', timestamp: Date.now(), content: [{ type: 'text', text }] };
}
function toolUseMsg(toolId: string, name = 'Bash'): Message {
  return {
    id: crypto.randomUUID(), role: 'assistant', timestamp: Date.now(),
    content: [{ type: 'tool_use', id: toolId, name, input: { command: 'ls' } }],
  };
}
function toolResultMsg(toolId: string): Message {
  return {
    id: crypto.randomUUID(), role: 'user', timestamp: Date.now(),
    content: [{ type: 'tool_result', tool_use_id: toolId, content: 'ok' }],
  };
}

describe('compaction math', () => {
  it('estimateTokens scales with content size', () => {
    const small = [userMsg('hello')];
    const big = [userMsg('x'.repeat(4000))];
    expect(estimateTokens(big)).toBeGreaterThan(estimateTokens(small) * 10);
  });

  it('shouldCompact is false for tiny histories and true when over budget', () => {
    const tiny = [userMsg('hi'), assistantMsg('hello')];
    expect(shouldCompact(tiny, 128_000)).toBe(false);
    const huge = Array.from({ length: 400 }, (_, i) => userMsg('x'.repeat(4000) + ` #${i}`));
    expect(shouldCompact(huge, 8_000)).toBe(true);
    expect(shouldCompact(huge, 0)).toBe(false);
  });

  it('findSafeBoundary never splits a tool_use from its tool_result', () => {
    const toolId = 'call-1';
    const messages = [
      userMsg('task'),
      assistantMsg('thinking'),
      toolUseMsg(toolId),
      toolResultMsg(toolId),
      userMsg('continue'),
      assistantMsg('done'),
    ];
    // Candidate boundary right after the tool_use (index 3) must move back
    // to a point where the tool_use stays with its result.
    const boundary = findSafeBoundary(messages, 3);
    const summarized = messages.slice(0, boundary);
    const kept = messages.slice(boundary);
    const summarizedToolUseIds = new Set(
      summarized.flatMap((m) => m.content.filter((b) => b.type === 'tool_use').map((b) => (b as { id: string }).id)),
    );
    const keptToolResultIds = new Set(
      kept.flatMap((m) => m.content.filter((b) => b.type === 'tool_result').map((b) => (b as { tool_use_id: string }).tool_use_id)),
    );
    for (const id of summarizedToolUseIds) {
      expect(keptToolResultIds.has(id)).toBe(false);
    }
  });

  it('partitionForCompaction keeps at least MIN_RECENT_TURNS verbatim', () => {
    const messages = Array.from({ length: 40 }, (_, i) => userMsg(`turn ${i} ` + 'y'.repeat(500)));
    const { kept } = partitionForCompaction(messages, 16_000);
    expect(kept.length).toBeGreaterThanOrEqual(8);
  });

  it('compactMessages returns null when under budget', async () => {
    const messages = [userMsg('hello'), assistantMsg('hi')];
    const result = await compactMessages({ messages, contextTokenBudget: 128_000, originalRequest: 'greet', summarize: async () => 'S' });
    expect(result).toBeNull();
  });

  it('compactMessages summarizes old turns and keeps recent ones with a fake summarizer', async () => {
    const messages = [
      userMsg('build the thing', 'u0'),
      ...Array.from({ length: 120 }, (_, i) => userMsg(`filler ${i} `.padEnd(1200, 'z'), `u${i + 1}`)),
      userMsg('now finish it', 'u-last'),
    ];
    const result = await compactMessages({
      messages,
      contextTokenBudget: 12_000,
      originalRequest: 'build the thing',
      summarize: async (prompt) => {
        expect(prompt).toContain('TASK:');
        return 'TASK: build the thing\nDONE: nothing yet\nNEXT: finish it';
      },
    });
    expect(result).not.toBeNull();
    expect(result!.messages[0].content[0].type).toBe('text');
    expect(String((result!.messages[0].content[0] as { text: string }).text)).toContain('[Conversation compacted');
    expect(result!.stats.summarizedTurns).toBeGreaterThan(0);
    // Recent tail preserved verbatim
    const lastText = (result!.messages.at(-1)!.content[0] as { text: string }).text;
    expect(lastText).toBe('now finish it');
    // Summarizer failure falls back to null (truncation path)
    const failed = await compactMessages({
      messages,
      contextTokenBudget: 12_000,
      originalRequest: 'build the thing',
      summarize: async () => { throw new Error('down'); },
    });
    expect(failed).toBeNull();
  });

  it('buildSummarizerPrompt embeds tool calls and results', () => {
    const prompt = buildSummarizerPrompt([toolUseMsg('c9', 'Edit'), toolResultMsg('c9')], 'refactor');
    expect(prompt).toContain('[tool_use: Edit');
    expect(prompt).toContain('[tool_result');
    expect(prompt).toContain('refactor');
  });
});
