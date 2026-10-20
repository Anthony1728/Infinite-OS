/**
 * Spreadsheet formula engine for Studio sheets.
 *
 * A deliberate subset of spreadsheet semantics, implemented safely instead of
 * evaluating JavaScript:
 *   • refs and ranges (A1, A1:B8), arithmetic, comparisons, text concatenation
 *   • SUM/AVERAGE/MIN/MAX/COUNT/COUNTA/MEDIAN/PRODUCT/ROUND/ABS/SQRT/POWER
 *   • IF/AND/OR/NOT/IFERROR, LEN/UPPER/LOWER/TRIM/CONCAT
 *
 * Errors are values, not exceptions: one bad cell shows #VALUE! without taking
 * the grid down, and circular references show #CYCLE! with detection per
 * evaluation pass. Evaluation is memoized so a 30×12 sheet recalculates once.
 */

import { parseCellAddress } from '../../shared/studio.js';

export class CellError {
  constructor(readonly code: string) {}

  toString(): string {
    return this.code;
  }
}

type Scalar = number | string | boolean;
interface RangeValue {
  kind: 'range';
  values: Array<Scalar | CellError>;
}
type Value = Scalar | CellError | RangeValue;

export type CellResult = Scalar | CellError;

const VALUE_ERROR = new CellError('#VALUE!');
const DIV_ZERO = new CellError('#DIV/0!');
const REF_ERROR = new CellError('#REF!');
const CYCLE_ERROR = new CellError('#CYCLE!');
const NAME_ERROR = new CellError('#NAME?');

export function isCellError(value: unknown): value is CellError {
  return value instanceof CellError;
}

function isRange(value: Value): value is RangeValue {
  return typeof value === 'object' && !(value instanceof CellError) && (value as RangeValue).kind === 'range';
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return value > 0 ? '∞' : value < 0 ? '-∞' : '#NUM!';
  if (Number.isInteger(value)) return String(value);
  const rounded = Math.round(value * 1e9) / 1e9;
  return String(rounded);
}

export function formatCellValue(value: CellResult): string {
  if (isCellError(value)) return value.code;
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return value;
}

function toNumber(value: Value): number | CellError {
  if (isCellError(value)) return value;
  if (isRange(value)) {
    const first = value.values[0];
    if (first === undefined) return 0;
    return toNumber(first);
  }
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const trimmed = value.trim();
  if (trimmed === '') return 0;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : VALUE_ERROR;
}

function toText(value: Value): string | CellError {
  if (isCellError(value)) return value;
  if (isRange(value)) {
    const first = value.values[0];
    return first === undefined ? '' : toText(first);
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return formatCellValue(value);
}

function toBoolean(value: Value): boolean | CellError {
  if (isCellError(value)) return value;
  if (isRange(value)) {
    const first = value.values[0];
    return first === undefined ? false : toBoolean(first);
  }
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = value.trim().toUpperCase();
  if (text === 'TRUE') return true;
  if (text === 'FALSE' || text === '') return false;
  return Boolean(value);
}

function flatten(args: Value[]): Array<Scalar | CellError> {
  const out: Array<Scalar | CellError> = [];
  for (const arg of args) {
    if (isRange(arg)) out.push(...arg.values);
    else out.push(arg as Scalar | CellError);
  }
  return out;
}

function numericArgs(args: Value[]): number[] | CellError {
  const numbers: number[] = [];
  for (const value of flatten(args)) {
    if (isCellError(value)) return value;
    if (value === '' || typeof value === 'string') continue; // SUM ignores text
    if (typeof value === 'number') numbers.push(value);
    else if (typeof value === 'boolean') numbers.push(value ? 1 : 0);
  }
  return numbers;
}

function compare(left: Value, right: Value, operator: string): Value {
  if (isCellError(left)) return left;
  if (isCellError(right)) return right;
  if (isRange(left) || isRange(right)) return VALUE_ERROR;
  let a: Scalar = left as Scalar;
  let b: Scalar = right as Scalar;
  if (typeof a === 'string' && typeof b === 'number') {
    const parsed = Number(a);
    if (Number.isFinite(parsed) && a.trim() !== '') a = parsed;
  }
  if (typeof b === 'string' && typeof a === 'number') {
    const parsed = Number(b);
    if (Number.isFinite(parsed) && b.trim() !== '') b = parsed;
  }
  switch (operator) {
    case '=': return a === b;
    case '<>': return a !== b;
    case '<': return a < b;
    case '>': return a > b;
    case '<=': return a <= b;
    case '>=': return a >= b;
    default: return VALUE_ERROR;
  }
}

// ── Tokenizer ───────────────────────────────────────────────────────────────

type Token =
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'ref'; value: string }
  | { type: 'range'; from: string; to: string }
  | { type: 'identifier'; value: string }
  | { type: 'operator'; value: string }
  | { type: 'paren'; value: '(' | ')' }
  | { type: 'comma' };

