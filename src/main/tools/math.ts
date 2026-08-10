// Math tool — deterministic numeric work: a safe (no eval) expression
// evaluator, statistics, base conversion, rounding, percentages, and random
// number generation. All arithmetic is double-precision IEEE-754.

import type { Tool, ToolResult } from './base.js';

interface MathInput {
  action: string;
  expression?: string;
  values?: number[];
  percentile?: number;
  number?: number;
  fromBase?: number;
  toBase?: number;
  decimals?: number;
  significant?: number;
  total?: number;
  part?: number;
  min?: number;
  max?: number;
  count?: number;
  seed?: number;
}

export const mathTool: Tool = {
  name: 'Math',
  description: 'Deterministic numeric work: safe expression evaluation (no eval) with + - * / % ^ parens and functions abs/round/floor/ceil/sqrt/cbrt/min/max/pow/log/log10/exp/sin/cos/tan/random, plus statistics (mean/median/mode/stddev/percentiles), base conversion (2-36), rounding, percentages, and seeded random numbers.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['eval', 'stats', 'base_convert', 'round', 'percent', 'random_int', 'random_float', 'list'] },
      expression: { type: 'string', description: 'Arithmetic expression for eval, e.g. "2^10 + sqrt(144) * pi".' },
      values: { type: 'array', items: { type: 'number' }, description: 'Number array for stats.' },
      percentile: { type: 'number', description: 'Percentile (0-100) to compute in stats.' },
      number: { type: 'number', description: 'Input number for base_convert / round / percent.' },
      fromBase: { type: 'number', description: 'Source base (2-36, default 10).' },
      toBase: { type: 'number', description: 'Target base (2-36, default 16).' },
      decimals: { type: 'number', description: 'Decimal places for round.' },
      significant: { type: 'number', description: 'Significant figures for round.' },
      total: { type: 'number', description: 'Total for percent calculations.' },
      part: { type: 'number', description: 'Part for percent calculations.' },
      min: { type: 'number', description: 'Inclusive min for random_int.' },
      max: { type: 'number', description: 'Inclusive max for random_int.' },
      count: { type: 'number', description: 'How many random numbers (default 1).' },
      seed: { type: 'number', description: 'Seed for reproducible random_float sequence.' },
    },
    required: ['action'],
  },
  permission: 'none',

  async execute(args, _ctx): Promise<ToolResult> {
    const input = args as MathInput;
    try {
      switch (input.action) {
        case 'eval': {
          if (!input.expression) return bad('eval requires an expression.');
          const value = evaluate(input.expression);
          return json({ expression: input.expression, value: value === 0 ? 0 : value });
        }
        case 'stats': {
          const values = input.values ?? [];
          if (values.length === 0) return bad('stats requires a non-empty values array.');
          return json(computeStats(values, input.percentile));
        }
        case 'base_convert': {
          if (input.number === undefined) return bad('base_convert requires number.');
          const fromBase = clampInt(input.fromBase, 2, 36, 10);
          const toBase = clampInt(input.toBase, 2, 36, 16);
          const asInteger = Math.trunc(input.number);
          const result = asInteger.toString(toBase);
          return json({ input: input.number, fromBase, toBase, value: result });
        }
        case 'round': {
          if (input.number === undefined) return bad('round requires number.');
          const decimals = input.decimals !== undefined ? clampInt(input.decimals, 0, 15, 0) : undefined;
          const significant = input.significant !== undefined ? clampInt(input.significant, 1, 15, 1) : undefined;
          const value = decimals !== undefined
            ? roundTo(input.number, decimals)
            : significant !== undefined
              ? roundToSignificant(input.number, significant)
              : Math.round(input.number);
          return json({ input: input.number, value });
        }
        case 'percent': {
          const part = input.part;
          const total = input.total;
          if (total === undefined && part === undefined) return bad('percent requires at least one of total/part.');
          const result: Record<string, unknown> = {};
          if (total !== undefined && part !== undefined) {
            result.percent = roundTo((part / total) * 100, 4);
            result.multiplier = roundTo(part / total, 6);
          } else if (total !== undefined) {
            result.percentOfTotal = { total, percentValue: 1, result: roundTo(total * 0.01, 6) };
          }
          return json(result);
        }
        case 'random_int': {
          if (input.min === undefined || input.max === undefined) return bad('random_int requires min and max.');
          const min = Math.ceil(input.min);
          const max = Math.floor(input.max);
          if (min > max) return bad('min must be <= max.');
          const count = clampInt(input.count, 1, 1000, 1);
          const numbers = Array.from({ length: count }, () => randomIntInclusive(min, max));
          return json({ count, min, max, numbers });
        }
        case 'random_float': {
          if (input.seed !== undefined) {
            const count = clampInt(input.count, 1, 1000, 1);
            const rng = mulberry32(input.seed);
            const numbers = Array.from({ length: count }, () => roundTo(rng(), 6));
            return json({ seeded: true, seed: input.seed, count, numbers });
          }
          const count = clampInt(input.count, 1, 1000, 1);
          const numbers = Array.from({ length: count }, () => roundTo(Math.random(), 6));
          return json({ count, numbers });
        }
        case 'list': {
          const names = ['abs', 'round', 'floor', 'ceil', 'trunc', 'sqrt', 'cbrt', 'sign', 'min', 'max', 'pow', 'log', 'log10', 'exp', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'random', 'pi', 'e', 'tau', 'phi'];
          return json({ constants: ['pi', 'e', 'tau', 'phi'], functions: names, examples: ['2^10', 'sqrt(144) + pi', 'round(1.234, 2)', 'min(1, 5, 3)'] });
        }
        default:
          return bad(`Unknown Math action: ${input.action}`);
      }
    } catch (error) {
      return bad((error as Error).message);
    }
  },
};

