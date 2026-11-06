import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { Message } from '../../shared/types.js';

const mocks = vi.hoisted(() => ({
  getProvider: vi.fn(),
  buildProviderFailoverPlan: vi.fn(),
  buildSystemPrompt: vi.fn(),
  buildContext: vi.fn(),
  runHooks: vi.fn().mockResolvedValue(undefined),
  checkPermission: vi.fn().mockResolvedValue(true),
  asProviderTools: vi.fn().mockReturnValue([]),
  drainInterjections: vi.fn().mockReturnValue([]),
  recordProviderFailure: vi.fn(),
  recordProviderSuccess: vi.fn(),
  selectNextProviderCandidate: vi.fn().mockReturnValue(null),
  isTransientStreamFailure: vi.fn().mockReturnValue(false),
  learnFromToolResult: vi.fn(),
  routeForcedBrowserTool: vi.fn().mockReturnValue(null),
}));

vi.mock('../providers/registry.js', () => ({ getProvider: mocks.getProvider }));
vi.mock('../providers/failover.js', () => ({
  buildProviderFailoverPlan: mocks.buildProviderFailoverPlan,
  recordProviderFailure: mocks.recordProviderFailure,
  recordProviderSuccess: mocks.recordProviderSuccess,
  selectNextProviderCandidate: mocks.selectNextProviderCandidate,
  isTransientStreamFailure: mocks.isTransientStreamFailure,
  backoffForError: () => 0,
  classifyError: () => 'unknown',
  SAME_MODEL_STREAM_RETRIES: 3,
  FAILOVER_CANDIDATE_RETRIES: 2,
  createCapabilityTracker: () => ({ failures: new Map(), details: new Map() }),
  recordCapabilityFailure: () => {},
  getCapabilityFailureCount: () => 0,
  CAPABILITY_FAILURE_THRESHOLD: 2,
}));
vi.mock('./context.js', () => ({ buildSystemPrompt: mocks.buildSystemPrompt, buildContext: mocks.buildContext }));
vi.mock('./hooks.js', () => ({ runHooks: mocks.runHooks }));
vi.mock('./permissions.js', () => ({ checkPermission: mocks.checkPermission, currentPermissionProfile: () => 'default' }));
vi.mock('../tools/base.js', () => ({ toolRegistry: { asProviderTools: mocks.asProviderTools }, CORE_TOOL_NAMES: new Set() }));
vi.mock('../brain/router.js', () => ({ DecisionRouter: vi.fn().mockImplementation(() => ({ recordTask: vi.fn() })) }));
vi.mock('./browser-routing.js', () => ({ routeForcedBrowserTool: mocks.routeForcedBrowserTool }));
vi.mock('./learning-adapter.js', () => ({ learnFromToolResult: mocks.learnFromToolResult, learnFromCompletedResponse: vi.fn(), learnFromRunOutcome: vi.fn() }));
// Sticky auto-switch persists the recovered model through the settings store —
// stub it so tests never touch the real profile's settings.json, while still
// recording writes so the auto-switch can be asserted.
vi.mock('../settings/store.js', () => {
  const sets: Array<{ scope: string; key: string; value: unknown }> = [];
  return {
    settings: {
      get: () => undefined,
      set: async (scope: string, key: string, value: unknown) => { sets.push({ scope, key, value }); },
    },
    __recordedSets: sets,
  };
});

import { keepPartialAssistant, runAgent, setLoopStallTimeout } from './loop.js';

