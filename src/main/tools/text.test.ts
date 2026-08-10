import { describe, expect, it } from 'vitest';
import { textTool } from './text.js';
import { lineDiff } from './text.js';

function exec(action: string, args: Record<string, unknown>) {
  return textTool.execute({ action, ...args }, {} as never);
}

describe('Text tool', () => {
  it('converts between case styles', async () => {
    const cases = [
      ['camel', 'camelCaseValue'],
      ['pascal', 'CamelCaseValue'],
      ['snake', 'camel_case_value'],
      ['kebab', 'camel-case-value'],
      ['constant', 'CAMEL_CASE_VALUE'],
    ] as const;
    for (const [style, expected] of cases) {
      const result = await exec('case', { text: 'camel case value', style });
      expect(String(result.content)).toBe(expected);
    }
  });

  it('slugifies text with unicode normalization', async () => {
    const result = await exec('slugify', { text: 'Café Näive — 100%!  ' });
    expect(String(result.content)).toBe('cafe-naive-100');
  });

  it('truncates with a configurable suffix', async () => {
    const short = await exec('truncate', { text: 'hello world', max: 20 });
    expect(String(short.content)).toBe('hello world');
    const long = await exec('truncate', { text: 'abcdefghij', max: 6 });
    expect(String(long.content)).toBe('abcde…'); // 5 chars + 1-char suffix = 6 total
  });

  it('counts chars, words, lines, and sentences', async () => {
    const result = await exec('count', { text: 'One. Two words. Three!\nNew line.' });
    expect(JSON.parse(String(result.content))).toMatchObject({ words: 6, lines: 2 });
  });

  it('produces a correct line diff', async () => {
    const result = await exec('diff', { a: 'a\nb\nc', b: 'a\nx\nc' });
    expect(String(result.content)).toContain('- b');
    expect(String(result.content)).toContain('+ x');
    expect(String(result.content)).toContain('  a');
  });

  it('splits and joins by delimiter', async () => {
    const split = await exec('split', { text: 'a,b,c', delimiter: ',' });
    expect(JSON.parse(String(split.content)).parts).toEqual(['a', 'b', 'c']);
    const joined = await exec('join', { lines: ['a', 'b', 'c'], delimiter: ',' });
    expect(String(joined.content)).toBe('a,b,c');
  });

  it('finds and replaces with regex', async () => {
    const found = await exec('regex_find', { text: 'id=1 id=22', pattern: 'id=(\\d+)' });
    expect(JSON.parse(String(found.content)).count).toBe(2);
    const replaced = await exec('regex_replace', { text: '2024-01-15', pattern: '(\\d{4})-(\\d{2})-(\\d{2})', replacement: '$3/$2/$1' });
    expect(String(replaced.content)).toBe('15/01/2024');
  });

  it('converts CSV to markdown and back', async () => {
    const md = await exec('csv_to_markdown', { csv: 'a,b\n1,2' });
    const mdText = String(md.content);
    expect(mdText).toContain('| a | b |');
    expect(mdText).toContain('| --- | --- |');

    const csv = await exec('markdown_to_csv', { md: mdText });
    expect(String(csv.content)).toBe('a,b\n1,2');
  });

  it('encodes and decodes base64 and URLs', async () => {
    const encoded = await exec('base64_encode', { text: 'hello' });
    expect(String(encoded.content)).toBe('aGVsbG8=');
    const decoded = await exec('base64_decode', { text: 'aGVsbG8=' });
    expect(String(decoded.content)).toBe('hello');

    const url = await exec('url_encode', { text: 'a b&c' });
    expect(String(url.content)).toBe('a%20b%26c');
  });

  it('wraps long text at a width', async () => {
    const result = await exec('wrap', { text: 'one two three four', width: 8 });
    const lines = String(result.content).split('\n');
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(8);
    expect(lines.length).toBeGreaterThan(1);
  });

  it('exposes a standalone lineDiff export', () => {
    expect(lineDiff('alpha\nbeta', 'alpha\ngamma')).toContain('- beta');
    expect(lineDiff('alpha\nbeta', 'alpha\ngamma')).toContain('+ gamma');
  });
});
