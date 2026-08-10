// Text tool — deterministic text manipulation for the agent:
// case conversion, slugify, diffing, regex, splitting, and table conversions.

import type { Tool, ToolResult } from './base.js';

interface TextInput {
  action: string;
  text?: string;
  // case
  style?: string;
  // truncate
  max?: number;
  suffix?: string;
  // count
  count?: string;
  // diff
  a?: string;
  b?: string;
  // split/join
  delimiter?: string;
  limit?: number;
  lines?: string[];
  // pad/trim
  length?: number;
  char?: string;
  // regex
  pattern?: string;
  flags?: string;
  replacement?: string;
  // base64
  encode?: boolean;
  decode?: boolean;
  // wrap
  width?: number;
  // markdown tables
  csv?: string;
  md?: string;
}

export const textTool: Tool = {
  name: 'Text',
  description: 'Deterministic text manipulation: case conversion (camel/snake/kebab/pascal/title...), slugify, truncate, word/char/line counts, line diff, split/join lines, regex find/replace, markdown table <-> CSV, and base64/URL encode-decode. Use for reliable text transforms.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['case', 'slugify', 'truncate', 'count', 'diff', 'split', 'join', 'pad', 'trim', 'regex_find', 'regex_replace', 'csv_to_markdown', 'markdown_to_csv', 'base64_encode', 'base64_decode', 'url_encode', 'url_decode', 'wrap'] },
      text: { type: 'string', description: 'Primary text input.' },
      style: { type: 'string', description: 'Target case style.' },
      max: { type: 'number', description: 'Max length for truncate / wrap width.' },
      suffix: { type: 'string', description: 'Truncation suffix (default "…").' },
      count: { type: 'string', description: 'What to count: chars, words, lines, sentences (default all).' },
      a: { type: 'string', description: 'First text for diff.' },
      b: { type: 'string', description: 'Second text for diff.' },
      delimiter: { type: 'string', description: 'Delimiter for split/join (default newline).' },
      limit: { type: 'number', description: 'Max pieces for split.' },
      lines: { type: 'array', items: { type: 'string' }, description: 'Lines to join.' },
      length: { type: 'number', description: 'Target length for pad/truncate.' },
      char: { type: 'string', description: 'Pad character (default space).' },
      pattern: { type: 'string', description: 'Regex pattern for regex_find/regex_replace.' },
      flags: { type: 'string', description: 'Regex flags (g, i, m, s).' },
      replacement: { type: 'string', description: 'Replacement for regex_replace ($1 refs supported).' },
      encode: { type: 'boolean' },
      decode: { type: 'boolean' },
      width: { type: 'number', description: 'Wrap width (default 80).' },
      csv: { type: 'string', description: 'CSV text for csv_to_markdown.' },
      md: { type: 'string', description: 'Markdown table text for markdown_to_csv.' },
    },
    required: ['action'],
  },
  permission: 'none',

  async execute(args, _ctx): Promise<ToolResult> {
    const input = args as TextInput;
    try {
      switch (input.action) {
        case 'case': {
          if (input.text === undefined || !input.style) return bad('case requires text and style.');
          return { content: convertCase(input.text, input.style) };
        }
        case 'slugify': {
          if (input.text === undefined) return bad('slugify requires text.');
          return { content: slugify(input.text) };
        }
        case 'truncate': {
          if (input.text === undefined) return bad('truncate requires text.');
          const max = clampInt(input.max, 1, 10_000_000, 80);
          const suffix = input.suffix ?? '…';
          if (input.text.length <= max) return { content: input.text };
          const cut = Math.max(0, max - suffix.length);
          return { content: input.text.slice(0, cut).trimEnd() + suffix };
        }
        case 'count': {
          if (input.text === undefined) return bad('count requires text.');
          return json(countText(input.text, input.count));
        }
        case 'diff': {
          if (input.a === undefined || input.b === undefined) return bad('diff requires a and b.');
          return { content: lineDiff(input.a, input.b) };
        }
        case 'split': {
          if (input.text === undefined) return bad('split requires text.');
          const delimiter = input.delimiter ?? '\n';
          const parts = input.text.split(delimiter);
          return json({ count: parts.length, parts: input.limit ? parts.slice(0, input.limit) : parts });
        }
        case 'join': {
          const lines = input.lines ?? [];
          return { content: lines.join(input.delimiter ?? '\n') };
        }
        case 'pad': {
          if (input.text === undefined) return bad('pad requires text.');
          const length = clampInt(input.length, 0, 10_000_000, input.text.length);
          const char = (input.char ?? ' ').slice(0, 1);
          const total = Math.max(0, length - input.text.length);
          const left = Math.floor(total / 2);
          return { content: char.repeat(left) + input.text + char.repeat(total - left) };
        }
        case 'trim': {
          if (input.text === undefined) return bad('trim requires text.');
          const char = input.char ?? ' ';
          return { content: trimBoth(input.text, char) };
        }
        case 'regex_find': {
          if (input.text === undefined || !input.pattern) return bad('regex_find requires text and pattern.');
          const matches = findMatches(input.text, input.pattern, input.flags ?? 'g');
          return json({ count: matches.length, matches });
        }
        case 'regex_replace': {
          if (input.text === undefined || !input.pattern || input.replacement === undefined) {
            return bad('regex_replace requires text, pattern, and replacement.');
          }
          const re = new RegExp(input.pattern, input.flags ?? 'g');
          return { content: input.text.replace(re, input.replacement) };
        }
        case 'csv_to_markdown': {
          if (input.csv === undefined) return bad('csv_to_markdown requires csv.');
          return { content: csvToMarkdown(input.csv) };
        }
        case 'markdown_to_csv': {
          if (input.md === undefined) return bad('markdown_to_csv requires md.');
          return { content: markdownToCsv(input.md) };
        }
        case 'base64_encode': {
          if (input.text === undefined) return bad('base64_encode requires text.');
          return { content: Buffer.from(input.text, 'utf8').toString('base64') };
        }
        case 'base64_decode': {
          if (input.text === undefined) return bad('base64_decode requires text.');
          return { content: Buffer.from(input.text, 'base64').toString('utf8') };
        }
        case 'url_encode': {
          if (input.text === undefined) return bad('url_encode requires text.');
          return { content: encodeURIComponent(input.text) };
        }
        case 'url_decode': {
          if (input.text === undefined) return bad('url_decode requires text.');
          return { content: decodeURIComponent(input.text) };
        }
        case 'wrap': {
          if (input.text === undefined) return bad('wrap requires text.');
          return { content: wrapText(input.text, clampInt(input.width, 1, 10_000, 80)) };
        }
        default:
          return bad(`Unknown Text action: ${input.action}`);
      }
    } catch (error) {
      return bad((error as Error).message);
    }
  },
};

