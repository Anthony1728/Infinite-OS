import { describe, expect, it } from 'vitest';
import { buildDiff, previewForTool } from './diff';

describe('permission diff preview', () => {
  it('marks context, removals, and additions', () => {
    const diff = buildDiff('const a = 1;\nconst b = 2;\n', 'const a = 1;\nconst b = 3;\nconst c = 4;\n');
    expect(diff.removed).toBe(1);
    expect(diff.added).toBe(2);
    expect(diff.lines.some((line) => line.kind === 'context' && line.text === 'const a = 1;')).toBe(true);
    expect(diff.lines.some((line) => line.kind === 'remove' && line.text === 'const b = 2;')).toBe(true);
    expect(diff.lines.some((line) => line.kind === 'add' && line.text === 'const b = 3;')).toBe(true);
  });

  it('treats a new file as all additions', () => {
    const diff = buildDiff('', 'one\ntwo\n');
    expect(diff.removed).toBe(0);
    expect(diff.added).toBe(3);
    expect(diff.lines.every((line) => line.kind === 'add')).toBe(true);
  });

  it('normalizes CRLF and CR line endings', () => {
    const diff = buildDiff('a\r\nb\r\n', 'a\r\nb\r\nc\r\n');
    expect(diff.lines.some((line) => line.kind === 'add' && line.text === 'c')).toBe(true);
    expect(diff.lines.some((line) => line.text.includes('\r'))).toBe(false);
  });

  it('bounds very large diffs and reports truncation', () => {
    const oldText = Array.from({ length: 800 }, (_, i) => `old-${i}`).join('\n');
    const newText = Array.from({ length: 800 }, (_, i) => `new-${i}`).join('\n');
    const diff = buildDiff(oldText, newText, 20);
    expect(diff.truncated).toBe(true);
    expect(diff.lines.length).toBeLessThanOrEqual(21);
    expect(diff.added).toBeGreaterThan(0);
    expect(diff.removed).toBeGreaterThan(0);
  });

  it('previews Edit, Write, and shell tools without leaking unsupported input', () => {
    const edit = previewForTool('Edit', { file_path: 'src/a.ts', old_string: 'old', new_string: 'new', replace_all: true });
    expect(edit?.kind).toBe('diff');
    expect(edit?.path).toBe('src/a.ts');
    expect(edit?.note).toContain('every occurrence');

    const write = previewForTool('Write', { file_path: 'src/b.ts', content: 'hello\n' });
    expect(write?.kind).toBe('content');
    expect(write?.diff?.added).toBe(2);

    const bash = previewForTool('Bash', { command: 'npm test' });
    expect(bash).toEqual({ kind: 'command', text: 'npm test' });

    expect(previewForTool('Read', { file_path: 'x' })).toBeNull();
  });
});
