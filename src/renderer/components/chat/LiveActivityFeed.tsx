import { useChatStore } from '../../stores/chat';

/**
 * Slim live status, rendered in the chat flow directly above the pending
 * assistant reply. Tool calls themselves render once, as ToolCallCards —
 * this feed carries only the single-line connection/progress status so
 * there is exactly one tool-call animation in the UI. Visible only while
 * work is actually streaming.
 */
export function LiveActivityFeed() {
  const activity = useChatStore((s) => s.activity);
  const streaming = useChatStore((s) => s.streaming);
  const providerStatus = useChatStore((s) => s.providerStatus);

  if (!streaming) return null;

  const running = activity.filter((a) => a.status === 'running');
  const done = activity.filter((a) => a.status === 'done').length;
  const errors = activity.filter((a) => a.status === 'error').length;

  // Claude/Codex style: show what the agent is *thinking* when no tool is active but text is streaming
  const trailing = (() => {
    if (running.length > 0) {
      const names = running.slice(0, 2).map((r) => r.label.split(':')[0] || r.label).join(', ');
      return running.length === 1 ? `${names} — running` : `${running.length} tools — ${names}… running`;
    }
    if (providerStatus?.label) return providerStatus.label;
    if (activity.length === 0) return 'Thinking — planning your task…';
    return done > 0 ? `Done ${done} step${done > 1 ? 's' : ''}${errors ? ` • ${errors} error${errors > 1 ? 's' : ''}` : ''} — thinking next…` : 'Thinking…';
  })();

  return (
    <div className="px-1" aria-live="polite" aria-label="Live progress">
      <div className="mb-1 flex items-center gap-2 text-[10px] font-medium tracking-wide text-zinc-500">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" />
        Live — {running.length} running • {done} done{errors ? ` • ${errors} failed` : ''}
        {providerStatus?.detail ? <span className="ml-auto truncate font-mono text-[10px] text-zinc-600" title={providerStatus.detail}>{providerStatus.detail.slice(0, 60)}</span> : null}
      </div>
      <div className="flex gap-3">
        <div className="flex w-6 flex-col items-center">
          {running.length > 0 ? (
            <span key={done} className="os-smash-rumble relative flex h-6 w-6 items-center justify-center" title="Agent smashing through work">
              <span className="os-smash-ring absolute inline-flex h-3 w-3 rounded-full border border-violet-400/70" />
              <span className="os-smash-ring os-smash-ring--late absolute inline-flex h-3 w-3 rounded-full border border-cyan-300/60" />
              <span className="os-smash-core relative inline-flex h-2 w-2 rounded-full bg-gradient-to-br from-violet-400 to-cyan-300 shadow-[0_0_8px_rgba(139,92,246,.9)]" />
            </span>
          ) : (
            <span className="relative flex h-6 w-6 items-center justify-center">
              <span className="absolute inline-flex h-2 w-2 rounded-full bg-indigo-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-400" />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1 pt-1">
          <span className="truncate text-xs font-medium text-indigo-300/90">{trailing}</span>
          {providerStatus?.detail ? <div className="truncate font-mono text-[10px] text-zinc-600">{providerStatus.detail.slice(0, 90)}</div> : null}
        </div>
      </div>
    </div>
  );
}
