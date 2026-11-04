import { useMemo, useState } from 'react';
import { Check, Link2, X } from 'lucide-react';
import {
  DATABASE_COLORS,
  type DatabaseProperty,
  type DatabaseRow,
  type DatabaseValue,
  type PageDatabase,
} from '../../../shared/pages';
import { PagePopover } from './PagePopover';
import { formulaResultFor } from './formula';
import { databaseValueText, htmlToPlainText } from './pageUtils';

const colorFor = (id?: string) => DATABASE_COLORS.find((color) => color.id === id) ?? DATABASE_COLORS[0]!;

function OptionChip({ property, value, onClear }: {
  property: DatabaseProperty;
  value: string;
  onClear?: () => void;
}) {
  const option = property.options?.find((candidate) => candidate.id === value);
  const color = colorFor(option?.color);
  return (
    <span className="pages-chip" style={{ color: color.value, backgroundColor: color.bg }}>
      {option?.name ?? value}
      {onClear ? (
        <button type="button" onClick={onClear} aria-label="Clear">
          <X size={10} />
        </button>
      ) : null}
    </span>
  );
}

function SelectCell({
  property,
  value,
  onChange,
  multiple = false,
}: {
  property: DatabaseProperty;
  value: DatabaseValue;
  onChange: (value: DatabaseValue) => void;
  multiple?: boolean;
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const selected = multiple
    ? Array.isArray(value) ? value : []
    : typeof value === 'string' ? [value] : [];
  return (
    <>
      <button
        type="button"
        className="pages-cell-trigger"
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
      >
        {selected.length ? (
          <span className="flex flex-wrap gap-1">
            {selected.map((id) => (
              <OptionChip key={id} property={property} value={id} />
            ))}
          </span>
        ) : (
          <span className="pages-cell-empty">{multiple ? 'Empty' : 'Select…'}</span>
        )}
      </button>
      {anchor ? (
        <PagePopover anchor={anchor} onClose={() => setAnchor(null)} width={230}>
          <div className="pages-option-menu">
            <div className="pages-option-menu-label">{property.name}</div>
            {(property.options ?? []).map((option) => {
              const active = selected.includes(option.id);
              const color = colorFor(option.color);
              return (
                <button
                  key={option.id}
                  type="button"
                  className="pages-option-item"
                  onClick={() => {
                    if (multiple) {
                      const next = active ? selected.filter((id) => id !== option.id) : [...selected, option.id];
                      onChange(next);
                    } else {
                      onChange(active ? null : option.id);
                      setAnchor(null);
                    }
                  }}
                >
                  <span className="pages-option-color" style={{ backgroundColor: color.value }} />
                  <span className="flex-1 text-left">{option.name}</span>
                  {active ? <Check size={13} /> : null}
                </button>
              );
            })}
            {selected.length ? (
              <button type="button" className="pages-option-clear" onClick={() => { onChange(multiple ? [] : null); setAnchor(null); }}>
                Clear
              </button>
            ) : null}
            {!(property.options ?? []).length ? <div className="px-2 py-2 text-xs text-zinc-500">Add options from the column menu.</div> : null}
          </div>
        </PagePopover>
      ) : null}
    </>
  );
}

function RelationCell({
  property,
  value,
  database,
  onChange,
}: {
  property: DatabaseProperty;
  value: DatabaseValue;
  database: PageDatabase;
  onChange: (value: DatabaseValue) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [target, setTarget] = useState<PageDatabase | null>(null);
  const [query, setQuery] = useState('');
  const ids = Array.isArray(value) ? value : [];
  const labelByRow = useMemo(() => {
    const map = new Map<string, string>();
    if (target) {
      const title = target.properties.find((candidate) => candidate.type === 'title');
      for (const row of target.rows) {
        map.set(row.id, title ? databaseValueText(row.values[title.id]) || 'Untitled' : row.id);
      }
    }
    return map;
  }, [target]);
  const loadTarget = async () => {
    if (target || !property.relationDatabaseId) return;
    try {
      const page = await window.api.pagesGet({ id: property.relationDatabaseId }) as { database?: PageDatabase } | null;
      setTarget(page?.database ?? null);
    } catch {
      setTarget(null);
    }
  };
  const title = target?.properties.find((candidate) => candidate.type === 'title');
  const rows = target?.rows.filter((row) => {
    if (!query.trim()) return true;
    return ids.includes(row.id)
      || databaseValueText(title ? row.values[title.id] : '').toLowerCase().includes(query.toLowerCase());
  }) ?? [];
  void database;
  return (
    <>
      <button
        type="button"
        className="pages-cell-trigger"
        onClick={(event) => {
          setAnchor(anchor ? null : event.currentTarget);
          void loadTarget();
        }}
      >
        {ids.length ? (
          <span className="pages-relation-count"><Link2 size={11} /> {ids.map((id) => labelByRow.get(id) ?? id).join(', ')}</span>
        ) : (
          <span className="pages-cell-empty">{property.relationDatabaseId ? 'Link rows…' : 'No target set'}</span>
        )}
      </button>
      {anchor ? (
        <PagePopover anchor={anchor} onClose={() => setAnchor(null)} width={280}>
          <div className="pages-relation-menu">
            <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a row…" className="pages-inline-input" />
            <div className="pages-option-menu">
              {rows.slice(0, 60).map((row) => {
                const active = ids.includes(row.id);
                return (
                  <button
                    key={row.id}
                    type="button"
                    className="pages-option-item"
                    onClick={() => onChange(active ? ids.filter((id) => id !== row.id) : [...ids, row.id])}
                  >
                    <span className="pages-relation-dot" />
                    <span className="flex-1 truncate text-left">{title ? databaseValueText(row.values[title.id]) || 'Untitled' : row.id}</span>
                    {active ? <Check size={13} /> : null}
                  </button>
                );
              })}
              {!target && property.relationDatabaseId ? <div className="px-2 py-2 text-xs text-zinc-500">Loading…</div> : null}
              {target && rows.length === 0 ? <div className="px-2 py-2 text-xs text-zinc-500">No matching rows.</div> : null}
            </div>
            {ids.length ? <button type="button" className="pages-option-clear" onClick={() => onChange([])}>Clear links</button> : null}
          </div>
        </PagePopover>
      ) : null}
    </>
  );
}

export function DatabaseCell({
  property,
  row,
  database,
  onChange,
  onOpenRow,
}: {
  property: DatabaseProperty;
  row: DatabaseRow;
  database: PageDatabase;
  onChange: (value: DatabaseValue) => void;
  onOpenRow?: () => void;
}) {
  const value = row.values[property.id];
  if (property.type === 'title') {
    return (
      <div className="pages-title-cell">
        <input
          value={htmlToPlainText(String(value ?? ''))}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && onOpenRow) onOpenRow();
          }}
          placeholder="Untitled"
        />
      </div>
    );
  }
  if (property.type === 'number') {
    return (
      <input
        className="pages-cell-input"
        type="number"
        value={typeof value === 'number' ? value : ''}
        onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))}
        placeholder="—"
      />
    );
  }
  if (property.type === 'checkbox') {
    return (
      <button
        type="button"
        className={`pages-checkbox ${value === true ? 'is-checked' : ''}`}
        onClick={() => onChange(value !== true)}
        aria-label={value === true ? 'Uncheck' : 'Check'}
      >
        {value === true ? '✓' : ''}
      </button>
    );
  }
  if (property.type === 'date') {
    return (
      <input
        type="date"
        className="pages-cell-input pages-date-input"
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value || null)}
      />
    );
  }
  if (property.type === 'select' || property.type === 'status') {
    return <SelectCell property={property} value={value} onChange={onChange} />;
  }
  if (property.type === 'multi_select') {
    return <SelectCell property={property} value={value} onChange={onChange} multiple />;
  }
  if (property.type === 'formula') {
    return <span className="pages-formula-value">{formulaResultFor(property, row, database)}</span>;
  }
  if (property.type === 'relation') {
    return <RelationCell property={property} value={value} database={database} onChange={onChange} />;
  }
  return (
    <input
      className="pages-cell-input"
      type={property.type === 'email' ? 'email' : property.type === 'url' ? 'url' : 'text'}
      value={typeof value === 'string' ? value : ''}
      onChange={(event) => onChange(event.target.value)}
      placeholder={property.type === 'url' ? 'https://…' : property.type === 'email' ? 'name@example.com' : '—'}
    />
  );
}
