import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownAZ,
  ArrowUpAZ,
  CalendarDays,
  Columns3,
  Copy,
  EyeOff,
  Filter,
  LayoutGrid,
  List,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  Table2,
  Trash2,
  X,
} from 'lucide-react';
import {
  DATABASE_COLORS,
  type DatabaseFilter,
  type DatabaseFilterGroup,
  type DatabaseProperty,
  type DatabasePropertyType,
  type DatabaseRow,
  type DatabaseSort,
  type DatabaseValue,
  type DatabaseView,
  type DatabaseViewType,
  type PageDatabase,
  type PageSummary,
} from '../../../shared/pages';
import { PagePopover, PopoverItem, PopoverSeparator } from './PagePopover';
import { DatabaseCell } from './DatabaseCell';
import { DatabaseViewBody } from './DatabaseViews';
import {
  databaseRowTitle,
  filterOperatorsFor,
  visibleDatabaseRows,
} from './databaseUtils';
import { databaseValueText, newId } from './pageUtils';

interface DatabaseViewProps {
  database: PageDatabase;
  summaries: PageSummary[];
  onChange: (database: PageDatabase) => void;
  onCreateRow: (values?: Record<string, DatabaseValue>) => void;
  onUpdateRow: (rowId: string, values: Record<string, DatabaseValue>) => void;
  onDuplicateRow: (rowId: string) => void;
  onDeleteRow: (rowId: string) => void;
  onOpenRow: (rowId: string) => void;
}

const VIEW_META: Record<DatabaseViewType, { label: string; icon: typeof Table2 }> = {
  table: { label: 'Table', icon: Table2 },
  board: { label: 'Board', icon: Columns3 },
  list: { label: 'List', icon: List },
  calendar: { label: 'Calendar', icon: CalendarDays },
  gallery: { label: 'Gallery', icon: LayoutGrid },
};

const PROPERTY_TYPES: Array<{ type: DatabasePropertyType; label: string }> = [
  { type: 'text', label: 'Text' },
  { type: 'number', label: 'Number' },
  { type: 'select', label: 'Select' },
  { type: 'multi_select', label: 'Multi-select' },
  { type: 'status', label: 'Status' },
  { type: 'date', label: 'Date' },
  { type: 'checkbox', label: 'Checkbox' },
  { type: 'url', label: 'URL' },
  { type: 'email', label: 'Email' },
  { type: 'phone', label: 'Phone' },
  { type: 'formula', label: 'Formula' },
  { type: 'relation', label: 'Relation' },
];

function typeGlyph(type: DatabasePropertyType): string {
  switch (type) {
    case 'title': return 'Aa';
    case 'text': return 'Aa';
    case 'number': return '#';
    case 'select': return '◉';
    case 'multi_select': return '≡';
    case 'status': return '◐';
    case 'date': return '▦';
    case 'checkbox': return '☑';
    case 'url': return '↗';
    case 'email': return '@';
    case 'phone': return '☎';
    case 'formula': return 'ƒ';
    case 'relation': return '⇄';
    default: return 'Aa';
  }
}

function optionColor(colorId: string | undefined): string {
  return DATABASE_COLORS.find((color) => color.id === colorId)?.value ?? DATABASE_COLORS[0]!.value;
}

function newView(type: DatabaseViewType): DatabaseView {
  const meta = VIEW_META[type];
  return {
    id: newId(),
    name: meta.label,
    type,
    sorts: [],
    ...(type === 'board' ? { boardGroupBy: undefined } : {}),
    ...(type === 'calendar' ? { datePropertyId: undefined } : {}),
  } as DatabaseView;
}

function defaultOptions(type: DatabasePropertyType): DatabaseProperty['options'] {
  if (type === 'status') {
    return [
      { id: 'status-todo', name: 'Not started', color: 'zinc' },
      { id: 'status-doing', name: 'In progress', color: 'sky' },
      { id: 'status-done', name: 'Done', color: 'green' },
    ];
  }
  if (type === 'select' || type === 'multi_select') {
    return [
      { id: `option-${Date.now().toString(36)}-1`, name: 'Option 1', color: 'violet' },
      { id: `option-${Date.now().toString(36)}-2`, name: 'Option 2', color: 'sky' },
    ];
  }
  return undefined;
}

