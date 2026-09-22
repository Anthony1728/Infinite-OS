import { describe, it, expect, beforeEach } from 'vitest';
import {
  setPlanMode,
  isPlanMode,
  planModeCheck,
  planModeGuard,
  resolveExitPlan,
  getPendingExitPlan,
  awaitPlanApproval,
} from './plan-mode.js';
import type { ToolResult } from '../tools/base.js';

describe('plan mode gate', () => {
  beforeEach(() => {
    setPlanMode('s1', false);
    setPlanMode('s2', false);
  });

  it('toggles per session', () => {
    expect(isPlanMode('s1')).toBe(false);
    setPlanMode('s1', true);
    expect(isPlanMode('s1')).toBe(true);
    expect(isPlanMode('s2')).toBe(false);
    setPlanMode('s1', false);
    expect(isPlanMode('s1')).toBe(false);
  });

  it('allows read-only tools', () => {
    for (const tool of ['Read', 'Glob', 'Grep', 'WebSearch', 'TodoWrite', 'ExitPlan']) {
      expect(planModeCheck(tool, {}).allowed).toBe(true);
    }
  });

  it('blocks file mutations with an explanatory reason', () => {
    for (const [tool, input] of [
      ['Write', { file_path: 'src/x.ts', content: 'x' }],
      ['Edit', { file_path: 'src/x.ts', old_string: 'a', new_string: 'b' }],
      ['Delete', { path: 'src/x.ts' }],
    ] as const) {
      const verdict = planModeCheck(tool, input);
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toContain('plan mode');
    }
  });

  it('allows read-only bash and blocks mutating bash', () => {
    expect(planModeCheck('Bash', { command: 'git status' }).allowed).toBe(true);
    expect(planModeCheck('Bash', { command: 'ls -la' }).allowed).toBe(true);
    expect(planModeCheck('Bash', { command: 'npm run typecheck' }).allowed).toBe(false);
    expect(planModeCheck('Bash', { command: 'rm -rf src' }).allowed).toBe(false);
    expect(planModeCheck('Bash', { command: 'npm install left-pad' }).allowed).toBe(false);
    expect(planModeCheck('Bash', { command: 'git commit -m x' }).allowed).toBe(false);
    expect(planModeCheck('Bash', { command: 'echo hi > file.txt' }).allowed).toBe(false);
    expect(planModeCheck('Bash', { command: 'a && b' }).allowed).toBe(false);
  });

  it('guards action-enum tools by action', () => {
    expect(planModeCheck('FileOps', { action: 'list' }).allowed).toBe(true);
    expect(planModeCheck('FileOps', { action: 'move' }).allowed).toBe(false);
    expect(planModeCheck('Computer', { action: 'screenshot' }).allowed).toBe(true);
    expect(planModeCheck('Computer', { action: 'click' }).allowed).toBe(false);
  });

  it('fails closed for unknown mutating tools', () => {
    expect(planModeCheck('Deploy', { action: 'deploy' }).allowed).toBe(false);
    expect(planModeCheck('MysteryTool', {}).allowed).toBe(false);
  });

  it('planModeGuard returns null when inactive and a block when active', () => {
    expect(planModeGuard('s1', 'Write', { file_path: 'x' })).toBeNull();
    setPlanMode('s1', true);
    const block = planModeGuard('s1', 'Write', { file_path: 'x' }) as ToolResult;
    expect(block.is_error).toBe(true);
    expect(String(block.content)).toContain('plan mode');
  });

  it('resolveExitPlan returns false with nothing pending and approves pending plans', async () => {
    expect(resolveExitPlan('s1', true)).toBe(false);
    setPlanMode('s1', true);
    const promise = awaitPlanApproval('s1', 'the plan', 5_000);
    expect(getPendingExitPlan('s1')?.plan).toBe('the plan');
    expect(resolveExitPlan('s1', true)).toBe(true);
    await expect(promise).resolves.toBe(true);
    // Approval lifts the gate
    expect(isPlanMode('s1')).toBe(false);
  });

  it('declining keeps plan mode active and resolves false', async () => {
    setPlanMode('s1', true);
    const promise = awaitPlanApproval('s1', 'plan', 5_000);
    expect(resolveExitPlan('s1', false)).toBe(true);
    await expect(promise).resolves.toBe(false);
    expect(isPlanMode('s1')).toBe(true);
  });
});
