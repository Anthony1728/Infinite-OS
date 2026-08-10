import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createLearningMemoryStore } from './memory.js';
import {
  getLearningMemoryStats,
  ingestActionTrace,
  ingestResponse,
  ingestToolResult,
  retrieveLearningContext,
  searchLearningMemory,
} from './learning.js';

let directory = '';

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'infinite-learning-facade-'));
  createLearningMemoryStore({ dataDir: directory });
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe('learning facade', () => {
  it('ingests completed agent responses through the adapter contract', () => {
    const learned = ingestResponse({
      request: 'Fix this TypeScript regression and verify it.',
      taskContext: 'The repository uses Vitest.',
      response: 'The reliable procedure is to reproduce the focused failure, inspect the relevant branch, make a minimal correction, then run the focused test and typecheck.',
      provider: 'groq',
      model: 'fast-model',
      durationMs: 400,
      successfulTools: ['Read', 'Edit', 'Terminal'],
    });

    expect(learned?.provenance[0]).toMatchObject({ type: 'api_conversation', provider: 'groq', model: 'fast-model' });
    expect(learned?.tags).toContain('tool:terminal');
    expect(retrieveLearningContext('TypeScript regression test')).toContain('reproduce the focused failure');
    expect(getLearningMemoryStats().byKind.episode).toBe(1);
  });

  it('keeps search snippets as lower-confidence evidence until a page is fetched', () => {
    const search = ingestToolResult({
      request: 'Search for the current release.',
      taskContext: '',
      tool: 'WebSearch',
      input: { query: 'current release' },
      output: 'Result: Example release notes https://example.com/releases',
    });

    expect(search?.kind).toBe('episode');
    expect(search?.confidence).toBeLessThan(0.7);
    expect(search?.tags).toContain('search-evidence');
  });

  it('classifies web tools as sourced facts and other tools as tool results', () => {
    const web = ingestToolResult({
      request: 'Find the current official release documentation.',
      taskContext: 'Use primary sources.',
      tool: 'WebFetch',
      input: { url: 'https://example.com/releases' },
      output: 'The official page at https://example.com/releases lists the current release and support status.',
    });
    const terminal = ingestToolResult({
      request: 'Check the focused test.',
      taskContext: 'TypeScript repository',
      tool: 'Terminal',
      input: { command: 'npm test' },
      output: 'All focused tests passed successfully.',
    });

    expect(web?.provenance[0]).toMatchObject({ type: 'web', url: 'https://example.com/releases' });
    expect(terminal?.provenance[0]).toMatchObject({ type: 'tool', tool: 'Terminal' });
    expect(getLearningMemoryStats().total).toBe(2);
  });

  it('stores and retrieves successful action outcomes by intent', () => {
    const episode = ingestActionTrace({
      goal: 'Repair a failing API integration',
      steps: ['Reproduced the request failure', 'Inspected the response status', 'Corrected the request schema', 'Ran integration tests'],
      outcome: 'The API integration tests passed.',
      tools: ['Terminal', 'Edit'],
      tags: ['api', 'debugging'],
    });

    expect(episode?.kind).toBe('episode');
    expect(searchLearningMemory('debug failing API test', { intent: 'debugging' })[0]?.record.id).toBe(episode?.id);
  });
});
