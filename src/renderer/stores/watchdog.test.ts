import { describe, it, expect, beforeEach } from 'vitest';
import { evaluateWatchdogPass, useWatchdogStore, resetWatchdog } from './watchdog';
import { useAgentsStore, type AgentRun } from './agents';

function liveRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-1',
    agentId: 'agent-1',
    sessionId: 'session-1',
    status: 'running',
    task: 'Summarize the quarterly report',
    startedAt: Date.now(),
    toolCallCount: 2,
    activity: [
      { id: 'a1', timestamp: Date.now(), kind: 'status', label: 'started' },
      { id: 'a2', timestamp: Date.now(), kind: 'tool', label: 'web_search' },
    ],
    ...overrides,
  };
}

function setRuns(runs: AgentRun[]): void {
  useAgentsStore.setState({ runs });
}

describe('agent watchdog', () => {
  beforeEach(() => {
    setRuns([]);
    resetWatchdog();
    useWatchdogStore.setState({ findings: [] });
  });

  it('does nothing while no agent is running', () => {
    setRuns([liveRun({ status: 'completed' })]);
    const findings = evaluateWatchdogPass();
    expect(findings).toEqual([]);
  });

  it('gives a fresh run a full grace period (no immediate stall finding)', () => {
    setRuns([liveRun()]);
    const findings = evaluateWatchdogPass();
    expect(findings).toEqual([]);
  });

  it('flags a stalled agent after 15 minutes without progress', () => {
    const stalled = liveRun();
    setRuns([stalled]);
    const first = evaluateWatchdogPass(1_000_000); // observation seeded
    expect(first).toEqual([]);
    // Second pass, 16 minutes later, fingerprint unchanged → stalled.
    const findings = evaluateWatchdogPass(1_000_000 + 16 * 60_000);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('stalled');
    expect(findings[0].detail).toContain('looks stuck');
  });

  it('flags a looping agent that repeats one tool call', () => {
    const now = Date.now();
    setRuns([
      liveRun({
        activity: Array.from({ length: 5 }, (_, i) => ({
          id: `a${i}`,
          timestamp: now,
          kind: 'tool' as const,
          label: 'read_file',
        })),
      }),
    ]);
    const findings = evaluateWatchdogPass();
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('looping');
    expect(findings[0].toolName).toBe('read_file');
    expect(findings[0].repeatCount).toBe(4);
  });

  it('stays quiet when the tail alternates tools (no loop)', () => {
    const now = Date.now();
    setRuns([
      liveRun({
        activity: ['read_file', 'grep', 'read_file', 'grep'].map((label, i) => ({
          id: `a${i}`,
          timestamp: now,
          kind: 'tool' as const,
          label,
        })),
      }),
    ]);
    expect(evaluateWatchdogPass()).toEqual([]);
  });

  it('progress resets the stall clock (fingerprint change)', () => {
    const run = liveRun();
    setRuns([run]);
    evaluateWatchdogPass(1_000_000);
    // The agent makes progress: a new activity entry lands.
    setRuns([
      liveRun({
        toolCallCount: 3,
        activity: [
          ...(run.activity ?? []),
          { id: 'a3', timestamp: 1_100_000, kind: 'tool', label: 'write_file' },
        ],
      }),
    ]);
    const findings = evaluateWatchdogPass(1_000_000 + 20 * 60_000);
    expect(findings).toEqual([]);
  });

  it('dismiss resets the clock so the same condition gets a fresh grace period', () => {
    const run = liveRun();
    setRuns([run]);
    evaluateWatchdogPass(1_000_000);
    const findings = evaluateWatchdogPass(1_000_000 + 16 * 60_000);
    expect(findings).toHaveLength(1);
    useWatchdogStore.getState().evaluate();
    useWatchdogStore.setState({ findings });
    useWatchdogStore.getState().dismiss(findings[0]);
    expect(useWatchdogStore.getState().findings).toEqual([]);
    // Still stalled in truth — but the grace period restarts, so the next
    // immediate pass stays quiet.
    const again = evaluateWatchdogPass(1_000_000 + 17 * 60_000);
    expect(again).toEqual([]);
  });
});
