import type { Tool, ToolContext, ToolResult } from './base.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * CSV Tool — read, filter, sort, transform, and analyze CSV files.
 * Deterministic, no model call. Handles quoted fields, escaped commas, etc.
 */
interface CsvArgs {
  action: 'read' | 'filter' | 'sort' | 'stats' | 'convert';
  file_path?: string;
  csv_text?: string;
  column?: string;
  value?: string;
  operator?: 'eq' | 'neq' | 'gt' | 'lt' | 'contains' | 'starts_with' | 'ends_with';
  sort_column?: string;
  sort_desc?: boolean;
  limit?: number;
  output_format?: 'csv' | 'json' | 'markdown';
}

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCSVLine(lines[0]);
  const rows = lines.slice(1).map(l => parseCSVLine(l));
  return { headers, rows };
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        result.push(current.trim());
        current = '';
      } else {
        current += c;
      }
    }
  }
  result.push(current.trim());
  return result;
}

function toMarkdown(headers: string[], rows: string[][]): string {
  const lines = [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(r => `| ${r.join(' | ')} |`),
  ];
  return lines.join('\n');
}

function toJSON(headers: string[], rows: string[][]): string {
  const objects = rows.map(r => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = r[i] ?? ''; });
    return obj;
  });
  return JSON.stringify(objects, null, 2);
}

