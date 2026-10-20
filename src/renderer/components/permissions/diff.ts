/**
 * Small, dependency-free line diff for the permission dialog.
 *
 * The agent is about to change a file; the user should see the shape of that
 * change before approving it, not a JSON-escaped pair of strings. This is a
 * classic LCS diff, bounded so a huge replacement cannot freeze the renderer.
 */

export type DiffKind = 'add' | 'remove' | 'context';

export interface DiffLine {
  kind: DiffKind;
  text: string;
}

export interface DiffResult {
  lines: DiffLine[];
  added: number;
  removed: number;
  truncated: boolean;
}

const MAX_INPUT_LINES = 600;
const MAX_OUTPUT_LINES = 180;
const LCS_CELL_LIMIT = 250_000;

function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

function limitLines(lines: DiffLine[], maxLines: number): { lines: DiffLine[]; truncated: boolean } {
  if (lines.length <= maxLines) return { lines, truncated: false };
  const head = Math.floor((maxLines - 1) / 2);
  const tail = maxLines - 1 - head;
  return {
    lines: [
      ...lines.slice(0, head),
      { kind: 'context', text: `… ${lines.length - maxLines} lines hidden …` },
      ...lines.slice(lines.length - tail),
    ],
    truncated: true,
  };
}

/** Build a readable line diff. Deterministic and safe for untrusted text. */
export function buildDiff(oldText: string, newText: string, maxLines = MAX_OUTPUT_LINES): DiffResult {
  const oldLines = splitLines(oldText ?? '');
  const newLines = splitLines(newText ?? '');

  if (!oldText && !newText) return { lines: [], added: 0, removed: 0, truncated: false };
  if (!oldText) {
    const all = newLines.map((text): DiffLine => ({ kind: 'add', text }));
    const limited = limitLines(all, maxLines);
    return { ...limited, added: newLines.length, removed: 0 };
  }
  if (!newText) {
    const all = oldLines.map((text): DiffLine => ({ kind: 'remove', text }));
    const limited = limitLines(all, maxLines);
    return { ...limited, added: 0, removed: oldLines.length };
  }

  // A giant replacement is not worth an O(n*m) table. Show the removed and
  // added blocks side by side in sequence with a clear truncation marker.
  if (oldLines.length > MAX_INPUT_LINES || newLines.length > MAX_INPUT_LINES || oldLines.length * newLines.length > LCS_CELL_LIMIT) {
    const visible = Math.max(2, maxLines - 1);
    const head = Math.floor(visible / 2);
    const tail = visible - head;
    const removed = oldLines.slice(0, head).map((text): DiffLine => ({ kind: 'remove', text }));
    const added = newLines.slice(0, tail).map((text): DiffLine => ({ kind: 'add', text }));
    const lines: DiffLine[] = [
      ...removed,
      { kind: 'context', text: `… diff shortened: ${oldLines.length} old lines → ${newLines.length} new lines …` },
      ...added,
    ];
    return { lines, added: newLines.length, removed: oldLines.length, truncated: true };
  }

  const rows = oldLines.length;
  const cols = newLines.length;
  const dp: Uint32Array[] = Array.from({ length: rows + 1 }, () => new Uint32Array(cols + 1));
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      dp[i][j] = oldLines[i] === newLines[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let added = 0;
  let removed = 0;
  while (i < rows && j < cols) {
    if (oldLines[i] === newLines[j]) {
      lines.push({ kind: 'context', text: oldLines[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push({ kind: 'remove', text: oldLines[i] });
      removed += 1;
      i += 1;
    } else {
      lines.push({ kind: 'add', text: newLines[j] });
      added += 1;
      j += 1;
    }
  }
  while (i < rows) {
    lines.push({ kind: 'remove', text: oldLines[i] });
    removed += 1;
    i += 1;
  }
  while (j < cols) {
    lines.push({ kind: 'add', text: newLines[j] });
    added += 1;
    j += 1;
  }

  const limited = limitLines(lines, maxLines);
  return { ...limited, added, removed };
}

export interface ChangePreview {
  kind: 'diff' | 'content' | 'command';
  path?: string;
  diff?: DiffResult;
  text?: string;
  note?: string;
}

/** Extract a human-readable preview from a tool-use input. */
export function previewForTool(tool: string, input: unknown): ChangePreview | null {
  const value = (input ?? {}) as Record<string, unknown>;
  if (tool === 'Edit') {
    const oldText = typeof value.old_string === 'string' ? value.old_string : '';
    const newText = typeof value.new_string === 'string' ? value.new_string : '';
    if (!oldText && !newText) return null;
    return {
      kind: 'diff',
      path: typeof value.file_path === 'string' ? value.file_path : undefined,
      diff: buildDiff(oldText, newText),
      ...(value.replace_all === true ? { note: 'Replaces every occurrence.' } : {}),
    };
  }
  if (tool === 'Write') {
    const content = typeof value.content === 'string' ? value.content : '';
    return {
      kind: 'content',
      path: typeof value.file_path === 'string' ? value.file_path : undefined,
      diff: buildDiff('', content, 120),
      note: 'Full file content — an existing file will be backed up before it is replaced.',
    };
  }
  if (tool === 'Bash' || tool === 'PowerShell' || tool === 'Terminal') {
    const command = typeof value.command === 'string' ? value.command : '';
    if (!command) return null;
    return { kind: 'command', text: command };
  }
  return null;
}