function FilterValueControl({
  property,
  filter,
  onChange,
}: {
  property: DatabaseProperty;
  filter: DatabaseFilter;
  onChange: (filter: DatabaseFilter) => void;
}) {
  if (filter.operator === 'is_empty' || filter.operator === 'is_not_empty' || filter.operator === 'is_checked' || filter.operator === 'is_unchecked') {
    return null;
  }
  if (property.type === 'select' || property.type === 'status') {
    return (
      <select
        className="pages-filter-value"
        value={typeof filter.value === 'string' ? filter.value : ''}
        onChange={(event) => onChange({ ...filter, value: event.target.value })}
      >
        <option value="">Choose…</option>
        {(property.options ?? []).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select>
    );
  }
  if (property.type === 'date') {
    return (
      <input
        type="date"
        className="pages-filter-value"
        value={typeof filter.value === 'string' ? filter.value : ''}
        onChange={(event) => onChange({ ...filter, value: event.target.value })}
      />
    );
  }
  if (property.type === 'number' || property.type === 'formula') {
    return (
      <input
        type="number"
        className="pages-filter-value"
        value={typeof filter.value === 'number' ? filter.value : ''}
        onChange={(event) => onChange({ ...filter, value: event.target.value === '' ? undefined : Number(event.target.value) })}
      />
    );
  }
  return (
    <input
      className="pages-filter-value"
      value={databaseValueText(filter.value)}
      onChange={(event) => onChange({ ...filter, value: event.target.value })}
      placeholder="Value"
    />
  );
}

function FilterMenu({
  database,
  view,
  onChange,
  onClose,
}: {
  database: PageDatabase;
  view: DatabaseView;
  onChange: (view: DatabaseView) => void;
  onClose: () => void;
}) {
  const group: DatabaseFilterGroup = view.filters ?? { conjunction: 'and', filters: [] };
  const update = (filters: DatabaseFilter[]) => onChange({ ...view, filters: { ...group, filters } });
  return (
    <div className="pages-filter-menu">
      <div className="pages-menu-head">
        <span>Filters</span>
        <button type="button" onClick={onClose}><X size={14} /></button>
      </div>
      {group.filters.length > 1 ? (
        <div className="pages-filter-conjunction">
          <span>Match</span>
          <select value={group.conjunction} onChange={(event) => onChange({ ...view, filters: { ...group, conjunction: event.target.value as 'and' | 'or' } })}>
            <option value="and">all filters</option>
            <option value="or">any filter</option>
          </select>
        </div>
      ) : null}
      {group.filters.map((filter) => {
        const property = database.properties.find((candidate) => candidate.id === filter.propertyId) ?? database.properties[0];
        if (!property) return null;
        return (
          <div key={filter.id} className="pages-filter-row">
            <select
              value={property.id}
              onChange={(event) => {
                const nextProperty = database.properties.find((candidate) => candidate.id === event.target.value);
                const operator = nextProperty ? filterOperatorsFor(nextProperty)[0]?.[0] ?? 'contains' : 'contains';
                update(group.filters.map((candidate) => candidate.id === filter.id
                  ? { ...candidate, propertyId: event.target.value, operator: operator as DatabaseFilter['operator'], value: undefined }
                  : candidate));
              }}
            >
              {database.properties.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
            </select>
            <select
              value={filter.operator}
              onChange={(event) => update(group.filters.map((candidate) => candidate.id === filter.id
                ? { ...candidate, operator: event.target.value as DatabaseFilter['operator'], value: undefined }
                : candidate))}
            >
              {filterOperatorsFor(property).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <FilterValueControl
              property={property}
              filter={filter}
              onChange={(next) => update(group.filters.map((candidate) => candidate.id === filter.id ? next : candidate))}
            />
            <button type="button" className="pages-filter-remove" onClick={() => update(group.filters.filter((candidate) => candidate.id !== filter.id))} title="Remove filter">
              <X size={13} />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className="pages-filter-add"
        onClick={() => {
          const property = database.properties[0];
          if (!property) return;
          update([...group.filters, {
            id: newId(),
            propertyId: property.id,
            operator: filterOperatorsFor(property)[0]?.[0] as DatabaseFilter['operator'] ?? 'contains',
            value: '',
          }]);
        }}
      >
        <Plus size={13} /> Add filter
      </button>
    </div>
  );
}

function SortMenu({
  database,
  view,
  onChange,
  onClose,
}: {
  database: PageDatabase;
  view: DatabaseView;
  onChange: (view: DatabaseView) => void;
  onClose: () => void;
}) {
  const sorts = view.sorts ?? [];
  const update = (next: DatabaseSort[]) => onChange({ ...view, sorts: next });
  return (
    <div className="pages-sort-menu">
      <div className="pages-menu-head">
        <span>Sort</span>
        <button type="button" onClick={onClose}><X size={14} /></button>
      </div>
      {sorts.map((sort, index) => (
        <div key={`${sort.propertyId}-${index}`} className="pages-sort-row">
          <select
            value={sort.propertyId}
            onChange={(event) => update(sorts.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, propertyId: event.target.value } : candidate))}
          >
            {database.properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}
          </select>
          <button
            type="button"
            className="pages-direction-button"
            onClick={() => update(sorts.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, direction: candidate.direction === 'asc' ? 'desc' : 'asc' } : candidate))}
            title={sort.direction === 'asc' ? 'Ascending' : 'Descending'}
          >
            {sort.direction === 'asc' ? <ArrowDownAZ size={15} /> : <ArrowUpAZ size={15} />}
          </button>
          <button type="button" className="pages-filter-remove" onClick={() => update(sorts.filter((_candidate, candidateIndex) => candidateIndex !== index))}><X size={13} /></button>
        </div>
      ))}
      <button
        type="button"
        className="pages-filter-add"
        onClick={() => {
          const property = database.properties[0];
          if (!property) return;
          update([...sorts, { propertyId: property.id, direction: 'asc' }]);
        }}
      >
        <Plus size={13} /> Add sort
      </button>
    </div>
  );
}

function PropertyMenu({
  database,
  property,
  targets,
  onChange,
  onClose,
}: {
  database: PageDatabase;
  property: DatabaseProperty;
  targets: PageSummary[];
  onChange: (database: PageDatabase) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(property.name);
  const [formula, setFormula] = useState(property.formula ?? '');
  const [newOption, setNewOption] = useState('');
  const commit = (patch: Partial<DatabaseProperty>) => {
    onChange({
      ...database,
      properties: database.properties.map((candidate) => candidate.id === property.id ? { ...candidate, ...patch } : candidate),
    });
  };
  const supportsOptions = property.type === 'select' || property.type === 'multi_select' || property.type === 'status';
  return (
    <div className="pages-property-menu">
      <div className="pages-menu-head">
        <span>Property</span>
        <button type="button" onClick={onClose}><X size={14} /></button>
      </div>
      <div className="pages-property-edit-row">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => { if (name.trim() && name.trim() !== property.name) commit({ name: name.trim() }); }}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.currentTarget.blur(); } }}
          placeholder="Property name"
        />
      </div>
      <div className="pages-property-edit-row">
        <label>Type</label>
        <select
          value={property.type}
          onChange={(event) => {
            const type = event.target.value as DatabasePropertyType;
            commit({
              type,
              options: (type === 'select' || type === 'multi_select' || type === 'status') ? property.options?.length ? property.options : defaultOptions(type) : undefined,
              formula: type === 'formula' ? property.formula ?? '' : undefined,
              relationDatabaseId: type === 'relation' ? property.relationDatabaseId : undefined,
            });
          }}
        >
          {PROPERTY_TYPES.map((entry) => <option key={entry.type} value={entry.type}>{entry.label}</option>)}
        </select>
      </div>
      {property.type === 'formula' ? (
        <div className="pages-property-formula">
          <label>Formula</label>
          <input
            value={formula}
            onChange={(event) => setFormula(event.target.value)}
            onBlur={() => { if (formula !== (property.formula ?? '')) commit({ formula }); }}
            onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
            placeholder='e.g. prop("Status") + " · " + formatDate(prop("Date"))'
            spellCheck={false}
          />
          <span>Use <code>prop(&quot;Name&quot;)</code>, arithmetic, and IF, CONCAT, LEN, ROUND, YEAR, MONTH, DAY, DATEADD, DATEDIF, FORMATDATE.</span>
        </div>
      ) : null}
      {property.type === 'relation' ? (
        <div className="pages-property-edit-row">
          <label>Target</label>
          <select
            value={property.relationDatabaseId ?? ''}
            onChange={(event) => commit({ relationDatabaseId: event.target.value || undefined })}
          >
            <option value="">Choose a database…</option>
            {targets.map((target) => (
              <option key={target.id} value={target.id}>{target.title}</option>
            ))}
          </select>
        </div>
      ) : null}
      {supportsOptions ? (
        <div className="pages-property-options">
          <div className="pages-property-options-label">Options</div>
          {(property.options ?? []).map((option) => (
            <div key={option.id} className="pages-property-option-row">
              <button
                type="button"
                className="pages-option-color"
                style={{ backgroundColor: optionColor(option.color) }}
                title="Change color"
                onClick={() => {
                  const nextColorIndex = (DATABASE_COLORS.findIndex((color) => color.id === option.color) + 1) % DATABASE_COLORS.length;
                  commit({
                    options: (property.options ?? []).map((candidate) => candidate.id === option.id ? { ...candidate, color: DATABASE_COLORS[nextColorIndex]!.id } : candidate),
                  });
                }}
              />
              <input
                value={option.name}
                onChange={(event) => commit({
                  options: (property.options ?? []).map((candidate) => candidate.id === option.id ? { ...candidate, name: event.target.value } : candidate),
                })}
              />
              <button
                type="button"
                title="Delete option"
                onClick={() => commit({ options: (property.options ?? []).filter((candidate) => candidate.id !== option.id) })}
              >
                <X size={12} />
              </button>
            </div>
          ))}
          <div className="pages-property-option-add">
            <input
              value={newOption}
              onChange={(event) => setNewOption(event.target.value)}
              placeholder="New option"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && newOption.trim()) {
                  commit({
                    options: [...(property.options ?? []), {
                      id: `option-${Date.now().toString(36)}`,
                      name: newOption.trim(),
                      color: DATABASE_COLORS[(property.options?.length ?? 0) % DATABASE_COLORS.length]!.id,
                    }],
                  });
                  setNewOption('');
                }
              }}
            />
            <button
              type="button"
              onClick={() => {
                if (!newOption.trim()) return;
                commit({
                  options: [...(property.options ?? []), {
                    id: `option-${Date.now().toString(36)}`,
                    name: newOption.trim(),
                    color: DATABASE_COLORS[(property.options?.length ?? 0) % DATABASE_COLORS.length]!.id,
                  }],
                });
                setNewOption('');
              }}
            >
              <Plus size={13} />
            </button>
          </div>
        </div>
      ) : null}
      {property.type !== 'title' ? (
        <>
          <PopoverSeparator />
          <div className="p-1.5">
            <PopoverItem
              label="Delete property"
              icon={<Trash2 size={14} />}
              danger
              onClick={() => {
                onChange({
                  ...database,
                  properties: database.properties.filter((candidate) => candidate.id !== property.id),
                  rows: database.rows.map((row) => {
                    const values = { ...row.values };
                    delete values[property.id];
                    return { ...row, values };
                  }),
                  views: database.views.map((view) => ({
                    ...view,
                    hiddenPropertyIds: view.hiddenPropertyIds?.filter((id) => id !== property.id),
                    sorts: view.sorts?.filter((sort) => sort.propertyId !== property.id),
                    filters: view.filters ? {
                      ...view.filters,
                      filters: view.filters.filters.filter((filter) => filter.propertyId !== property.id),
                    } : undefined,
                  })),
                });
                onClose();
              }}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

function TableView({
  database,
  view,
  rows,
  onUpdateRow,
  onCreateRow,
  onDuplicateRow,
  onDeleteRow,
  onOpenRow,
  onChange,
  summaries,
}: {
  database: PageDatabase;
  view: DatabaseView;
  rows: DatabaseRow[];
  onUpdateRow: (rowId: string, values: Record<string, DatabaseValue>) => void;
  onCreateRow: () => void;
  onDuplicateRow: (rowId: string) => void;
  onDeleteRow: (rowId: string) => void;
  onOpenRow: (rowId: string) => void;
  onChange: (database: PageDatabase) => void;
  summaries: PageSummary[];
}) {
  const hidden = new Set(view.hiddenPropertyIds ?? []);
  const properties = database.properties.filter((property) => !hidden.has(property.id));
  const [propertyMenu, setPropertyMenu] = useState<{ property: DatabaseProperty; anchor: HTMLElement } | null>(null);
  const [addAnchor, setAddAnchor] = useState<HTMLButtonElement | null>(null);
  const [rowMenu, setRowMenu] = useState<{ rowId: string; anchor: HTMLButtonElement } | null>(null);
  const [newPropertyName, setNewPropertyName] = useState('');
  const [newPropertyType, setNewPropertyType] = useState<DatabasePropertyType>('text');
  const addRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (addAnchor) requestAnimationFrame(() => addRef.current?.focus());
  }, [addAnchor]);

  const addProperty = () => {
    const name = newPropertyName.trim() || PROPERTY_TYPES.find((entry) => entry.type === newPropertyType)?.label || 'Property';
    const property: DatabaseProperty = {
      id: newId(),
      name,
      type: newPropertyType,
      options: defaultOptions(newPropertyType),
    };
    onChange({ ...database, properties: [...database.properties, property] });
    setNewPropertyName('');
    setNewPropertyType('text');
    setAddAnchor(null);
  };

  return (
    <div className="pages-table-view custom-scrollbar">
      <table className="pages-database-table">
        <thead>
          <tr>
            <th className="pages-db-index">#</th>
            {properties.map((property) => {
              const sorted = view.sorts?.find((sort) => sort.propertyId === property.id);
              return (
                <th key={property.id} className={property.type === 'title' ? 'is-title' : ''}>
                  <button
                    type="button"
                    className="pages-db-property-head"
                    onClick={(event) => setPropertyMenu({ property, anchor: event.currentTarget })}
                  >
                    <span className="pages-db-type">{typeGlyph(property.type)}</span>
                    <span className="truncate">{property.name}</span>
                    {sorted ? (sorted.direction === 'asc' ? <ArrowDownAZ size={12} /> : <ArrowUpAZ size={12} />) : null}
                  </button>
                  <button
                    type="button"
                    className="pages-db-head-menu"
                    title="Column options"
                    onClick={(event) => setPropertyMenu({ property, anchor: event.currentTarget })}
                  >
                    <MoreHorizontal size={13} />
                  </button>
                </th>
              );
            })}
            <th className="pages-db-add-cell">
              <button type="button" className="pages-db-add-property" onClick={(event) => setAddAnchor(addAnchor ? null : event.currentTarget)}>
                <Plus size={15} />
              </button>
            </th>
            <th className="pages-db-row-space" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={row.id}
              onDoubleClick={(event) => {
                if ((event.target as HTMLElement).closest('input,button,select')) return;
                onOpenRow(row.id);
              }}
            >
              <td className="pages-db-index">
                <span>{rowIndex + 1}</span>
                <button
                  type="button"
                  className="pages-row-open"
                  title="Open row"
                  onClick={() => onOpenRow(row.id)}
                >
                  ↗
                </button>
              </td>
              {properties.map((property) => (
                <td key={property.id} className={property.type === 'title' ? 'is-title' : ''}>
                  <DatabaseCell
                    property={property}
                    row={row}
                    database={database}
                    onChange={(value) => onUpdateRow(row.id, { ...row.values, [property.id]: value })}
                    onOpenRow={() => onOpenRow(row.id)}
                  />
                </td>
              ))}
              <td className="pages-db-add-cell" />
              <td className="pages-db-row-space">
                <button
                  type="button"
                  className="pages-db-row-menu"
                  title="Row options"
                  onClick={(event) => setRowMenu({ rowId: row.id, anchor: event.currentTarget })}
                >
                  <MoreHorizontal size={14} />
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={properties.length + 3}>
                <div className="pages-table-empty">
                  <div className="pages-empty-glyph">▦</div>
                  <div>
                    <h3>No rows yet</h3>
                    <p>Add the first row, or change a filter if this view should show existing rows.</p>
                  </div>
                  <button type="button" className="pages-primary-button" onClick={onCreateRow}><Plus size={14} /> New row</button>
                </div>
              </td>
            </tr>
          ) : null}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={properties.length + 3}>
              <button type="button" className="pages-db-new-row" onClick={onCreateRow}>
                <Plus size={14} /> New row
              </button>
            </td>
          </tr>
        </tfoot>
      </table>

      {addAnchor ? (
        <PagePopover anchor={addAnchor} onClose={() => setAddAnchor(null)} width={280}>
          <div className="pages-add-property-menu">
            <div className="pages-menu-head"><span>New property</span><button type="button" onClick={() => setAddAnchor(null)}><X size={14} /></button></div>
            <input
              ref={addRef}
              value={newPropertyName}
              onChange={(event) => setNewPropertyName(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') addProperty(); }}
              placeholder="Property name"
            />
            <select value={newPropertyType} onChange={(event) => setNewPropertyType(event.target.value as DatabasePropertyType)}>
              {PROPERTY_TYPES.map((entry) => <option key={entry.type} value={entry.type}>{entry.label}</option>)}
            </select>
            <button type="button" className="pages-primary-button" onClick={addProperty}><Plus size={14} /> Add property</button>
          </div>
        </PagePopover>
      ) : null}

      {propertyMenu ? (
        <PagePopover anchor={propertyMenu.anchor} onClose={() => setPropertyMenu(null)} width={330}>
          <PropertyMenu
            database={database}
            property={database.properties.find((candidate) => candidate.id === propertyMenu.property.id) ?? propertyMenu.property}
            targets={summaries.filter((summary) => summary.kind === 'database' && !summary.trashedAt)}
            onChange={onChange}
            onClose={() => setPropertyMenu(null)}
          />
        </PagePopover>
      ) : null}

      {rowMenu ? (
        <PagePopover anchor={rowMenu.anchor} onClose={() => setRowMenu(null)} width={210}>
          <div className="p-1.5">
            <PopoverItem label="Open row" icon={<span>↗</span>} onClick={() => { setRowMenu(null); onOpenRow(rowMenu.rowId); }} />
            <PopoverItem label="Duplicate row" icon={<Copy size={14} />} onClick={() => { setRowMenu(null); onDuplicateRow(rowMenu.rowId); }} />
            <PopoverSeparator />
            <PopoverItem label="Delete row" icon={<Trash2 size={14} />} danger onClick={() => { setRowMenu(null); onDeleteRow(rowMenu.rowId); }} />
          </div>
        </PagePopover>
      ) : null}
    </div>
  );
}