// ---------------------------------------------------------------------------
// Safe expression evaluator — recursive descent, no eval/Function.
// ---------------------------------------------------------------------------

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
  phi: (1 + Math.sqrt(5)) / 2,
};

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  abs: (x) => Math.abs(x),
  round: (x, d) => roundTo(x, Math.trunc(d ?? 0)),
  floor: (x) => Math.floor(x),
  ceil: (x) => Math.ceil(x),
  trunc: (x) => Math.trunc(x),
  sqrt: (x) => Math.sqrt(x),
  cbrt: (x) => Math.cbrt(x),
  sign: (x) => Math.sign(x),
  min: (...xs) => Math.min(...xs),
  max: (...xs) => Math.max(...xs),
  pow: (a, b) => Math.pow(a, b),
  log: (x, base) => (base === undefined ? Math.log(x) : Math.log(x) / Math.log(base)),
  log10: (x) => Math.log10(x),
  exp: (x) => Math.exp(x),
  sin: (x) => Math.sin(x),
  cos: (x) => Math.cos(x),
  tan: (x) => Math.tan(x),
  asin: (x) => Math.asin(x),
  acos: (x) => Math.acos(x),
  atan: (x) => Math.atan(x),
  random: () => Math.random(),
};

export function evaluate(expression: string): number {
  const tokens = tokenize(expression);
  const parser = new Parser(tokens);
  const value = parser.parseExpression();
  parser.expectEnd();
  if (!Number.isFinite(value)) throw new Error('Expression produced a non-finite value.');
  return value;
}

type Token = { type: 'num'; value: number } | { type: 'ident'; value: string } | { type: 'op'; value: string };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const char = input[i];
    if (/\s/.test(char)) { i++; continue; }
    if (/[0-9.]/.test(char)) {
      const match = /^(\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(input.slice(i));
      if (!match) throw new Error(`Invalid number at position ${i}.`);
      tokens.push({ type: 'num', value: Number(match[0]) });
      i += match[0].length;
      continue;
    }
    if (/[a-zA-Z_]/.test(char)) {
      const match = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(input.slice(i));
      const name = match![0];
      tokens.push({ type: 'ident', value: name });
      i += name.length;
      continue;
    }
    if ('+-*/%^(),'.includes(char)) {
      tokens.push({ type: 'op', value: char });
      i++;
      continue;
    }
    throw new Error(`Unexpected character "${char}" at position ${i}.`);
  }
  return tokens;
}

class Parser {
  private index = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token | undefined { return this.tokens[this.index]; }
  private next(): Token | undefined { return this.tokens[this.index++]; }
  private expectOp(value: string): void {
    const token = this.next();
    if (!token || token.type !== 'op' || token.value !== value) {
      throw new Error(`Expected "${value}".`);
    }
  }

  parseExpression(): number {
    let value = this.parseTerm();
    while (this.peek()?.type === 'op' && ['+', '-'].includes((this.peek() as { value: string }).value)) {
      const op = (this.next() as { value: string }).value;
      const right = this.parseTerm();
      value = op === '+' ? value + right : value - right;
    }
    return value;
  }

  private parseTerm(): number {
    let value = this.parseFactor();
    while (this.peek()?.type === 'op' && ['*', '/', '%'].includes((this.peek() as { value: string }).value)) {
      const op = (this.next() as { value: string }).value;
      const right = this.parseFactor();
      if (op === '*') value *= right;
      else if (op === '/') {
        if (right === 0) throw new Error('Division by zero.');
        value /= right;
      } else value %= right;
    }
    return value;
  }

