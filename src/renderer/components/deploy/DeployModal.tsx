import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

type PushPhase = 'idle' | 'working' | 'success' | 'failed';

interface OsStatus {
  ok: boolean;
  error?: string;
  root?: string;
  branch?: string;
  remote?: string;
  dirty?: number;
  ahead?: number;
  behind?: number;
  lastCommit?: string;
}

interface PushResult {
  ok: boolean;
  error?: string;
  commit?: string;
  pushed?: boolean;
  output?: string;
}

export function DeployModal({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<PushPhase>('idle');
  const [status, setStatus] = useState<OsStatus | null>(null);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<PushResult | null>(null);

  const load = async () => {
    try {
      setStatus((await window.api.deployOsStatus()) as OsStatus);
    } catch (e) {
      setStatus({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const push = async () => {
    setPhase('working');
    setResult(null);
    try {
      const res = (await window.api.deployOsPush({ message: message.trim() || undefined })) as PushResult;
      setResult(res);
      setPhase(res.ok ? 'success' : 'failed');
      await load();
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
      setPhase('failed');
    }
  };

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center" onClick={onClose}>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="relative bg-bg-subtle/95 backdrop-blur-xl border border-white/8 rounded-2xl shadow-panel w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-brand flex items-center justify-center text-white text-sm shadow-glow-sm">🚀</div>
            <h2 className="text-lg font-semibold">Deploy Infinite OS</h2>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-white/5 text-fg-muted hover:text-fg flex items-center justify-center text-sm">✕</button>
        </div>

        <div className="p-6">
          {!status ? (
            <div className="text-sm text-fg-muted">Reading repository state…</div>
          ) : !status.ok ? (
            <div className="text-sm text-danger">{status.error || 'Repository unavailable.'}</div>
          ) : (
            <>
              <div className="card p-4 mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-medium text-sm">{status.branch || 'HEAD'}</span>
                  <span className="text-xs bg-white/5 border border-white/8 rounded-full px-2 py-0.5 text-fg-muted">
                    {(status.dirty ?? 0) === 0 ? 'clean' : `${status.dirty} changed`}
                  </span>
                  {(status.ahead ?? 0) > 0 && (
                    <span className="text-xs bg-white/5 border border-white/8 rounded-full px-2 py-0.5 text-fg-muted">
                      {status.ahead} ahead
                    </span>
                  )}
                  {(status.behind ?? 0) > 0 && (
                    <span className="text-xs bg-white/5 border border-white/8 rounded-full px-2 py-0.5 text-fg-muted">
                      {status.behind} behind
                    </span>
                  )}
                </div>
                <div className="text-xs text-fg-muted break-all">{status.remote || 'no remote'}</div>
                {status.lastCommit && <div className="text-xs text-fg-subtle mt-1">Last: {status.lastCommit}</div>}
              </div>

              {phase !== 'success' && (
                <>
                  <input
                    type="text"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Commit message (optional)"
                    className="w-full input-premium mb-3 text-sm"
                    disabled={phase === 'working'}
                  />
                  <button
                    onClick={() => void push()}
                    disabled={phase === 'working'}
                    className="btn-primary w-full text-sm disabled:opacity-50"
                  >
                    {phase === 'working' ? 'Pushing to GitHub…' : 'Push to GitHub'}
                  </button>
                </>
              )}

              {result && (
                <div className={`mt-4 text-xs rounded-lg px-3 py-2 ${result.ok ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
                  {result.ok
                    ? `Pushed${result.commit ? ` (${result.commit})` : ''} to origin.`
                    : result.error || 'Push failed.'}
                  {result.output && (
                    <pre className="mt-2 whitespace-pre-wrap break-all text-fg-muted">{result.output}</pre>
                  )}
                </div>
              )}

              {phase === 'success' && (
                <div className="mt-4 flex gap-2">
                  <button onClick={onClose} className="btn-ghost flex-1 text-sm">Close</button>
                </div>
              )}
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
