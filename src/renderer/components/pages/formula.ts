/**
 * Safe database formulas.
 *
 * This is a tiny expression language, not JavaScript: no property access,
 * no function constructors, no eval, no host objects. It supports arithmetic,
 * comparisons, boolean logic, `prop("Name")`, and a conservative set of
 * functions that are useful in a workspace. Anything unknown renders as
 * #ERROR instead of taking the UI down.
 */

import type { DatabaseProperty, DatabaseRow, DatabaseValue, PageDatabase } from '../../../shared/pages';
import { parseIsoDay, todayIso } from './pageUtils';

type FormulaValue = number | string | boolean | null;

class FormulaError extends Error {}

interface Token {
  type: 'number' | 'string' | 'identifier' | 'operator' | 'eof';
  value: string;
  position: number;
}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < expression.length) {
    const char = expression[index]!;
    if (/\s/.test(char)) {
      index++;
      continue;
    }
    if (/\d/.test(char) || (char === '.' && /\d/.test(expression[index + 1] ?? ''))) {
      const start = index;
      while (index < expression.length && /[\d.]/.test(expression[index]!)) index++;
      tokens.push({ type: 'number', value: expression.slice(start, index), position: start });
      continue;
    }
    if (char === '"' || char === "'") {
      const quote = char;
      const start = index;
      index++;
      let value = '';
      let closed = false;
      while (index < expression.length) {
        const next = expression[index]!;
        if (next === '\\' && index + 1 < expression.length) {
          const escaped = expression[index + 1]!;
          value += escaped === 'n' ? '\n' : escaped === 't' ? '\t' : escaped;
          index += 2;
          continue;
        }
        if (next === quote) {
          closed = true;
          index++;
          break;
        }
        value += next;
        index++;
      }
      if (!closed) throw new FormulaError('Unclosed text');
      tokens.push({ type: 'string', value, position: start });
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const start = index;
      while (index < expression.length && /[A-Za-z0-9_]/.test(expression[index]!)) index++;
      tokens.push({ type: 'identifier', value: expression.slice(start, index), position: start });
      continue;
    }
    const two = expression.slice(index, index + 2);
    if (['==', '!=', '>=', '<=', '&&', '||'].includes(two)) {
      tokens.push({ type: 'operator', value: two, position: index });
      index += 2;
      continue;
    }
    if ('+-*/%^()<>,!'.includes(char)) {
      tokens.push({ type: 'operator', value: char, position: index });
      index++;
      continue;
    }
    throw new FormulaError(`Unexpected character “${char}”`);
  }
  tokens.push({ type: 'eof', value: '', position: index });
  return tokens;
}

function isTruthy(value: FormulaValue): boolean {
  if (value === null || value === false) return false;
  if (typeof value === 'number') return value !== 0 && Number.isFinite(value);
  if (typeof value === 'string') return value.trim() !== '';
  return true;
}

