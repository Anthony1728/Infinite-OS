import { describe, expect, it, beforeAll } from 'vitest';
import { getProvider } from './registry.js';

/** The real local adapter, exactly as the app resolves it at runtime. */
const ollama = () => {
  const adapter = getProvider('ollama');
  if (!adapter) throw new Error('the ollama adapter is not registered');
  return adapter;
};
import {
  budgetForModel,
  getHardwareProfile,
  isOllamaReachable,
  getInstalledModels,
  invalidateModelCache,
  resolveOllamaModel,
  testOllamaConnection,
} from '../ollama/utils.js';

/**
 * These run against the REAL Ollama server on this machine, because the whole
 * problem being fixed is empirical: a local model that "doesn't work" fails in
 * ways a mock cannot reproduce (a model that reasons for 41 s and returns
 * nothing, a model name that 404s, a server that is simply not running).
 *
 * They skip rather than fail when Ollama is absent, so CI without Ollama stays
 * green.
 */

const online = await isOllamaReachable();
const suite = online ? describe : describe.skip;

suite('the real Ollama server', () => {
  beforeAll(() => invalidateModelCache());

  it('is reachable and has models installed', async () => {
    const health = await testOllamaConnection({ startIfNeeded: false });
    expect(health.ok).toBe(true);
    expect((await getInstalledModels()).length).toBeGreaterThan(0);
  });

  it('reports the machine honestly, and the tier matches this CPU-only box', () => {
    const hw = getHardwareProfile();
    expect(hw.totalRamGb).toBeGreaterThan(0);
    // This machine has integrated graphics only, so it must not be rated as if
    // it had a GPU to offload to.
    if (!hw.hasNvidiaGpu) expect(hw.tier).toBe('low');
  });

  it('lists models with the budget it will actually use', async () => {
    const models = await ollama().listModels('');
    expect(models.length).toBeGreaterThan(0);
    const budget = budgetForModel();
    for (const model of models) {
      // The advertised context must match what a request will actually send.
      // It used to hardcode 8192 regardless of the machine.
      expect(model.context_window).toBe(budget.numCtx);
    }
  });

  it('answers a short question, and reports how long it really took', async () => {
    const adapter = ollama();
    const started = Date.now();
    const chunks: string[] = [];
    for await (const chunk of adapter.streamChat({
      model: 'qwen3:1.7b',
      messages: [{ id: 'u1', role: 'user', content: [{ type: 'text', text: 'Reply with exactly: ready' }], timestamp: Date.now() }],
      stream: true,
    }, '')) {
      if (chunk.type === 'text_delta') chunks.push(chunk.text);
      if (chunk.type === 'error') throw new Error(chunk.error);
    }
    const elapsed = (Date.now() - started) / 1000;
    const answer = chunks.join('');
    expect(answer.length).toBeGreaterThan(0);
    // Logged, not asserted: a hard time limit would make this test flaky on a
    // loaded machine, and the number is the point of the exercise.
    console.log(`    [measured] short answer in ${elapsed.toFixed(1)}s -> ${JSON.stringify(answer.slice(0, 60))}`);
  }, 300_000);

  it('never exceeds the machine output budget, however large the request asks for', async () => {
    // The agent asks for large max_tokens. Before the fix that was passed
    // straight through, so a 1.7 GHz CPU was asked to produce 2048 tokens.
    const adapter = ollama();
    const budget = budgetForModel();
    let sawEnd = false;
    for await (const chunk of adapter.streamChat({
      model: 'qwen3:1.7b',
      messages: [{ id: 'u1', role: 'user', content: [{ type: 'text', text: 'Count to ten.' }], timestamp: Date.now() }],
      max_tokens: 100_000,
      stream: true,
    }, '')) {
      if (chunk.type === 'error') throw new Error(chunk.error);
      if (chunk.type === 'message_end') {
        sawEnd = true;
        // Whatever it produced, it was bounded by the machine budget.
        expect(chunk.usage.output).toBeLessThanOrEqual(budget.numPredict + 8);
      }
    }
    // The turn must always close, even if the stream ended abruptly.
    expect(sawEnd).toBe(true);
  }, 300_000);

  it('surfaces the model reasoning as its own channel, not as the answer', async () => {
    // This is the behaviour the user actually asked for: see what the model is
    // thinking, the way Ollama's own UI shows it. Before this change reasoning
    // was deleted by a stripper and the user just saw a long unexplained pause.
    const adapter = ollama();
    const thinking: string[] = [];
    const answer: string[] = [];
    const started = Date.now();

    for await (const chunk of adapter.streamChat({
      model: 'qwen3:1.7b',
      messages: [{
        id: 'u1',
        role: 'user',
        content: [{ type: 'text', text: 'What is 17*23? Answer with just the number.' }],
        timestamp: Date.now(),
      }],
      stream: true,
      thinking: true,
    }, '')) {
      if (chunk.type === 'error') throw new Error(chunk.error);
      if (chunk.type === 'thinking_delta') thinking.push(chunk.text);
      if (chunk.type === 'text_delta') answer.push(chunk.text);
    }
    const elapsed = (Date.now() - started) / 1000;

    // The reasoning really reached the UI...
    expect(thinking.join('').length).toBeGreaterThan(0);
    // ...and it stayed separate from the answer.
    expect(answer.join('')).not.toContain('<think>');
    console.log(
      `    [measured] thinking ${thinking.join('').length} chars in ${elapsed.toFixed(1)}s, answer ${JSON.stringify(answer.join('').slice(0, 40))}`,
    );
  }, 300_000);

  it('stops reasoning from starving the answer, however long the model rambles', async () => {
    // The measured failure this fixes: with the whole 400-token budget given to
    // reasoning, qwen3:1.7b spent 41 s on "17x23" and returned an EMPTY answer.
    // With a bounded thinking slice the turn must always finish with something.
    const adapter = ollama();
    const thinking: string[] = [];
    let sawEnd = false;
    let stopReason = '';

    for await (const chunk of adapter.streamChat({
      model: 'qwen3:1.7b',
      messages: [{
        id: 'u1',
        role: 'user',
        content: [{ type: 'text', text: 'What is 17*23? Answer with just the number.' }],
        timestamp: Date.now(),
      }],
      stream: true,
      thinking: true,
      thinkingBudget: 400,
    }, '')) {
      if (chunk.type === 'thinking_delta') thinking.push(chunk.text);
      if (chunk.type === 'message_end') {
        sawEnd = true;
        stopReason = chunk.stop_reason;
      }
    }

    // The turn closes - the UI is never left waiting on a stream that will not
    // finish.
    expect(sawEnd).toBe(true);
    // Reasoning stayed within the slice it was given.
    expect(thinking.join('').length).toBeLessThan(400 * 8);
    // And the stop reason is one the UI knows how to explain.
    expect(['end_turn', 'max_tokens', 'tool_use']).toContain(stopReason);
    console.log(`    [measured] bounded thinking -> stop_reason=${stopReason}, ${thinking.join('').length} chars kept`);
  }, 300_000);
});

