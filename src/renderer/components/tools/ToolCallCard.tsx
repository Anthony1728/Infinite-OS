import { useState, useEffect, useMemo, memo, type ReactNode } from 'react';

export const ToolIcon = memo(function ToolIcon({ name }: { name: string }) {
  const n = name.toLowerCase();
  let inner: ReactNode;

  if (/(file|read|write|edit|save|document|markdown)/.test(n)) {
    inner = (
      <>
        <path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
        <path d="M14 3v5h5" />
      </>
    );
  } else if (/(shell|bash|terminal|command|exec|run|process)/.test(n)) {
    inner = (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M7 9l3 3-3 3M13 15h4" />
      </>
    );
  } else if (/(browser|navigate|click|scroll|web|page|site|url)/.test(n)) {
    inner = (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.6 2.6 2.6 15.4 0 18M12 3c-2.6 2.6-2.6 15.4 0 18" />
      </>
    );
  } else if (/(search|fetch|scrape|crawl)/.test(n)) {
    inner = (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3" />
      </>
    );
  } else if (/(memory|knowledge|recall|remember|brain|learn)/.test(n)) {
    inner = (
      <>
        <path d="M4 5a2 2 0 0 1 2-2h12v15H6a2 2 0 0 0-2 2V5z" />
        <path d="M4 20a2 2 0 0 1 2-2h12" />
      </>
    );
  } else if (/(git|branch|commit|repo|diff)/.test(n)) {
    inner = (
      <>
        <circle cx="6" cy="6" r="2.5" />
        <circle cx="6" cy="18" r="2.5" />
        <circle cx="18" cy="8" r="2.5" />
        <path d="M6 8.5v7M18 10.5c0 4-6 3-6 6.5" />
      </>
    );
  } else if (/(image|photo|picture|vision|draw|paint|design)/.test(n)) {
    inner = (
      <>
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <circle cx="9" cy="10" r="1.5" />
        <path d="M5 17l4-4 3 3 3-4 4 4" />
      </>
    );
  } else if (/(agent|bot|assistant|orchestrat|subagent)/.test(n)) {
    inner = (
      <>
        <rect x="5" y="8" width="14" height="11" rx="2" />
        <path d="M12 8V5M9 3h6M9 13h.01M15 13h.01" />
      </>
    );
  } else {
    inner = <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2 2-2-2 2-2z" />;
  }

  return (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
    >
      {inner}
    </svg>
  );
});

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

