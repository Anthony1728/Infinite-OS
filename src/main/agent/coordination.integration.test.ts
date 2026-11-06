// Integration test: the delegation pipeline end-to-end.
//
// This is the "agents must cooperate on real tasks" gate: a specialist is
// delegated a task WITH acceptance criteria, its deliverable is mechanically
// verified (file claims checked on disk), a lying specialist gets a revision
// round, the leader receives honest verification lines, and the specialist's
// work is recorded into per-agent memory for its next run.
//
// The LLM is a scripted fake (spawnSubagent mocked) — the pipeline under test
// is the coordination logic, not the model. File checks hit the REAL
// filesystem in a temp dir.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  spawnSubagent: vi.fn(),
  createMemory: vi.fn(),
  recallMemories: vi.fn(() => []),
}));

vi.mock('./runtime.js', () => ({ spawnSubagent: mocks.spawnSubagent }));
vi.mock('../memory/store.js', () => ({
  createMemory: mocks.createMemory,
  recallMemories: mocks.recallMemories,
}));
vi.mock('../providers/registry.js', () => ({
  providerRegistry: {
    testprov: {
      freeModels: [{ id: 'test-coder-model', label: 'Test Coder', supports_tools: true }],
      defaultModel: 'test-coder-model',
    },
  },
}));

import { buildCrewPlan, runCrew, type CrewEvent } from './crew.js';
import {
  deriveAcceptanceCriteria,
  verifyDeliverable,
  renderRevisionRequest,
  extractClaimedPaths,
  agentMemoryDataset,
  type DelegatedTask,
} from './coordination.js';

const leader = { provider: 'testprov', model: 'test-coder-model', free: true };
const noopSink = (_e: CrewEvent) => {};

let workspace = '';

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'infinite-coordination-'));
  mocks.spawnSubagent.mockReset();
  mocks.createMemory.mockReset();
  mocks.recallMemories.mockReset();
  mocks.recallMemories.mockImplementation(() => []);
});

afterEach(() => {
  try { rmSync(workspace, { recursive: true, force: true }); } catch { /* temp best-effort */ }
});

