import { describe, expect, it, beforeEach } from 'vitest';
import { collectActivity, resolveCommunicationModel } from './narration.js';
import { settings } from '../settings/store.js';

const cwd = process.cwd();
const set = (key: string, value: unknown) => settings.set('user', key, value, cwd);

describe('communication model split', () => {
  beforeEach(async () => {
    await settings.clear('user', 'voiceCommunicationProvider', cwd);
    await settings.clear('user', 'voiceCommunicationModel', cwd);
  });

  it('is off unless the user picks a communication model', () => {
    expect(resolveCommunicationModel({ provider: 'openrouter', model: 'a' })).toBeNull();
  });

  it('is off when only one half is set — a half-configured split is not a split', async () => {
    await set('voiceCommunicationProvider', 'nvidia');
    expect(resolveCommunicationModel({ provider: 'openrouter', model: 'a' })).toBeNull();

    await settings.clear('user', 'voiceCommunicationProvider', cwd);
    await set('voiceCommunicationModel', 'some/model');
    expect(resolveCommunicationModel({ provider: 'openrouter', model: 'a' })).toBeNull();
  });

  it('is off when both sides are the same model, since it only adds latency', async () => {
    await set('voiceCommunicationProvider', 'openrouter');
    await set('voiceCommunicationModel', 'a');
    expect(resolveCommunicationModel({ provider: 'openrouter', model: 'a' })).toBeNull();
  });

  it('uses the chosen model when it genuinely differs', async () => {
    await set('voiceCommunicationProvider', 'nvidia');
    await set('voiceCommunicationModel', 'spark-voice');
    expect(resolveCommunicationModel({ provider: 'openrouter', model: 'a' })).toEqual({
      provider: 'nvidia',
      model: 'spark-voice',
    });
  });
});

describe('activity collection for narration', () => {
  const event = (over: Record<string, unknown>) =>
    ({ runId: 'r', message_id: 'm', tool_use_id: 't', ...over }) as never;

  it('records only tools that actually ran', () => {
    const activity = collectActivity([
      event({ type: 'tool_use_start', name: 'Bash' }),
      event({ type: 'tool_use_end', name: 'Bash', input: { command: 'npm test' } }),
      event({ type: 'tool_result', content: 'ok' }),
    ] as never);
    expect(activity).toHaveLength(1);
    expect(activity[0].name).toBe('Bash');
    expect(activity[0].status).toBe('done');
    expect(activity[0].detail).toBe('npm test');
  });

  it('marks a failed tool as failed, so the narrator cannot claim success', () => {
    const activity = collectActivity([
      event({ type: 'tool_use_start', name: 'Bash' }),
      event({ type: 'tool_use_end', name: 'Bash', input: { command: 'rm -rf /' } }),
      event({ type: 'tool_result', content: 'denied', is_error: true }),
    ] as never);
    expect(activity[0].status).toBe('error');
  });

  it('returns nothing when no tools ran — the narrator must not invent work', () => {
    expect(collectActivity([] as never)).toEqual([]);
    expect(collectActivity([event({ type: 'message_start', name: 'x' })] as never)).toEqual([]);
  });

  it('keeps a long command short enough to say out loud', () => {
    const long = 'x'.repeat(400);
    const activity = collectActivity([
      event({ type: 'tool_use_start', name: 'Bash' }),
      event({ type: 'tool_use_end', name: 'Bash', input: { command: long } }),
    ] as never);
    expect(activity[0].detail.length).toBeLessThanOrEqual(71);
  });

  it('prefers a meaningful input field when describing a tool', () => {
    const activity = collectActivity([
      event({ type: 'tool_use_start', name: 'WebFetch' }),
      event({ type: 'tool_use_end', name: 'WebFetch', input: { url: 'https://example.com', prompt: 'ignored' } }),
    ] as never);
    expect(activity[0].detail).toBe('https://example.com');
  });
});