function numberValue(value: FormulaValue): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[$,%\s]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function stringValue(value: FormulaValue): string {
  if (value === null) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function normalizeComparable(value: FormulaValue): FormulaValue {
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return value;
}

function compareValues(left: FormulaValue, right: FormulaValue): number {
  const a = normalizeComparable(left);
  const b = normalizeComparable(right);
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return stringValue(a).localeCompare(stringValue(b), undefined, { numeric: true, sensitivity: 'base' });
}

function propertyValue(property: DatabaseProperty, value: DatabaseValue): FormulaValue {
  if (value === null || value === undefined) return null;
  if (property.type === 'number') return typeof value === 'number' ? value : Array.isArray(value) ? numberValue(value[0] ?? null) : numberValue(value);
  if (property.type === 'checkbox') return value === true;
  if (property.type === 'select' || property.type === 'status') {
    return property.options?.find((option) => option.id === value)?.name ?? String(value);
  }
  if (property.type === 'multi_select' && Array.isArray(value)) {
    return value.map((id) => property.options?.find((option) => option.id === id)?.name ?? id).join(', ');
  }
  if (property.type === 'relation' && Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

class Parser {
  private readonly tokens: Token[];
  private position = 0;

  constructor(
    expression: string,
    private readonly row: DatabaseRow,
    private readonly database: PageDatabase,
  ) {
    this.tokens = tokenize(expression);
  }

  parse(): FormulaValue {
    const value = this.parseOr();
    if (this.peek().type !== 'eof') throw new FormulaError('Unexpected trailing input');
    return value;
  }

  private peek(offset = 0): Token {
    return this.tokens[this.position + offset] ?? this.tokens[this.tokens.length - 1]!;
  }

  private consume(value?: string): Token {
    const token = this.peek();
    if (value && token.value !== value) throw new FormulaError(`Expected ${value}`);
    this.position++;
    return token;
  }

  private match(value: string): boolean {
    const token = this.peek();
    // Punctuation/operators are only ever operator tokens. Matching on the
    // raw value would treat the string literal "-" (or "(") as an operator
    // and fail on perfectly valid formulas such as join("a", "b", "-").
    if (token.type === 'operator' && token.value === value) {
      this.position++;
      return true;
    }
    return false;
  }

  private parseOr(): FormulaValue {
    let value = this.parseAnd();
    // Parse the right-hand side even when the left side is already truthy.
    // `true || false` must consume both operands, otherwise the remaining
    // token is reported as unexpected trailing input.
    while (
      (this.peek().type === 'operator' && this.peek().value === '||')
      || (this.peek().type === 'identifier' && this.peek().value.toLowerCase() === 'or')
    ) {
      this.consume();
      const right = this.parseAnd();
      value = isTruthy(value) || isTruthy(right);
    }
    return value;
  }

  private parseAnd(): FormulaValue {
    let value = this.parseEquality();
    while (
      (this.peek().type === 'operator' && this.peek().value === '&&')
      || (this.peek().type === 'identifier' && this.peek().value.toLowerCase() === 'and')
    ) {
      this.consume();
      const right = this.parseEquality();
      value = isTruthy(value) && isTruthy(right);
    }
    return value;
  }

  private parseEquality(): FormulaValue {
    let value = this.parseComparison();
    while (this.peek().value === '==' || this.peek().value === '!=') {
      const operator = this.consume().value;
      const right = this.parseComparison();
      const equal = compareValues(value, right) === 0;
      value = operator === '==' ? equal : !equal;
    }
    return value;
  }

  private parseComparison(): FormulaValue {
    let value = this.parseAdditive();
    while (['>', '<', '>=', '<='].includes(this.peek().value)) {
      const operator = this.consume().value;
      const right = this.parseAdditive();
      const comparison = compareValues(value, right);
      value = operator === '>'
        ? comparison > 0
        : operator === '<'
          ? comparison < 0
          : operator === '>='
            ? comparison >= 0
            : comparison <= 0;
    }
    return value;
  }

  private parseAdditive(): FormulaValue {
    let value = this.parseMultiplicative();
    while (this.peek().value === '+' || this.peek().value === '-') {
      const operator = this.consume().value;
      const right = this.parseMultiplicative();
      if (operator === '+' && (typeof value === 'string' || typeof right === 'string')) {
        value = stringValue(value) + stringValue(right);
      } else {
        value = operator === '+' ? numberValue(value) + numberValue(right) : numberValue(value) - numberValue(right);
      }
    }
    return value;
  }

  private parseMultiplicative(): FormulaValue {
    let value = this.parsePower();
    while (['*', '/', '%'].includes(this.peek().value)) {
      const operator = this.consume().value;
      const right = this.parsePower();
      if (operator === '*') value = numberValue(value) * numberValue(right);
      else {
        const divisor = numberValue(right);
        value = divisor === 0 ? null : operator === '/' ? numberValue(value) / divisor : numberValue(value) % divisor;
      }
    }
    return value;
  }

  private parsePower(): FormulaValue {
    const value = this.parseUnary();
    if (this.match('^')) return Math.pow(numberValue(value), numberValue(this.parsePower()));
    return value;
  }

  private parseUnary(): FormulaValue {
    if (this.match('-')) return -numberValue(this.parseUnary());
    if (this.match('+')) return numberValue(this.parseUnary());
    if (this.match('!')) return !isTruthy(this.parseUnary());
    if (this.peek().type === 'identifier' && this.peek().value.toLowerCase() === 'not') {
      this.consume();
      return !isTruthy(this.parseUnary());
    }
    return this.parsePrimary();
  }

  private parsePrimary(): FormulaValue {
    const token = this.peek();
    if (token.type === 'number') {
      this.consume();
      const value = Number(token.value);
      if (!Number.isFinite(value)) throw new FormulaError('Invalid number');
      return value;
    }
    if (token.type === 'string') {
      this.consume();
      return token.value;
    }
    if (token.value === '(') {
      this.consume('(');
      const value = this.parseOr();
      this.consume(')');
      return value;
    }
    if (token.type === 'identifier') {
      this.consume();
      const name = token.value;
      const lower = name.toLowerCase();
      if (lower === 'true') return true;
      if (lower === 'false') return false;
      // A bare `empty` is the null literal, but `empty(...)` is the helper
      // function. Resolve the call first so the reserved word cannot shadow it.
      if (this.match('(')) {
        const args: FormulaValue[] = [];
        if (!this.match(')')) {
          do {
            args.push(this.parseOr());
          } while (this.match(','));
          this.consume(')');
        }
        return this.callFunction(name, args);
      }
      if (lower === 'null' || lower === 'empty') return null;
      return this.lookupProperty(name);
    }
    throw new FormulaError(token.type === 'eof' ? 'Formula is incomplete' : `Unexpected “${token.value}”`);
  }

  private lookupProperty(name: string): FormulaValue {
    const lower = name.toLowerCase();
    const property = this.database.properties.find((candidate) => candidate.id === name)
      ?? this.database.properties.find((candidate) => candidate.name.toLowerCase() === lower);
    if (!property) throw new FormulaError(`Unknown property “${name}”`);
    return propertyValue(property, this.row.values[property.id]);
  }

  private callFunction(rawName: string, args: FormulaValue[]): FormulaValue {
    const name = rawName.toLowerCase().replace(/\s+/g, '');
    const arg = (index: number) => args[index] ?? null;
    const numbers = () => args.map(numberValue).filter((value) => Number.isFinite(value));
    const requireArgs = (minimum: number) => {
      if (args.length < minimum) throw new FormulaError(`${rawName} needs ${minimum} argument${minimum === 1 ? '' : 's'}`);
    };
    switch (name) {
      case 'prop': {
        requireArgs(1);
        return this.lookupProperty(stringValue(arg(0)));
      }
      case 'sum': return numbers().reduce((total, value) => total + value, 0);
      case 'avg':
      case 'average': {
        const values = numbers();
        return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
      }
      case 'min': {
        const values = numbers();
        return values.length ? Math.min(...values) : 0;
      }
      case 'max': {
        const values = numbers();
        return values.length ? Math.max(...values) : 0;
      }
      case 'round': {
        requireArgs(1);
        const digits = Math.max(0, Math.min(8, Math.floor(numberValue(arg(1)))));
        const factor = Math.pow(10, digits);
        return Math.round(numberValue(arg(0)) * factor) / factor;
      }
      case 'ceil': return Math.ceil(numberValue(arg(0)));
      case 'floor': return Math.floor(numberValue(arg(0)));
      case 'abs': return Math.abs(numberValue(arg(0)));
      case 'len': return stringValue(arg(0)).length;
      case 'lower': return stringValue(arg(0)).toLowerCase();
      case 'upper': return stringValue(arg(0)).toUpperCase();
      case 'trim': return stringValue(arg(0)).trim();
      case 'concat': return args.map(stringValue).join('');
      case 'join': return args.slice(0, -1).map(stringValue).join(stringValue(args[args.length - 1] ?? ', '));
      case 'contains': return stringValue(arg(0)).toLowerCase().includes(stringValue(arg(1)).toLowerCase());
      case 'empty':
      case 'isempty': return !isTruthy(arg(0));
      case 'if': return isTruthy(arg(0)) ? arg(1) : arg(2);
      case 'and': return args.every(isTruthy);
      case 'or': return args.some(isTruthy);
      case 'not': return !isTruthy(arg(0));
      case 'today': return todayIso();
      case 'now': return new Date().toISOString();
      case 'year': return parseIsoDay(stringValue(arg(0))).getFullYear();
      case 'month': return parseIsoDay(stringValue(arg(0))).getMonth() + 1;
      case 'day': return parseIsoDay(stringValue(arg(0))).getDate();
      case 'datediff': {
        const start = parseIsoDay(stringValue(arg(0))).getTime();
        const end = parseIsoDay(stringValue(arg(1))).getTime();
        if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
        return Math.round((end - start) / 86_400_000);
      }
      case 'formatdate': {
        const date = parseIsoDay(stringValue(arg(0)));
        if (!Number.isFinite(date.getTime())) return '';
        return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
      }
      default:
        throw new FormulaError(`Unknown function “${rawName}”`);
    }
  }
}

export function evaluateFormula(expression: string, row: DatabaseRow, database: PageDatabase): string {
  const trimmed = expression.trim();
  if (!trimmed) return '';
  try {
    const parser = new Parser(trimmed, row, database);
    const value = parser.parse();
    if (value === null) return '';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return '#ERROR';
      return String(Math.round(value * 1_000_000) / 1_000_000);
    }
    return value;
  } catch {
    return '#ERROR';
  }
}

export function formulaResultFor(property: DatabaseProperty, row: DatabaseRow, database: PageDatabase): string {
  return evaluateFormula(property.formula ?? '', row, database);
}