function tokenize(formula: string): Token[] | CellError {
  const tokens: Token[] = [];
  let index = 0;
  const text = formula;
  while (index < text.length) {
    const char = text[index];
    if (/\s/.test(char)) {
      index++;
      continue;
    }
    if (char === '"') {
      let value = '';
      index++;
      let closed = false;
      while (index < text.length) {
        if (text[index] === '"') {
          if (text[index + 1] === '"') {
            value += '"';
            index += 2;
            continue;
          }
          index++;
          closed = true;
          break;
        }
        value += text[index++];
      }
      if (!closed) return VALUE_ERROR;
      tokens.push({ type: 'string', value });
      continue;
    }
    if (/\d/.test(char) || (char === '.' && /\d/.test(text[index + 1] ?? ''))) {
      const match = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(text.slice(index));
      if (!match) return VALUE_ERROR;
      tokens.push({ type: 'number', value: Number(match[0]) });
      index += match[0].length;
      continue;
    }
    if (char === '(' || char === ')') {
      tokens.push({ type: 'paren', value: char });
      index++;
      continue;
    }
    if (char === ',') {
      tokens.push({ type: 'comma' });
      index++;
      continue;
    }
    const comparison = /^(<=|>=|<>|=|<|>)/.exec(text.slice(index));
    if (comparison) {
      tokens.push({ type: 'operator', value: comparison[0] });
      index += comparison[0].length;
      continue;
    }
    if ('+-*/^&%'.includes(char)) {
      tokens.push({ type: 'operator', value: char });
      index++;
      continue;
    }
    const refMatch = /^\$?([A-Za-z]{1,2})\$?([0-9]{1,3})(?:\s*:\s*\$?([A-Za-z]{1,2})\$?([0-9]{1,3}))?/.exec(text.slice(index));
    if (refMatch) {
      const from = `${refMatch[1].toUpperCase()}${refMatch[2]}`;
      if (refMatch[3]) {
        const to = `${refMatch[3].toUpperCase()}${refMatch[4]}`;
        tokens.push({ type: 'range', from, to });
      } else {
        tokens.push({ type: 'ref', value: from });
      }
      index += refMatch[0].length;
      continue;
    }
    const identifier = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(text.slice(index));
    if (identifier) {
      tokens.push({ type: 'identifier', value: identifier[0].toUpperCase() });
      index += identifier[0].length;
      continue;
    }
    return VALUE_ERROR;
  }
  return tokens;
}

// ── Parser + evaluator ──────────────────────────────────────────────────────

