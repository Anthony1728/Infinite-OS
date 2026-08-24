import { useEffect, useState } from 'react';
import { useChatStore, type ActivityItem } from '../../stores/chat';
import { ToolIcon } from '../tools/ToolCallCard';

function categoryColor(category: string): string {
  switch (category) {
    case 'shell':
      return 'bg-emerald-500/15 text-emerald-300';
    case 'computer':
      return 'bg-cyan-500/15 text-cyan-300';
    case 'browser':
      return 'bg-sky-500/15 text-sky-300';
    case 'file':
      return 'bg-amber-500/15 text-amber-300';
    case 'memory':
      return 'bg-purple-500/15 text-purple-300';
    case 'web':
      return 'bg-teal-500/15 text-teal-300';
    case 'agent':
      return 'bg-indigo-500/15 text-indigo-300';
    default:
      return 'bg-white/[0.04] text-zinc-300';
  }
}

/** Ticking elapsed-time label for the step that is currently running. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return (
    <span className="ml-1.5 flex-shrink-0 tabular-nums text-[10px] text-indigo-300/60">
      {s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`}
    </span>
  );
}

function StepRow({ item, connect }: { item: ActivityItem; connect: boolean }) {
  const running = item.status === 'running';
  const errored = item.status === 'error';
  return (
    <div className="flex gap-3">
      <div className="flex w-6 flex-col items-center">
        <span
          className={`relative flex h-6 w-6 flex-none items-center justify-center rounded-md ${
            errored ? 'bg-red-500/15 text-red-300' : categoryColor(item.category)
          }`}
        >
          {running && (
            <span className="absolute inset-0 rounded-md border border-indigo-400/50 animate-ping" />
          )}
          {running ? (
            <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-current/40 border-t-current" />
          ) : errored ? (
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          ) : item.status === 'done' ? (
            <svg className="h-3.5 w-3.5 text-emerald-400/80" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <path d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          ) : (
            <ToolIcon name={item.name} />
          )}
        </span>
        {connect && <span className="w-px flex-1 bg-white/[0.07]" />}
      </div>
      <div className="min-w-0 flex-1 pb-3 pt-0.5">
        <div className="flex items-baseline gap-2">
          <span className={`truncate text-xs ${running ? 'font-medium text-zinc-100' : errored ? 'font-medium text-red-300/90' : 'text-zinc-400'}`}>
            {item.label}
          </span>
          {running && <Elapsed since={item.timestamp} />}
        </div>
        {item.detail && (
          <div className="mt-0.5 truncate font-mono text-[10px] text-textMuted" title={item.detail}>
            {item.detail}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Inline live progress, rendered in the chat flow directly above the pending
 * assistant reply. Visible only while work is actually streaming — once the
 * run finishes the final assistant message carries the result, so nothing
 * lingers as a faded strip at the top of the chat.
 */
export function LiveActivityFeed() {
  const activity = useChatStore((s) => s.activity);
  const streaming = useChatStore((s) => s.streaming);

  if (!streaming) return null;

  const visible = activity.slice(-6);
  const runningCount = activity.filter((a) => a.status === 'running').length;
  const trailing =
    runningCount > 0 || visible.length > 0 ? 'Working…' : 'Starting…';

  return (
    <div className="px-1" aria-live="polite" aria-label="Live progress">
      <div className="flex flex-col">
        {visible.map((item) => (
          <StepRow key={item.id} item={item} connect />
        ))}
        <div className="flex gap-3">
          <div className="flex w-6 flex-col items-center">
            <span className="relative flex h-6 w-6 items-center justify-center">
              <span className="absolute inline-flex h-2 w-2 rounded-full bg-indigo-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-400" />
            </span>
          </div>
          <div className="min-w-0 flex-1 pt-1">
            <span className="text-xs font-medium text-indigo-300/90">{trailing}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
