export function TitleBar({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <header className="h-10 border-b border-border bg-bg-subtle flex items-center justify-between px-4 select-none" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      <div className="text-sm font-semibold">∞ Infinite AI</div>
      <div className="flex items-center gap-3 text-xs" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <span className="text-fg-muted">v0.1.0</span>
        <button onClick={onOpenSettings} className="text-fg-muted hover:text-fg">⚙</button>
      </div>
    </header>
  );
}

