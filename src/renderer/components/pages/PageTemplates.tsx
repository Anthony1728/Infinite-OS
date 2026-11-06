import { useState } from 'react';
import { ArrowRight, Database, FileText, Sparkles } from 'lucide-react';
import { PAGE_TEMPLATES, type PageTemplateId, type PageTemplateInfo } from '../../../shared/pages';
import { usePagesStore } from '../../stores/pages';

const ACCENTS: Record<string, string> = {
  zinc: 'linear-gradient(135deg, #27272a, #52525b)',
  sky: 'linear-gradient(135deg, #0c4a6e, #0ea5e9)',
  violet: 'linear-gradient(135deg, #3b0764, #8b5cf6)',
  emerald: 'linear-gradient(135deg, #064e3b, #10b981)',
  amber: 'linear-gradient(135deg, #451a03, #f59e0b)',
  rose: 'linear-gradient(135deg, #4c0519, #f43f5e)',
  orange: 'linear-gradient(135deg, #431407, #f97316)',
};

export function PageTemplates({
  parentId,
  onClose,
}: {
  parentId?: string | null;
  onClose: () => void;
}) {
  const createFromTemplate = usePagesStore((state) => state.createFromTemplate);
  const [filter, setFilter] = useState<'all' | 'page' | 'database'>('all');
  const [busy, setBusy] = useState<PageTemplateId | null>(null);
  const templates = PAGE_TEMPLATES.filter((template) => filter === 'all' || template.kind === filter);

  const create = async (template: PageTemplateInfo) => {
    setBusy(template.id);
    try {
      await createFromTemplate(template.id, parentId ?? null);
      onClose();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="pages-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="pages-modal pages-template-modal">
        <div className="pages-modal-head">
          <div>
            <div className="pages-eyebrow"><Sparkles size={12} /> Curated starting points</div>
            <h2>Create something beautiful</h2>
            <p>Every template is a real, editable page or database — no lock-in.</p>
          </div>
          <button type="button" className="pages-icon-button" onClick={onClose}>×</button>
        </div>
        <div className="pages-template-toolbar">
          <div className="pages-segmented">
            {(['all', 'page', 'database'] as const).map((value) => (
              <button key={value} type="button" className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)}>
                {value === 'all' ? 'All templates' : value === 'page' ? 'Notes' : 'Databases'}
              </button>
            ))}
          </div>
          <span>{templates.length} templates</span>
        </div>
        <div className="pages-template-grid custom-scrollbar">
          {templates.map((template) => (
            <button
              key={template.id}
              type="button"
              className="pages-template-card"
              disabled={busy !== null}
              onClick={() => void create(template)}
            >
              <div className="pages-template-cover" style={{ background: ACCENTS[template.accent] ?? ACCENTS.zinc }}>
                <span className="pages-template-icon">{template.icon}</span>
                <span className="pages-template-kind">
                  {template.kind === 'database' ? <Database size={11} /> : <FileText size={11} />}
                  {template.kind === 'database' ? 'Database' : 'Note'}
                </span>
              </div>
              <div className="pages-template-body">
                <div className="pages-template-title">
                  {template.name}
                  <ArrowRight size={14} />
                </div>
                <p>{template.description}</p>
                {busy === template.id ? <span className="pages-template-loading">Creating…</span> : null}
              </div>
            </button>
          ))}
        </div>
        <div className="pages-template-footer">
          <span>Tip: press <kbd>/</kbd> in any page to insert a database, callout, or nested page.</span>
        </div>
      </div>
    </div>
  );
}
