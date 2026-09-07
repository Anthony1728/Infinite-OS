import { useEffect } from 'react';

interface ShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { category: 'Navigation', items: [
    { keys: ['Ctrl', 'K'], label: 'Open command palette' },
    { keys: ['Ctrl', '`'], label: 'Open terminal' },
    { keys: ['Ctrl', 'N'], label: 'New chat' },
    { keys: ['Ctrl', 'B'], label: 'Toggle sidebar' },
    { keys: ['Ctrl', '.'], label: 'Toggle right panel' },
    { keys: ['Ctrl', '/'], label: 'Show keyboard shortcuts' },
  ]},
  { category: 'Chat', items: [
    { keys: ['Enter'], label: 'Send message' },
    { keys: ['Shift', 'Enter'], label: 'New line in input' },
    { keys: ['Escape'], label: 'Stop streaming / Close panel' },
    { keys: ['/'], label: 'Show commands (in empty input)' },
  ]},
  { category: 'Messages', items: [
    { keys: ['Right-click'], label: 'Copy / Edit / Branch message' },
  ]},
];

export function ShortcutsModal({ open, onClose }: ShortcutsModalProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md rounded-xl border border-white/[0.08] bg-[#111113] shadow-2xl p-6 animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-zinc-100">Keyboard Shortcuts</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 transition-colors" aria-label="Close">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
          {SHORTCUTS.map((group) => (
            <div key={group.category}>
              <div className="text-[9px] font-semibold text-zinc-600 uppercase tracking-wider mb-2">{group.category}</div>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <div key={item.label} className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-white/[0.03]">
                    <span className="text-xs text-zinc-400">{item.label}</span>
                    <div className="flex items-center gap-1">
                      {item.keys.map((key, i) => (
                        <span key={i}>
                          {i > 0 && <span className="text-zinc-600 text-[10px] mx-0.5">+</span>}
                          <kbd className="inline-block text-[10px] font-mono text-zinc-300 bg-white/[0.06] border border-white/[0.08] rounded px-1.5 py-0.5 min-w-[20px] text-center">
                            {key}
                          </kbd>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
