// Unified orchestrator facade tests. All three surfaces are injected — no
// singletons, no real spawns. What is under test: the NORMALIZATION (crew,
// worker, and automation statuses become one shape) and the DELEGATION
// (orchestrateObjective routes through crew planning).

import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runCrew: vi.fn(),
  buildCrewPlan: vi.fn(),
}));

vi.mock('../agent/crew.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../agent/crew.js')>();
  return {
    ...actual,
    runCrew: mocks.runCrew,
    buildCrewPlan: mocks.buildCrewPlan,
  };
});

import {
  listOrchestrations,
  orchestrateObjective,
  type Orchestration,
} from './unified.js';
import type { CrewRun } from '../agent/crew.js';

function crewRun(overrides: Partial<CrewRun>): CrewRun {
  return {
    id: 'crew-1',
    originalPrompt: 'Build the login page',
    plan: {
      leader: { provider: 'p', model: 'm', free: false },
      members: [
        { id: 'm1', agentType: 'code', role: 'Coding Specialist', description: '', assignment: { provider: 'p', model: 'm', free: false }, status: 'completed', toolCallCount: 2, verification: { verdict: 'pass', reasons: [] } },
        { id: 'm2', agentType: 'design', role: 'Design Lead', description: '', assignment: { provider: 'p', model: 'm', free: false }, status: 'running', toolCallCount: 1 },
      ],
      strategy: 'paired',
      reasons: [],
    },
    status: 'running',
    startedAt: 1000,
    sessionId: 's',
    ...overrides,
  } as CrewRun;
}

describe('listOrchestrations', () => {
  it('normalizes a running crew with progress counts and verification', () => {
    const list = listOrchestrations({
      listCrew: () => [crewRun({})],
      listWorkers: () => [],
      listAutomationRuns: () => [],
    });
    expect(list).toHaveLength(1);
    const entry: Orchestration = list[0];
    expect(entry.kind).toBe('crew');
    expect(entry.status).toBe('running');
    expect(entry.progress).toContain('1/2 specialists done');
    expect(entry.progress).toContain('1 verified');
    expect(entry.name).toBe('Build the login page');
  });

  it('normalizes workers and automations into the same shape', () => {
    const list = listOrchestrations({
      listCrew: () => [],
      listWorkers: () => [{ id: 'w1', name: 'Nightly backup', status: 'running' as const, updatedAt: 2000 }],
      listAutomationRuns: () => [{ id: 'r1', workflowId: 'wf-9', status: 'running', startedAt: 1500 }],
      workflowName: (id) => (id === 'wf-9' ? 'Security audit' : undefined),
    });
    expect(list.map((e) => e.kind)).toEqual(['worker', 'automation']);
    expect(list[0].status).toBe('running');
    expect(list[1].name).toBe('Security audit');
  });

  it('hides completed runs by default and shows them with includeCompleted', () => {
    const deps = {
      listCrew: () => [crewRun({ status: 'completed' as const, completedAt: 2000 })],
      listWorkers: () => [{ id: 'w1', name: 'w', status: 'draft' as const }],
      listAutomationRuns: () => [{ id: 'r1', workflowId: 'wf', status: 'failed', startedAt: 3000, error: 'boom' }],
    };
    expect(listOrchestrations(deps)).toHaveLength(0);
    const all = listOrchestrations({ ...deps, includeCompleted: true });
    // Sorted by startedAt desc: automation (3000) → crew (1000) → worker (0).
    expect(all.map((e) => e.status)).toEqual(['failed', 'completed', 'draft']);
    expect(all[0].error).toBe('boom');
  });

  it('sorts by startedAt descending across kinds', () => {
    const list = listOrchestrations({
      listCrew: () => [crewRun({ startedAt: 1000 })],
      listWorkers: () => [{ id: 'w1', name: 'w', status: 'running' as const, updatedAt: 3000 }],
      listAutomationRuns: () => [{ id: 'r1', workflowId: 'wf', status: 'running', startedAt: 2000 }],
    });
    // worker (3000) → automation (2000) → crew (1000)
    expect(list.map((e) => e.kind)).toEqual(['worker', 'automation', 'crew']);
  });
});

describe('orchestrateObjective', () => {
  it('routes through buildCrewPlan and runCrew with the objective and leader', async () => {
    const fakePlan = {
      leader: { provider: 'prov', model: 'model-x', free: false },
      members: [],
      strategy: 'single' as const,
      reasons: [],
    };
    const fakeRun = { id: 'crew-run-1', status: 'completed' } as unknown as CrewRun;
    mocks.buildCrewPlan.mockReturnValue(fakePlan);
    mocks.runCrew.mockResolvedValue(fakeRun);

    const onEvent = vi.fn();
    const run = await orchestrateObjective('Fix the flaky test', {
      sessionId: 's1',
      cwd: '.',
      provider: 'prov',
      model: 'model-x',
      parentHistory: [],
      onEvent,
    });

    expect(run).toBe(fakeRun);
    expect(mocks.buildCrewPlan).toHaveBeenCalledWith(
      'Fix the flaky test',
      { provider: 'prov', model: 'model-x', free: false },
      expect.any(Map),
      undefined,
    );
    expect(mocks.runCrew).toHaveBeenCalledWith(fakePlan, expect.objectContaining({
      prompt: 'Fix the flaky test',
      sessionId: 's1',
    }));
  });

  it('passes forced members through to the planner', async () => {
    mocks.buildCrewPlan.mockReturnValue({
      leader: { provider: 'prov', model: 'm', free: false },
      members: [],
      strategy: 'full-crew',
      reasons: [],
    });
    mocks.runCrew.mockResolvedValue({ id: 'r', status: 'completed' } as unknown as CrewRun);

    await orchestrateObjective('Big project', {
      sessionId: 's',
      cwd: '.',
      provider: 'prov',
      model: 'm',
      parentHistory: [],
      onEvent: vi.fn(),
      forceMembers: ['code', 'design'],
    });
    expect(mocks.buildCrewPlan).toHaveBeenCalledWith(
      'Big project',
      expect.anything(),
      expect.anything(),
      ['code', 'design'],
    );
  });
});
