import { useMemo, useState } from 'react';
import { PAGE_ICONS } from '../../../shared/pages';

export function EmojiPicker({
  onPick,
  onRemove,
  compact = false,
}: {
  onPick: (icon: string) => void;
  onRemove?: () => void;
  compact?: boolean;
}) {
  const [query, setQuery] = useState('');
  const icons = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return PAGE_ICONS;
    return PAGE_ICONS.filter((icon) => icon.includes(needle));
  }, [query]);
  return (
    <div className="pages-emoji-picker">
      <div className="flex items-center gap-2 px-2.5 pt-2.5 pb-1.5">
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search icons"
          className="pages-inline-input flex-1 text-xs"
          aria-label="Search icons"
        />
        {onRemove ? (
          <button type="button" className="pages-ghost-button text-[11px]" onClick={onRemove}>
            Remove
          </button>
        ) : null}
      </div>
      <div className={`grid ${compact ? 'grid-cols-8' : 'grid-cols-9'} gap-0.5 p-2 max-h-[228px] overflow-y-auto custom-scrollbar`}>
        {icons.map((icon) => (
          <button
            key={icon}
            type="button"
            className="pages-emoji-choice"
            onClick={() => onPick(icon)}
            aria-label={`Use ${icon}`}
          >
            {icon}
          </button>
        ))}
      </div>
      {icons.length === 0 ? <div className="px-3 pb-3 text-xs text-zinc-500">No matching icons</div> : null}
    </div>
  );
}
