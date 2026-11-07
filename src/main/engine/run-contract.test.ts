// Run-contract tests: the execution engine's proof-of-work gate.
//
// These prove the mechanism that caught the REAL eval failure (2026-11-11):
// a model said "Created notes/welcome.md ... verified" with zero writes and
// the run finished successfully. The contract evaluates claims against the
// REAL filesystem and drives the revision/honest-failure decision.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluateFileClaims, extractClaimedPaths, renderClaimRevisionDirective } from './run-contract.js';

let cwd = '';

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'infinite-contract-'));
});

afterEach(() => {
  try { rmSync(cwd, { recursive: true, force: true }); } catch { /* temp best-effort */ }
});

describe('extractClaimedPaths', () => {
  it('finds absolute Windows and POSIX paths, trims punctuation', () => {
    const paths = extractClaimedPaths('Wrote C:\\projects\\app\\index.ts. Also /home/user/notes.md.');
    expect(paths).toContain('C:\\projects\\app\\index.ts');
    expect(paths).toContain('/home/user/notes.md');
  });

  it('does not match bare relative filenames (those are verified by the eval checks)', () => {
    expect(extractClaimedPaths('created notes/welcome.md').filter((p) => p.includes(':') || p.startsWith('/'))).toEqual([]);
  });
});

describe('evaluateFileClaims', () => {
  it('PASSES when every claimed file exists on disk', () => {
    const file = join(cwd, 'widget.tsx');
    writeFileSync(file, 'export const widget = 1;\n');
    const { claimed, missing } = evaluateFileClaims(`Created ${file} with the widget implementation.`, cwd);
    expect(claimed).toContain(file);
    expect(missing).toEqual([]);
  });

  it('FAILS when the claimed file does not exist — the hallucination case', () => {
    const { missing } = evaluateFileClaims('Created C:\\definitely\\not\\here\\widget.tsx with the implementation.', cwd);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain('widget.tsx');
  });

  it('reports no claims for replies that name no paths', () => {
    const { claimed, missing } = evaluateFileClaims('I considered the problem and have a plan.', cwd);
    expect(claimed).toEqual([]);
    expect(missing).toEqual([]);
  });

  it('verifies MULTIPLE claims and reports only the phantom ones', () => {
    const real = join(cwd, 'real.ts');
    writeFileSync(real, 'export {};\n');
    const { missing } = evaluateFileClaims(
      `Created ${real} and ${join(cwd, 'phantom.ts')} — both fully implemented.`,
      cwd,
    );
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain('phantom.ts');
  });
});

describe('renderClaimRevisionDirective', () => {
  it('names the missing files and demands real writes', () => {
    const directive = renderClaimRevisionDirective(['C:\\nope\\a.ts', 'C:\\nope\\b.ts']);
    expect(directive).toContain('FAILED');
    expect(directive).toContain('C:\\nope\\a.ts');
    expect(directive).toContain('Write tool');
  });
});
