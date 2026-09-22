import { describe, expect, it } from 'vitest';
import { NoActiveModelError, resolveActiveModel, type SettingsGetter } from './active-model.js';

const getter = (values: Record<string, unknown>): SettingsGetter => {
  return <T = unknown>(key: string): T | undefined => values[key] as T | undefined;
};

describe('resolveActiveModel', () => {
  it('resolves the saved provider, model, and cwd', () => {
    expect(
      resolveActiveModel(getter({ provider: 'nvidia', model: 'meta/llama-3.3-70b-instruct', cwd: 'C:/work' })),
    ).toEqual({ provider: 'nvidia', model: 'meta/llama-3.3-70b-instruct', cwd: 'C:/work' });
  });

  it('trims stray whitespace from pasted selections', () => {
    const resolved = resolveActiveModel(getter({ provider: '  groq  ', model: '\nllama\n' }));
    expect(resolved.provider).toBe('groq');
    expect(resolved.model).toBe('llama');
  });

  it('falls back to the process cwd only when no workspace is saved', () => {
    const resolved = resolveActiveModel(getter({ provider: 'opencode', model: 'opencode::big-pickle' }));
    expect(resolved.cwd).toBe(process.cwd());
  });

  it('throws an actionable error instead of silently falling back to Ollama', () => {
    for (const values of [{}, { provider: 'nvidia' }, { model: 'm' }, { provider: ' ', model: '' }]) {
      try {
        resolveActiveModel(getter(values));
        expect.unreachable(`should have thrown for ${JSON.stringify(values)}`);
      } catch (e) {
        expect(e).toBeInstanceOf(NoActiveModelError);
        expect((e as Error).message).toMatch(/Settings → AI Provider/);
      }
    }
  });
});
