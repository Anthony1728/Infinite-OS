import { describe, expect, it } from 'vitest';
import { parseExecArgs, execUsage } from './args.js';

describe('parseExecArgs', () => {
  it('parses a plain prompt with flags', () => {
    const parsed = parseExecArgs(['fix', 'the', 'tests', '--yes', '--json', '--provider', 'ollama', '--model', 'qwen3:4b']);
    expect('error' in parsed).toBe(false);
    if ('error' in parsed) return;
    expect(parsed.prompt).toBe('fix the tests');
    expect(parsed.yes).toBe(true);
    expect(parsed.json).toBe(true);
    expect(parsed.provider).toBe('ollama');
    expect(parsed.model).toBe('qwen3:4b');
    expect(parsed.timeoutMin).toBe(10);
  });

  it('accepts review and resume forms', () => {
    const review = parseExecArgs(['--review']);
    expect('error' in review).toBe(false);
    const resume = parseExecArgs(['--resume', 'abc123', 'continue', '--timeout-min', '3']);
    expect('error' in resume).toBe(false);
    if ('error' in resume) return;
    expect(resume.resume).toBe('abc123');
    expect(resume.prompt).toBe('continue');
    expect(resume.timeoutMin).toBe(3);
  });

  it('clamps the timeout and rejects unknown flags and empty input', () => {
    const clamped = parseExecArgs(['hi', '--timeout-min', '999']);
    if (!('error' in clamped)) expect(clamped.timeoutMin).toBe(120);
    expect((parseExecArgs(['hi', '--nope']) as { error: string }).error).toMatch(/Unknown flag/);
    expect((parseExecArgs([]) as { error: string }).error).toMatch(/prompt/i);
  });

  it('documents itself', () => {
    expect(execUsage()).toMatch(/npm run exec/);
    expect(execUsage()).toMatch(/Exit codes/);
  });
});
