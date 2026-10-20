import { describe, expect, it } from 'vitest';
import {
  CellError,
  cellMatrix,
  evaluateCell,
  evaluateSheet,
  formatCellValue,
  matrixToCells,
} from './sheet.js';

const show = (cells: Record<string, string>, address: string): string =>
  formatCellValue(evaluateCell(cells, address));

describe('sheet formula engine', () => {
  it('applies arithmetic precedence and parentheses', () => {
    expect(show({ A1: '=2+3*4' }, 'A1')).toBe('14');
    expect(show({ A1: '=(2+3)*4' }, 'A1')).toBe('20');
    expect(show({ A1: '=2^3^2' }, 'A1')).toBe('512');
    expect(show({ A1: '=-4+2' }, 'A1')).toBe('-2');
    expect(show({ A1: '=50%' }, 'A1')).toBe('0.5');
  });

  it('resolves references and ranges', () => {
    const cells = { A1: '2', A2: '3', A3: '5', A4: '=A1+A2*2', A5: '=SUM(A1:A3)', A6: '=AVERAGE(A1:A3)' };
    expect(show(cells, 'A4')).toBe('8');
    expect(show(cells, 'A5')).toBe('10');
    expect(show(cells, 'A6')).toBe('3.333333333');
  });

  it('treats blank cells as zero in arithmetic but not in COUNTA', () => {
    expect(show({ A1: '=B1+2' }, 'A1')).toBe('2');
    expect(show({ A1: '=COUNTA(B1:B3)' }, 'A1')).toBe('0');
  });

  it('concatenates text and formats booleans', () => {
    expect(show({ A1: 'Ada', A2: '=A1&" Lovelace"' }, 'A2')).toBe('Ada Lovelace');
    expect(show({ A1: '=1=1' }, 'A1')).toBe('TRUE');
    expect(show({ A1: '=LEN(UPPER("hello"))' }, 'A1')).toBe('5');
    expect(show({ A1: '=TRIM("  a   b  ")' }, 'A1')).toBe('a b');
  });

  it('supports conditional logic', () => {
    const cells = { A1: '72', A2: '=IF(A1>=70,"pass","fail")', A3: '=IFERROR(1/0,"safe")' };
    expect(show(cells, 'A2')).toBe('pass');
    expect(show(cells, 'A3')).toBe('safe');
    expect(show({ A1: '=AND(TRUE,1=1)' }, 'A1')).toBe('TRUE');
    expect(show({ A1: '=NOT(FALSE)' }, 'A1')).toBe('TRUE');
  });

  it('supports aggregate and math functions', () => {
    const cells = {
      A1: '1', A2: '2', A3: '3', A4: 'text',
      B1: '=COUNT(A1:A4)', B2: '=COUNTA(A1:A4)', B3: '=MAX(A1:A3)',
      B4: '=MIN(A1:A3)', B5: '=MEDIAN(A1:A3)', B6: '=PRODUCT(A1:A3)',
      B7: '=ROUND(3.14159,2)', B8: '=ABS(-7)', B9: '=SQRT(81)', B10: '=POWER(2,10)',
    };
    expect(show(cells, 'B1')).toBe('3');
    expect(show(cells, 'B2')).toBe('4');
    expect(show(cells, 'B3')).toBe('3');
    expect(show(cells, 'B4')).toBe('1');
    expect(show(cells, 'B5')).toBe('2');
    expect(show(cells, 'B6')).toBe('6');
    expect(show(cells, 'B7')).toBe('3.14');
    expect(show(cells, 'B8')).toBe('7');
    expect(show(cells, 'B9')).toBe('9');
    expect(show(cells, 'B10')).toBe('1024');
  });

  it('returns errors as values without throwing', () => {
    expect(show({ A1: '=1/0' }, 'A1')).toBe('#DIV/0!');
    expect(show({ A1: '=NOPE(1)' }, 'A1')).toBe('#NAME?');
    expect(show({ A1: '=ZZ1' }, 'A1')).toBe('#REF!');
    expect(show({ A1: '=1+' }, 'A1')).toBe('#VALUE!');
    expect(show({ A1: '="unterminated' }, 'A1')).toBe('#VALUE!');
  });

  it('detects circular references', () => {
    expect(show({ A1: '=B1', B1: '=A1' }, 'A1')).toBe('#CYCLE!');
    expect(show({ A1: '=A1+1' }, 'A1')).toBe('#CYCLE!');
    expect(show({ A1: '=IF(TRUE,1,B1)', B1: '=A1' }, 'A1')).toBe('1');
  });

  it('handles quoted strings and escaped quotes', () => {
    expect(show({ A1: '="hello, world"' }, 'A1')).toBe('hello, world');
    expect(show({ A1: '="she said ""hi"""' }, 'A1')).toBe('she said "hi"');
  });

  it('formats every formula in a sheet once', () => {
    const sheet = evaluateSheet({ A1: '2', A2: '=A1*3', A3: '=A2+1' });
    expect(sheet).toEqual({ A1: '2', A2: '6', A3: '7' });
  });

  it('round-trips tables to cell maps', () => {
    const cells = matrixToCells([['Name', 'Score'], ['Ada', '10'], ['', '20']]);
    expect(cells).toEqual({ A1: 'Name', B1: 'Score', A2: 'Ada', B2: '10', B3: '20' });
    const matrix = cellMatrix({ A1: '1', B2: '=A1+1' }, 3, 3);
    expect(matrix[0][0]).toBe('1');
    expect(matrix[1][1]).toBe('2');
    expect(matrix[2][2]).toBe('');
  });

  it('exposes CellError for callers that branch on failure', () => {
    const value = evaluateCell({ A1: '=1/0' }, 'A1');
    expect(value).toBeInstanceOf(CellError);
    expect((value as CellError).code).toBe('#DIV/0!');
  });
});
