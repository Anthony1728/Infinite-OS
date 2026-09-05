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
  learnFromToolResult: vi.fn(),
  routeForcedBrowserTool: vi.fn().mockReturnValue(null),
}));

vi.mock('../providers/registry.js', () => ({ getProvider: mocks.getProvider }));
vi.mock('../providers/failover.js', () => ({
  buildProviderFailoverPlan: mocks.buildProviderFailoverPlan,
  recordProviderFailure: mocks.recordProviderFailure,
  recordProviderSuccess: mocks.recordProviderSuccess,
  selectNextProviderCandidate: mocks.selectNextProviderCandidate,
  isTransientStreamFailure: () => false,
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
vi.mock('./permissions.js', () => ({ checkPermission: mocks.checkPermission }));
vi.mock('../tools/base.js', () => ({ toolRegistry: { asProviderTools: mocks.asProviderTools } }));
vi.mock('../brain/router.js', () => ({ DecisionRouter: vi.fn().mockImplementation(() => ({ recordTask: vi.fn() })) }));
vi.mock('./browser-routing.js', () => ({ routeForcedBrowserTool: mocks.routeForcedBrowserTool }));
vi.mock('./learning-adapter.js', () => ({ learnFromToolResult: mocks.learnFromToolResult, learnFromCompletedResponse: vi.fn() }));

import { runAgent, setLoopStallTimeout } from './loop.js';

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
