import { describe, expect, it } from 'vitest';
import { evalUsage, parseEvalArgs } from './args.js';

describe('evaluation CLI arguments', () => {
  it('defaults to the core suite with no provider override', () => {
    expect(parseEvalArgs([])).toEqual({
      suite: 'core',
      tasks: [],
      provider: null,
      model: null,
      json: false,
      list: false,
      matrix: [],
      trend: false,
      timeoutMin: null,
    });
  });

  it('accepts repeated and comma-separated task ids', () => {
    const parsed = parseEvalArgs(['--task', 'a,b', '--task', 'c', '--json']);
    expect('error' in parsed).toBe(false);
    if ('error' in parsed) return;
    expect(parsed.tasks).toEqual(['a', 'b', 'c']);
    expect(parsed.json).toBe(true);
  });

  it('accepts positional task ids and a forwarded -- separator', () => {
    const parsed = parseEvalArgs(['--', 'create-welcome-note,fix-failing-test']);
    expect('error' in parsed).toBe(false);
    if ('error' in parsed) return;
    expect(parsed.tasks).toEqual(['create-welcome-note', 'fix-failing-test']);
  });

  it('parses provider, model, suite, and timeout overrides', () => {
    const parsed = parseEvalArgs([
      '--suite', 'core',
      '--provider', 'openai',
      '--model', 'gpt-5',
      '--timeout', '2.5',
    ]);
    expect('error' in parsed).toBe(false);
    if ('error' in parsed) return;
    expect(parsed).toMatchObject({
      suite: 'core',
      provider: 'openai',
      model: 'gpt-5',
      timeoutMin: 2.5,
    });
  });

  it('rejects missing values, unknown flags, and bad timeouts', () => {
    expect(parseEvalArgs(['--task'])).toEqual({ error: '--task needs a task id.' });
    expect(parseEvalArgs(['--provider'])).toEqual({ error: '--provider needs a provider id.' });
    expect(parseEvalArgs(['--nope'])).toEqual({ error: 'Unknown option: --nope' });
    expect(parseEvalArgs(['do something'])).toMatchObject({ tasks: ['do something'] });
    expect(parseEvalArgs(['--timeout', '0'])).toEqual({ error: '--timeout must be between 0 and 60 minutes.' });
    expect(parseEvalArgs(['--timeout', '61'])).toEqual({ error: '--timeout must be between 0 and 60 minutes.' });
  });

  it('reports help as a distinct outcome', () => {
    expect(parseEvalArgs(['--help'])).toEqual({ error: 'help' });
    expect(evalUsage()).toContain('npm run eval');
  });
});
