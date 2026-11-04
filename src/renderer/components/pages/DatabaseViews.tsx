import { useMemo, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  MoreHorizontal,
  Plus,
  Trash2,
} from 'lucide-react';
import type {
  DatabaseProperty,
  DatabaseRow,
  DatabaseValue,
  DatabaseView,
  PageDatabase,
} from '../../../shared/pages';
import { DATABASE_COLORS } from '../../../shared/pages';
import { PagePopover, PopoverItem, PopoverSeparator } from './PagePopover';
import { boardGroups, databaseRowTitle } from './databaseUtils';
import { databaseValueText, todayIso } from './pageUtils';

interface DatabaseViewsProps {
  database: PageDatabase;
  view: DatabaseView;
  rows: DatabaseRow[];
  onOpenRow: (rowId: string) => void;
  onCreateRow: (values?: Record<string, DatabaseValue>) => void;
  onUpdateRow: (rowId: string, values: Record<string, DatabaseValue>) => void;
  onDuplicateRow: (rowId: string) => void;
  onDeleteRow: (rowId: string) => void;
  onDatabaseChange: (database: PageDatabase) => void;
}

function optionColor(colorId: string | undefined): string {
  return DATABASE_COLORS.find((color) => color.id === colorId)?.value ?? DATABASE_COLORS[0]!.value;
}

function RowMenu({
  rowId,
  onOpen,
  onDuplicate,
  onDelete,
}: {
  rowId: string;
  onOpen: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  return (
    <>
      <button
        type="button"
        className="pages-row-menu-button"
        onClick={(event) => {
          event.stopPropagation();
          setAnchor(anchor ? null : event.currentTarget);
        }}
        aria-label="Row options"
      >
        <MoreHorizontal size={14} />
      </button>
      {anchor ? (
        <PagePopover anchor={anchor} onClose={() => setAnchor(null)} width={210}>
          <div className="p-1.5" onClick={(event) => event.stopPropagation()}>
            <PopoverItem label="Open row" icon={<ExternalLink size={14} />} onClick={() => { setAnchor(null); onOpen(); }} />
            <PopoverItem label="Duplicate" icon={<Copy size={14} />} onClick={() => { setAnchor(null); onDuplicate(); }} />
            <PopoverSeparator />
            <PopoverItem label="Delete row" icon={<Trash2 size={14} />} danger onClick={() => { setAnchor(null); onDelete(); }} />
          </div>
        </PagePopover>
      ) : null}
      <span className="sr-only">{rowId}</span>
    </>
  );
}

function cardProperties(database: PageDatabase, row: DatabaseRow, limit = 3): DatabaseProperty[] {
  return database.properties
    .filter((property) => property.type !== 'title')
    .filter((property) => {
      const value = row.values[property.id];
      return value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0);
    })
    .slice(0, limit);
}

function PropertyPill({ property, value }: { property: DatabaseProperty; value: DatabaseValue }) {
  if (property.type === 'select' || property.type === 'status') {
    const option = property.options?.find((candidate) => candidate.id === value);
    return (
      <span className="pages-mini-chip" style={{ color: optionColor(option?.color), backgroundColor: `${optionColor(option?.color)}20` }}>
        {option?.name ?? databaseValueText(value)}
      </span>
    );
  }
  if (property.type === 'multi_select' && Array.isArray(value)) {
    return (
      <span className="flex flex-wrap gap-1">
        {value.slice(0, 2).map((id) => {
          const option = property.options?.find((candidate) => candidate.id === id);
          return (
            <span key={id} className="pages-mini-chip" style={{ color: optionColor(option?.color), backgroundColor: `${optionColor(option?.color)}20` }}>
              {option?.name ?? id}
            </span>
          );
        })}
      </span>
    );
  }
  if (property.type === 'checkbox') return <span className="pages-mini-chip is-muted">{value ? '✓' : '—'}</span>;
  if (property.type === 'date' && typeof value === 'string') {
    const date = new Date(`${value}T00:00:00`);
    return (
      <span className="pages-mini-chip is-muted">
        {Number.isFinite(date.getTime()) ? date.toLocaleDateString([], { month: 'short', day: 'numeric' }) : value}
      </span>
    );
  }
  return <span className="pages-mini-chip is-muted">{databaseValueText(value).slice(0, 42)}</span>;
}

