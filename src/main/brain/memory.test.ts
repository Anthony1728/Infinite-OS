import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { LearningMemoryStore } from './memory.js';

const directories: string[] = [];
const START = Date.UTC(2026, 0, 1);

function dataDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'infinite-learning-memory-'));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('LearningMemoryStore', () => {
  it('classifies conversations, web knowledge, tools, and successful action traces', () => {
    const store = new LearningMemoryStore({ dataDir: dataDir(), now: () => START });
    const preference = store.ingest({
      type: 'api_conversation',
      user: 'I prefer concise TypeScript answers and always want tests.',
      assistant: 'Understood. I will lead with the result and include focused TypeScript validation.',
      provider: 'openai',
      model: 'fast-model',
    });
    const fact = store.ingest({
      type: 'web',
      query: 'Current TypeScript documentation for narrowing',
      result: 'TypeScript uses control-flow analysis to narrow a union after a supported runtime check.',
      url: 'https://www.typescriptlang.org/docs/handbook/2/narrowing.html',
    });
    const tool = store.ingest({
      type: 'tool',
      toolName: 'WebSearch',
      input: 'current release status',
      result: 'Found the current release status in the official documentation.',
      success: true,
    });
    const episode = store.ingest({
      type: 'action_trace',
      goal: 'Fix the failing TypeScript test',
      steps: ['Ran the focused test', 'Inspected the stack trace', 'Changed the incorrect condition', 'Reran validation'],
      outcome: 'The focused test and typecheck passed.',
      success: true,
      tools: ['terminal', 'filesystem'],
    });

    expect(preference?.kind).toBe('preference');
    expect(preference?.expiresAt).toBeNull();
    expect(fact?.kind).toBe('fact');
    expect(fact?.provenance[0].url).toContain('typescriptlang.org');
    expect(tool?.provenance[0]).toMatchObject({ type: 'tool', tool: 'WebSearch' });
    expect(episode?.kind).toBe('episode');
    expect(store.getStats().byKind).toEqual({ fact: 2, procedure: 0, preference: 1, episode: 1 });
  });

  it('rejects failed or invalid evidence', () => {
    const store = new LearningMemoryStore({ dataDir: dataDir() });
    expect(store.ingest({
      type: 'action_trace', goal: 'Deploy app', steps: ['Ran deploy'], outcome: 'Deployment failed', success: false,
    })).toBeNull();
    expect(store.ingest({
      type: 'tool', toolName: 'terminal', result: 'command failed', success: false,
    })).toBeNull();
    expect(store.ingest({
      type: 'web', query: 'untrusted result', result: 'A result long enough to otherwise be accepted.', url: 'javascript:alert(1)',
    })).toBeNull();
    expect(store.getStats().total).toBe(0);
  });

  it('deduplicates repeated evidence and raises confidence without exceeding one', () => {
    const store = new LearningMemoryStore({ dataDir: dataDir(), now: () => START });
    const input = {
      type: 'teaching' as const,
      question: 'How should a coding agent verify a bug fix?',
      answer: 'Reproduce the failure, implement the smallest safe change, rerun the focused regression test, and then run broader validation.',
      provider: 'groq',
      model: 'teacher-model',
    };
    const first = store.ingest(input)!;
    const second = store.ingest({ ...input, provider: 'openai', model: 'second-teacher' })!;

    expect(second.id).toBe(first.id);
    expect(second.evidenceCount).toBe(2);
    expect(second.confidence).toBeGreaterThan(first.confidence);
    expect(second.confidence).toBeLessThanOrEqual(1);
    expect(second.provenance).toHaveLength(2);
    expect(store.getStats().total).toBe(1);
  });

  it('redacts secrets before persistence and restores records from disk', () => {
    const directory = dataDir();
    const store = new LearningMemoryStore({ dataDir: directory, now: () => START });
    const learned = store.ingest({
      type: 'tool',
      toolName: 'ConfigInspector',
      input: 'Inspect the provider configuration',
      result: 'The provider is configured. api_key=supersecretvalue123456 and the connection test passed.',
      success: true,
      kind: 'fact',
    });
    expect(learned?.content).not.toContain('supersecretvalue');
    expect(learned?.content).toContain('[REDACTED]');

    // Writes are batched (see `saveIntervalMs`), so flush before reading back.
    store.flush();

    const restored = new LearningMemoryStore({ dataDir: directory, now: () => START });
    expect(restored.getStats().total).toBe(1);
    expect(restored.getById(learned!.id)?.content).toBe(learned?.content);
  });

  it('batches writes instead of rewriting the store after every ingest', () => {
    const directory = dataDir();
    const store = new LearningMemoryStore({ dataDir: directory, now: () => START });
    const storeFile = join(directory, 'learning-memory.json');

    store.ingest({
      type: 'tool', toolName: 'Terminal', input: 'run tests', result: 'All focused tests passed successfully.', success: true,
    });
    store.ingest({
      type: 'tool', toolName: 'Editor', input: 'patch file', result: 'The file was patched and validation passed.', success: true,
    });

    // Nothing hits the disk mid-burst: no full-store rewrite per tool result.
    expect(existsSync(storeFile)).toBe(false);
    expect(store.getStats().total).toBe(2);

    store.flush();
    expect(existsSync(storeFile)).toBe(true);
    expect(new LearningMemoryStore({ dataDir: directory }).getStats().total).toBe(2);
  });

  it('writes through when batching is turned off', () => {
    const directory = dataDir();
    const store = new LearningMemoryStore({ dataDir: directory, now: () => START, saveIntervalMs: 0 });

    store.ingest({
      type: 'tool', toolName: 'Terminal', input: 'run tests', result: 'All focused tests passed successfully.', success: true,
    });

    expect(existsSync(join(directory, 'learning-memory.json'))).toBe(true);
    store.flush();
  });

  it('retrieves by intent and suppresses stale facts by default', () => {
    let now = START;
    const store = new LearningMemoryStore({ dataDir: dataDir(), now: () => now });
    const fact = store.ingest({
      type: 'web',
      query: 'latest framework release',
      result: 'The official release page identifies a specific current framework version and release status.',
      url: 'https://example.com/releases',
      tags: ['framework', 'release'],
    })!;
    const procedure = store.ingest({
      type: 'teaching',
      question: 'How do I debug a TypeScript regression?',
      answer: 'Start with the focused failing test and stack trace, isolate the faulty assumption, patch it, and run both focused and broad checks.',
      kind: 'procedure',
      tags: ['typescript', 'debugging'],
    })!;

    expect(store.search('debug TypeScript test', { intent: 'debugging', limit: 1 })[0]?.record.id).toBe(procedure.id);
    expect(store.formatForContext('debug TypeScript')).toContain('confidence');

    now = START + 46 * 24 * 60 * 60_000;
    expect(store.search('framework release', { kinds: ['fact'] }).some((result) => result.record.id === fact.id)).toBe(false);
    expect(store.search('framework release', { kinds: ['fact'], includeStale: true }).find((result) => result.record.id === fact.id)?.stale).toBe(true);
  });
});