describe('coordination primitives', () => {
  it('derives file-existence criteria for code roles and source criteria for research roles', () => {
    const coder = deriveAcceptanceCriteria('code', 'build a widget');
    expect(coder.some((c) => /absolute path/i.test(c))).toBe(true);
    expect(coder.some((c) => /actually exists on disk/i.test(c))).toBe(true);

    const researcher = deriveAcceptanceCriteria('research', 'market deep dive');
    expect(researcher.some((c) => /source/i.test(c))).toBe(true);
    expect(researcher.some((c) => /exists on disk/i.test(c))).toBe(false);
  });

  it('extractClaimedPaths finds absolute windows and posix paths, trims punctuation', () => {
    const paths = extractClaimedPaths('Wrote C:\\projects\\app\\index.ts. Also /home/user/notes.md.');
    expect(paths).toContain('C:\\projects\\app\\index.ts');
    expect(paths).toContain('/home/user/notes.md');
  });

  it('verifyDeliverable FAILS when the result claims a file that does not exist', () => {
    const task: DelegatedTask = {
      id: 't1',
      role: 'Coding Specialist',
      agentType: 'code',
      prompt: 'x',
      acceptanceCriteria: deriveAcceptanceCriteria('code', 'build a widget'),
      status: 'result_ready',
      result: `Created C:\\definitely\\not\\here\\widget.tsx with the full implementation.`,
      verification: { verdict: 'unverified', checked: [], reasons: [] },
    };
    const v = verifyDeliverable(task, workspace);
    expect(v.verdict).toBe('fail');
    expect(v.reasons.join(' ')).toContain('does not exist');
  });

  it('verifyDeliverable PASSES once the claimed file really exists', () => {
    const claimed = join(workspace, 'widget.tsx');
    writeFileSync(claimed, 'export const widget = 1;\n');
    const task: DelegatedTask = {
      id: 't2',
      role: 'Coding Specialist',
      agentType: 'code',
      prompt: 'x',
      acceptanceCriteria: deriveAcceptanceCriteria('code', 'build a widget'),
      status: 'result_ready',
      result: `Created ${claimed} with the widget implementation.`,
      verification: { verdict: 'unverified', checked: [], reasons: [] },
    };
    const v = verifyDeliverable(task, workspace);
    expect(v.verdict).toBe('pass');
    expect(v.reasons).toHaveLength(0);
  });

  it('verifyDeliverable FAILS a promise-only reply (plan, not delivery)', () => {
    const task: DelegatedTask = {
      id: 't3',
      role: 'Coding Specialist',
      agentType: 'code',
      prompt: 'x',
      acceptanceCriteria: deriveAcceptanceCriteria('code', 'build a widget'),
      status: 'result_ready',
      result: 'I will create the widget component next and then I will run the tests for you.',
      verification: { verdict: 'unverified', checked: [], reasons: [] },
    };
    const v = verifyDeliverable(task, workspace);
    expect(v.verdict).toBe('fail');
    expect(v.reasons.join(' ')).toMatch(/future work/i);
  });

  it('renderRevisionRequest names the failed checks and the definition of done', () => {
    const task: DelegatedTask = {
      id: 't4',
      role: 'Coding Specialist',
      agentType: 'code',
      prompt: 'x',
      acceptanceCriteria: deriveAcceptanceCriteria('code', 'build'),
      status: 'result_ready',
      result: 'Created C:\\nope\\missing.ts',
      verification: {
        verdict: 'fail',
        checked: [],
        reasons: ['Claims file "C:\\nope\\missing.ts" but it does not exist on disk.'],
      },
    };
    const revision = renderRevisionRequest(task, task.verification);
    expect(revision).toContain('FAILED MECHANICAL VERIFICATION');
    expect(revision).toContain('does not exist');
    expect(revision).toContain('DEFINITION OF DONE');
  });

  it('normalizes agent memory datasets', () => {
    expect(agentMemoryDataset('code')).toBe('agent:code');
    expect(agentMemoryDataset('Mobile Dev')).toBe('agent:mobile-dev');
  });
});

