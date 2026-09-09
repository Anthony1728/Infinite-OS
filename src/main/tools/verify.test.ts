import { describe, expect, it } from 'vitest';
import { detectChecks } from './verify.js';
import { verifyTool } from './verify.js';
import type { ToolContext } from './base.js';

function ctx(cwd: string): ToolContext {
  return { cwd, abortSignal: AbortSignal.timeout(30000), sessionId: 'test', onUpdate: () => {} };
}

const pkg = (scripts: Record<string, string>) => () => ({ scripts });

describe('detectChecks', () => {
  it('prefers package.json scripts in typecheck/lint/test/build order', () => {
    const exists = (p: string) => p.endsWith('package.json');
    const { checks, note } = detectChecks('/w', exists, pkg({ test: 'vitest', build: 'x', typecheck: 'tsc', lint: 'eslint' }));
    expect(checks.map((c) => c.label)).toEqual(['npm run typecheck', 'npm run lint', 'npm run test', 'npm run build']);
    expect(note).toMatch(/Node project/);
  });

  it('falls back to pytest and go toolchains', () => {
    expect(detectChecks('/w', (p) => p.endsWith('pytest.ini'), () => null).checks.map((c) => c.label)).toEqual(['pytest']);
    expect(detectChecks('/w', (p) => p.endsWith('go.mod'), () => null).checks.map((c) => c.label)).toEqual(['go vet', 'go test']);
  });

  it('reports nothing to verify for unknown workspaces', () => {
    const { checks, note } = detectChecks('/w', () => false, () => null);
    expect(checks).toEqual([]);
    expect(note).toMatch(/No supported project/);
  });
});

describe('verifyTool', () => {
  it('returns the no-project note without spawning anything', async () => {
    const res = await verifyTool.execute({}, ctx('/definitely/not/a/project-xyz'));
    expect(res.is_error).toBeFalsy();
    expect(String(res.content)).toMatch(/No supported project/);
  });

  it('rejects unknown check selectors', async () => {
    // Point at this repo (has package.json scripts) but ask for nonsense.
    const res = await verifyTool.execute({ only: ['no-such-check'] }, ctx(process.cwd()));
    expect(res.is_error).toBe(true);
    expect(String(res.content)).toMatch(/Available:/);
  });
});