export function DatabaseView({
  database,
  summaries,
  onChange,
  onCreateRow,
  onUpdateRow,
  onDuplicateRow,
  onDeleteRow,
  onOpenRow,
}: DatabaseViewProps) {
  const [activeViewId, setActiveViewId] = useState(database.defaultViewId);
  const [viewMenu, setViewMenu] = useState<HTMLButtonElement | null>(null);
  const [addViewAnchor, setAddViewAnchor] = useState<HTMLButtonElement | null>(null);
  const [filterAnchor, setFilterAnchor] = useState<HTMLButtonElement | null>(null);
  const [sortAnchor, setSortAnchor] = useState<HTMLButtonElement | null>(null);
  const [hideAnchor, setHideAnchor] = useState<HTMLButtonElement | null>(null);
  const [search, setSearch] = useState('');
  const [pendingViewName, setPendingViewName] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const view = database.views.find((candidate) => candidate.id === activeViewId) ?? database.views[0];

  useEffect(() => {
    if (!database.views.some((candidate) => candidate.id === activeViewId)) {
      setActiveViewId(database.defaultViewId ?? database.views[0]?.id ?? '');
    }
  }, [database.views, database.defaultViewId, activeViewId]);

  useEffect(() => {
    if (viewMenu) setPendingViewName(view?.name ?? '');
  }, [viewMenu, view?.name]);

  if (!view) {
    return (
      <div className="pages-view-empty">
        <h3>This database has no views</h3>
        <p>Add a table view to start working with rows.</p>
        <button
          type="button"
          className="pages-primary-button"
          onClick={() => {
            const next = newView('table');
            onChange({ ...database, views: [next], defaultViewId: next.id });
            setActiveViewId(next.id);
          }}
        >
          <Plus size={14} /> Add table view
        </button>
      </div>
    );
  }

  const updateDatabase = (next: PageDatabase) => onChange(next);
  const updateView = (nextView: DatabaseView) => {
    onChange({
      ...database,
      views: database.views.map((candidate) => candidate.id === nextView.id ? nextView : candidate),
    });
  };

  const rows = visibleDatabaseRows(database, view).filter((row) => {
    if (!search.trim()) return true;
    const needle = search.trim().toLowerCase();
    return databaseRowTitle(database, row).toLowerCase().includes(needle)
      || database.properties.some((property) => databaseValueText(row.values[property.id]).toLowerCase().includes(needle));
  });

  const filterCount = view.filters?.filters.length ?? 0;
  const sortCount = view.sorts?.length ?? 0;
  const hiddenCount = view.hiddenPropertyIds?.length ?? 0;
  const dateProperty = database.properties.find((property) => property.type === 'date');
  const groupProperties = database.properties.filter((property) => property.type === 'status' || property.type === 'select');

  return (
    <div className="pages-database">
      <div className="pages-view-tabs">
        <div className="pages-view-tab-list custom-scrollbar">
          {database.views.map((candidate) => {
            const Icon = VIEW_META[candidate.type].icon;
            return (
              <button
                key={candidate.id}
                type="button"
                className={`pages-view-tab ${candidate.id === view.id ? 'is-active' : ''}`}
                onClick={() => setActiveViewId(candidate.id)}
                onDoubleClick={(event) => {
                  setActiveViewId(candidate.id);
                  setPendingViewName(candidate.name);
                  setSettingsOpen(true);
                  setViewMenu(event.currentTarget);
                }}
              >
                <Icon size={13} />
                <span>{candidate.name}</span>
              </button>
            );
          })}
          <button type="button" className="pages-view-add" onClick={(event) => setAddViewAnchor(addViewAnchor ? null : event.currentTarget)} title="Add view">
            <Plus size={14} />
          </button>
        </div>
        <div className="pages-view-toolbar">
          <div className="pages-db-search">
            <Search size={13} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a row…" />
            {search ? <button type="button" onClick={() => setSearch('')}><X size={12} /></button> : null}
          </div>
          <button type="button" className={`pages-toolbar-button ${filterCount ? 'is-active' : ''}`} onClick={(event) => setFilterAnchor(filterAnchor ? null : event.currentTarget)}>
            <Filter size={14} />
            <span>Filter</span>
            {filterCount ? <span className="pages-toolbar-count">{filterCount}</span> : null}
          </button>
          <button type="button" className={`pages-toolbar-button ${sortCount ? 'is-active' : ''}`} onClick={(event) => setSortAnchor(sortAnchor ? null : event.currentTarget)}>
            <ArrowDownAZ size={14} />
            <span>Sort</span>
            {sortCount ? <span className="pages-toolbar-count">{sortCount}</span> : null}
          </button>
          <button type="button" className={`pages-toolbar-button ${hiddenCount ? 'is-active' : ''}`} onClick={(event) => setHideAnchor(hideAnchor ? null : event.currentTarget)} title="Hide properties">
            <EyeOff size={14} />
          </button>
          <button
            type="button"
            className={`pages-toolbar-button ${settingsOpen ? 'is-active' : ''}`}
            onClick={(event) => {
              setViewMenu(viewMenu ? null : event.currentTarget);
              setSettingsOpen(!viewMenu);
            }}
            title="View settings"
          >
            <Settings2 size={14} />
          </button>
        </div>
      </div>

      <div className="pages-database-body">
        {view.type === 'table' ? (
          <TableView
            database={database}
            view={view}
            rows={rows}
            onUpdateRow={onUpdateRow}
            onCreateRow={() => onCreateRow()}
            onDuplicateRow={onDuplicateRow}
            onDeleteRow={onDeleteRow}
            onOpenRow={onOpenRow}
            onChange={onChange}
            summaries={summaries}
          />
        ) : (
          <DatabaseViewBody
            database={database}
            view={view}
            rows={rows}
            onOpenRow={onOpenRow}
            onCreateRow={onCreateRow}
            onUpdateRow={onUpdateRow}
            onDuplicateRow={onDuplicateRow}
            onDeleteRow={onDeleteRow}
            onDatabaseChange={onChange}
          />
        )}
      </div>

      <div className="pages-database-foot">
        <span>{rows.length} row{rows.length === 1 ? '' : 's'}</span>
        {filterCount ? <span>· filtered</span> : null}
        <span className="ml-auto">{VIEW_META[view.type].label} view</span>
      </div>

      {addViewAnchor ? (
        <PagePopover anchor={addViewAnchor} onClose={() => setAddViewAnchor(null)} width={230}>
          <div className="p-1.5">
            {(Object.keys(VIEW_META) as DatabaseViewType[]).map((type) => {
              const Icon = VIEW_META[type].icon;
              return (
                <PopoverItem
                  key={type}
                  label={VIEW_META[type].label}
                  icon={<Icon size={14} />}
                  onClick={() => {
                    const next = newView(type);
                    onChange({
                      ...database,
                      views: [...database.views, next],
                      defaultViewId: database.defaultViewId,
                    });
                    setActiveViewId(next.id);
                    setAddViewAnchor(null);
                  }}
                />
              );
            })}
          </div>
        </PagePopover>
      ) : null}

      {filterAnchor ? (
        <PagePopover anchor={filterAnchor} onClose={() => setFilterAnchor(null)} width={440}>
          <FilterMenu database={database} view={view} onChange={updateView} onClose={() => setFilterAnchor(null)} />
        </PagePopover>
      ) : null}

      {sortAnchor ? (
        <PagePopover anchor={sortAnchor} onClose={() => setSortAnchor(null)} width={360}>
          <SortMenu database={database} view={view} onChange={updateView} onClose={() => setSortAnchor(null)} />
        </PagePopover>
      ) : null}

      {hideAnchor ? (
        <PagePopover anchor={hideAnchor} onClose={() => setHideAnchor(null)} width={250}>
          <div className="pages-hide-menu">
            <div className="pages-menu-head"><span>Properties</span><button type="button" onClick={() => setHideAnchor(null)}><X size={14} /></button></div>
            {database.properties.map((property) => {
              const hidden = (view.hiddenPropertyIds ?? []).includes(property.id);
              return (
                <label key={property.id} className={`pages-hide-row ${property.type === 'title' ? 'is-disabled' : ''}`}>
                  <input
                    type="checkbox"
                    checked={!hidden}
                    disabled={property.type === 'title'}
                    onChange={() => {
                      const nextHidden = hidden
                        ? (view.hiddenPropertyIds ?? []).filter((id) => id !== property.id)
                        : [...(view.hiddenPropertyIds ?? []), property.id];
                      updateView({ ...view, hiddenPropertyIds: nextHidden });
                    }}
                  />
                  <span className="pages-db-type">{typeGlyph(property.type)}</span>
                  <span className="flex-1 truncate">{property.name}</span>
                </label>
              );
            })}
          </div>
        </PagePopover>
      ) : null}

      {viewMenu ? (
        <PagePopover anchor={viewMenu} onClose={() => { setViewMenu(null); setSettingsOpen(false); }} width={300}>
          <div className="pages-view-menu">
            <div className="pages-menu-head"><span>View settings</span><button type="button" onClick={() => { setViewMenu(null); setSettingsOpen(false); }}><X size={14} /></button></div>
            <input
              value={pendingViewName}
              onChange={(event) => setPendingViewName(event.target.value)}
              onBlur={() => { if (pendingViewName.trim() && pendingViewName.trim() !== view.name) updateView({ ...view, name: pendingViewName.trim() }); }}
              onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
              placeholder="View name"
            />
            <div className="pages-view-menu-types">
              {(Object.keys(VIEW_META) as DatabaseViewType[]).map((type) => {
                const Icon = VIEW_META[type].icon;
                return (
                  <button
                    key={type}
                    type="button"
                    className={`pages-view-type-choice ${view.type === type ? 'is-active' : ''}`}
                    onClick={() => updateView({ ...view, type })}
                    title={VIEW_META[type].label}
                  >
                    <Icon size={16} />
                    <span>{VIEW_META[type].label}</span>
                  </button>
                );
              })}
            </div>
            {view.type === 'board' ? (
              <label className="pages-view-setting">
                <span>Group by</span>
                <select
                  value={view.boardGroupBy ?? groupProperties[0]?.id ?? ''}
                  onChange={(event) => updateView({ ...view, boardGroupBy: event.target.value || undefined })}
                >
                  {groupProperties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}
                </select>
              </label>
            ) : null}
            {view.type === 'calendar' ? (
              <label className="pages-view-setting">
                <span>Date property</span>
                <select
                  value={view.datePropertyId ?? dateProperty?.id ?? ''}
                  onChange={(event) => updateView({ ...view, datePropertyId: event.target.value || undefined })}
                >
                  {database.properties.filter((property) => property.type === 'date').map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}
                </select>
              </label>
            ) : null}
            <label className="pages-view-setting">
              <span>Default view</span>
              <input
                type="checkbox"
                checked={database.defaultViewId === view.id}
                onChange={() => updateDatabase({ ...database, defaultViewId: view.id })}
              />
            </label>
            <PopoverSeparator />
            <div className="p-1.5">
              <PopoverItem
                label="Duplicate view"
                icon={<Copy size={14} />}
                onClick={() => {
                  const copy = { ...view, id: newId(), name: `${view.name} copy` };
                  updateDatabase({ ...database, views: [...database.views, copy] });
                  setActiveViewId(copy.id);
                  setViewMenu(null);
                }}
              />
              <PopoverItem
                label="Delete view"
                icon={<Trash2 size={14} />}
                danger
                disabled={database.views.length <= 1}
                onClick={() => {
                  const nextViews = database.views.filter((candidate) => candidate.id !== view.id);
                  updateDatabase({
                    ...database,
                    views: nextViews,
                    defaultViewId: database.defaultViewId === view.id ? nextViews[0]?.id : database.defaultViewId,
                  });
                  setActiveViewId(nextViews[0]?.id ?? '');
                  setViewMenu(null);
                }}
              />
            </div>
          </div>
        </PagePopover>
      ) : null}
    </div>
  );
}
