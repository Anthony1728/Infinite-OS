import { describe, it, expect } from 'vitest';
import { parseTscOutput, parseColonOutput } from './lsp.js';

describe('parseTscOutput', () => {
  it('parses tsc --pretty false lines', () => {
    const out = parseTscOutput(
      'src/main/index.ts(42,7): error TS2551: Property \'namee\' does not exist. Did you mean \'name\'?\nsrc/lib/x.ts(3,1): error TS2304: Cannot find name \'foo\'.\n',
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ file: 'src/main/index.ts', line: 42, column: 7, severity: 'error', source: 'tsc' });
    expect(out[0].message).toContain('does not exist');
  });

  it('ignores summary lines', () => {
    expect(parseTscOutput('Found 2 errors in 2 files.\n\n')).toHaveLength(0);
  });
});

describe('parseColonOutput', () => {
  it('parses ruff/pyright colon diagnostics', () => {
    const out = parseColonOutput(
      'app.py:10:5: ERROR: undefined name `foo`\napp.py:20:1: warning: unused import os\n',
      'ruff',
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ file: 'app.py', line: 10, severity: 'error', source: 'ruff' });
    expect(out[1].severity).toBe('warning');
  });
});
