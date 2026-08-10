// Json tool — parse, validate, query, and transform structured data.
// The agent uses this for reliable JSON work without shelling out.

import type { Tool, ToolResult } from './base.js';

const MAX_INPUT = 5_000_000; // 5 MB guard against pathological inputs

interface JsonInput {
  action: string;
  input?: string;
  value?: string;
  path?: string;
  indent?: number;
  delimiter?: string;
  data?: string;
  array?: unknown[];
  maxDepth?: number;
  prefix?: string;
}

export const jsonTool: Tool = {
  name: 'Json',
  description: 'Reliable structured-data work: parse, stringify, validate, query (dot-path like users.0.name or users[*].name), CSV<->JSON conversion, deep merge, and flatten/unflatten. Use this instead of guessing JSON by hand.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['parse', 'stringify', 'validate', 'query', 'csv_to_json', 'json_to_csv', 'merge', 'flatten', 'unflatten', 'extract'] },
      input: { type: 'string', description: 'JSON text to parse/validate/extract.' },
      value: { type: 'string', description: 'JSON text of the value to stringify.' },
      path: { type: 'string', description: 'Dot/bracket path for query, e.g. users.0.name or items[*].id.' },
      indent: { type: 'number', description: 'Indent spaces for stringify (default 2).' },
      delimiter: { type: 'string', description: 'CSV delimiter (default comma).' },
      data: { type: 'string', description: 'JSON text of data for merge/flatten/unflatten.' },
      array: { type: 'array', items: { type: 'object' }, description: 'Array of objects to convert to CSV.' },
      maxDepth: { type: 'number', description: 'Max depth for flatten (default 10).' },
      prefix: { type: 'string', description: 'Prefix separator for flatten (default ".").' },
    },
    required: ['action'],
  },
  permission: 'none',

  async execute(args, _ctx): Promise<ToolResult> {
    const input = args as JsonInput;
    try {
      switch (input.action) {
        case 'parse': {
          const parsed = parseJson(input.input);
          return json({ ok: true, type: typeOf(parsed), value: parsed });
        }
        case 'stringify': {
          const value = parseJson(input.value ?? '');
          const indent = clampInt(input.indent, 0, 10, 2);
          return { content: JSON.stringify(value, null, indent) };
        }
        case 'validate': {
          try {
            const parsed = parseJson(input.input);
            return json({ valid: true, type: typeOf(parsed), size: roughSize(parsed) });
          } catch (error) {
            return json({ valid: false, error: (error as Error).message });
          }
        }
        case 'query': {
          const target = input.input !== undefined ? parseJson(input.input) : input.data;
          if (!input.path) return bad('query requires a path.');
          const result = queryPath(target, input.path);
          return json({ ok: true, found: result.found, value: result.value });
        }
        case 'csv_to_json': {
          return json(parseCsv(input.input ?? '', input.delimiter ?? ','));
        }
        case 'json_to_csv': {
          const rows = (input.array ?? []) as Record<string, unknown>[];
          if (!Array.isArray(rows)) return bad('json_to_csv requires an array.');
          return { content: toCsv(rows, input.delimiter ?? ',') };
        }
        case 'merge': {
          const target = input.input !== undefined ? parseJson(input.input) : undefined;
          const source = input.data !== undefined ? parseJson(input.data) : undefined;
          if (!target || !source) return bad('merge requires input and data JSON.');
          return json(deepMerge(target, source));
        }
        case 'flatten': {
          const target = parseJson(input.data ?? input.input ?? '');
          return json(flatten(target, input.prefix ?? '.', clampInt(input.maxDepth, 1, 50, 10)));
        }
        case 'unflatten': {
          const target = parseJson(input.data ?? input.input ?? '');
          if (!isPlainObject(target)) return bad('unflatten requires a flat object.');
          return json(unflatten(target, input.prefix ?? '.'));
        }
        case 'extract': {
          const found = extractJson(input.input ?? '');
          if (found === null) return bad('No valid JSON object or array found in the text.');
          return json({ ok: true, type: typeOf(found), value: found });
        }
        default:
          return bad(`Unknown Json action: ${input.action}`);
      }
    } catch (error) {
      return bad((error as Error).message);
    }
  },
};

// ---------------------------------------------------------------------------
// Implementation helpers
// ---------------------------------------------------------------------------