  private parseFactor(): number {
    const token = this.peek();
    if (token?.type === 'op' && token.value === '-') { this.next(); return -this.parseFactor(); }
    if (token?.type === 'op' && token.value === '+') { this.next(); return this.parseFactor(); }
    const base = this.parsePower();
    if (this.peek()?.type === 'op' && (this.peek() as { value: string }).value === '^') {
      this.next();
      const exponent = this.parseFactor();
      return Math.pow(base, exponent);
    }
    return base;
  }

  private parsePower(): number {
    return this.parseAtom();
  }

  private parseAtom(): number {
    const token = this.next();
    if (!token) throw new Error('Unexpected end of expression.');
    if (token.type === 'num') return token.value;
    if (token.type === 'op') {
      if (token.value === '(') {
        const value = this.parseExpression();
        this.expectOp(')');
        return value;
      }
      throw new Error(`Unexpected "${token.value}".`);
    }
    // identifier: constant or function call
    if (CONSTANTS[token.value] !== undefined) return CONSTANTS[token.value];
    if (FUNCTIONS[token.value] !== undefined) {
      const next = this.peek();
      if (next?.type === 'op' && next.value === '(') {
        this.next();
        const args: number[] = [];
        if (!(this.peek()?.type === 'op' && (this.peek() as { value: string }).value === ')')) {
          args.push(this.parseExpression());
          while (this.peek()?.type === 'op' && (this.peek() as { value: string }).value === ',') {
            this.next();
            args.push(this.parseExpression());
          }
        }
        this.expectOp(')');
        const fn = FUNCTIONS[token.value];
        const result = fn(...args);
        if (!Number.isFinite(result)) throw new Error(`Function ${token.value} returned a non-finite value.`);
        return result;
      }
      // bare function name with zero args (e.g. `random`)
      const result = FUNCTIONS[token.value]();
      if (!Number.isFinite(result)) throw new Error(`Function ${token.value} returned a non-finite value.`);
      return result;
    }
    throw new Error(`Unknown identifier "${token.value}".`);
  }

  expectEnd(): void {
    if (this.index < this.tokens.length) {
      throw new Error(`Unexpected token at end of expression.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

interface StatsResult {
  count: number;
  min: number;
  max: number;
  sum: number;
  mean: number;
  median: number;
  mode: number[];
  variance: number;
  stddev: number;
  percentile?: number;
  quartiles: { q1: number; q2: number; q3: number };
}

export function computeStats(values: number[], requestedPercentile?: number): StatsResult {
  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mean = sum / count;
  const min = sorted[0];
  const max = sorted[count - 1];
  const median = percentile(sorted, 50);
  const variance = sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) / count;
  const stddev = Math.sqrt(variance);

  const frequency = new Map<number, number>();
  for (const v of sorted) frequency.set(v, (frequency.get(v) ?? 0) + 1);
  let maxFreq = 0;
  for (const f of frequency.values()) maxFreq = Math.max(maxFreq, f);
  const mode = maxFreq > 1 ? [...frequency.entries()].filter(([, f]) => f === maxFreq).map(([v]) => v) : [];

  const result: StatsResult = {
    count,
    min,
    max,
    sum: roundTo(sum, 6),
    mean: roundTo(mean, 6),
    median: roundTo(median, 6),
    mode,
    variance: roundTo(variance, 6),
    stddev: roundTo(stddev, 6),
    quartiles: {
      q1: roundTo(percentile(sorted, 25), 6),
      q2: roundTo(median, 6),
      q3: roundTo(percentile(sorted, 75), 6),
    },
  };
  if (requestedPercentile !== undefined) {
    const p = Math.min(100, Math.max(0, requestedPercentile));
    result.percentile = roundTo(percentile(sorted, p), 6);
  }
  return result;
}

/** Linear-interpolation percentile (method R-7, the default in most tools). */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  const fraction = rank - lower;
  return sorted[lower] + fraction * (sorted[upper] - sorted[lower]);
}

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** Math.trunc(decimals);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function roundToSignificant(value: number, sig: number): number {
  if (value === 0) return 0;
  const d = Math.ceil(Math.log10(Math.abs(value)));
  const factor = 10 ** (sig - d);
  return Math.round(value * factor) / factor;
}

function randomIntInclusive(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Deterministic PRNG (mulberry32) for seeded random_float sequences. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function json(value: unknown): ToolResult { return { content: JSON.stringify(value, null, 2) }; }
function bad(content: string): ToolResult { return { content, is_error: true }; }