function msg(text: string): Message {
  return { id: crypto.randomUUID(), role: 'user', content: [{ type: 'text', text }], timestamp: Date.now() };
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.getProvider.mockReturnValue({
    id: 'test',
    label: 'Test',
    requiresApiKey: false,
    freeModels: [{ id: 'test-model', supports_tools: false }],
    streamChat: vi.fn(),
  });
  mocks.buildProviderFailoverPlan.mockResolvedValue([
    { provider: 'test', model: 'test-model', label: 'Test', apiKey: 'k' },
  ]);
  mocks.buildSystemPrompt.mockResolvedValue('system');
  mocks.buildContext.mockResolvedValue('');
  mocks.isTransientStreamFailure.mockReturnValue(false);
  mocks.selectNextProviderCandidate.mockReturnValue(null);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Agent loop stall timeout', () => {
  it('aborts a stalled stream and triggers failover', async () => {
    setLoopStallTimeout(500);

    // The streamChat mock returns a generator that blocks forever until the
    // abort signal fires — matching how a real provider stalls on reader.read().
    const streamChat = vi.fn().mockImplementation((opts: { signal?: AbortSignal }, _apiKey: string) => {
      const signal = opts.signal;
      return (async function* () {
        // Never yields — simulates a provider that blocks on reader.read().
        // ESLint: the whole point is to NOT yield.
        yield* [];
        await new Promise<never>((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          }, { once: true });
        });
      })();
    });

    mocks.getProvider.mockReturnValue({
      id: 'test',
      label: 'Test',
      requiresApiKey: false,
      freeModels: [{ id: 'test-model', supports_tools: false }],
      streamChat,
    });

    const controller = new AbortController();
    const events: unknown[] = [];
    const resultPromise = runAgent([], msg('hello'), {
      sessionId: 's1',
      cwd: '/tmp',
      provider: 'test',
      model: 'test-model',
      signal: controller.signal,
      onEvent: (e) => events.push(e),
    });

    // Advance past the stall timeout — watchdog fires, dispatches abort on opts.signal
    await vi.advanceTimersByTimeAsync(600);

    const messages = await resultPromise;
    const lastEvent = events.at(-1) as { type: string };
    expect(lastEvent.type).toBe('fallback_required');
    expect(messages.length).toBe(1);
    expect(messages[0].role).toBe('user');
  }, 10_000);

  it('does not trigger when chunks arrive before the stall timeout', async () => {
    setLoopStallTimeout(500);

    const slowGenerator = (async function* () {
      for (let i = 0; i < 3; i++) {
        await new Promise((r) => setTimeout(r, 200));
        yield { type: 'text_delta' as const, text: `chunk${i}` };
      }
      yield { type: 'message_end' as const, stop_reason: 'end_turn', usage: null };
    })();

    mocks.getProvider.mockReturnValue({
      id: 'test',
      label: 'Test',
      requiresApiKey: false,
      freeModels: [{ id: 'test-model', supports_tools: false }],
      streamChat: vi.fn().mockReturnValue(slowGenerator),
    });

    const controller = new AbortController();
    const events: unknown[] = [];
    const resultPromise = runAgent([], msg('hello'), {
      sessionId: 's1',
      cwd: '/tmp',
      provider: 'test',
      model: 'test-model',
      signal: controller.signal,
      onEvent: (e) => events.push(e),
    });

    await vi.advanceTimersByTimeAsync(1500);

    await resultPromise;
    const lastEvent = events.at(-1) as { type: string };
    expect(lastEvent.type).toBe('done');
    const textDeltas = (events as { type: string }[]).filter((e) => e.type === 'text_delta');
    expect(textDeltas.length).toBe(3);
  }, 10_000);

  it('cleans up the stall interval when the stream completes normally', async () => {
    setLoopStallTimeout(500);

    const normalGenerator = (async function* () {
      yield { type: 'text_delta' as const, text: 'hi' };
      yield { type: 'message_end' as const, stop_reason: 'end_turn', usage: null };
    })();

    mocks.getProvider.mockReturnValue({
      id: 'test',
      label: 'Test',
      requiresApiKey: false,
      freeModels: [{ id: 'test-model', supports_tools: false }],
      streamChat: vi.fn().mockReturnValue(normalGenerator),
    });

    const controller = new AbortController();
    const resultPromise = runAgent([], msg('hello'), {
      sessionId: 's1',
      cwd: '/tmp',
      provider: 'test',
      model: 'test-model',
      signal: controller.signal,
      onEvent: () => {},
    });

    await vi.advanceTimersByTimeAsync(100);
    await resultPromise;

    // After completing, advancing time should not cause errors (interval cleared)
    await vi.advanceTimersByTimeAsync(1000);
  }, 10_000);
});