// ---------------------------------------------------------------------------
// Implementations
// ---------------------------------------------------------------------------

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function splitWords(text: string): string[] {
  return text.match(/[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*/g) ?? [];
}

function convertCase(text: string, style: string): string {
  const words = splitWords(text);
  const lower = words.map((w) => w.toLowerCase());
  const cap = lower.map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  switch (style) {
    case 'lower': return lower.join(' ');
    case 'upper': return lower.map((w) => w.toUpperCase()).join(' ');
    case 'title': return cap.join(' ');
    case 'sentence': return lower.map((w, i) => (i === 0 ? cap[0] : w)).join(' ');
    case 'camel': return lower.map((w, i) => (i === 0 ? w : cap[i])).join('');
    case 'pascal': return cap.join('');
    case 'snake': return lower.join('_');
    case 'kebab': return lower.join('-');
    case 'constant': return lower.map((w) => w.toUpperCase()).join('_');
    case 'dot': return lower.join('.');
    case 'capitalize': return cap.join(' ');
    default: return text;
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled';
}

function countText(text: string, what: string | undefined): Record<string, number> {
  const words = (text.match(/\S+/g) ?? []).length;
  const chars = text.length;
  const lines = text === '' ? 0 : text.split('\n').length;
  const sentences = (text.match(/[^.!?]+[.!?]+/g) ?? []).length;
  if (!what) return { chars, words, lines, sentences };
  switch (what) {
    case 'chars': return { chars };
    case 'words': return { words };
    case 'lines': return { lines };
    case 'sentences': return { sentences };
    default: return { chars, words, lines, sentences };
  }
}

// -- line diff (LCS) ---------------------------------------------------------

export function lineDiff(a: string, b: string): string {
  const aLines = a.replace(/\r\n/g, '\n').split('\n');
  const bLines = b.replace(/\r\n/g, '\n').split('\n');
  const table = lcsTable(aLines, bLines);
  const out: string[] = [];
  let i = aLines.length;
  let j = bLines.length;
  while (i > 0 && j > 0) {
    if (aLines[i - 1] === bLines[j - 1]) { out.unshift(`  ${aLines[i - 1]}`); i--; j--; }
    else if (table[i - 1][j] >= table[i][j - 1]) { out.unshift(`- ${aLines[i - 1]}`); i--; }
    else { out.unshift(`+ ${bLines[j - 1]}`); j--; }
  }
  while (i > 0) { out.unshift(`- ${aLines[i - 1]}`); i--; }
  while (j > 0) { out.unshift(`+ ${bLines[j - 1]}`); j--; }
  return out.join('\n');
}

function lcsTable(a: string[], b: string[]): number[][] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      table[i][j] = a[i - 1] === b[j - 1] ? table[i - 1][j - 1] + 1 : Math.max(table[i - 1][j], table[i][j - 1]);
    }
  }
  return table;
}