describe('runCrew delegation pipeline (integration)', () => {
  it('lying specialist → verification fails → revision → verified → leader sees [verified] → work recorded in agent memory', async () => {
    const ghostPath = join(workspace, 'ghost.ts');
    const realPath = join(workspace, 'real.ts');
    let call = 0;
    mocks.spawnSubagent.mockImplementation(() => {
      call++;
      if (call === 1) {
        // First attempt: claims a file it never wrote — the classic
        // multi-agent failure this pipeline exists to catch.
        return { state: { id: 'm1' }, done: Promise.resolve(`Created ${ghostPath} implementing the feature.`) };
      }
      if (call === 2) {
        // Revision round: this time it really writes the file.
        writeFileSync(realPath, 'export const real = true;\n');
        expect(existsSync(realPath)).toBe(true);
        return { state: { id: 'm1' }, done: Promise.resolve(`Created ${realPath} implementing the feature. Ran tests: 3 passed.`) };
      }
      // Leader integration.
      return { state: { id: 'leader' }, done: Promise.resolve('Integrated delivery complete.') };
    });

    const plan = buildCrewPlan('Build the widget feature', leader, new Map([['testprov', {}]]), ['code']);
    expect(plan.members).toHaveLength(1);

    const run = await runCrew(plan, {
      prompt: 'Build the widget feature',
      sessionId: 'integration-session',
      cwd: workspace,
      parentHistory: [],
      sink: noopSink,
    });

    // Three spawns: specialist, revision, leader.
    expect(mocks.spawnSubagent).toHaveBeenCalledTimes(3);
    // The specialist's task carried the definition of done.
    const specialistTask = mocks.spawnSubagent.mock.calls[0][0].task as string;
    expect(specialistTask).toContain('DEFINITION OF DONE');
    expect(specialistTask).toContain('actually exists on disk');
    // The revision request named the failed check.
    const revisionTask = mocks.spawnSubagent.mock.calls[1][0].task as string;
    expect(revisionTask).toContain('FAILED MECHANICAL VERIFICATION');
    expect(revisionTask).toContain('ghost.ts');
    // The leader received the honest verification line.
    const leaderTask = mocks.spawnSubagent.mock.calls[2][0].task as string;
    expect(leaderTask).toContain('[verified]');
    // The run completed with the verified member.
    expect(run.status).toBe('completed');
    const member = run.plan.members[0];
    expect(member.status).toBe('completed');
    expect(member.verification?.verdict).toBe('pass');
    // Per-agent memory: the specialist's work was recorded under its dataset.
    expect(mocks.createMemory).toHaveBeenCalledTimes(1);
    const memoryArg = mocks.createMemory.mock.calls[0][0];
    expect(memoryArg.dataset).toBe('agent:code');
    expect(memoryArg.content).toContain('real.ts');
  });

  it('specialist that keeps lying after revision is reported [UNVERIFIED] to the leader, not silently trusted', async () => {
    let call = 0;
    mocks.spawnSubagent.mockImplementation(() => {
      call++;
      if (call <= 2) {
        return { state: { id: 'm1' }, done: Promise.resolve(`Created C:\\nowhere\\at-all\\phantom.ts fully implemented.`) };
      }
      return { state: { id: 'leader' }, done: Promise.resolve('Integrated with my own checks.') };
    });

    const plan = buildCrewPlan('Build the thing', leader, new Map([['testprov', {}]]), ['code']);
    const run = await runCrew(plan, {
      prompt: 'Build the thing',
      sessionId: 'integration-session-2',
      cwd: workspace,
      parentHistory: [],
      sink: noopSink,
    });

    expect(mocks.spawnSubagent).toHaveBeenCalledTimes(3);
    const member = run.plan.members[0];
    expect(member.verification?.verdict).toBe('fail');
    const leaderTask = mocks.spawnSubagent.mock.calls[2][0].task as string;
    expect(leaderTask).toContain('[UNVERIFIED');
    expect(leaderTask).toContain('does not exist');
    expect(run.status).toBe('completed');
  });

  it('a leader whose integrated delivery claims missing files is itself caught and revised', async () => {
    // Specialist behaves perfectly; the LEADER then overclaims a file that
    // does not exist. The hierarchy bar must apply at the top too: the leader
    // gets a revision round, and the run report carries the final verdict.
    const realPath = join(workspace, 'honest.ts');
    writeFileSync(realPath, 'export const honest = true;\n');
    let call = 0;
    mocks.spawnSubagent.mockImplementation(() => {
      call++;
      if (call === 1) {
        return { state: { id: 'm1' }, done: Promise.resolve(`Created ${realPath} with the core implementation.`) };
      }
      if (call === 2) {
        // Leader attempt 1: integrates the real file but ALSO claims a phantom one.
        return { state: { id: 'leader' }, done: Promise.resolve(`Integrated everything. Final delivery: ${realPath} plus C:\\fabricated\\summary.md written and verified.`) };
      }
      // Leader attempt 2 (revision): honest delivery only.
      return { state: { id: 'leader' }, done: Promise.resolve(`Final delivery: ${realPath} — all claims re-checked against disk.`) };
    });

    const plan = buildCrewPlan('Build the honest thing', leader, new Map([['testprov', {}]]), ['code']);
    const run = await runCrew(plan, {
      prompt: 'Build the honest thing',
      sessionId: 'integration-session-3',
      cwd: workspace,
      parentHistory: [],
      sink: noopSink,
    });

    // 4 spawns: specialist → leader → leader revision (no second member call).
    expect(mocks.spawnSubagent).toHaveBeenCalledTimes(3);
    const leaderRevisionTask = mocks.spawnSubagent.mock.calls[2][0].task as string;
    expect(leaderRevisionTask).toContain('FAILED MECHANICAL VERIFICATION');
    expect(leaderRevisionTask).toContain('summary.md');
    expect(run.status).toBe('completed');
    expect(run.report?.leaderVerification?.verdict).toBe('pass');
    expect(run.report?.leaderResult).toContain('honest.ts');
    expect(run.report?.summary).toContain('pass');
  });
});
