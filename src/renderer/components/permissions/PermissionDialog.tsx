import { useChatStore } from '../../stores/chat';

export function PermissionDialog() {
  const pending = useChatStore((s) => s.pendingPermission);
  const respond = useChatStore((s) => s.respondPermission);
  if (!pending) return null;

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40">
      <div className="bg-bg-elevated border border-border rounded-lg shadow-lg p-4 max-w-md">
        <div className="text-sm font-semibold mb-1">Permission required</div>
        <div className="text-xs text-fg-muted mb-3">
          The assistant wants to call <code className="text-accent">{pending.tool}</code>.
        </div>
        <pre className="text-xs bg-bg-subtle p-2 rounded mb-3 max-h-32 overflow-y-auto">
          {JSON.stringify(pending.input, null, 2)}
        </pre>
        <div className="flex gap-2 justify-end">
          <button onClick={() => respond(false)} className="rounded-md px-3 py-1.5 text-sm bg-bg-subtle hover:bg-border">Deny</button>
          <button onClick={() => respond(true)} className="rounded-md px-3 py-1.5 text-sm bg-accent text-accent-fg hover:opacity-90">Allow</button>
        </div>
      </div>
    </div>
  );
}