function BoardView({ database, view, rows, onOpenRow, onCreateRow, onUpdateRow, onDuplicateRow, onDeleteRow, onDatabaseChange }: DatabaseViewsProps) {
  const [dragRow, setDragRow] = useState<string | null>(null);
  const [dropGroup, setDropGroup] = useState<string | null>(null);
  const groupProperty = database.properties.find((property) => property.id === (view.boardGroupBy ?? view.groupBy))
    ?? database.properties.find((property) => property.type === 'status' || property.type === 'select');
  const groups = boardGroups(database, view, rows);
  if (!groupProperty || (groupProperty.type !== 'status' && groupProperty.type !== 'select')) {
    return (
      <div className="pages-view-empty">
        <div className="pages-empty-glyph">▦</div>
        <h3>Choose a grouping column</h3>
        <p>Board views group rows by a status or select property. Add one, or pick a property in view settings.</p>
        <select
          className="pages-select"
          value={view.boardGroupBy ?? ''}
          onChange={(event) => {
            const nextView = { ...view, boardGroupBy: event.target.value || undefined };
            onDatabaseChange({
              ...database,
              views: database.views.map((candidate) => candidate.id === view.id ? nextView : candidate),
            });
          }}
        >
          <option value="">Choose a property…</option>
          {database.properties.filter((property) => property.type === 'status' || property.type === 'select').map((property) => (
            <option key={property.id} value={property.id}>{property.name}</option>
          ))}
        </select>
      </div>
    );
  }
  return (
    <div className="pages-board custom-scrollbar">
      {groups.map((group) => (
        <div
          key={group.id}
          className={`pages-board-column ${dropGroup === group.id ? 'is-over' : ''}`}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes('application/x-infinite-row')) {
              event.preventDefault();
              setDropGroup(group.id);
            }
          }}
          onDragLeave={() => setDropGroup((current) => current === group.id ? null : current)}
          onDrop={(event) => {
            event.preventDefault();
            setDropGroup(null);
            const rowId = event.dataTransfer.getData('application/x-infinite-row') || dragRow;
            if (!rowId) return;
            const row = database.rows.find((candidate) => candidate.id === rowId);
            if (!row) return;
            onUpdateRow(rowId, {
              ...row.values,
              [groupProperty.id]: group.id === '__empty' || group.id === '__all' ? null : group.id,
            });
            setDragRow(null);
          }}
        >
          <div className="pages-board-head">
            <span className="pages-board-dot" style={{ backgroundColor: optionColor(group.color) }} />
            <span className="pages-board-title">{group.name}</span>
            <span className="pages-board-count">{group.rows.length}</span>
            <button
              type="button"
              className="pages-board-add"
              title={`Add to ${group.name}`}
              onClick={() => onCreateRow({ [groupProperty.id]: group.id.startsWith('__') ? null : group.id })}
            >
              <Plus size={14} />
            </button>
          </div>
          <div className="pages-board-cards custom-scrollbar">
            {group.rows.map((row) => (
              <article
                key={row.id}
                className={`pages-board-card ${dragRow === row.id ? 'is-dragging' : ''}`}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData('application/x-infinite-row', row.id);
                  event.dataTransfer.effectAllowed = 'move';
                  setDragRow(row.id);
                }}
                onDragEnd={() => { setDragRow(null); setDropGroup(null); }}
                onClick={() => onOpenRow(row.id)}
              >
                <div className="pages-board-card-top">
                  <span className="pages-board-card-title">{databaseRowTitle(database, row)}</span>
                  <RowMenu
                    rowId={row.id}
                    onOpen={() => onOpenRow(row.id)}
                    onDuplicate={() => onDuplicateRow(row.id)}
                    onDelete={() => onDeleteRow(row.id)}
                  />
                </div>
                <div className="pages-board-card-props">
                  {cardProperties(database, row, 3).map((property) => (
                    <span key={property.id} className="pages-board-card-prop">
                      <PropertyPill property={property} value={row.values[property.id] ?? null} />
                    </span>
                  ))}
                </div>
              </article>
            ))}
            <button type="button" className="pages-board-new" onClick={() => onCreateRow({ [groupProperty.id]: group.id.startsWith('__') ? null : group.id })}>
              <Plus size={14} /> New
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="pages-board-new-column"
        onClick={() => {
          const option = {
            id: `option-${Date.now().toString(36)}`,
            name: 'New group',
            color: DATABASE_COLORS[(groupProperty.options?.length ?? 0) % DATABASE_COLORS.length]!.id,
          };
          onDatabaseChange({
            ...database,
            properties: database.properties.map((property) => (
              property.id === groupProperty.id ? { ...property, options: [...(property.options ?? []), option] } : property
            )),
          });
        }}
      >
        <Plus size={15} /> New group
      </button>
    </div>
  );
}

