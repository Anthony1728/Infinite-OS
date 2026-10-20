import { describe, expect, it } from 'vitest';
import { editStaleToolResults } from './context-editing.js';
import type { ContentBlock, Message } from '../../shared/types.js';

let counter = 0;
function msg(role: Message['role'], content: ContentBlock[]): Message {
  counter++;
  return { id: `m${counter}`, role, content, timestamp: Date.now() + counter };
}
function toolUse(id: string): ContentBlock {
  return { type: 'tool_use', id, name: 'Read', input: { path: '/x' } };
}
function toolResult(id: string, content: string | ContentBlock[], opts: { error?: boolean } = {}): ContentBlock {
  return { type: 'tool_result', tool_use_id: id, content, ...(opts.error ? { is_error: true } : {}) };
}
const big = (n: number) => 'x'.repeat(n);

describe('editStaleToolResults', () => {
  it('keeps the newest tool results verbatim and clears older oversized ones', () => {
    const messages = [
      msg('assistant', [toolUse('t1')]),
      msg('user', [toolResult('t1', big(5_000))]),
      msg('assistant', [toolUse('t2')]),
      msg('user', [toolResult('t2', big(5_000))]),
    ];
    const { messages: edited, stats } = editStaleToolResults(messages, { keepRecentToolResults: 1 });

    const first = edited[1].content[0];
    expect(first.type).toBe('tool_result');
    expect(first.type === 'tool_result' && typeof first.content === 'string' && first.content.length).toBeLessThan(1_000);
    expect(first.type === 'tool_result' && typeof first.content === 'string' && first.content).toContain('stale tool output cleared');
    expect(first.type === 'tool_result' && typeof first.content === 'string' && first.content).toContain('5000 chars');

    const last = edited[3].content[0];
    expect(last).toBe(messages[3].content[0]); // newest result untouched (same ref)
    expect(stats.cleared).toBe(1);
    expect(stats.charsFreed).toBeGreaterThan(3_500);
  });

  it('leaves small results alone even when old', () => {
    const messages = [
      msg('assistant', [toolUse('t1')]),
      msg('user', [toolResult('t1', 'short output')]),
      msg('assistant', [toolUse('t2')]),
      msg('user', [toolResult('t2', big(4_000))]),
    ];
    const { messages: edited, stats } = editStaleToolResults(messages, { keepRecentToolResults: 0 });
    expect(edited[1].content[0]).toBe(messages[1].content[0]);
    expect(stats.cleared).toBe(1);
  });

  it('preserves ids, order, and tool_use/tool_result pairing', () => {
    const messages = [
      msg('assistant', [toolUse('t1')]),
      msg('user', [toolResult('t1', big(3_000)), toolResult('t2', big(3_000))]),
      msg('assistant', [toolUse('t2')]),
      msg('user', [{ type: 'text', text: 'keep me' }]),
    ];
    const { messages: edited } = editStaleToolResults(messages, { keepRecentToolResults: 0 });
    expect(edited.map((m) => m.id)).toEqual(messages.map((m) => m.id));
    expect(edited[0].content).toBe(messages[0].content); // tool_use never touched
    const results = edited[1].content.filter((b) => b.type === 'tool_result');
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.type === 'tool_result' ? r.tool_use_id : null).toMatch(/^t[12]$/);
    }
    expect(edited[3].content[0]).toBe(messages[3].content[0]);
  });

  it('does not mutate the input array or its messages', () => {
    const original = big(3_000);
    const messages = [
      msg('assistant', [toolUse('t1')]),
      msg('user', [toolResult('t1', original)]),
    ];
    const snapshot = JSON.parse(JSON.stringify(messages));
    const firstMessageRef = messages[0];
    const resultBlockRef = messages[1].content[0];
    editStaleToolResults(messages, { keepRecentToolResults: 0 });
    expect(JSON.parse(JSON.stringify(messages))).toEqual(snapshot);
    // Input objects are left alone: same references, same payload string.
    expect(messages[0]).toBe(firstMessageRef);
    expect(messages[1].content[0]).toBe(resultBlockRef);
    expect((messages[1].content[0] as { content: string }).content).toBe(original);
  });

  it('clears stale base64 images and oversized text inside array results', () => {
    const messages = [
      msg('assistant', [toolUse('t1')]),
      msg('user', [toolResult('t1', [
        { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'A'.repeat(50_000) } },
        { type: 'text', text: big(4_000) },
      ])]),
      msg('assistant', [toolUse('t2')]),
      msg('user', [toolResult('t2', 'ok')]),
    ];
    const { messages: edited, stats } = editStaleToolResults(messages, { keepRecentToolResults: 1 });
    const block = edited[1].content[0];
    expect(block.type).toBe('tool_result');
    if (block.type !== 'tool_result' || typeof block.content === 'string') throw new Error('expected array content');
    expect(block.content.some((p) => p.type === 'image')).toBe(false);
    expect(block.content.some((p) => p.type === 'text' && p.text.includes('stale image cleared'))).toBe(true);
    expect(block.content.some((p) => p.type === 'text' && p.text.includes('stale tool output cleared'))).toBe(true);
    expect(stats.charsFreed).toBeGreaterThan(50_000);
  });

  it('is idempotent: a second pass never shrinks an already-cleared result', () => {
    const messages = [
      msg('assistant', [toolUse('t1')]),
      msg('user', [toolResult('t1', big(6_000))]),
      msg('assistant', [toolUse('t2')]),
      msg('user', [toolResult('t2', 'small')]),
    ];
    const first = editStaleToolResults(messages, { keepRecentToolResults: 1 });
    const second = editStaleToolResults(first.messages, { keepRecentToolResults: 1 });
    expect(second.stats.cleared).toBe(0);
    expect(second.messages[1].content).toEqual(first.messages[1].content);
    expect(second.messages).toEqual(first.messages);
  });

  it('keeps error results whose content is short and clears long stack traces', () => {
    const messages = [
      msg('assistant', [toolUse('t1')]),
      msg('user', [toolResult('t1', 'Error: boom', { error: true })]),
      msg('assistant', [toolUse('t2')]),
      msg('user', [toolResult('t2', big(2_500), { error: true })]),
      msg('assistant', [toolUse('t3')]),
      msg('user', [toolResult('t3', 'done')]),
    ];
    const { messages: edited } = editStaleToolResults(messages, { keepRecentToolResults: 1 });
    expect(edited[1].content[0]).toBe(messages[1].content[0]);
    const long = edited[3].content[0];
    expect(long.type === 'tool_result' && typeof long.content === 'string' && long.content).toContain('stale tool output cleared');
    expect(long.type === 'tool_result' && long.is_error).toBe(true); // error flag preserved
  });
});