class Evaluator {
  private position = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly cells: Record<string, string>,
    private readonly cache: Map<string, CellResult>,
    private readonly stack: Set<string>,
  ) {}

  evaluate(): CellResult {
    if (!this.tokens.length) return '';
    const value = this.parseComparison();
    if (this.position < this.tokens.length) return VALUE_ERROR;
    return this.scalarize(value);
  }

  private scalarize(value: Value): CellResult {
    if (isCellError(value)) return value;
    if (isRange(value)) return VALUE_ERROR;
    return value;
  }

  private peek(): Token | undefined {
    return this.tokens[this.position];
  }

  private take(): Token | undefined {
    return this.tokens[this.position++];
  }

  private parseComparison(): Value {
    let left = this.parseConcat();
    for (;;) {
      const token = this.peek();
      if (token?.type !== 'operator' || !['=', '<>', '<', '>', '<=', '>='].includes(token.value)) break;
      this.take();
      const right = this.parseConcat();
      left = compare(left, right, token.value);
      if (isCellError(left)) return left;
    }
    return left;
  }

  private parseConcat(): Value {
    let left = this.parseAdditive();
    for (;;) {
      const token = this.peek();
      if (token?.type !== 'operator' || token.value !== '&') break;
      this.take();
      const right = this.parseAdditive();
      const a = toText(left);
      const b = toText(right);
      if (isCellError(a)) return a;
      if (isCellError(b)) return b;
      left = a + b;
    }
    return left;
  }

  private parseAdditive(): Value {
    let left = this.parseMultiplicative();
    for (;;) {
      const token = this.peek();
      if (token?.type !== 'operator' || (token.value !== '+' && token.value !== '-')) break;
      this.take();
      const right = this.parseMultiplicative();
      const a = toNumber(left);
      const b = toNumber(right);
      if (isCellError(a)) return a;
      if (isCellError(b)) return b;
      left = token.value === '+' ? a + b : a - b;
    }
    return left;
  }

  private parseMultiplicative(): Value {
    let left = this.parsePower();
    for (;;) {
      const token = this.peek();
      if (token?.type !== 'operator' || (token.value !== '*' && token.value !== '/')) break;
      this.take();
      const right = this.parsePower();
      const a = toNumber(left);
      const b = toNumber(right);
      if (isCellError(a)) return a;
      if (isCellError(b)) return b;
      if (token.value === '/') {
        if (b === 0) return DIV_ZERO;
        left = a / b;
      } else {
        left = a * b;
      }
    }
    return left;
  }

  private parsePower(): Value {
    const left = this.parseUnary();
    const token = this.peek();
    if (token?.type === 'operator' && token.value === '^') {
      this.take();
      const right = this.parsePower();
      const a = toNumber(left);
      const b = toNumber(right);
      if (isCellError(a)) return a;
      if (isCellError(b)) return b;
      return Math.pow(a, b);
    }
    return left;
  }

  private parseUnary(): Value {
    const token = this.peek();
    if (token?.type === 'operator' && (token.value === '-' || token.value === '+')) {
      this.take();
      const value = this.parseUnary();
      const number = toNumber(value);
      if (isCellError(number)) return number;
      return token.value === '-' ? -number : number;
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Value {
    let value = this.parsePrimary();
    const token = this.peek();
    if (token?.type === 'operator' && token.value === '%') {
      this.take();
      const number = toNumber(value);
      if (isCellError(number)) return number;
      value = number / 100;
    }
    return value;
  }

  private parsePrimary(): Value {
    const token = this.take();
    if (!token) return VALUE_ERROR;
    if (token.type === 'number') return token.value;
    if (token.type === 'string') return token.value;
    if (token.type === 'ref') return this.reference(token.value, token.value);
    if (token.type === 'range') return this.range(token.from, token.to);
    if (token.type === 'paren' && token.value === '(') {
      const value = this.parseComparison();
      const close = this.take();
      return close?.type === 'paren' && close.value === ')' ? value : VALUE_ERROR;
    }
    if (token.type === 'identifier') {
      if (token.value === 'TRUE') return true;
      if (token.value === 'FALSE') return false;
      return this.call(token.value);
    }
    return VALUE_ERROR;
  }

  private reference(from: string, _to: string): Value {
    if (!parseCellAddress(from)) return REF_ERROR;
    return this.cellValue(from);
  }

  private range(from: string, to: string): Value {
    const start = parseCellAddress(from);
    const end = parseCellAddress(to);
    if (!start || !end) return REF_ERROR;
    const values: Array<Scalar | CellError> = [];
    const rowStart = Math.min(start.row, end.row);
    const rowEnd = Math.max(start.row, end.row);
    const columnStart = Math.min(start.column, end.column);
    const columnEnd = Math.max(start.column, end.column);
    if ((rowEnd - rowStart + 1) * (columnEnd - columnStart + 1) > 5_000) return VALUE_ERROR;
    for (let row = rowStart; row <= rowEnd; row++) {
      for (let column = columnStart; column <= columnEnd; column++) {
        const address = `${columnLetter(column)}${row + 1}`;
        values.push(this.cellValue(address));
      }
    }
    return { kind: 'range', values };
  }

  private cellValue(address: string): Scalar | CellError {
    const cached = this.cache.get(address);
    if (cached !== undefined) return cached;
    if (this.stack.has(address)) return CYCLE_ERROR;
    const raw = this.cells[address] ?? '';
    if (!raw.startsWith('=')) {
      const trimmed = raw.trim();
      const numeric = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed);
      const result: CellResult = numeric ? Number(trimmed) : raw;
      this.cache.set(address, result);
      return result;
    }
    this.stack.add(address);
    const tokens = tokenize(raw.slice(1));
    if (isCellError(tokens)) {
      this.stack.delete(address);
      this.cache.set(address, tokens);
      return tokens;
    }
    const evaluator = new Evaluator(tokens, this.cells, this.cache, this.stack);
    const result = evaluator.evaluate();
    this.stack.delete(address);
    this.cache.set(address, result);
    return result;
  }

  private call(name: string): Value {
    const open = this.take();
    if (open?.type !== 'paren' || open.value !== '(') return NAME_ERROR;
    const args: Value[] = [];
    if (!(this.peek()?.type === 'paren' && (this.peek() as { value?: string }).value === ')')) {
      for (;;) {
        args.push(this.parseComparison());
        const token = this.peek();
        if (token?.type === 'comma') {
          this.take();
          continue;
        }
        break;
      }
    }
    const close = this.take();
    if (close?.type !== 'paren' || close.value !== ')') return VALUE_ERROR;
    return this.apply(name, args);
  }

  private apply(name: string, args: Value[]): Value {
    if (name === 'IFERROR') {
      const value = args[0] ?? '';
      return isCellError(value) ? args[1] ?? '' : value;
    }
    if (name === 'IF') {
      const condition = toBoolean(args[0] ?? false);
      if (isCellError(condition)) return condition;
      return condition ? args[1] ?? true : args[2] ?? false;
    }
    if (name === 'AND' || name === 'OR') {
      const values = flatten(args).map(toBoolean);
      const error = values.find(isCellError);
      if (error) return error;
      return name === 'AND' ? values.every(Boolean) : values.some(Boolean);
    }
    if (name === 'NOT') {
      const value = toBoolean(args[0] ?? false);
      return isCellError(value) ? value : !value;
    }

    const flattened = flatten(args);
    const firstError = flattened.find(isCellError);
    if (firstError) return firstError;

    if (name === 'SUM' || name === 'AVERAGE' || name === 'MIN' || name === 'MAX' ||
        name === 'COUNT' || name === 'MEDIAN' || name === 'PRODUCT') {
      if (name === 'COUNT') return flattened.filter((value) => typeof value === 'number').length;
      const numbers = numericArgs(args);
      if (isCellError(numbers)) return numbers;
      if (name === 'SUM') return numbers.reduce((sum, n) => sum + n, 0);
      if (name === 'PRODUCT') return numbers.reduce((product, n) => product * n, 1);
      if (!numbers.length) return name === 'AVERAGE' || name === 'MEDIAN' ? DIV_ZERO : 0;
      if (name === 'AVERAGE') return numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
      if (name === 'MIN') return Math.min(...numbers);
      if (name === 'MAX') return Math.max(...numbers);
      const sorted = [...numbers].sort((a, b) => a - b);
      const middle = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    }

    if (name === 'COUNTA') {
      return flattened.filter((value) => value !== '' && value !== undefined && value !== null).length;
    }
    if (name === 'ROUND') {
      const value = toNumber(args[0] ?? 0);
      const digits = toNumber(args[1] ?? 0);
      if (isCellError(value)) return value;
      if (isCellError(digits)) return digits;
      const factor = Math.pow(10, Math.trunc(digits));
      return Math.round(value * factor) / factor;
    }
    if (name === 'ABS') {
      const value = toNumber(args[0] ?? 0);
      return isCellError(value) ? value : Math.abs(value);
    }
    if (name === 'SQRT') {
      const value = toNumber(args[0] ?? 0);
      if (isCellError(value)) return value;
      return value < 0 ? VALUE_ERROR : Math.sqrt(value);
    }
    if (name === 'POWER') {
      const base = toNumber(args[0] ?? 0);
      const exponent = toNumber(args[1] ?? 0);
      if (isCellError(base)) return base;
      if (isCellError(exponent)) return exponent;
      return Math.pow(base, exponent);
    }
    if (name === 'LEN') {
      const value = toText(args[0] ?? '');
      return isCellError(value) ? value : value.length;
    }
    if (name === 'UPPER' || name === 'LOWER' || name === 'TRIM') {
      const value = toText(args[0] ?? '');
      if (isCellError(value)) return value;
      if (name === 'UPPER') return value.toUpperCase();
      if (name === 'LOWER') return value.toLowerCase();
      return value.replace(/\s+/g, ' ').trim();
    }
    if (name === 'CONCAT' || name === 'CONCATENATE') {
      const parts = flattened.map(toText);
      const error = parts.find(isCellError);
      if (error) return error;
      return parts.join('');
    }
    return NAME_ERROR;
  }
}

