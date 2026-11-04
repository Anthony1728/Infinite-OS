import type {
  DatabaseProperty,
  DatabaseRow,
  DatabaseView,
  PageDatabase,
} from '../../../shared/pages';
import { evaluateFormula } from './formula';
import { databaseValueText } from './pageUtils';

export function databaseTitleProperty(database: PageDatabase): DatabaseProperty | undefined {
  return database.properties.find((property) => property.type === 'title');
}

export function databaseRowTitle(database: PageDatabase, row: DatabaseRow): string {
  const title = databaseTitleProperty(database);
  const value = title ? row.values[title.id] : null;
  return databaseValueText(value).trim() || 'Untitled';
}

function comparableValue(property: DatabaseProperty, row: DatabaseRow, database: PageDatabase): string | number | boolean | string[] | null {
  const value = row.values[property.id];
  if (property.type === 'formula') {
    const result = evaluateFormula(property.formula ?? '', row, database);
    return result === '' || result === '#ERROR' ? null : result;
  }
  if (property.type === 'select' || property.type === 'status') {
    return typeof value === 'string' ? value : null;
  }
  if (property.type === 'multi_select') return Array.isArray(value) ? value : [];
  if (property.type === 'number') return typeof value === 'number' ? value : null;
  if (property.type === 'checkbox') return value === true;
  if (property.type === 'date') return typeof value === 'string' && value ? value : null;
  if (value === null || value === undefined) return null;
  return databaseValueText(value);
}

function isEmpty(value: string | number | boolean | string[] | null): boolean {
  return value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

function compareText(actual: unknown, expected: unknown): number {
  return databaseValueText(actual).localeCompare(databaseValueText(expected), undefined, { numeric: true, sensitivity: 'base' });
}

function filterMatches(property: DatabaseProperty, row: DatabaseRow, database: PageDatabase, filter: NonNullable<NonNullable<DatabaseView['filters']>['filters']>[number]): boolean {
  const raw = comparableValue(property, row, database);
  const expected = filter.value;
  switch (filter.operator) {
    case 'is_empty':
      return isEmpty(raw);
    case 'is_not_empty':
      return !isEmpty(raw);
    case 'is_checked':
      return raw === true;
    case 'is_unchecked':
      return raw !== true;
    case 'contains':
      if (Array.isArray(raw)) return raw.includes(String(expected ?? ''));
      return databaseValueText(raw).toLowerCase().includes(databaseValueText(expected).toLowerCase());
    case 'not_contains':
      if (Array.isArray(raw)) return !raw.includes(String(expected ?? ''));
      return !databaseValueText(raw).toLowerCase().includes(databaseValueText(expected).toLowerCase());
    case 'is':
      return compareText(raw, expected) === 0;
    case 'is_not':
      return compareText(raw, expected) !== 0;
    case 'gt':
      return Number(raw) > Number(expected);
    case 'lt':
      return Number(raw) < Number(expected);
    case 'before':
      return typeof raw === 'string' && typeof expected === 'string' && raw < expected;
    case 'after':
      return typeof raw === 'string' && typeof expected === 'string' && raw > expected;
    default:
      return true;
  }
}

export function filterDatabaseRows(database: PageDatabase, view: DatabaseView): DatabaseRow[] {
  const rows = [...database.rows].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
  const filters = view.filters?.filters ?? [];
  if (!filters.length) return rows;
  return rows.filter((row) => {
    const checks = filters.map((filter) => {
      const property = database.properties.find((candidate) => candidate.id === filter.propertyId);
      return property ? filterMatches(property, row, database, filter) : true;
    });
    return view.filters?.conjunction === 'or' ? checks.some(Boolean) : checks.every(Boolean);
  });
}

export function sortDatabaseRows(database: PageDatabase, view: DatabaseView, rows: DatabaseRow[]): DatabaseRow[] {
  const sorts = view.sorts ?? [];
  if (!sorts.length) return rows;
  return [...rows].sort((a, b) => {
    for (const sort of sorts) {
      const property = database.properties.find((candidate) => candidate.id === sort.propertyId);
      if (!property) continue;
      const left = comparableValue(property, a, database);
      const right = comparableValue(property, b, database);
      let result = 0;
      if (typeof left === 'number' && typeof right === 'number') result = left - right;
      else if (typeof left === 'boolean' && typeof right === 'boolean') result = Number(left) - Number(right);
      else result = compareText(left, right);
      if (result !== 0) return sort.direction === 'desc' ? -result : result;
    }
    return a.order - b.order;
  });
}

export function visibleDatabaseRows(database: PageDatabase, view: DatabaseView): DatabaseRow[] {
  return sortDatabaseRows(database, view, filterDatabaseRows(database, view));
}

export const FILTER_OPERATORS = {
  text: [
    ['contains', 'contains'], ['not_contains', 'does not contain'], ['is', 'is'], ['is_not', 'is not'],
    ['is_empty', 'is empty'], ['is_not_empty', 'is not empty'],
  ],
  number: [['is', 'is'], ['gt', 'is greater than'], ['lt', 'is less than'], ['is_empty', 'is empty'], ['is_not_empty', 'is not empty']],
  date: [['is', 'is'], ['before', 'is before'], ['after', 'is after'], ['is_empty', 'is empty'], ['is_not_empty', 'is not empty']],
  checkbox: [['is_checked', 'is checked'], ['is_unchecked', 'is not checked']],
  select: [['is', 'is'], ['is_not', 'is not'], ['is_empty', 'is empty'], ['is_not_empty', 'is not empty']],
  multi: [['contains', 'contains'], ['not_contains', 'does not contain'], ['is_empty', 'is empty'], ['is_not_empty', 'is not empty']],
} as const;

export function filterOperatorsFor(property: DatabaseProperty): ReadonlyArray<readonly [string, string]> {
  if (property.type === 'number' || property.type === 'formula') return FILTER_OPERATORS.number;
  if (property.type === 'date') return FILTER_OPERATORS.date;
  if (property.type === 'checkbox') return FILTER_OPERATORS.checkbox;
  if (property.type === 'select' || property.type === 'status') return FILTER_OPERATORS.select;
  if (property.type === 'multi_select') return FILTER_OPERATORS.multi;
  return FILTER_OPERATORS.text;
}

export function boardGroups(database: PageDatabase, view: DatabaseView, rows: DatabaseRow[]): Array<{ id: string; name: string; color?: string; rows: DatabaseRow[] }> {
  const groupBy = view.boardGroupBy ?? view.groupBy ?? database.properties.find((property) => property.type === 'status' || property.type === 'select')?.id;
  const property = database.properties.find((candidate) => candidate.id === groupBy);
  if (!property || (property.type !== 'status' && property.type !== 'select')) {
    return [{ id: '__all', name: 'All rows', rows }];
  }
  const groups = (property.options ?? []).map((option) => ({
    id: option.id,
    name: option.name,
    color: option.color,
    rows: rows.filter((row) => row.values[property.id] === option.id),
  }));
  const emptyRows = rows.filter((row) => !(property.options ?? []).some((option) => option.id === row.values[property.id]));
  if (emptyRows.length) groups.push({ id: '__empty', name: 'No value', color: 'zinc', rows: emptyRows });
  return groups;
}

export function rowsForDay(_database: PageDatabase, rows: DatabaseRow[], propertyId: string | undefined, day: string): DatabaseRow[] {
  if (!propertyId) return [];
  return rows.filter((row) => row.values[propertyId] === day);
}

export function firstPropertyOfType(database: PageDatabase, type: DatabaseProperty['type']): DatabaseProperty | undefined {
  return database.properties.find((property) => property.type === type);
}
