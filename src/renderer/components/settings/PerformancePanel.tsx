/**
 * PerformancePanel — what is making this PC slow, and the user's control over it.
 *
 * THE RULE THIS SCREEN IS BUILT AROUND
 *
 * Nothing happens that the user cannot account for. Every row shows where the
 * claim came from ("measured over 3s", "startup entry, runs at every log in"),
 * every action that can be undone says so, and anything the app does not
 * positively recognise is shown for information and has no button at all.
 *
 * The three tiers are visible, not hidden behind wording:
 *   - Safe to do now    applied when you press Apply
 *   - Needs your OK      one button, and it says what you give up
 *   - Just so you know   no button, ever
 *
 * There is intentionally no "make my PC perfect" button. The temptation to ship
 * one is exactly how a machine ends up with Defender switched off and Office
 * deactivated by something that thought it was being helpful.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Zap, ShieldCheck, Info, Undo2, RotateCw, CheckCircle2, AlertTriangle, Ban,
} from 'lucide-react';

interface Finding {
  id: string;
  title: string;
  detail: string;
  tier: 'safe' | 'ask' | 'report';
  tradeoff?: string;
  impact: number;
  evidence: string;
  action?: { kind: string; target?: string };
}

interface UndoEntry {
  at: number;
  findingId: string;
  title: string;
  lossy: boolean;
}

const TIER_COPY: Record<Finding['tier'], { label: string; blurb: string }> = {
  safe: { label: 'Safe to do now', blurb: 'Reversible with one click, and nothing can be lost.' },
  ask: { label: 'Needs your OK', blurb: 'Real speed-up, but there is something to give up.' },
  report: { label: 'Just so you know', blurb: 'Infinite OS will not change any of these.' },
};

export function PerformancePanel() {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [undoLog, setUndoLog] = useState<UndoEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [scanning, setScanning] = useState(true);
  const [autoEnabled, setAutoEnabled] = useState(true);
  const [message, setMessage] = useState('');
  const [applied, setApplied] = useState<Set<string>>(new Set());

  const scan = useCallback(async () => {
    setScanning(true);
    setMessage('');
    try {
      // The renderer does not try to guess which other programs the user has
      // open: only main can see window titles, and a half-right answer here
      // would mean proposing to close the app somebody is working in. Main's
      // probe filters by real window state instead.
      const [list, log, auto] = await Promise.all([
        window.api.optimizeAnalyse({}),
        window.api.optimizeUndoList(),
        window.api.optimizeAutoEnabled(),
      ]);
      setFindings(Array.isArray(list) ? list : []);
      setUndoLog(Array.isArray(log) ? log : []);
      setAutoEnabled(auto?.enabled !== false);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    void scan();
  }, [scan]);

  const apply = async (finding: Finding, approved: boolean) => {
    setBusy(finding.id);
    setMessage('');
    try {
      const result = await window.api.optimizeApply({ finding, approved });
      setMessage(result?.message ?? 'Done.');
      if (result?.ok) {
        setApplied((prev) => new Set(prev).add(finding.id));
        const log = await window.api.optimizeUndoList();
        setUndoLog(Array.isArray(log) ? log : []);
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const applyAllSafe = async () => {
    const safe = findings.filter((f) => f.tier === 'safe' && f.action && !applied.has(f.id));
    if (safe.length === 0) {
      setMessage('Nothing safe left to do.');
      return;
    }
    setBusy('all-safe');
    const done: string[] = [];
    for (const finding of safe) {
      const result = await window.api.optimizeApply({ finding });
      if (result?.ok) {
        done.push(finding.title);
        setApplied((prev) => new Set(prev).add(finding.id));
      }
    }
    setBusy(null);
    setMessage(done.length ? `Done: ${done.join(', ')}` : 'Nothing could be changed.');
    const log = await window.api.optimizeUndoList();
    setUndoLog(Array.isArray(log) ? log : []);
  };

  const undoOne = async (entry: UndoEntry) => {
    setBusy(entry.findingId);
    const result = await window.api.optimizeUndo({ entry });
    setBusy(null);
    setMessage(result?.message ?? 'Restored.');
    void scan();
  };

  const undoEverything = async () => {
    setBusy('undo-all');
    const results = await window.api.optimizeUndoAll();
    setBusy(null);
    const ok = results.filter((r: { ok: boolean }) => r.ok).length;
    setMessage(`Put back ${ok} of ${results.length}.`);
    void scan();
  };

  const toggleAuto = async () => {
    const next = !autoEnabled;
    setAutoEnabled(next);
    await window.api.setSetting({ scope: 'user', key: 'bootOptimization', value: next, cwd: '.' }).catch(() => undefined);
    setMessage(
      next
        ? 'On. Infinite OS will clear temp files when it starts, and nothing else without asking.'
        : 'Off. Infinite OS will not change anything on startup.',
    );
  };

  const groups: Array<Finding['tier']> = ['safe', 'ask', 'report'];
  const actionable = findings.filter((f) => f.action).length;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-white/80">Performance</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-white/40">
          Measured on this computer just now. Anything Infinite OS changes can be put back with one click,
          and anything it does not recognise is shown for information only — it will not touch those.
        </p>
      </div>

      {/* Master switch, so the whole thing is genuinely optional. */}
      <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
        <button onClick={() => void toggleAuto()} className="flex w-full items-center gap-2 text-left">
          {autoEnabled ? (
            <Zap size={13} className="shrink-0 text-amber-400" />
          ) : (
            <Ban size={13} className="shrink-0 text-white/30" />
          )}
          <span className="text-[11px] font-medium text-white/70">Clean up automatically when Infinite OS starts</span>
          <span className="ml-auto text-[10px] font-medium text-white/50">{autoEnabled ? 'On' : 'Off'}</span>
        </button>
        <p className="mt-1.5 text-[11px] leading-relaxed text-white/40">
          {autoEnabled
            ? 'On start, it clears temporary files only. It never disables a service, closes a program or removes software without asking you first.'
            : 'Off. Infinite OS will not change anything on your computer when it starts.'}
        </p>
      </div>

      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => void scan()}
          disabled={scanning}
          className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
        >
          <RotateCw size={12} className={scanning ? 'animate-spin' : ''} />
          {scanning ? 'Measuring…' : 'Measure again'}
        </button>
        <button
          onClick={() => void applyAllSafe()}
          disabled={busy !== null || actionable === 0}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-500/20 border border-indigo-500/30 px-2.5 py-1.5 text-[11px] text-indigo-200 transition-colors hover:bg-indigo-500/30 disabled:opacity-50"
        >
          <ShieldCheck size={12} />
          Apply the safe ones
        </button>
      </div>

      {message && <div className="text-[11px] text-white/50">{message}</div>}

      {scanning && findings.length === 0 && (
        <div className="text-[11px] text-white/30">Taking a real CPU and memory reading — this takes a few seconds.</div>
      )}

      {!scanning && findings.length === 0 && (
        <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3 text-[11px] leading-relaxed text-white/40">
          Nothing found that is worth changing. That is a good result, not a failure to find things.
        </div>
      )}

      {groups.map((tier) => {
        const group = findings.filter((f) => f.tier === tier);
        if (group.length === 0) return null;
        const copy = TIER_COPY[tier];
        return (
          <div key={tier}>
            <div className="mb-1.5 flex items-baseline gap-2">
              <span className="text-[11px] font-medium text-white/70">{copy.label}</span>
              <span className="text-[10px] text-white/30">{copy.blurb}</span>
            </div>
            <div className="space-y-1">
              {group.map((finding) => {
                const done = applied.has(finding.id);
                return (
                  <div
                    key={finding.id}
                    className="flex items-start gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2"
                  >
                    <span className="mt-0.5 shrink-0">
                      {tier === 'safe' && <ShieldCheck size={12} className="text-emerald-400" />}
                      {tier === 'ask' && <AlertTriangle size={12} className="text-amber-400" />}
                      {tier === 'report' && <Info size={12} className="text-white/30" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[11px] font-medium text-white/80">{finding.title}</span>
                        {done && <CheckCircle2 size={11} className="shrink-0 text-emerald-400" />}
                      </div>
                      <div className="mt-0.5 text-[10px] leading-relaxed text-white/40">{finding.detail}</div>
                      {finding.tradeoff && (
                        <div className="mt-0.5 text-[10px] leading-relaxed text-amber-200/50">
                          You give up: {finding.tradeoff}
                        </div>
                      )}
                      {/* Where the claim came from. Without this the list is just
                          an app asserting things about the user's machine. */}
                      <div className="mt-1 text-[9px] leading-relaxed text-white/25">{finding.evidence}</div>
                    </div>
                    {finding.action && !done && (
                      <button
                        onClick={() => void apply(finding, tier === 'ask')}
                        disabled={busy === finding.id}
                        className={`shrink-0 rounded-md border px-2 py-1 text-[10px] transition-colors disabled:opacity-50 ${
                          tier === 'safe'
                            ? 'border-white/10 text-white/60 hover:bg-white/10 hover:text-white'
                            : 'border-amber-500/30 text-amber-200/90 hover:bg-amber-500/15'
                        }`}
                      >
                        {busy === finding.id ? '…' : tier === 'safe' ? 'Do it' : 'Allow'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Undo. Present whenever anything has been changed. */}
      {undoLog.length > 0 && (
        <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-medium text-white/70">
              Changed by Infinite OS ({undoLog.length})
            </span>
            <button
              onClick={() => void undoEverything()}
              disabled={busy === 'undo-all'}
              className="flex items-center gap-1.5 rounded-md border border-white/10 px-2 py-1 text-[10px] text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
            >
              <Undo2 size={11} />
              Put everything back
            </button>
          </div>
          <div className="space-y-1">
            {undoLog.map((entry) => (
              <div key={`${entry.findingId}-${entry.at}`} className="flex items-center gap-2 text-[10px] text-white/45">
                <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                <span className="shrink-0 text-white/25">{new Date(entry.at).toLocaleString()}</span>
                <button
                  onClick={() => void undoOne(entry)}
                  disabled={busy === entry.findingId}
                  className="shrink-0 rounded border border-white/10 px-1.5 py-0.5 text-[9px] text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-50"
                >
                  Undo
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-white/[0.06] pt-3">
        <p className="text-[10px] leading-relaxed text-white/30">
          What Infinite OS will never do on its own: uninstall software, delete anything outside a temp
          folder, stop a security or licensing service, or close a program that has a window open. Those are
          either not reversible or could cost you real work, so they are yours to decide — and the ones that
          are only informational have no button at all.
        </p>
      </div>
    </div>
  );
}

export default PerformancePanel;