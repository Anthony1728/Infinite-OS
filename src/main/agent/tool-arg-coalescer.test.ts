import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToolCallArgCoalescer } from './tool-arg-coalescer.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('ToolCallArgCoalescer', () => {
  it('emits the tool name synchronously on start (card appears instantly)', () => {
    const deltas: Array<{ id: string; name: string; partialJson: string }> = [];
    const c = new ToolCallArgCoalescer({ onDelta: (d) => deltas.push(d) });
    c.start('t1', 'Bash');
    expect(deltas).toEqual([{ id: 't1', name: 'Bash', partialJson: '' }]);
    c.dispose();
  });

  it('batches argument deltas into frames (snapshot semantics, not fragments)', () => {
    vi.useFakeTimers();
    const deltas: Array<{ id: string; name: string; partialJson: string }> = [];
    const c = new ToolCallArgCoalescer({ onDelta: (d) => deltas.push(d) });
    c.start('t1', 'Write');
    c.delta('t1', '{"path":"a.');
    c.delta('t1', '{"path":"a.ts","content":');
    c.delta('t1', '{"path":"a.ts","content":"hi"}');
    expect(deltas).toHaveLength(1); // only the start so far
    vi.advanceTimersByTime(40);
    expect(deltas).toHaveLength(2);
    expect(deltas[1].partialJson).toBe('{"path":"a.ts","content":"hi"}'); // full snapshot
    c.dispose();
  });

  it('flushes the final snapshot synchronously on end, before tool_use_end', () => {
    const deltas: Array<{ id: string; name: string; partialJson: string }> = [];
    const c = new ToolCallArgCoalescer({ onDelta: (d) => deltas.push(d) });
    c.start('t1', 'Bash');
    c.delta('t1', '{"command":"npm test"}');
    c.end('t1');
    expect(deltas).toHaveLength(2);
    expect(deltas[1]).toEqual({ id: 't1', name: 'Bash', partialJson: '{"command":"npm test"}' });
    c.dispose();
  });

  it('handles unknown ids from delta-only starts', () => {
    vi.useFakeTimers();
    const deltas: Array<{ id: string; name: string; partialJson: string }> = [];
    const c = new ToolCallArgCoalescer({ onDelta: (d) => deltas.push(d) });
    c.delta('t9', '{"query":"hi"}');
    vi.advanceTimersByTime(40);
    expect(deltas).toEqual([{ id: 't9', name: '', partialJson: '{"query":"hi"}' }]);
    c.dispose();
  });

  it('dispose flushes pending snapshots exactly once', () => {
    const deltas: Array<{ id: string; partialJson: string }> = [];
    const c = new ToolCallArgCoalescer({ onDelta: (d) => deltas.push(d) });
    c.delta('t1', '{"a":1}');
    c.dispose();
    c.dispose();
    expect(deltas.filter((d) => d.id === 't1' && d.partialJson === '{"a":1}')).toHaveLength(1);
  });

  it('tracks multiple concurrent calls independently', () => {
    vi.useFakeTimers();
    const deltas: Array<{ id: string; partialJson: string }> = [];
    const c = new ToolCallArgCoalescer({ onDelta: (d) => deltas.push(d) });
    c.start('a', 'Read');
    c.start('b', 'Grep');
    c.delta('a', '{"path":"x.ts"}');
    c.delta('b', '{"pattern":"y"}');
    vi.advanceTimersByTime(40);
    const byId = new Map(deltas.map((d) => [d.id, d.partialJson]));
    expect(byId.get('a')).toBe('{"path":"x.ts"}');
    expect(byId.get('b')).toBe('{"pattern":"y"}');
    c.dispose();
  });
});
