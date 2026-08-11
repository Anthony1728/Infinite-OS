// Database tool — SQLite queries, CSV import, schema inspection via better-sqlite3.
// Gives the agent direct SQL power without shelling out to the CLI.

import type { Tool, ToolResult } from './base.js';

interface DatabaseInput {
  action: string;
  db_path?: string;
  query?: string;
  params?: unknown[];
  csv_path?: string;
  table_name?: string;
  delimiter?: string;
}

export const databaseTool: Tool = {
  name: 'Database',
  description: 'SQLite database operations: run SELECT/INSERT/UPDATE/DELETE queries, import CSV files into tables, inspect schema (tables, columns, indexes), and get row counts. Uses better-sqlite3 for reliable synchronous access.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['query', 'import_csv', 'schema', 'row_count', 'tables'] },
      db_path: { type: 'string', description: 'Path to the SQLite database file. Created if it does not exist for write actions.' },
      query: { type: 'string', description: 'SQL query to execute. Use ? placeholders for parameters.' },
      params: { type: 'array', description: 'Parameters for the SQL query placeholders.' },
      csv_path: { type: 'string', description: 'Path to a CSV file to import.' },
      table_name: { type: 'string', description: 'Target table name for CSV import or schema inspection.' },
      delimiter: { type: 'string', description: 'CSV delimiter (default: comma).' },
    },
    required: ['action', 'db_path'],
  },
  permission: 'allow',

  async execute(args, _ctx): Promise<ToolResult> {
    const input = args as DatabaseInput;
    try {
      // Lazy import — better-sqlite3 is optional at build time
      const Database = (await import('better-sqlite3')).default;
      const db = new Database(input.db_path!);

      try {
        switch (input.action) {
          case 'query': {
            if (!input.query) return { content: 'Error: query is required', is_error: true };
            const trimmed = input.query.trim().toUpperCase();
            const isRead = trimmed.startsWith('SELECT') || trimmed.startsWith('PRAGMA') || trimmed.startsWith('EXPLAIN');
            if (isRead) {
              const stmt = db.prepare(input.query);
              const rows = input.params ? stmt.all(...input.params) : stmt.all();
              const limited = rows.slice(0, 500);
              return {
                content: JSON.stringify({
                  row_count: rows.length,
                  returned: limited.length,
                  rows: limited,
                }, null, 2),
              };
            }
            // Write statements (INSERT, UPDATE, DELETE, CREATE, etc.)
            const info = input.params
              ? db.prepare(input.query).run(...input.params)
              : db.prepare(input.query).run();
            return {
              content: JSON.stringify({
                changes: info.changes,
                last_insert_rowid: info.lastInsertRowid,
              }),
            };
          }

          case 'import_csv': {
            if (!input.csv_path || !input.table_name) {
              return { content: 'Error: csv_path and table_name are required', is_error: true };
            }
            const { readFileSync } = await import('node:fs');
            const csvContent = readFileSync(input.csv_path, 'utf-8');
            const delim = input.delimiter ?? ',';
            const lines = csvContent.split('\n').filter((l) => l.trim());
            if (lines.length < 2) return { content: 'Error: CSV must have a header and at least one data row', is_error: true };

            const headers = lines[0].split(delim).map((h) => h.trim().replace(/^"|"$/g, ''));
            const safeTable = input.table_name.replace(/[^a-zA-Z0-9_]/g, '_');
            const colDefs = headers.map((h) => `"${h.replace(/"/g, '""')}" TEXT`).join(', ');
            db.exec(`CREATE TABLE IF NOT EXISTS "${safeTable}" (${colDefs})`);

            const placeholders = headers.map(() => '?').join(', ');
            const insert = db.prepare(`INSERT INTO "${safeTable}" (${headers.map((h) => `"${h.replace(/"/g, '""')}"`).join(', ')}) VALUES (${placeholders})`);

            const insertMany = db.transaction((rows: string[][]) => {
              for (const row of rows) insert.run(...row);
            });

            const dataRows = lines.slice(1).map((line) => {
              const vals: string[] = [];
              let current = '';
              let inQuotes = false;
              for (const ch of line) {
                if (ch === '"') { inQuotes = !inQuotes; continue; }
                if (ch === delim && !inQuotes) { vals.push(current.trim()); current = ''; continue; }
                current += ch;
              }
              vals.push(current.trim());
              return vals;
            });

            insertMany(dataRows);
            return {
              content: JSON.stringify({
                table: safeTable,
                rows_imported: dataRows.length,
                columns: headers,
              }),
            };
          }

          case 'schema': {
            const target = input.table_name;
            if (target) {
              const safeTable = target.replace(/[^a-zA-Z0-9_]/g, '_');
              const info = db.prepare(`PRAGMA table_info("${safeTable}")`).all();
              const indexes = db.prepare(`PRAGMA index_list("${safeTable}")`).all();
              return { content: JSON.stringify({ table: safeTable, columns: info, indexes }, null, 2) };
            }
            // All tables
            const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all();
            return { content: JSON.stringify({ tables }, null, 2) };
          }

          case 'row_count': {
            if (!input.table_name) return { content: 'Error: table_name is required', is_error: true };
            const safeTable = input.table_name.replace(/[^a-zA-Z0-9_]/g, '_');
            const result = db.prepare(`SELECT COUNT(*) as count FROM "${safeTable}"`).get() as { count: number };
            return { content: JSON.stringify({ table: safeTable, count: result.count }) };
          }

          case 'tables': {
            const tables = db.prepare(`SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name`).all();
            return { content: JSON.stringify({ tables }, null, 2) };
          }

          default:
            return { content: `Unknown action: "${input.action}". Use: query, import_csv, schema, row_count, tables`, is_error: true };
        }
      } finally {
        db.close();
      }
    } catch (e) {
      return { content: `Database error: ${(e as Error).message}`, is_error: true };
    }
  },
};
