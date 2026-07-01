import { useChatStore } from '../../stores/chat';

export function SessionList() {
  const sessions = useChatStore((s) => s.sessions);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const selectSession = useChatStore((s) => s.selectSession);
  const deleteSession = useChatStore((s) => s.deleteSession);

  if (!sessions.length) {
    return <div className="p-4 text-xs text-fg-muted">No sessions yet.</div>;
  }

  return (
    <ul className="py-1">
      {sessions.map((s) => (
        <li
          key={s.id}
          className={`group flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-bg-elevated ${
            s.id === currentSessionId ? 'bg-bg-elevated' : ''
          }`}
          onClick={() => selectSession(s.id)}
        >
          <div className="flex-1 min-w-0">
            <div className="truncate">{s.title || 'Untitled'}</div>
            <div className="text-xs text-fg-muted truncate">{s.provider}/{s.model}</div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (confirm('Delete this session?')) deleteSession(s.id);
            }}
            className="opacity-0 group-hover:opacity-100 text-fg-muted hover:text-danger"
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