describe('Selected-model honesty', () => {
  function providerWith(script: Array<'error' | 'ok'>, failure: string) {
    let calls = 0;
    const seenModels: string[] = [];
    const streamChat = vi.fn().mockImplementation((req: { model?: string }) => {
      seenModels.push(req.model ?? '');
      const step = script[Math.min(calls++, script.length - 1)];
      if (step === 'error') {
        return (async function* () {
          yield { type: 'error' as const, error: failure };
        })();
      }
      return (async function* () {
        yield { type: 'text_delta' as const, text: 'done' };
        yield { type: 'message_end' as const, stop_reason: 'end_turn', usage: null };
      })();
    });
    mocks.getProvider.mockReturnValue({
      id: 'test',
      label: 'Test',
      requiresApiKey: false,
      // Both models known with tools off: the turns stay tool-free so wiped
      // registry mocks from earlier tests can never break these runs.
      freeModels: [
        { id: 'selected-model', supports_tools: false },
        { id: 'backup-model', supports_tools: false },
      ],
      streamChat,
    });
    return { streamChat, seenModels };
  }

  it('announces the real error when leaving the selected model', async () => {
    const selected = { provider: 'test', model: 'selected-model', label: 'Test / selected-model', apiKey: 'k' };
    const backup = { provider: 'test', model: 'backup-model', label: 'Test / backup-model', apiKey: 'k' };
    mocks.buildProviderFailoverPlan.mockResolvedValue([selected, backup]);
    mocks.selectNextProviderCandidate.mockReturnValue(backup);
    // 401 is NOT transient: no same-model retry, straight to a named switch.
    mocks.isTransientStreamFailure.mockReturnValue(false);
    const { streamChat, seenModels } = providerWith(['error', 'ok'], 'API error (401): bad key');

    const events: Array<{ type: string; status?: string; reason?: string; from?: string; to?: string }> = [];
    await runAgent([], msg('hello'), {
      sessionId: 's1', cwd: '/tmp', provider: 'test', model: 'selected-model',
      signal: new AbortController().signal, onEvent: (e) => events.push(e as never),
    });

    // The selection was genuinely attempted first…
    expect(seenModels[0]).toBe('selected-model');
    // …and the switch names the real failure instead of going quiet.
    const failover = events.find((e) => e.type === 'provider_status' && e.status === 'failover');
    expect(failover?.from).toBe('Test / selected-model');
    expect(failover?.to).toBe('Test / backup-model');
    expect(failover?.reason).toMatch(/401/);
    expect(streamChat).toHaveBeenCalledTimes(2);
  }, 10_000);

  it('visibly retries the selected model on transient failures before switching', async () => {
    const selected = { provider: 'test', model: 'selected-model', label: 'Test / selected-model', apiKey: 'k' };
    const backup = { provider: 'test', model: 'backup-model', label: 'Test / backup-model', apiKey: 'k' };
    mocks.buildProviderFailoverPlan.mockResolvedValue([selected, backup]);
    mocks.selectNextProviderCandidate.mockReturnValue(backup);
    mocks.isTransientStreamFailure.mockReturnValue(true);
    const { streamChat, seenModels } = providerWith(['error', 'error', 'error', 'error', 'ok'], 'Network error: socket hang up');

    const events: Array<{ type: string; status?: string; reason?: string; provider?: string; model?: string }> = [];
    await runAgent([], msg('hello'), {
      sessionId: 's1', cwd: '/tmp', provider: 'test', model: 'selected-model',
      signal: new AbortController().signal, onEvent: (e) => events.push(e as never),
    });

    // SAME_MODEL_STREAM_RETRIES (3) all stay on the selection…
    expect(seenModels.slice(0, 4)).toEqual(['selected-model', 'selected-model', 'selected-model', 'selected-model']);
    // …each retry is announced with model + cause…
    const retries = events.filter((e) => e.type === 'provider_status' && e.status === 'retrying');
    expect(retries.length).toBe(3);
    expect(retries[0]?.model).toBe('selected-model');
    expect(retries[0]?.reason).toMatch(/socket hang up/);
    // …and only then does it switch, carrying the last error.
    const failover = events.find((e) => e.type === 'provider_status' && e.status === 'failover');
    expect(failover?.reason).toMatch(/socket hang up/);
    expect(streamChat).toHaveBeenCalledTimes(5);
  }, 10_000);

  it('persists the recovered model as the new active model after a hard failure', async () => {
    const selected = { provider: 'test', model: 'selected-model', label: 'Test / selected-model', apiKey: 'k' };
    const backup = { provider: 'test', model: 'backup-model', label: 'Test / backup-model', apiKey: 'k' };
    mocks.buildProviderFailoverPlan.mockResolvedValue([selected, backup]);
    mocks.selectNextProviderCandidate.mockReturnValue(backup);
    mocks.isTransientStreamFailure.mockReturnValue(false);
    providerWith(['error', 'ok'], 'API error (401): bad key');

    const settingsModule = await import('../settings/store.js');
    const recorded = (settingsModule as unknown as { __recordedSets: Array<{ key: string; value: unknown }> }).__recordedSets;
    recorded.length = 0;

    const events: Array<{ type: string; status?: string; sticky?: boolean; provider?: string; model?: string }> = [];
    await runAgent([], msg('hello'), {
      sessionId: 's1', cwd: '/tmp', provider: 'test', model: 'selected-model',
      signal: new AbortController().signal, onEvent: (e) => events.push(e as never),
    });

    // The Brain announces the sticky switch with the ids the renderer adopts…
    const sticky = events.find((e) => e.type === 'provider_status' && e.sticky === true);
    expect(sticky?.provider).toBe('test');
    expect(sticky?.model).toBe('backup-model');
    // …and saves it so the NEXT turn (WhatsApp, Telegram, scheduled) starts here.
    expect(recorded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'provider', value: 'test' }),
        expect.objectContaining({ key: 'model', value: 'backup-model' }),
      ]),
    );
  }, 10_000);

  it('never persists a switch after a transient blip', async () => {
    const selected = { provider: 'test', model: 'selected-model', label: 'Test / selected-model', apiKey: 'k' };
    const backup = { provider: 'test', model: 'backup-model', label: 'Test / backup-model', apiKey: 'k' };
    mocks.buildProviderFailoverPlan.mockResolvedValue([selected, backup]);
    mocks.selectNextProviderCandidate.mockReturnValue(backup);
    // Transient: the run retries the selection, then may fail over in-run —
    // but the user's saved choice must never be overwritten.
    mocks.isTransientStreamFailure.mockReturnValue(true);
    providerWith(['error', 'error', 'error', 'error', 'ok'], 'Network error: socket hang up');

    const settingsModule = await import('../settings/store.js');
    const recorded = (settingsModule as unknown as { __recordedSets: Array<{ key: string }> }).__recordedSets;
    recorded.length = 0;

    const events: Array<{ type: string; sticky?: boolean }> = [];
    await runAgent([], msg('hello'), {
      sessionId: 's1', cwd: '/tmp', provider: 'test', model: 'selected-model',
      signal: new AbortController().signal, onEvent: (e) => events.push(e as never),
    });

    expect(events.some((e) => e.sticky === true)).toBe(false);
    expect(recorded).toHaveLength(0);
  }, 10_000);
});

describe('keepPartialAssistant', () => {
  const assistant = (content: Message['content']): Message => ({
    id: 'a1', role: 'assistant', content, timestamp: Date.now(),
  });

  it('keeps streamed text and drops orphan tool_use blocks', () => {
    const m = assistant([
      { type: 'text', text: 'Working on it — found ' },
      { type: 'tool_use', id: 't1', name: 'Read', input: { path: 'x' } },
    ]);
    expect(keepPartialAssistant(m)).toBe(true);
    expect(m.content).toEqual([{ type: 'text', text: 'Working on it — found ' }]);
  });

  it('returns false for empty or tool-only partials', () => {
    const empty = assistant([{ type: 'text', text: '   ' }]);
    expect(keepPartialAssistant(empty)).toBe(false);
    const toolOnly = assistant([{ type: 'tool_use', id: 't1', name: 'Read', input: {} }]);
    expect(keepPartialAssistant(toolOnly)).toBe(false);
    expect(toolOnly.content).toEqual([]);
  });
});