function ListView({ database, rows, onOpenRow, onCreateRow, onDuplicateRow, onDeleteRow }: DatabaseViewsProps) {
  return (
    <div className="pages-list-view">
      <div className="pages-list-head">
        <span>Name</span>
        <span className="pages-list-head-props">Properties</span>
        <button type="button" className="pages-view-add-row" onClick={() => onCreateRow()}>
          <Plus size={14} /> New
        </button>
      </div>
      {rows.map((row) => (
        <div key={row.id} className="pages-list-row" onClick={() => onOpenRow(row.id)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') onOpenRow(row.id); }}>
          <span className="pages-list-file">📄</span>
          <span className="pages-list-title">{databaseRowTitle(database, row)}</span>
          <span className="pages-list-props">
            {cardProperties(database, row, 4).map((property) => (
              <PropertyPill key={property.id} property={property} value={row.values[property.id] ?? null} />
            ))}
          </span>
          <RowMenu rowId={row.id} onOpen={() => onOpenRow(row.id)} onDuplicate={() => onDuplicateRow(row.id)} onDelete={() => onDeleteRow(row.id)} />
        </div>
      ))}
      {rows.length === 0 ? (
        <div className="pages-view-empty compact">
          <p>This view has no rows yet.</p>
          <button type="button" className="pages-primary-button" onClick={() => onCreateRow()}><Plus size={14} /> Add a row</button>
        </div>
      ) : null}
      <button type="button" className="pages-view-add-row is-footer" onClick={() => onCreateRow()}>
        <Plus size={14} /> New row
      </button>
    </div>
  );
}

function dayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function CalendarView({ database, view, rows, onOpenRow, onCreateRow }: DatabaseViewsProps) {
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const dateProperty = database.properties.find((property) => property.id === view.datePropertyId)
    ?? database.properties.find((property) => property.type === 'date');
  const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = new Date(start);
  gridStart.setDate(1 - start.getDay());
  const days = Array.from({ length: 42 }, (_item, index) => {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + index);
    return day;
  });
  const today = todayIso();
  const rowsByDay = useMemo(() => {
    const map = new Map<string, DatabaseRow[]>();
    if (!dateProperty) return map;
    for (const row of rows) {
      const value = row.values[dateProperty.id];
      if (typeof value === 'string' && value) {
        const list = map.get(value) ?? [];
        list.push(row);
        map.set(value, list);
      }
    }
    return map;
  }, [dateProperty, rows]);

  if (!dateProperty) {
    return (
      <div className="pages-view-empty">
        <CalendarDays size={28} />
        <h3>Add a date property</h3>
        <p>Calendar views need a date column to place rows on the grid.</p>
      </div>
    );
  }

  return (
    <div className="pages-calendar">
      <div className="pages-calendar-head">
        <div className="flex items-center gap-2">
          <button type="button" className="pages-icon-button" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}><ChevronLeft size={16} /></button>
          <button type="button" className="pages-icon-button" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}><ChevronRight size={16} /></button>
          <button type="button" className="pages-secondary-button" onClick={() => { const now = new Date(); setCursor(new Date(now.getFullYear(), now.getMonth(), 1)); }}>Today</button>
          <h3>{cursor.toLocaleDateString([], { month: 'long', year: 'numeric' })}</h3>
        </div>
        <div className="pages-calendar-legend">
          <span className="pages-calendar-date-prop">{dateProperty.name}</span>
          <button type="button" className="pages-view-add-row" onClick={() => onCreateRow({ [dateProperty.id]: today })}>
            <Plus size={14} /> New row
          </button>
        </div>
      </div>
      <div className="pages-calendar-weekdays">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="pages-calendar-grid">
        {days.map((day) => {
          const key = dayKey(day);
          const isOtherMonth = day.getMonth() !== cursor.getMonth();
          const isToday = key === today;
          const dayRows = rowsByDay.get(key) ?? [];
          return (
            <div key={key} className={`pages-calendar-day ${isOtherMonth ? 'is-other' : ''} ${isToday ? 'is-today' : ''}`}>
              <div className="pages-calendar-day-head">
                <span>{day.getDate() === 1 ? day.toLocaleDateString([], { month: 'short', day: 'numeric' }) : day.getDate()}</span>
                <button type="button" title={`Add row on ${key}`} onClick={() => onCreateRow({ [dateProperty.id]: key })}>
                  <Plus size={12} />
                </button>
              </div>
              <div className="pages-calendar-events">
                {dayRows.slice(0, 3).map((row) => (
                  <button key={row.id} type="button" className="pages-calendar-event" onClick={() => onOpenRow(row.id)} title={databaseRowTitle(database, row)}>
                    <span className="pages-calendar-event-dot" />
                    <span className="truncate">{databaseRowTitle(database, row)}</span>
                  </button>
                ))}
                {dayRows.length > 3 ? <span className="pages-calendar-more">+{dayRows.length - 3} more</span> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const GALLERY_GRADIENTS = [
  'linear-gradient(135deg, #312e81 0%, #7c3aed 55%, #c084fc 100%)',
  'linear-gradient(135deg, #082f49 0%, #0369a1 55%, #22d3ee 100%)',
  'linear-gradient(135deg, #052e16 0%, #15803d 55%, #86efac 100%)',
  'linear-gradient(135deg, #3f1d2b 0%, #be123c 55%, #fb7185 100%)',
  'linear-gradient(135deg, #422006 0%, #b45309 55%, #fcd34d 100%)',
  'linear-gradient(135deg, #18181b 0%, #3f3f46 55%, #a1a1aa 100%)',
];

function gradientFor(title: string): string {
  let hash = 0;
  for (let index = 0; index < title.length; index += 1) hash = (hash * 31 + title.charCodeAt(index)) >>> 0;
  return GALLERY_GRADIENTS[hash % GALLERY_GRADIENTS.length]!;
}

function GalleryView({ database, rows, onOpenRow, onCreateRow, onDuplicateRow, onDeleteRow }: DatabaseViewsProps) {
  return (
    <div className="pages-gallery">
      {rows.map((row) => {
        const title = databaseRowTitle(database, row);
        return (
          <article key={row.id} className="pages-gallery-card" onClick={() => onOpenRow(row.id)}>
            <div className="pages-gallery-cover" style={{ background: gradientFor(title) }}>
              <span className="pages-gallery-watermark">{title.slice(0, 1).toUpperCase()}</span>
              <RowMenu rowId={row.id} onOpen={() => onOpenRow(row.id)} onDuplicate={() => onDuplicateRow(row.id)} onDelete={() => onDeleteRow(row.id)} />
            </div>
            <div className="pages-gallery-body">
              <div className="pages-gallery-title">
                <span className="pages-gallery-icon">📄</span>
                <span className="truncate">{title}</span>
              </div>
              <div className="pages-gallery-props">
                {cardProperties(database, row, 3).map((property) => (
                  <PropertyPill key={property.id} property={property} value={row.values[property.id] ?? null} />
                ))}
              </div>
            </div>
          </article>
        );
      })}
      <button type="button" className="pages-gallery-new" onClick={() => onCreateRow()}>
        <span className="pages-gallery-new-glyph"><Plus size={20} /></span>
        <span>New row</span>
      </button>
    </div>
  );
}

export function DatabaseViewBody(props: DatabaseViewsProps) {
  switch (props.view.type) {
    case 'board':
      return <BoardView {...props} />;
    case 'list':
      return <ListView {...props} />;
    case 'calendar':
      return <CalendarView {...props} />;
    case 'gallery':
      return <GalleryView {...props} />;
    default:
      return null;
  }
}