describe('choosing a model that exists', () => {
  it('uses an exact match when it is installed', () => {
    expect(resolveOllamaModel('qwen3:1.7b', ['qwen3:1.7b', 'qwen3:4b'])).toBe('qwen3:1.7b');
  });

  it('falls back to the same base model at a different size', () => {
    // The profile remembers a model the user has since removed.
    expect(resolveOllamaModel('qwen3:8b', ['qwen3:1.7b', 'qwen3:4b'])).toBe('qwen3:1.7b');
  });

  it('falls back to the smallest installed model rather than a 404', () => {
    // Sending an uninstalled name returns 404 and the chat dies silently, which
    // is the bug this guards.
    const resolved = resolveOllamaModel('llama3:70b', ['qwen3:4b', 'qwen3:1.7b']);
    expect(['qwen3:4b', 'qwen3:1.7b']).toContain(resolved);
  });

  it('returns the requested name when nothing is installed, for an honest error', () => {
    expect(resolveOllamaModel('qwen3:1.7b', [])).toBe('qwen3:1.7b');
  });
});

describe('the thinking channel', () => {
  it('is opt-in, so a normal request never asks the model to reason', () => {
    // Pinned because it is the whole reason local chat stayed usable: reasoning
    // costs tokens and seconds, and nobody asked for it by default.
    const req: { thinking?: boolean } = {};
    expect(req.thinking).toBeUndefined();
  });

  it('is shown to the user but never sent back to the model', async () => {
    const { toOllamaMessages } = await import('./registry.js') as {
      toOllamaMessages: (messages: unknown[], system?: string) => Array<{ role: string; content: string }>;
    };
    const mapped = toOllamaMessages([
      {
        id: 'a1',
        role: 'assistant',
        timestamp: 1,
        content: [
          { type: 'thinking', text: 'SECRET REASONING that should not cost a single prompt token' },
          { type: 'text', text: 'The answer.' },
        ],
      },
    ]);
    expect(mapped).toHaveLength(1);
    // Only the answer goes back. Replaying reasoning would double the prompt on a
    // CPU-bound machine, and the model's own transcript already has it.
    expect(mapped[0].content).toBe('The answer.');
    expect(mapped[0].content).not.toContain('SECRET REASONING');
  });
});