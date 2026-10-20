/**
 * ResumeBanner — "here is what happened before the app restarted".
 *
 * Infinite AI edits Infinite OS's own source, which restarts the app mid-run. The
 * user used to come back to a blank chat with no idea a conversation was even
 * waiting. This says, plainly, which request was interrupted and what had
 * genuinely been done at that point.
 *
 * Everything shown is read from the persisted transcript, so a line only appears
 * if that tool call really is in the record. Nothing here is reconstructed from
 * what the agent intended.
 */

import { useEffect, useState } from 'react';
import { RotateCcw, X, CheckCircle2, AlertTriangle, FileCode2 } from 'lucide-react';
import { useChatStore } from '../../stores/chat';

interface InterruptedRun {
  sessionId: string;
  request: string;
  done: string[];
  toolsRun: number;
  toolsFailed: number;
  filesTouched: string[];
  startedAt: number;
  updatedAt: number;
}

const DISMISSED_KEY = 'infinite:resume:dismissed';

export function ResumeBanner() {
  const selectSession = useChatStore((s) => s.selectSession);
  const [run, setRun] = useState<InterruptedRun | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(DISMISSED_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(parsed) ? (parsed as string[]) : []);
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    let cancelled = false;
    void window.api
      .resumeInterrupted()
      .then((list: InterruptedRun[]) => {
        if (cancelled || !Array.isArray(list) || list.length === 0) return;
        // Only surface the most recent interruption; older ones are history and
        // the transcript already holds them.
        const next = list.find((item) => !dismissed.has(item.sessionId));
        if (next) setRun(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // Deliberately not depending on `dismissed`: this runs once on mount, and a
    // re-run would re-open a banner the user just closed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!run) return null;

  const close = () => {
    setRun(null);
    const next = new Set(dismissed).add(run.sessionId);
    setDismissed(next);
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next].slice(-50)));
    } catch {
      /* dismissal just will not persist; the banner reappears next launch */
    }
  };

  const goToChat = async () => {
    close();
    await selectSession(run.sessionId);
  };

  const when = new Date(run.updatedAt);

  return (
    // Fixed and centred: mounted at app-shell level so it floats above whatever
    // section the user landed on after the restart.
    <div className="fixed left-1/2 -translate-x-1/2 top-4 z-[60] w-[min(560px,calc(100vw-2rem))] rounded-xl border border-amber-500/30 bg-[#15120c]/95 backdrop-blur-sm shadow-2xl shadow-black/40 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <RotateCcw size={15} className="text-amber-400 mt-0.5 flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-xs font-medium text-amber-200">
              Infinite OS restarted partway through a task
            </div>
            <div className="text-[11px] text-white/50 mt-0.5">
              {when.toLocaleString()} — the app restarted while Infinite AI was working. Here is what it had
              actually done before that.
            </div>
          </div>
        </div>
        <button onClick={close} className="text-white/30 hover:text-white/60 flex-shrink-0" aria-label="Dismiss">
          <X size={14} />
        </button>
      </div>

      {run.request && (
        <div className="mt-2 text-[11px] text-white/60">
          <span className="text-white/35">You had asked: </span>
          <span className="italic">{run.request.length > 200 ? `${run.request.slice(0, 200)}…` : run.request}</span>
        </div>
      )}

      {run.toolsRun > 0 && (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
            <span className="flex items-center gap-1 text-white/60">
              <CheckCircle2 size={12} className="text-emerald-400" />
              {run.toolsRun - run.toolsFailed} of {run.toolsRun} step{run.toolsRun === 1 ? '' : 's'} completed
            </span>
            {run.toolsFailed > 0 && (
              <span className="flex items-center gap-1 text-amber-300/90">
                <AlertTriangle size={12} />
                {run.toolsFailed} failed
              </span>
            )}
          </div>

          {run.done.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {run.done.map((line, index) => (
                <li key={index} className="text-[11px] text-white/50 font-mono truncate">
                  · {line}
                </li>
              ))}
              {run.toolsRun > run.done.length && (
                <li className="text-[11px] text-white/25">· …and {run.toolsRun - run.done.length} more</li>
              )}
            </ul>
          )}
        </>
      )}

      {run.toolsRun === 0 && (
        <div className="mt-2 text-[11px] text-white/45">
          It had not finished any steps yet, so nothing was lost.
        </div>
      )}

      {run.filesTouched.length > 0 && (
        <div className="mt-2 text-[11px] text-white/45 flex items-start gap-1">
          <FileCode2 size={12} className="mt-0.5 flex-shrink-0" />
          <span>
            Edited {run.filesTouched.length} file{run.filesTouched.length === 1 ? '' : 's'} —{' '}
            {run.filesTouched.slice(0, 3).map((file) => file.split(/[\\/]/).pop()).join(', ')}
            {run.filesTouched.length > 3 ? ` and ${run.filesTouched.length - 3} more` : ''}
          </span>
        </div>
      )}

      <div className="mt-2.5 flex gap-2">
        <button
          onClick={() => void goToChat()}
          className="px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-[11px] text-amber-200 hover:bg-amber-500/25"
        >
          Pick up that conversation
        </button>
        <button onClick={close} className="px-3 py-1.5 rounded-lg text-[11px] text-white/40 hover:text-white/70">
          Dismiss
        </button>
      </div>
    </div>
  );
}