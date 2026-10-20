import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from './csv.js';

describe('CSV', () => {
  it('parses simple rows', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  it('handles quoted commas, newlines, and escaped quotes', () => {
    expect(parseCsv('name,note\n"Ada, A.","said ""hi""\nnext line"')).toEqual([
      ['name', 'note'],
      ['Ada, A.', 'said "hi"\nnext line'],
    ]);
  });

  it('handles CRLF and a trailing newline', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('keeps empty leading fields and removes only a trailing blank record', () => {
    expect(parseCsv(',x\n,y\n')).toEqual([['', 'x'], ['', 'y']]);
  });

  it('round-trips through toCsv', () => {
    const rows = [['plain', 'has,comma', 'has"quote'], ['line\nbreak', '', 'ok']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});
