import { describe, expect, it, beforeEach } from 'vitest';
import {
  SHOW_LOCAL_MODEL_THINKING_KEY,
  SHOW_MODEL_THINKING_KEY,
  isLocalProvider,
  resolveThinkingPreference,
  thinkingCostNote,
} from './thinking-preference.js';
import { settings } from '../settings/store.js';

/**
 * Defaults here are a judgement call with real numbers behind it, so they are
 * pinned.
 *
 * Measured on the development machine (i5-4210U, no GPU):
 *   qwen3:1.7b, no reasoning  ->  0.2 s
 *   qwen3:1.7b, reasoning on  -> 17.5 s
 *
 * That is why local defaults off and cloud defaults on. One shared default would
 * force a bad choice for somebody either way.
 */

const cwd = process.cwd();
const clear = (key: string) => settings.clear('user', key, cwd);

describe('which providers are local', () => {
  it('knows Ollama runs on the user machine', () => {
    expect(isLocalProvider('ollama')).toBe(true);
  });

  it('treats everything else as remote', () => {
    for (const provider of ['anthropic', 'openrouter', 'nvidia', 'opencode', 'freebuff']) {
      expect(isLocalProvider(provider)).toBe(false);
    }
  });
});

describe('the default for each kind of provider', () => {
  beforeEach(async () => {
    await clear(SHOW_MODEL_THINKING_KEY);
    await clear(SHOW_LOCAL_MODEL_THINKING_KEY);
  });

  it('shows thinking for cloud models by default — the user asked to see it', () => {
    expect(resolveThinkingPreference('anthropic')).toEqual({ thinking: true });
  });

  it('hides it for local models by default, because it costs 17 seconds a turn', () => {
    // An empty object means "do not set the flag", so the provider keeps its own
    // cheap default rather than being asked to reason.
    expect(resolveThinkingPreference('ollama')).toEqual({});
  });

  it('obeys the cloud switch when it is turned off', async () => {
    await settings.set('user', SHOW_MODEL_THINKING_KEY, false, cwd);
    expect(resolveThinkingPreference('anthropic')).toEqual({});
  });

  it('obeys the local switch when it is turned on', async () => {
    await settings.set('user', SHOW_LOCAL_MODEL_THINKING_KEY, true, cwd);
    expect(resolveThinkingPreference('ollama')).toEqual({ thinking: true });
  });

  it('keeps the two switches independent', async () => {
    // Somebody may want cloud reasoning off while local reasoning is on.
    await settings.set('user', SHOW_MODEL_THINKING_KEY, false, cwd);
    await settings.set('user', SHOW_LOCAL_MODEL_THINKING_KEY, true, cwd);
    expect(resolveThinkingPreference('anthropic')).toEqual({});
    expect(resolveThinkingPreference('ollama')).toEqual({ thinking: true });
  });
});

describe('the cost note shown in settings', () => {
  it('warns that local reasoning costs real time', () => {
    // The panel must not imply thinking is free everywhere.
    expect(thinkingCostNote('ollama')).toMatch(/second|seconds/);
  });

  it('says cloud reasoning costs no extra round trip', () => {
    expect(thinkingCostNote('anthropic')).toMatch(/no extra round trip/i);
  });
});