function columnLetter(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

export function evaluateCell(
  cells: Record<string, string>,
  address: string,
  cache: Map<string, CellResult> = new Map(),
  stack: Set<string> = new Set(),
): CellResult {
  const normalized = address.toUpperCase();
  const raw = cells[normalized] ?? '';
  if (!raw.startsWith('=')) return raw;
  const tokens = tokenize(raw.slice(1));
  if (isCellError(tokens)) return tokens;
  if (stack.has(normalized)) return CYCLE_ERROR;
  stack.add(normalized);
  const result = new Evaluator(tokens, cells, cache, stack).evaluate();
  stack.delete(normalized);
  cache.set(normalized, result);
  return result;
}

/** Evaluate every formula in the sheet once and return display strings. */
export function evaluateSheet(cells: Record<string, string>): Record<string, string> {
  const cache = new Map<string, CellResult>();
  const output: Record<string, string> = {};
  for (const address of Object.keys(cells)) {
    output[address] = formatCellValue(evaluateCell(cells, address, cache));
  }
  return output;
}

/** Raw values as the UI shows them (formulas resolved, blanks empty). */
export function cellMatrix(cells: Record<string, string>, columns: number, rows: number): string[][] {
  const cache = new Map<string, CellResult>();
  return Array.from({ length: rows }, (_row, rowIndex) =>
    Array.from({ length: columns }, (_column, columnIndex) => {
      const address = `${columnLetter(columnIndex)}${rowIndex + 1}`;
      const raw = cells[address] ?? '';
      return raw.startsWith('=') ? formatCellValue(evaluateCell(cells, address, cache)) : raw;
    }),
  );
}

/** Cell input for a human-readable table (CSV import / AI output). */
export function matrixToCells(matrix: string[][]): Record<string, string> {
  const cells: Record<string, string> = {};
  matrix.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      if (value === '') return;
      cells[`${columnLetter(columnIndex)}${rowIndex + 1}`] = value;
    });
  });
  return cells;
}
