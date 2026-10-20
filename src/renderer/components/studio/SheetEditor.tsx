import { useEffect, useMemo, useRef, useState } from 'react';
import type { StudioItem, StudioSheet } from '../../../shared/studio';
import { columnName } from '../../../shared/studio';
import { useStudioStore } from '../../stores/studio';
import { evaluateCell, formatCellValue } from '../../lib/sheet';
import { plainTextToSheet } from './studioUtils';
import './studio.css';

interface SheetEditorProps {
  item: StudioItem;
}

const CELL_WIDTH = 112;
const ROW_HEIGHT = 28;
const MAX_RENDER_ROWS = 140;
const MAX_RENDER_COLUMNS = 32;

export function SheetEditor({ item }: SheetEditorProps) {
  const initial = item.sheet ?? { columns: 12, rows: 30, cells: {} };
  const [cells, setCells] = useState<Record<string, string>>(initial.cells);
  const [columns, setColumns] = useState(initial.columns);
  const [rows, setRows] = useState(initial.rows);
  const [selected, setSelected] = useState('A1');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [formulaFocus, setFormulaFocus] = useState(false);
  const [formulaDraft, setFormulaDraft] = useState('');
  const gridRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const loadedIdRef = useRef(item.id);
  const localSheetRef = useRef<StudioSheet>(initial);
  const formulaSkipBlurRef = useRef(false);

  useEffect(() => {
    const next = item.sheet ?? { columns: 12, rows: 30, cells: {} };
    if (item.id !== loadedIdRef.current) {
      loadedIdRef.current = item.id;
      localSheetRef.current = next;
      setCells(next.cells);
      setColumns(next.columns);
      setRows(next.rows);
      setSelected('A1');
      setEditing(false);
      setDraft('');
      return;
    }
    if (editing) return;
    // Our saves echo back through the store; only an external writer (AI panel
    // or agent) can produce a sheet that differs from the last local snapshot.
    if (sameSheet(next, localSheetRef.current)) return;
    localSheetRef.current = next;
    setCells(next.cells);
    setColumns(next.columns);
    setRows(next.rows);
  }, [item.id, item.sheet, item.updatedAt, editing]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const values = useMemo(() => {
    const display: Record<string, string> = {};
    const cache = new Map();
    for (const address of Object.keys(cells)) {
      const raw = cells[address] ?? '';
      const value = raw.startsWith('=') ? evaluateCell(cells, address, cache) : raw;
      display[address] = formatCellValue(value);
    }
    return display;
  }, [cells]);

  const raw = cells[selected] ?? '';
  const shown = values[selected] ?? '';
  const isFormula = raw.startsWith('=');

  useEffect(() => {
    if (!formulaFocus) setFormulaDraft(raw);
  }, [raw, formulaFocus, selected]);

  const save = (nextCells: Record<string, string>, nextColumns = columns, nextRows = rows) => {
    setCells(nextCells);
    const sheet: StudioSheet = { columns: nextColumns, rows: nextRows, cells: nextCells };
    localSheetRef.current = sheet;
    saveQueue.current = saveQueue.current
      .then(() => useStudioStore.getState().update(item.id, { sheet }))
      .catch(() => undefined);
  };

  const commit = (address: string, value: string) => {
    const next = { ...cells };
    if (value.trim() === '') delete next[address];
    else next[address] = value;
    save(next);
    setEditing(false);
    setDraft('');
  };

  const select = (address: string) => {
    if (editing) commit(selected, draft);
    setSelected(address);
    setDraft(cells[address] ?? '');
    setEditing(false);
    gridRef.current?.focus();
  };

  const move = (deltaRow: number, deltaColumn: number, commitCurrent = false) => {
    const match = /^([A-Z]+)(\d+)$/.exec(selected);
    if (!match) return;
    let column = 0;
    for (const char of match[1]) column = column * 26 + (char.charCodeAt(0) - 64);
    column -= 1;
    const row = Number(match[2]) - 1;
    const nextRow = Math.max(0, Math.min(rows - 1, row + deltaRow));
    const nextColumn = Math.max(0, Math.min(columns - 1, column + deltaColumn));
    const address = `${columnName(nextColumn)}${nextRow + 1}`;
    if (commitCurrent) commit(selected, draft);
    setSelected(address);
    setDraft(cells[address] ?? '');
    setEditing(false);
    gridRef.current?.focus();
    requestAnimationFrame(() => {
      document.querySelector(`[data-cell="${address}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  };

  const startEditing = (seed?: string) => {
    setDraft(seed ?? cells[selected] ?? '');
    setEditing(true);
  };

  const onGridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (editing || formulaFocus) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); move(1, 0); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); move(-1, 0); return; }
    if (event.key === 'ArrowRight') { event.preventDefault(); move(0, 1); return; }
    if (event.key === 'ArrowLeft') { event.preventDefault(); move(0, -1); return; }
    if (event.key === 'Enter' || event.key === 'F2') { event.preventDefault(); startEditing(); return; }
    if (event.key === 'Tab') {
      event.preventDefault();
      move(0, event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      commit(selected, '');
      return;
    }
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      setDraft(event.key);
      setEditing(true);
    }
  };

  const onPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    if (editing || formulaFocus) return;
    const text = event.clipboardData.getData('text/plain');
    if (!text || (!text.includes('\t') && !text.includes('\n'))) return;
    event.preventDefault();
    const table = text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').map((line) => line.split('\t'));
    const match = /^([A-Z]+)(\d+)$/.exec(selected);
    if (!match) return;
    let startColumn = 0;
    for (const char of match[1]) startColumn = startColumn * 26 + (char.charCodeAt(0) - 64);
    startColumn -= 1;
    const startRow = Number(match[2]) - 1;
    const next = { ...cells };
    const widest = Math.max(...table.map((line) => line.length));
    table.forEach((line, rowOffset) => {
      line.forEach((value, columnOffset) => {
        const column = startColumn + columnOffset;
        const row = startRow + rowOffset;
        if (column >= 64 || row >= 500) return;
        const address = `${columnName(column)}${row + 1}`;
        if (value === '') delete next[address];
        else next[address] = value.slice(0, 4_000);
      });
    });
    save(
      next,
      Math.max(columns, Math.min(64, startColumn + widest + 1)),
      Math.max(rows, Math.min(500, startRow + table.length + 2)),
    );
  };

  const importCsvFile = async (file: File) => {
    const text = await file.text();
    const sheet = plainTextToSheet(text, columns, rows);
    save(sheet.cells, Math.max(columns, sheet.columns), Math.max(rows, sheet.rows));
  };

  const renderedColumns = Math.min(columns, MAX_RENDER_COLUMNS);
  const renderedRows = Math.min(rows, MAX_RENDER_ROWS);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#101015]/80 px-3 py-1.5 backdrop-blur-xl">
        <span className="grid h-7 min-w-16 place-items-center rounded-md border border-white/[0.07] bg-white/[0.035] px-2 text-[11px] font-semibold text-zinc-300">
          {selected}
        </span>
        <span className="grid h-7 w-7 place-items-center rounded-md text-[12px] font-serif italic text-zinc-500">fx</span>
        <input
          value={formulaFocus ? formulaDraft : raw}
          onFocus={() => {
            setFormulaFocus(true);
            setFormulaDraft(raw);
          }}
          onBlur={() => {
            if (formulaSkipBlurRef.current) {
              formulaSkipBlurRef.current = false;
              setFormulaFocus(false);
              return;
            }
            if (formulaDraft !== raw) commit(selected, formulaDraft);
            setFormulaFocus(false);
          }}
          onChange={(event) => setFormulaDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit(selected, formulaDraft);
              formulaSkipBlurRef.current = true;
              setFormulaFocus(false);
              gridRef.current?.focus();
            }
            if (event.key === 'Escape') {
              formulaSkipBlurRef.current = true;
              setFormulaFocus(false);
              setFormulaDraft(raw);
              gridRef.current?.focus();
            }
          }}
          spellCheck={false}
          className="h-7 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 font-mono text-[12px] text-zinc-200 outline-none focus:border-white/[0.08] focus:bg-white/[0.03]"
          placeholder="Enter a value or =SUM(A1:A9)"
          aria-label="Formula bar"
        />
        <div className="hidden items-center gap-1 sm:flex">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded-md px-2 py-1.5 text-[11px] text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-100"
          >
            Import CSV
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importCsvFile(file);
              event.target.value = '';
            }}
          />
          <span className="mx-1 h-5 w-px bg-white/[0.07]" />
          <button
            type="button"
            title="Add row"
            onClick={() => {
              const nextRows = Math.min(500, rows + 1);
              setRows(nextRows);
              save(cells, columns, nextRows);
            }}
            className="rounded-md px-2 py-1.5 text-[11px] text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-100"
          >
            + Row
          </button>
          <button
            type="button"
            title="Add column"
            onClick={() => {
              const nextColumns = Math.min(64, columns + 1);
              setColumns(nextColumns);
              save(cells, nextColumns, rows);
            }}
            className="rounded-md px-2 py-1.5 text-[11px] text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-100"
          >
            + Column
          </button>
        </div>
      </div>

      <div
        ref={gridRef}
        tabIndex={0}
        onKeyDown={onGridKeyDown}
        onPaste={onPaste}
        className="sheet-wrap min-h-0 flex-1 overflow-auto outline-none"
      >
        <table className="sheet-grid" style={{ width: 48 + renderedColumns * CELL_WIDTH }}>
          <colgroup>
            <col style={{ width: 48 }} />
            {Array.from({ length: renderedColumns }, (_value, index) => (
              <col key={index} style={{ width: CELL_WIDTH }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="corner" />
              {Array.from({ length: renderedColumns }, (_value, index) => (
                <th key={index}>{columnName(index)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: renderedRows }, (_value, rowIndex) => (
              <tr key={rowIndex} style={{ height: ROW_HEIGHT }}>
                <th>{rowIndex + 1}</th>
                {Array.from({ length: renderedColumns }, (_cell, columnIndex) => {
                  const address = `${columnName(columnIndex)}${rowIndex + 1}`;
                  const isSelected = address === selected;
                  const value = values[address] ?? '';
                  const error = value.startsWith('#') && (cells[address]?.startsWith('=') ?? false);
                  return (
                    <td
                      key={address}
                      data-cell={address}
                      className={`${isSelected ? 'is-selected' : ''} ${error ? 'is-error' : ''} ${isNumeric(value) ? 'is-number' : ''}`}
                      onMouseDown={() => select(address)}
                      onDoubleClick={() => startEditing()}
                    >
                      {isSelected && editing ? (
                        <input
                          ref={inputRef}
                          value={draft}
                          onChange={(event) => setDraft(event.target.value)}
                          onBlur={() => {
                            if (editing) commit(address, draft);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              move(1, 0, true);
                            } else if (event.key === 'Tab') {
                              event.preventDefault();
                              move(0, event.shiftKey ? -1 : 1, true);
                            } else if (event.key === 'Escape') {
                              event.preventDefault();
                              setEditing(false);
                              setDraft('');
                              gridRef.current?.focus();
                            }
                          }}
                          spellCheck={false}
                          className="h-[26px] w-full min-w-0 bg-transparent font-mono text-[12px] text-white outline-none"
                        />
                      ) : (
                        <span className={value.startsWith('=') ? 'font-mono' : ''}>{value}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {(rows > renderedRows || columns > renderedColumns) && (
          <div className="px-4 py-3 text-[11px] text-zinc-600">
            Showing {renderedColumns} of {columns} columns and {renderedRows} of {rows} rows. Values beyond the grid are preserved and exported.
          </div>
        )}
      </div>

      <div className="flex items-center gap-4 border-t border-white/[0.06] bg-[#0f0f14] px-4 py-1.5 text-[11px] text-zinc-600">
        <span>{Object.keys(cells).length.toLocaleString()} filled cells</span>
        <span className="text-zinc-700">·</span>
        <span>Enter to edit · Tab to move · paste TSV from Excel or Sheets</span>
        <span className="ml-auto hidden font-mono text-zinc-500 sm:block">
          {isFormula ? `${formatCellValue(evaluateCell(cells, selected))}` : shown}
        </span>
      </div>
    </div>
  );
}

function isNumeric(value: string): boolean {
  return value !== '' && /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value);
}

function sameSheet(a: StudioSheet, b: StudioSheet): boolean {
  if (a.columns !== b.columns || a.rows !== b.rows) return false;
  const aKeys = Object.keys(a.cells);
  const bKeys = Object.keys(b.cells);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => a.cells[key] === b.cells[key]);
}
