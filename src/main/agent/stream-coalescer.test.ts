import { afterEach, describe, expect, it, vi } from 'vitest';

import { StreamCoalescer } from './stream-coalescer.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('StreamCoalescer', () => {
  it('flushes the first push after one frame, not immediately', () => {
    vi.useFakeTimers();
    const flushed: string[] = [];
    const c = new StreamCoalescer({ onFlush: (t) => flushed.push(t) });
    c.push('Hello');
    expect(flushed).toEqual([]); // no per-token IPC yet
    vi.advanceTimersByTime(50);
    expect(flushed).toEqual(['Hello']);
    c.dispose();
  });

  it('batches rapid pushes within the same frame into one flush', () => {
    vi.useFakeTimers();
    const flushed: string[] = [];
    const c = new StreamCoalescer({ onFlush: (t) => flushed.push(t) });
    c.push('Hel');
    c.push('lo ');
    c.push('wor');
    c.push('ld');
    vi.advanceTimersByTime(50);
    expect(flushed).toEqual(['Hello world']);
    c.dispose();
  });

  it('flushes immediately when the buffer exceeds the size cap', () => {
    const flushed: string[] = [];
    const c = new StreamCoalescer({ onFlush: (t) => flushed.push(t) });
    c.push('x'.repeat(2_500));
    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toHaveLength(2_500);
    c.dispose();
  });

  it('flushNow emits buffered text synchronously and empties the buffer', () => {
    const flushed: string[] = [];
    const c = new StreamCoalescer({ onFlush: (t) => flushed.push(t) });
    c.push('partial');
    c.flushNow();
    c.flushNow(); // second call is a no-op
    expect(flushed).toEqual(['partial']);
    c.dispose();
  });

  it('dispose flushes remaining text exactly once', () => {
    const flushed: string[] = [];
    const c = new StreamCoalescer({ onFlush: (t) => flushed.push(t) });
    c.push('tail');
    c.dispose();
    c.dispose();
    expect(flushed).toEqual(['tail']);
  });

  it('ignores empty pushes', () => {
    const flushed: string[] = [];
    const c = new StreamCoalescer({ onFlush: (t) => flushed.push(t) });
    c.push('');
    c.flushNow();
    expect(flushed).toEqual([]);
    c.dispose();
  });
});