// -- regex helpers ------------------------------------------------------------

function findMatches(text: string, pattern: string, flags: string): Array<{ match: string; groups: string[] }> {
  const re = new RegExp(pattern, flags.includes('g') ? flags : flags + 'g');
  const out: Array<{ match: string; groups: string[] }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ match: m[0], groups: m.slice(1) });
    if (m[0] === '') re.lastIndex++;
  }
  return out;
}

// -- markdown tables ----------------------------------------------------------

function csvToMarkdown(csv: string): string {
  const rows = csv.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim() !== '');
  if (rows.length === 0) return '';
  const parsed = rows.map((line) => parseCsvCells(line));
  const width = Math.max(...parsed.map((r) => r.length));
  const pad = (cells: string[]): string[] => {
    const padded = [...cells];
    while (padded.length < width) padded.push('');
    return padded;
  };
  const formatRow = (cells: string[]): string => `| ${pad(cells).join(' | ')} |`;
  const header = parsed[0];
  const out = [formatRow(header), `| ${pad(header).map(() => '---').join(' | ')} |`];
  for (let i = 1; i < parsed.length; i++) out.push(formatRow(parsed[i]));
  return out.join('\n');
}

function parseCsvCells(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((c) => c.trim());
}

function markdownToCsv(md: string): string {
  const rows = md.replace(/\r\n/g, '\n').split('\n')
    .filter((l) => l.trim().startsWith('|'))
    .filter((l) => !/^\s*\|[\s:|-]+\|\s*$/.test(l)); // drop separator rows
  if (rows.length === 0) return '';
  const cells = rows.map((row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()));
  const escape = (c: string): string => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
  return cells.map((row) => row.map(escape).join(',')).join('\n');
}

function trimBoth(text: string, char: string): string {
  if (char.length === 0) return text.trim();
  const re = new RegExp(`^[${escapeRe(char)}]+|[${escapeRe(char)}]+$`, 'g');
  return text.replace(re, '');
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wrapText(text: string, width: number): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length <= width) {
      current = current ? `${current} ${word}` : word;
    } else {
      if (current) lines.push(current);
      // Long word: hard-wrap it.
      if (word.length > width) {
        for (let i = 0; i < word.length; i += width) lines.push(word.slice(i, i + width));
        current = '';
      } else {
        current = word;
      }
    }
  }
  if (current) lines.push(current);
  return lines.join('\n');
}

function json(value: unknown): ToolResult { return { content: JSON.stringify(value, null, 2) }; }
function bad(content: string): ToolResult { return { content, is_error: true }; }
