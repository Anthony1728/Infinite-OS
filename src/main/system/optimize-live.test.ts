import { describe, expect, it } from 'vitest';
import { analyse, listStartupItems, sampleProcesses, tempFileFindings, isProtectedProcess } from './optimize.js';

/**
 * Live probes against this actual machine.
 *
 * These are not mockable: the whole feature is about reading real Windows state,
 * so it is verified against real Windows. They assert only that the reading works
 * and is honest — never what the findings should be, which depends on the
 * machine.
 */

const isWindows = process.platform === 'win32';
const suite = isWindows ? describe : describe.skip;

suite('reading this machine', () => {
  it('reads the real startup entries', async () => {
    const items = await listStartupItems();
    // A Windows machine always has at least a couple of startup entries.
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(typeof item.name).toBe('string');
      expect(typeof item.command).toBe('string');
      // No invented fields: the shape comes from PowerShell.
      expect(item.source).toMatch(/^(HKCU|HKLM|HKLM32|startup-folder|task)$/);
    }
  }, 60_000);

  it('measures real process CPU over a window, not a guess', async () => {
    const processes = await sampleProcesses(3000);
    expect(Array.isArray(processes)).toBe(true);
    for (const p of processes) {
      // Cumulative CPU seconds would produce huge numbers; these must be a
      // percentage of one core over the sample window.
      expect(p.cpuPercent).toBeGreaterThanOrEqual(0);
      expect(p.cpuPercent).toBeLessThan(400);
      expect(p.memoryMb).toBeGreaterThanOrEqual(0);
    }
  }, 60_000);

  it('measures real temp file usage', async () => {
    const findings = await tempFileFindings();
    for (const finding of findings) {
      expect(finding.tier).toBe('safe');
      // The evidence names the directories it actually measured.
      expect(finding.evidence).toMatch(/Measured/);
      expect(finding.detail).toMatch(/GB in .* files/);
    }
  }, 120_000);

  it('produces findings that are all honestly tiered', async () => {
    const findings = await analyse({ busyNames: [] });
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(['safe', 'ask', 'report']).toContain(finding.tier);
      // Nothing is presented without evidence of where the claim came from.
      expect(finding.evidence.length).toBeGreaterThan(0);
      // Anything that needs a human must say what they give up.
      if (finding.tier === 'ask') expect(finding.tradeoff && finding.tradeoff.length > 0).toBe(true);
      // Report-only findings never carry an action.
      if (finding.tier === 'report') expect(finding.action).toBeUndefined();
      // And anything actionable names its target.
      if (finding.action) expect(finding.action.kind).toBeTruthy();
    }
  }, 120_000);

  it('never proposes an action for a protected Windows component', async () => {
    const findings = await analyse({ busyNames: [] });
    for (const finding of findings) {
      if (finding.action?.kind === 'stop-process' && finding.action.target) {
        // Ending a protected process is never on the table, whatever its cost.
        expect(isProtectedProcess(finding.action.target)).toBe(false);
      }
      if (finding.action?.kind === 'set-service' && finding.action.target) {
        expect(['SysMain', 'WSearch', 'XboxNetApiSvc', 'Spooler']).toContain(finding.action.target);
      }
    }
  }, 120_000);

  it('leaves alone anything the user currently has open', async () => {
    // Pass a real running process name as "busy" and confirm it is not offered.
    const processes = await sampleProcesses(2000);
    const target = processes.find((p) => p.cpuPercent > 1 || p.memoryMb > 200);
    if (!target) return; // nothing heavy running right now
    const findings = await analyse({ busyNames: [target.name] });
    const offending = findings.find((f) => f.action?.kind === 'stop-process' && f.action.target === target.name);
    expect(offending).toBeUndefined();
  }, 180_000);
});