export const csvTool: Tool = {
  name: 'CSV',
  description:
    'Read, filter, sort, analyze, and convert CSV files. Supports quoted fields, escaped commas, and multiple output formats (CSV, JSON, Markdown table). Deterministic — no model call. Use for data exploration, quick analysis, or format conversion.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['read', 'filter', 'sort', 'stats', 'convert'], description: 'What to do with the CSV' },
      file_path: { type: 'string', description: 'Path to CSV file (or use csv_text)' },
      csv_text: { type: 'string', description: 'Raw CSV text (alternative to file_path)' },
      column: { type: 'string', description: 'Column name for filter' },
      value: { type: 'string', description: 'Value to filter by' },
      operator: { type: 'string', enum: ['eq', 'neq', 'gt', 'lt', 'contains', 'starts_with', 'ends_with'], description: 'Filter operator (default: contains)' },
      sort_column: { type: 'string', description: 'Column to sort by' },
      sort_desc: { type: 'boolean', description: 'Sort descending (default: false)' },
      limit: { type: 'number', description: 'Max rows to return' },
      output_format: { type: 'string', enum: ['csv', 'json', 'markdown'], description: 'Output format (default: markdown)' },
    },
    required: ['action'],
  },
  permission: 'allow',
  async execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
    const a = args as CsvArgs;

    let csvText = a.csv_text;
    if (!csvText && a.file_path) {
      try {
        csvText = await readFile(resolve(ctx.cwd, a.file_path), 'utf8');
      } catch (e) {
        return { content: `Cannot read CSV file: ${(e as Error).message}`, is_error: true };
      }
    }
    if (!csvText) return { content: 'CSV tool requires file_path or csv_text.', is_error: true };

    const { headers, rows } = parseCSV(csvText);
    if (headers.length === 0) return { content: 'CSV is empty or has no headers.', is_error: true };

    const format = a.output_format || 'markdown';

    if (a.action === 'read') {
      const limited = a.limit ? rows.slice(0, a.limit) : rows;
      if (format === 'json') return { content: toJSON(headers, limited) };
      if (format === 'csv') return { content: [headers.join(','), ...limited.map(r => r.join(','))].join('\n') };
      return { content: `**CSV: ${headers.length} columns, ${rows.length} rows**\n\n${toMarkdown(headers, limited)}` };
    }

    if (a.action === 'filter') {
      if (!a.column || !a.value) return { content: 'Filter requires column and value.', is_error: true };
      const colIdx = headers.findIndex(h => h.toLowerCase() === a.column!.toLowerCase());
      if (colIdx === -1) return { content: `Column "${a.column}" not found. Available: ${headers.join(', ')}`, is_error: true };
      const op = a.operator || 'contains';
      const filtered = rows.filter(r => {
        const cell = r[colIdx] || '';
        switch (op) {
          case 'eq': return cell.toLowerCase() === a.value!.toLowerCase();
          case 'neq': return cell.toLowerCase() !== a.value!.toLowerCase();
          case 'gt': return Number(cell) > Number(a.value);
          case 'lt': return Number(cell) < Number(a.value);
          case 'contains': return cell.toLowerCase().includes(a.value!.toLowerCase());
          case 'starts_with': return cell.toLowerCase().startsWith(a.value!.toLowerCase());
          case 'ends_with': return cell.toLowerCase().endsWith(a.value!.toLowerCase());
          default: return true;
        }
      });
      const limited = a.limit ? filtered.slice(0, a.limit) : filtered;
      if (format === 'json') return { content: toJSON(headers, limited) };
      if (format === 'csv') return { content: [headers.join(','), ...limited.map(r => r.join(','))].join('\n') };
      return { content: `**Filter: ${a.column} ${op} "${a.value}"** — ${filtered.length} matching rows\n\n${toMarkdown(headers, limited)}` };
    }

    if (a.action === 'sort') {
      if (!a.sort_column) return { content: 'Sort requires sort_column.', is_error: true };
      const colIdx = headers.findIndex(h => h.toLowerCase() === a.sort_column!.toLowerCase());
      if (colIdx === -1) return { content: `Column "${a.sort_column}" not found. Available: ${headers.join(', ')}`, is_error: true };
      const sortDesc = a.sort_desc;
      const sorted = [...rows].sort((rowA, rowB) => {
        const va = rowA[colIdx] || '';
        const vb = rowB[colIdx] || '';
        const na = Number(va);
        const nb = Number(vb);
        if (!isNaN(na) && !isNaN(nb)) return sortDesc ? nb - na : na - nb;
        return sortDesc ? vb.localeCompare(va) : va.localeCompare(vb);
      });
      const limited = a.limit ? sorted.slice(0, a.limit) : sorted;
      if (format === 'json') return { content: toJSON(headers, limited) };
      if (format === 'csv') return { content: [headers.join(','), ...limited.map(r => r.join(','))].join('\n') };
      return { content: `**Sorted by ${a.sort_column} ${a.sort_desc ? 'desc' : 'asc'}** — ${rows.length} rows\n\n${toMarkdown(headers, limited)}` };
    }

    if (a.action === 'stats') {
      const stats: Array<{ column: string; type: string; unique: number; nulls: number; sample: string }> = [];
      for (let i = 0; i < headers.length; i++) {
        const values = rows.map(r => r[i] || '');
        const unique = new Set(values).size;
        const nulls = values.filter(v => !v).length;
        const isNumeric = values.every(v => !v || !isNaN(Number(v)));
        const sample = values.find(v => v) || '';
        stats.push({ column: headers[i], type: isNumeric ? 'number' : 'text', unique, nulls, sample });
      }
      const output = [
        `**CSV Stats: ${rows.length} rows, ${headers.length} columns**`,
        ``,
        `| Column | Type | Unique | Nulls | Sample |`,
        `|--------|------|--------|-------|--------|`,
        ...stats.map(s => `| ${s.column} | ${s.type} | ${s.unique} | ${s.nulls} | ${s.sample} |`),
      ].join('\n');
      return { content: output };
    }

    if (a.action === 'convert') {
      if (format === 'json') return { content: toJSON(headers, rows) };
      if (format === 'csv') return { content: [headers.join(','), ...rows.map(r => r.join(','))].join('\n') };
      return { content: toMarkdown(headers, rows) };
    }

    return { content: `Unknown CSV action: ${a.action}`, is_error: true };
  },
};
