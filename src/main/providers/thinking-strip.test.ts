import { describe, expect, it } from 'vitest';
import { createThinkingStripper } from './registry.js';

function run(chunks: string[]): string {
  const s = createThinkingStripper();
  let out = '';
  for (const c of chunks) out += s.push(c);
  out += s.flush();
  return out;
}

describe('createThinkingStripper', () => {
  it('passes clean answers through untouched', () => {
    expect(run(['READY'])).toBe('READY');
    expect(run(['Hello, ', 'world!'])).toBe('Hello, world!');
  });

  it('removes closed think blocks', () => {
    expect(run(['<think>reasoning here</think>READY'])).toBe('READY');
  });

  it('removes think blocks split across chunks', () => {
    expect(run(['<thi', 'nk>reason', 'ing</th', 'ink>RE', 'ADY'])).toBe('READY');
  });

  it('drops unopened thinking closed only by </think>', () => {
    expect(run(['Hmm, thinking out loud…</think>READY'])).toBe('READY');
  });

  it('drops unclosed thinking at stream end', () => {
    expect(run(['<think>never ends…'])).toBe('');
  });

  it('handles multiple think blocks', () => {
    expect(run(['A<think>x</think>B<think>y</think>C'])).toBe('ABC');
  });
});