function safeJson(value: unknown, limit = 16_000): string {
  try {
    const text = JSON.stringify(value, null, 2) ?? String(value);
    return text.length > limit
      ? `${text.slice(0, limit)}\n… (${text.length - limit} more characters)`
      : text;
  } catch {
    return String(value);
  }
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

/**
 * Best-effort preview from a still-forming JSON string. Models stream tool
 * arguments a fragment at a time, so before the JSON parses we extract the
 * first useful string field with a regex. This is what makes the card's title
 * turn into `Bash — npm run build` while the command is still arriving.
 */
function liveSummary(input: unknown, partialInput?: string): string {
  const direct = asRecord(input);
  const pick = ['command', 'cmd', 'path', 'file_path', 'file', 'query', 'url', 'pattern', 'prompt', 'task', 'text'];
  for (const key of pick) {
    const value = direct[key];
    if (typeof value === 'string' && value.trim()) {
      return value.replace(/\s+/g, ' ').trim().slice(0, 96);
    }
  }
  if (partialInput) {
    try {
      const parsed = asRecord(JSON.parse(partialInput));
      for (const key of pick) {
        const value = parsed[key];
        if (typeof value === 'string' && value.trim()) {
          return value.replace(/\s+/g, ' ').trim().slice(0, 96);
        }
      }
    } catch {
      // Mid-stream JSON — fall through to a targeted regex.
    }
    for (const key of pick) {
      const match = partialInput.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`));
      if (match?.[1]) {
        return match[1]
          .replace(/\\n/g, ' ')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 96);
      }
    }
    return partialInput.replace(/\s+/g, ' ').trim().slice(-96);
  }
  return '';
}

type DiffLine = { kind: 'context' | 'add' | 'remove'; text: string };

/** Line diff capped to something a card can render at 60fps. */
function buildLineDiff(before: string, after: string): DiffLine[] {
  const MAX_LINES = 320;
  const a = before.split(/\r?\n/).slice(0, MAX_LINES);
  const b = after.split(/\r?\n/).slice(0, MAX_LINES);
  if (a.length * b.length > 90_000) {
    return [
      ...a.map((text) => ({ kind: 'remove' as const, text })),
      ...b.map((text) => ({ kind: 'add' as const, text })),
    ];
  }
  const rows = a.length + 1;
  const cols = b.length + 1;
  const lcs = Array.from({ length: rows }, () => new Uint32Array(cols));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'context', text: a[i] });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: 'remove', text: a[i] });
      i += 1;
    } else {
      out.push({ kind: 'add', text: b[j] });
      j += 1;
    }
  }
  while (i < a.length) out.push({ kind: 'remove', text: a[i++] });
  while (j < b.length) out.push({ kind: 'add', text: b[j++] });
  return out.slice(0, 700);
}

function EditDiff({ lines }: { lines: DiffLine[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-white/[0.06] bg-black/25 font-mono text-[11px] leading-[1.55]">
      {lines.map((line, index) => (
        <div
          key={index}
          className={
            line.kind === 'add'
              ? 'flex bg-emerald-500/[0.09] text-emerald-200/85'
              : line.kind === 'remove'
                ? 'flex bg-red-500/[0.09] text-red-200/80'
                : 'flex text-zinc-500'
          }
        >
          <span className="w-6 shrink-0 select-none border-r border-white/[0.04] px-1 text-right text-zinc-600">
            {line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' '}
          </span>
          <span className="whitespace-pre px-2">{line.text || ' '}</span>
        </div>
      ))}
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        }).catch(() => {});
      }}
      className="rounded px-1.5 py-0.5 text-[9px] font-medium text-zinc-600 transition-colors hover:bg-white/[0.05] hover:text-zinc-300"
      title={`Copy ${label}`}
    >
      {copied ? 'copied' : 'copy'}
    </button>
  );
}

export const ToolCallCard = memo(function ToolCallCard({
  name,
  input,
  status,
  startTime,
  endTime,
  error,
  result,
  partialInput,
}: {
  name: string;
  input: unknown;
  status: 'running' | 'done' | 'error';
  startTime?: number;
  endTime?: number;
  error?: string;
  result?: string;
  /** Latest partial tool-argument JSON while the provider is still streaming. */
  partialInput?: string;
}) {
  const [open, setOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const running = status === 'running';
  const failed = status === 'error';

  useEffect(() => {
    if (failed) setOpen(true);
  }, [failed]);

  useEffect(() => {
    if (!running || !startTime) {
      if (startTime && endTime) setElapsed(Math.max(0, endTime - startTime));
      return;
    }
    setElapsed(Math.max(0, Date.now() - startTime));
    const interval = window.setInterval(() => {
      setElapsed(Math.max(0, Date.now() - startTime));
    }, 100);
    return () => window.clearInterval(interval);
  }, [running, startTime, endTime]);

  const record = asRecord(input);
  const summary = liveSummary(input, partialInput);
  const hasInput = Object.keys(record).length > 0;
  const rawInput = hasInput ? safeJson(input) : (partialInput ? safeJson(partialInput, 12_000) : '');
  const lowerName = name.toLowerCase();

  const before = stringValue(record, ['old_string', 'oldString', 'old_text', 'oldText', 'before']);
  const after = stringValue(record, ['new_string', 'newString', 'new_text', 'newText', 'after']);
  const written = stringValue(record, ['content', 'file_text', 'text']);
  const isEdit = /(edit|patch|replace)/.test(lowerName) || Boolean(before && after);
  const isWrite = /(write|create.*file)/.test(lowerName);
  const diff = useMemo(
    () => (isEdit && before && after ? buildLineDiff(before, after) : []),
    [isEdit, before, after],
  );

  const resultText = result ?? (failed ? error : undefined);
  const shownResult = resultText && resultText.length > 40_000
    ? `${resultText.slice(0, 40_000)}\n… (${resultText.length - 40_000} more characters)`
    : resultText;
  const firstErrorLine = failed && error ? error.split(/\r?\n/).find((line) => line.trim()) : '';
  const statusLabel = failed ? 'failed' : running ? 'running' : 'done';

  return (
    <div
      className={`group my-2 overflow-hidden rounded-xl border bg-[#0c1018] transition-colors ${
        failed ? 'border-red-500/35' : running ? 'border-indigo-500/35' : 'border-white/[0.06]'
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.03]"
        title={summary || name}
        aria-expanded={open}
      >
        <span
          className={`relative flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${
            failed ? 'bg-red-500/15 text-red-300' : running ? 'bg-indigo-500/15 text-indigo-300' : 'bg-white/[0.04] text-zinc-400'
          }`}
        >
          {running ? (
            <>
              <span className="absolute inset-0 rounded-lg border border-indigo-400/40 animate-ping" />
              <span className="absolute inset-0 rounded-lg border-2 border-transparent border-t-indigo-400 animate-spin" />
            </>
          ) : null}
          <ToolIcon name={name} />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="shrink-0 font-mono text-[13px] font-medium text-zinc-200">{name}</span>
            {summary ? (
              <span className="min-w-0 truncate font-sans text-[11px] font-normal text-zinc-500">
                {summary}
              </span>
            ) : running && partialInput ? (
              <span className="min-w-0 truncate font-sans text-[11px] font-normal text-indigo-300/60">
                streaming arguments…
              </span>
            ) : null}
          </span>
          {failed && firstErrorLine && !open ? (
            <span className="mt-0.5 block truncate font-mono text-[10px] text-red-400/80">
              {firstErrorLine}
            </span>
          ) : null}
        </span>

        <span className="ml-auto flex flex-shrink-0 items-center gap-2 text-[11px]">
          {running ? (
            <>
              <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-indigo-400/30 border-t-indigo-300" />
              <span className="text-indigo-300">running</span>
            </>
          ) : failed ? (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
              <span className="text-red-400">failed</span>
            </>
          ) : (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span className="text-zinc-500">done</span>
            </>
          )}
          {(running || (startTime && endTime)) && elapsed > 0 ? (
            <span className={`font-mono text-[10px] ${running ? 'text-indigo-400/60' : 'text-zinc-600'}`}>
              {formatElapsed(elapsed)}
            </span>
          ) : null}
          <svg
            className={`h-3 w-3 text-zinc-600 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </button>

      {open ? (
        <div className="border-t border-white/[0.06] bg-black/15">
          <div className="flex items-center justify-between border-b border-white/[0.04] px-3 py-1.5">
            <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-600">Input</span>
            <div className="flex items-center gap-2">
              {running && !hasInput && partialInput ? (
                <span className="text-[9px] text-indigo-300/60">streaming</span>
              ) : null}
              {rawInput ? <CopyButton text={rawInput} label="input" /> : null}
            </div>
          </div>

          <div className="px-3 py-2">
            {diff.length > 0 ? (
              <EditDiff lines={diff} />
            ) : isWrite && written ? (
              <div className="space-y-1.5">
                <div className="text-[10px] text-zinc-600">
                  {written.split(/\r?\n/).length} line{written.split(/\r?\n/).length === 1 ? '' : 's'} written
                </div>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/[0.06] bg-black/25 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-zinc-400">
                  {written.length > 20_000 ? `${written.slice(0, 20_000)}\n… (${written.length - 20_000} more characters)` : written}
                </pre>
              </div>
            ) : rawInput ? (
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-zinc-400">
                {rawInput}
              </pre>
            ) : (
              <div className="py-1 text-[11px] italic text-zinc-600">
                {running ? 'Waiting for arguments…' : 'No arguments.'}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-y border-white/[0.04] px-3 py-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-600">Output</span>
              <span className={`text-[9px] ${failed ? 'text-red-400/80' : running ? 'text-indigo-300/60' : 'text-emerald-400/70'}`}>
                {statusLabel}
              </span>
              {shownResult ? (
                <span className="font-mono text-[9px] text-zinc-700">
                  {shownResult.split(/\r?\n/).length} lines
                </span>
              ) : null}
            </div>
            {shownResult ? <CopyButton text={resultText ?? ''} label="output" /> : null}
          </div>

          <div className="px-3 py-2">
            {shownResult ? (
              <pre
                className={`max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border px-2.5 py-2 font-mono text-[11px] leading-relaxed ${
                  failed
                    ? 'border-red-500/20 bg-red-500/[0.04] text-red-300/85'
                    : 'border-white/[0.05] bg-black/25 text-zinc-400'
                }`}
              >
                {shownResult}
              </pre>
            ) : (
              <div className="flex items-center gap-2 py-1 text-[11px] italic text-zinc-600">
                {running ? (
                  <>
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" />
                    Waiting for the tool to return…
                  </>
                ) : (
                  'No output returned.'
                )}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
});
