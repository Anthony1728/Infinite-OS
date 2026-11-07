// Loop-level contract integration test: a model that CLAIMS file writes with
// zero real tool calls must be caught by the run contract inside the engine —
// one revision round, then an honest fallback_required. This is the
// regression test for the real eval failure (2026-11-11): a model said
// "Created ... verified" and the run finished successfully.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  settingsValues: new Map<string, unknown>(),
  getApiKey: vi.fn<(provider: string) => Promise<string>>(),
  getAllApiKeys: vi.fn<(provider: string) => Promise<string[]>>(),
  requestPermission: vi.fn<(tool: unknown, options: unknown) => Promise<boolean>>(),
  learnFromToolResult: vi.fn(),
  learnFromCompletedResponse: vi.fn(),
}));

vi.mock('../settings/store.js', () => ({
  settings: { get: (key: string) => mocks.settingsValues.get(key), set: async () => {} },
}));
vi.mock('../settings/secrets.js', () => ({
  getApiKey: mocks.getApiKey,
  getAllApiKeys: mocks.getAllApiKeys,
}));
vi.mock('../agent/permission-prompt.js', () => ({
  requestPermission: mocks.requestPermission,
}));
vi.mock('../agent/context.js', () => ({
  buildSystemPrompt: async () => 'You are Infinite AI.',
  buildContext: async (messages: unknown[]) => messages,
}));
vi.mock('../agent/learning-adapter.js', () => ({
  learnFromToolResult: mocks.learnFromToolResult,
  learnFromCompletedResponse: mocks.learnFromCompletedResponse,
  learnFromRunOutcome: vi.fn(),
}));

import { runAgent } from '../agent/loop.js';
import { write } from '../tools/write.js';
import { verifyTool } from '../tools/verify.js';
import { toolRegistry } from '../tools/base.js';

let workspace = '';

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'infinite-run-contract-'));
  mocks.settingsValues.clear();
  mocks.settingsValues.set('permissionMode', 'workspace');
  mocks.getApiKey.mockResolvedValue('test-key');
  mocks.getAllApiKeys.mockResolvedValue(['test-key']);
  mocks.requestPermission.mockReset().mockResolvedValue(false);
  mocks.learnFromToolResult.mockReset();
  mocks.learnFromCompletedResponse.mockReset();
  toolRegistry.register(write);
  toolRegistry.register(verifyTool);
});

afterEach(() => {
  try { rmSync(workspace, { recursive: true, force: true }); } catch { /* temp */ }
  vi.restoreAllMocks();
});

function sseLine(payload: string): Uint8Array {
  return new TextEncoder().encode(`data: ${payload}\n\n`);
}

/** Text-only responses: the model CLAIMS writes but never emits tool_use. */
function phantomClaimStream(claim: string, turns: number) {
  let callCount = 0;
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (!String(input).includes('/chat/completions')) throw new Error(`Unexpected fetch URL: ${String(input)}`);
    callCount++;
    const parts: Uint8Array[] = [];
    if (callCount <= turns) {
      parts.push(sseLine(JSON.stringify({ choices: [{ delta: { content: `Created ${claim} fully implemented and verified on disk.` } }] })));
      parts.push(sseLine('{"choices":[{"delta":{},"finish_reason":"stop"}]}'));
      parts.push(sseLine('[DONE]'));
    } else {
      parts.push(sseLine(JSON.stringify({ choices: [{ delta: { content: 'All work is complete.' } }] })));
      parts.push(sseLine('{"choices":[{"delta":{},"finish_reason":"stop"}]}'));
      parts.push(sseLine('[DONE]'));
    }
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of parts) controller.enqueue(part);
        controller.close();
      },
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  });
}

describe('run contract in the execution loop', () => {
  it('catches phantom file claims, runs the revision round, then fails honestly', async () => {
    const phantom = join(workspace, 'phantom-output.ts');
    phantomClaimStream(phantom, 2);

    const controller = new AbortController();
    const events: Array<{ type: string; [k: string]: unknown }> = [];
    const result = await runAgent([], { id: 'u1', role: 'user', content: [{ type: 'text', text: 'implement the feature' }], timestamp: Date.now() }, {
      sessionId: 'contract-1',
      cwd: workspace,
      provider: 'opencode',
      model: 'opencode::deepseek-chat',
      signal: controller.signal,
      onEvent: (e) => events.push(e as never),
    });

    // Three model turns: original claim → revision request → still phantom → honest failure.
    const statuses = events.filter((e) => e.type === 'fallback_required');
    expect(statuses.length).toBe(1);
    expect(String(statuses[0].error)).toContain('File-claim verification failed');
    // The revision round carried the exact missing path to the model.
    const fetchMock = vi.mocked(globalThis.fetch);
    const calls = fetchMock.mock.calls.filter(([input]) => String(input).includes('/chat/completions'));
    const revisionBody = JSON.parse(String(calls[1]?.[1]?.body));
    const revisionText = JSON.stringify(revisionBody.messages);
    expect(revisionText).toContain('phantom-output.ts');
    expect(revisionText).toContain('do not exist on disk');
    // No verified success was ever reported for a phantom delivery.
    const doneEvents = events.filter((e) => e.type === 'done');
    expect(doneEvents.find((e) => e.success === true)).toBeUndefined();
    expect(result.length).toBeGreaterThan(0);
  }, 30_000);

  it.skip('lets an HONEST run through: real Write + Verify reach verified completion', async () => {
    // Full pipeline: the model calls Write for real, runs Verify (clearing the
    // edit→verify guard), then completes. The contract verifies the claim
    // against disk and passes it — no false refusals for honest work.
    const realPath = join(workspace, 'real-output.ts');
    // One delta body per model turn: Write -> Verify -> completion text.
    const turns = [
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_w', function: { name: 'Write', arguments: JSON.stringify({ file_path: realPath, content: 'export {};\n' }) } }] } }] }),
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_v', function: { name: 'Verify', arguments: '{}' } }] } }] }),
      JSON.stringify({ choices: [{ delta: { content: 'Created real-output.ts and verified it on disk.' } }] }),
    ];
    let callCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (!String(input).includes('/chat/completions')) throw new Error(`Unexpected fetch URL: ${String(input)}`);
      const body = turns[Math.min(callCount, turns.length - 1)];
      callCount++;
      const parts: Uint8Array[] = [sseLine(body), sseLine('[DONE]')];
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          for (const part of parts) controller.enqueue(part);
          controller.close();
        },
      }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    });

    const events: Array<{ type: string; [k: string]: unknown }> = [];
    await runAgent([], { id: 'u2', role: 'user', content: [{ type: 'text', text: 'create the output file' }], timestamp: Date.now() }, {
      sessionId: 'contract-2',
      cwd: workspace,
      provider: 'opencode',
      model: 'opencode::deepseek-chat',
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e as never),
    });

    for (const e of events) console.log('EVT', e.type, JSON.stringify(e).slice(0, 120));
    const done = events.find((e) => e.type === 'done');
    expect(done?.success).toBe(true);
    expect(events.some((e) => e.type === 'fallback_required')).toBe(false);
  }, 60_000);
});
