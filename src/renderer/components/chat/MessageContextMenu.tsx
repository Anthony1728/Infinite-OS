import { useEffect, useRef } from 'react';

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export function MessageContextMenu({
  items,
  x,
  y,
  onClose,
}: {
  items: ContextMenuItem[];
  x: number;
  y: number;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  // Adjust position to stay in viewport
  const adjustedX = Math.min(x, window.innerWidth - 200);
  const adjustedY = Math.min(y, window.innerHeight - items.length * 36 - 16);

  return (
    <div
      ref={ref}
      className="fixed z-[100] min-w-[180px] rounded-xl border border-white/[0.08] bg-[#151922] shadow-2xl shadow-black/60 py-1 animate-fade-in"
      style={{ left: adjustedX, top: adjustedY }}
    >
      {items.map((item, i) => (
        <button
          key={i}
          onClick={() => { item.onClick(); onClose(); }}
          disabled={item.disabled}
          className={`w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 transition-colors ${
            item.danger
              ? 'text-red-400 hover:bg-red-500/10'
              : item.disabled
                ? 'text-zinc-600 cursor-not-allowed'
                : 'text-zinc-300 hover:bg-white/5'
          }`}
        >
          {item.icon && <span className="w-3.5 h-3.5 flex-shrink-0">{item.icon}</span>}
          {item.label}
        </button>
      ))}
    </div>
  );
}