function parseJson(raw: string | undefined): unknown {
  if (raw === undefined) throw new Error('Missing JSON input.');
  if (typeof raw !== 'string' || raw.length > MAX_INPUT) throw new Error('JSON input must be a string under 5 MB.');
  return JSON.parse(raw);
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function roughSize(value: unknown): number {
  return JSON.stringify(value)?.length ?? 0;
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// -- dot/bracket path query -------------------------------------------------

interface QueryResult {
  found: boolean;
  value: unknown;
}

/** Query a parsed value with a dot/bracket path supporting `[*]` wildcards. */
export function queryPath(root: unknown, path: string): QueryResult {
  const tokens = tokenizePath(path);
  const hits: unknown[] = [];
  walk(root, tokens, 0, hits);
  const wildcard = path.includes('[*]');
  if (!wildcard) {
    return { found: hits.length > 0, value: hits.length > 0 ? hits[0] : undefined };
  }
  return { found: hits.length > 0, value: hits };
}

function tokenizePath(path: string): Array<string | number | '*'> {
  const tokens: Array<string | number | '*'> = [];
  // Normalize bracket access (users[0].name, a[*]) to dot notation, then split.
  const normalized = path.replace(/\[(\*|\d+)\]/g, '.$1');
  for (const part of normalized.split('.')) {
    if (part === '') continue;
    if (part === '*') tokens.push('*');
    else if (/^\d+$/.test(part)) tokens.push(Number(part));
    else tokens.push(part);
  }
  return tokens;
}

function walk(node: unknown, tokens: Array<string | number | '*'>, index: number, hits: unknown[]): void {
  if (index >= tokens.length) {
    hits.push(node);
    return;
  }
  const token = tokens[index];
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    if (token === '*') {
      for (const item of node) walk(item, tokens, index + 1, hits);
    } else if (typeof token === 'number') {
      walk(node[token], tokens, index + 1, hits);
    }
    return;
  }
  if (isPlainObject(node) && typeof token === 'string') {
    walk(node[token], tokens, index + 1, hits);
  }
}

// -- CSV <-> JSON -----------------------------------------------------------

function parseCsv(text: string, delimiter: string): { rows: Record<string, unknown>[]; headers: string[] } {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((line) => line.trim() !== '');
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = splitCsvLine(lines[0], delimiter);
  const rows: Record<string, unknown>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i], delimiter);
    const row: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      const raw = cells[index];
      if (raw !== undefined) row[header] = coerceCell(raw);
    });
    rows.push(row);
  }
  return { headers, rows };
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((c) => c.trim());
}

function coerceCell(raw: string): string | number | boolean | null {
  if (raw === '') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

function toCsv(rows: Record<string, unknown>[], delimiter: string): string {
  if (rows.length === 0) return '';
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const escape = (cell: unknown): string => {
    const text = cell === null || cell === undefined ? '' : String(cell);
    return /["\n,]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [headers.map(escape).join(delimiter)];
  for (const row of rows) {
    lines.push(headers.map((header) => escape(row[header])).join(delimiter));
  }
  return lines.join('\n');
}

// -- deep merge / flatten / unflatten ---------------------------------------

function deepMerge(target: unknown, source: unknown): unknown {
  if (Array.isArray(target) && Array.isArray(source)) return [...target, ...source];
  if (isPlainObject(target) && isPlainObject(source)) {
    const out: Record<string, unknown> = { ...target };
    for (const key of Object.keys(source)) {
      out[key] = key in out ? deepMerge(out[key], source[key]) : source[key];
    }
    return out;
  }
  return source;
}

function flatten(node: unknown, prefix: string, maxDepth: number, depth = 0, key = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const push = (child: unknown, path: string): void => {
    const leaf = !isPlainObject(child) && !Array.isArray(child);
    if (leaf || depth >= maxDepth) {
      out[path] = child;
    } else {
      Object.assign(out, flatten(child, prefix, maxDepth, depth + 1, path));
    }
  };
  if (Array.isArray(node)) {
    node.forEach((item, index) => push(item, key ? `${key}${prefix}${index}` : `${index}`));
  } else if (isPlainObject(node)) {
    for (const [k, v] of Object.entries(node)) {
      push(v, key ? `${key}${prefix}${k}` : k);
    }
  } else {
    out[key || ''] = node;
  }
  return out;
}

function unflatten(flat: Record<string, unknown>, prefix: string): unknown {
  const root: Record<string, unknown> = {};
  const numeric = (s: string): number | null => (/^\d+$/.test(s) ? Number(s) : null);

  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split(prefix);
    let container: Record<string, unknown> | unknown[] = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      const nextPart = parts[i + 1];
      const isArrayNext = numeric(nextPart) !== null;
      let next: Record<string, unknown> | unknown[] | undefined;
      if (Array.isArray(container)) {
        const index = numeric(part);
        if (index !== null) next = container[index] as Record<string, unknown> | unknown[] | undefined;
        else next = (container as unknown as Record<string, unknown>)[part] as Record<string, unknown> | unknown[] | undefined;
        if (typeof next !== 'object' || next === null) {
          const replacement: Record<string, unknown> | unknown[] = isArrayNext ? [] : {};
          if (index !== null) container[index] = replacement;
          else (container as unknown as Record<string, unknown>)[part] = replacement;
          next = replacement;
        }
      } else {
        next = container[part] as Record<string, unknown> | unknown[] | undefined;
        if (typeof next !== 'object' || next === null) {
          const replacement: Record<string, unknown> | unknown[] = isArrayNext ? [] : {};
          container[part] = replacement;
          next = replacement;
        }
      }
      container = next;
    }
    const last = parts[parts.length - 1];
    if (Array.isArray(container)) {
      const index = numeric(last);
      if (index !== null) container[index] = value;
      else (container as unknown as Record<string, unknown>)[last] = value;
    } else {
      container[last] = value;
    }
  }
  return root;
}

// -- extract JSON from text ---------------------------------------------------

function extractJson(text: string): unknown {
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char !== '{' && char !== '[') continue;
    const candidate = tryBalanced(text, i);
    if (candidate !== null) return candidate;
  }
  return null;
}

function tryBalanced(text: string, start: number): unknown | null {
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === open) depth++;
    else if (char === close) {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function json(value: unknown): ToolResult { return { content: JSON.stringify(value, null, 2) }; }
function bad(content: string): ToolResult { return { content, is_error: true }; }
