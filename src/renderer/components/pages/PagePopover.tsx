import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface PagePopoverProps {
  anchor: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  align?: 'start' | 'end' | 'center';
  side?: 'bottom' | 'top';
  className?: string;
}

/**
 * Small, portal-based popover used throughout Pages. It positions against an
 * anchor element, flips when there is not enough room, and closes on outside
 * pointer/escape. Keeping menus out of the scrolling sidebar also means they
 * are never clipped by overflow.
 */
export function PagePopover({
  anchor,
  onClose,
  children,
  width = 240,
  align = 'start',
  side = 'bottom',
  className = '',
}: PagePopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const margin = 8;
      let top = side === 'top' ? rect.top - margin : rect.bottom + margin;
      let left = align === 'end' ? rect.right - width : align === 'center' ? rect.left + rect.width / 2 - width / 2 : rect.left;
      const panelHeight = panelRef.current?.offsetHeight ?? 320;
      if (side === 'bottom' && top + panelHeight > window.innerHeight - margin) top = Math.max(margin, rect.top - margin - panelHeight);
      if (side === 'top' && top < margin) top = Math.min(window.innerHeight - panelHeight - margin, rect.bottom + margin);
      left = Math.max(margin, Math.min(window.innerWidth - width - margin, left));
      setPosition({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, width, align, side]);

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchor?.contains(target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [anchor, onClose]);

  if (!anchor) return null;

  return createPortal(
    <div
      ref={panelRef}
      className={`pages-popover ${className}`}
      style={{
        width,
        top: position?.top ?? -9999,
        left: position?.left ?? -9999,
        visibility: position ? 'visible' : 'hidden',
      }}
      role="dialog"
    >
      {children}
    </div>,
    document.body,
  );
}

export function PopoverItem({
  icon,
  label,
  hint,
  danger = false,
  active = false,
  onClick,
  disabled = false,
}: {
  icon?: ReactNode;
  label: string;
  hint?: string;
  danger?: boolean;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`pages-popover-item ${danger ? 'is-danger' : ''} ${active ? 'is-active' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      {icon ? <span className="pages-popover-icon">{icon}</span> : null}
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate">{label}</span>
        {hint ? <span className="pages-popover-hint">{hint}</span> : null}
      </span>
    </button>
  );
}

export function PopoverSeparator() {
  return <div className="pages-popover-separator" />;
}
