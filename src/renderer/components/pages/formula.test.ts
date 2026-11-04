import { describe, expect, it } from 'vitest';
import type { DatabaseRow, PageDatabase } from '../../../shared/pages';
import { evaluateFormula, formulaResultFor } from './formula';

const database: PageDatabase = {
  properties: [
    { id: 'name', name: 'Name', type: 'title' },
    { id: 'price', name: 'Price', type: 'number' },
    { id: 'qty', name: 'Qty', type: 'number' },
    { id: 'done', name: 'Done', type: 'checkbox' },
    { id: 'stage', name: 'Stage', type: 'select', options: [{ id: 'won', name: 'Won', color: 'green' }] },
    { id: 'due', name: 'Due', type: 'date' },
    { id: 'total', name: 'Total', type: 'formula', formula: 'prop("Price") * prop("Qty")' },
  ],
  rows: [],
  views: [{ id: 'view', name: 'Table', type: 'table' }],
  defaultViewId: 'view',
};

const row: DatabaseRow = {
  id: 'row-1',
  values: {
    name: 'Widget',
    price: 12.5,
    qty: 4,
    done: true,
    stage: 'won',
    due: '2026-10-30',
  },
  order: 0,
  createdAt: 1,
  updatedAt: 1,
};

const run = (expression: string) => evaluateFormula(expression, row, database);

describe('safe database formulas', () => {
  it('follows arithmetic precedence and grouping', () => {
    expect(run('1 + 2 * 3')).toBe('7');
    expect(run('(1 + 2) * 3')).toBe('9');
    expect(run('2 ^ 3')).toBe('8');
    expect(run('10 % 4')).toBe('2');
    expect(run('-4 + 6')).toBe('2');
  });

  it('reads properties by display name and by id', () => {
    expect(run('prop("Price") * prop("Qty")')).toBe('50');
    expect(run('price * qty')).toBe('50');
    expect(run('Name')).toBe('Widget');
    expect(run('concat(Name, " x ", Qty)')).toBe('Widget x 4');
  });

  it('resolves select values to their labels and dates to components', () => {
    expect(run('Stage')).toBe('Won');
    expect(run('year(Due)')).toBe('2026');
    expect(run('month(Due)')).toBe('10');
    expect(run('day(Due)')).toBe('30');
    expect(run('datediff("2026-10-01", Due)')).toBe('29');
  });

  it('evaluates comparisons and boolean logic completely', () => {
    expect(run('Price > 10')).toBe('Yes');
    expect(run('Qty == 4 && Done')).toBe('Yes');
    expect(run('false || true')).toBe('Yes');
    expect(run('true || false')).toBe('Yes');
    expect(run('false && true')).toBe('No');
    expect(run('true && false')).toBe('No');
    expect(run('!Done')).toBe('No');
  });

  it('supports the documented helper functions', () => {
    expect(run('if(Done, "finished", "open")')).toBe('finished');
    expect(run('round(10 / 3, 2)')).toBe('3.33');
    expect(run('ceil(2.1)')).toBe('3');
    expect(run('floor(2.9)')).toBe('2');
    expect(run('abs(0 - 7)')).toBe('7');
    expect(run('len(Name)')).toBe('6');
    expect(run('upper(Name)')).toBe('WIDGET');
    expect(run('lower(Name)')).toBe('widget');
    expect(run('contains(Name, "idg")')).toBe('Yes');
    expect(run('join("a", "b", "-")')).toBe('a-b');
    expect(run('sum(1, 2, 3)')).toBe('6');
    expect(run('avg(2, 4)')).toBe('3');
    expect(run('min(3, 1, 2)')).toBe('1');
    expect(run('max(3, 1, 2)')).toBe('3');
  });

  it('returns an empty string for empty input and blank values', () => {
    expect(run('')).toBe('');
    expect(run('   ')).toBe('');
    expect(run('empty("")')).toBe('Yes');
    expect(run('10 / 0')).toBe('');
  });

  it('renders a stored formula property through its expression', () => {
    expect(formulaResultFor(database.properties[6]!, row, database)).toBe('50');
  });

  it('refuses malformed expressions instead of evaluating code', () => {
    expect(run('1 +')).toBe('#ERROR');
    expect(run('1; alert(1)')).toBe('#ERROR');
    expect(run('unknownFunction(1)')).toBe('#ERROR');
    expect(run('MissingProperty + 1')).toBe('#ERROR');
    expect(run('"unterminated')).toBe('#ERROR');
  });
});
