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

function ActivityRow({ item }: { item: ActivityItem }) {
  const running = item.status === 'running';
  const errored = item.status === 'error';
  return (
    <div className={`flex items-start gap-2 rounded-lg px-2 py-1.5 ${running ? 'bg-indigo-500/[0.07]' : ''}`}>
      <span
        className={`relative mt-0.5 flex items-center justify-center w-5 h-5 rounded-md flex-shrink-0 ${errored ? 'bg-red-500/15 text-red-300' : categoryColor(item.category)}`}
      >
        {running && <span className="absolute inset-0 rounded-md border border-indigo-400/50 animate-ping" />}
        <ToolIcon name={item.name} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-zinc-200 truncate">{item.label}</span>
          <span className="ml-auto flex-shrink-0">
            {running ? (
              <span className="w-3 h-3 rounded-full border-2 border-indigo-400/30 border-t-indigo-400 animate-spin" />
            ) : errored ? (
              <svg
                className="w-3.5 h-3.5 text-red-400"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                viewBox="0 0 24 24"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            ) : (
              <svg
                className="w-3.5 h-3.5 text-emerald-400"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                viewBox="0 0 24 24"
              >
                <path d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            )}
          </span>
        </div>
        {item.detail && (
          <div className="text-[10px] text-textMuted font-mono truncate mt-0.5" title={item.detail}>
            {item.detail}
          </div>
        )}
      </div>
    </div>
  );
}

export function LiveActivityFeed() {
  const activity = useChatStore((s) => s.activity);
  const streaming = useChatStore((s) => s.streaming);
  if (activity.length === 0) return null;

  const runningCount = activity.filter((a) => a.status === 'running').length;

  return (
    <div className="sticky top-0 z-10 px-10 pt-3 pb-2 bg-gradient-to-b from-[#08080b] via-[#08080b] to-transparent pointer-events-none">
      <div className="rounded-xl border border-white/[0.08] bg-[#0c1018]/90 backdrop-blur-sm overflow-hidden shadow-lg pointer-events-auto">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75 animate-ping" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-400" />
          </span>
          <span className="text-[11px] font-semibold tracking-wide text-zinc-300 uppercase">Live Activity</span>
          {streaming && (
            <span className="text-[10px] text-indigo-300/80 ml-auto">
              {runningCount > 0 ? `${runningCount} running…` : 'working…'}
            </span>
          )}
        </div>
        <div className="max-h-44 overflow-y-auto custom-scrollbar px-2 py-2 space-y-1">
          {activity.map((a) => (
            <ActivityRow key={a.id} item={a} />
          ))}
        </div>
      </div>
    </div>
  );
}
