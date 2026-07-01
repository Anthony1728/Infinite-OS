import { useState } from 'react';

export function ToolCallCard({ name, input, status }: { name: string; input: unknown; status: 'running' | 'done' }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-2 rounded-lg border border-border bg-bg-subtle">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm font-mono hover:bg-bg-elevated"
      >
        <span>{open ? '▾' : '▸'}</span>
        <span className="text-accent">🔧 {name}</span>
        <span className="text-fg-muted ml-auto text-xs">
          {status === 'running' ? 'running…' : 'done'}
        </span>
      </button>
      {open && (
        <pre className="px-3 py-2 text-xs text-fg-muted border-t border-border overflow-x-auto">
          {JSON.stringify(input, null, 2)}
        </pre>
      )}
    </div>
  );
}

