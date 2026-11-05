import { useState } from 'react';
import { useAutomationStore, type AutomationApproval } from '../../stores/automation';
import { useNotificationStore } from '../../stores/notifications';

/**
 * Otto-style review card. A step draft stops here until a person approves,
 * comments, or rejects it. The card is shared by Home and Automations so both
 * surfaces always show the same waiting work.
 */
export function AutomationReviewCard({
  approval,
  onOpenAutomations,
  className = '',
}: {
  approval: AutomationApproval;
  onOpenAutomations?: () => void;
  className?: string;
}) {
  const approveAutomation = useAutomationStore((s) => s.approveAutomation);
  const commentAutomation = useAutomationStore((s) => s.commentAutomation);
  const rejectAutomation = useAutomationStore((s) => s.rejectAutomation);
  const addToast = useNotificationStore((s) => s.addToast);

  const [commenting, setCommenting] = useState(false);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<'approve' | 'comment' | 'reject' | null>(null);
  const [error, setError] = useState('');

  const revising = approval.status === 'revising';
  const stepLabel = approval.actionType.replace(/_/g, ' ');

  const run = async (kind: 'approve' | 'comment' | 'reject') => {
    setBusy(kind);
    setError('');
    try {
      if (kind === 'approve') {
        await approveAutomation(approval.id);
        addToast({ type: 'success', title: 'Approved', message: 'The automation is carrying on.' });
      } else if (kind === 'reject') {
        await rejectAutomation(approval.id);
        addToast({ type: 'success', title: 'Rejected', message: 'The run stopped.' });
      } else {
        if (!comment.trim()) {
          setError('Write a comment first.');
          return;
        }
        await commentAutomation(approval.id, comment.trim());
        setCommenting(false);
        addToast({ type: 'success', title: 'Comment sent', message: 'The agent is revising the draft.' });
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      addToast({ type: 'error', title: 'Review action failed', message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <article
      className={`relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[#12131a] ${className}`}
      aria-label={`Review ${approval.workflowName}`}
    >
      <div className={`absolute inset-y-4 left-0 w-0.5 rounded-full ${revising ? 'bg-cyan-400/80' : 'bg-amber-400/80'}`} />
      <div className="p-4 pl-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-amber-300/90">Needs you</span>
              <span className="h-1 w-1 rounded-full bg-zinc-700" />
              <span className="truncate text-[11px] text-zinc-500">{approval.workflowName}</span>
              <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[9px] font-medium capitalize text-zinc-400">
                {stepLabel} · step {approval.actionIndex + 1}
              </span>
            </div>
            <h3 className="mt-1.5 text-[14px] font-semibold text-white">
              {revising ? 'Revising your draft' : 'Review this draft before it runs'}
            </h3>
          </div>
          <span className="shrink-0 text-[10px] text-zinc-600">
            {new Date(approval.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </span>
        </div>

        <div className="mt-3 max-h-52 overflow-auto rounded-xl border border-white/[0.06] bg-black/25 px-3 py-2.5 custom-scrollbar">
          <pre className="whitespace-pre-wrap break-words font-sans text-[12px] leading-5 text-zinc-300">{approval.draft || 'No draft text.'}</pre>
        </div>

        {approval.afterApproval && (
          <p className="mt-2 text-[10.5px] leading-4 text-zinc-500">
            <span className="uppercase tracking-wide text-zinc-600">Then:</span> {approval.afterApproval}
          </p>
        )}

        {revising && (
          <p className="mt-3 flex items-center gap-2 text-[11px] text-cyan-200/90">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300" />
            Agent is reworking the draft from your comment…
          </p>
        )}

        {error && <p className="mt-3 text-[11px] text-rose-300">{error}</p>}

        {commenting && (
          <div className="mt-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-2">
            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="What should change? The agent revises the draft, then asks again."
              rows={3}
              autoFocus
              className="w-full resize-none bg-transparent px-1 py-1 text-[12px] leading-5 text-zinc-200 placeholder-zinc-600 focus:outline-none"
            />
            <div className="mt-1 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setCommenting(false); setError(''); }}
                className="rounded-lg px-2.5 py-1 text-[11px] text-zinc-400 transition-colors hover:text-zinc-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void run('comment')}
                disabled={busy !== null || !comment.trim()}
                className="rounded-lg bg-white/[0.1] px-3 py-1 text-[11px] font-medium text-white transition-colors hover:bg-white/[0.16] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy === 'comment' ? 'Sending…' : 'Send comment'}
              </button>
            </div>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void run('approve')}
            disabled={busy !== null || revising || commenting}
            className="rounded-lg bg-white px-3.5 py-1.5 text-[11px] font-semibold text-zinc-900 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy === 'approve' ? 'Approving…' : 'Approve'}
          </button>
          <button
            type="button"
            onClick={() => { setCommenting((value) => !value); setError(''); }}
            disabled={busy !== null || revising}
            className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[11px] text-zinc-300 transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Comment
          </button>
          <button
            type="button"
            onClick={() => void run('reject')}
            disabled={busy !== null || revising}
            className="rounded-lg px-3 py-1.5 text-[11px] text-rose-300/90 transition-colors hover:bg-rose-500/10 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy === 'reject' ? 'Rejecting…' : 'Reject'}
          </button>
          {onOpenAutomations && (
            <button
              type="button"
              onClick={onOpenAutomations}
              className="ml-auto text-[10.5px] text-zinc-500 transition-colors hover:text-zinc-300"
            >
              Open automation
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
