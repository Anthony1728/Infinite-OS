import { useMemo, useState } from 'react';
import { Loader2, Send, Sparkles, X } from 'lucide-react';
import type { DatabaseValue, PageBlock, PageDatabase, PageRecord } from '../../../shared/pages';
import { parseCsv } from '../../../shared/csv';
import { useNotificationStore } from '../../stores/notifications';
import { htmlToPlainText } from './pageUtils';

type AiAction = 'write' | 'continue' | 'rewrite' | 'grammar' | 'summarize' | 'poem' | 'custom' | 'sheet';

interface PagesAiProps {
  page: PageRecord;
  title: string;
  blocks: PageBlock[];
  database?: PageDatabase;
  onClose: () => void;
  onApplyText: (text: string, mode: 'replace' | 'append') => void;
  onApplyRows: (rows: Array<Record<string, DatabaseValue>>) => Promise<void>;
}

const DOC_ACTIONS: Array<{ id: AiAction; label: string; description: string }> = [
  { id: 'write', label: 'Write', description: 'Draft a new section' },
  { id: 'continue', label: 'Continue', description: 'Pick up where the page stops' },
  { id: 'rewrite', label: 'Improve', description: 'Make it clearer and stronger' },
  { id: 'grammar', label: 'Fix grammar', description: 'Polish without changing your voice' },
  { id: 'summarize', label: 'Summarize', description: 'Compress the page into key points' },
  { id: 'poem', label: 'Poem', description: 'Turn the idea into verse' },
  { id: 'custom', label: 'Ask', description: 'Give a precise instruction' },
];

const DB_ACTIONS: Array<{ id: AiAction; label: string; description: string }> = [
  { id: 'sheet', label: 'Generate rows', description: 'Fill the database from a brief' },
  { id: 'summarize', label: 'Summarize table', description: 'Find patterns in the rows' },
  { id: 'custom', label: 'Ask', description: 'Ask about this database' },
];

function databaseContext(database: PageDatabase, page: PageRecord): string {
  const properties = database.properties
    .filter((property) => property.type !== 'formula')
    .map((property) => {
      const options = property.options?.length ? ` [${property.options.map((option) => option.name).join(' | ')}]` : '';
      return `- ${property.name} (${property.type})${options}`;
    })
    .join('\n');
  const title = database.properties.find((property) => property.type === 'title');
  const sampleRows = database.rows.slice(0, 8).map((row) => (
    database.properties.map((property) => `${property.name}: ${String(row.values[property.id] ?? '')}`).join(' · ')
  )).join('\n');
  return [
    `Database: ${page.title}`,
    'Columns:',
    properties,
    title ? `Use "${title.name}" for the row name.` : '',
    sampleRows ? `Sample rows:\n${sampleRows}` : '',
  ].filter(Boolean).join('\n');
}

function parseDatabaseRows(csv: string, database: PageDatabase): Array<Record<string, DatabaseValue>> {
  const table = parseCsv(csv.replace(/^```[a-z]*\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim());
  if (table.length < 2) return [];
  const header = table[0]!.map((cell) => cell.trim().toLowerCase());
  const props = database.properties.filter((property) => property.type !== 'formula' && property.type !== 'relation');
  const columns = props.map((property, index) => {
    const exact = header.indexOf(property.name.trim().toLowerCase());
    return { property, index: exact >= 0 ? exact : index };
  });
  const rows: Array<Record<string, DatabaseValue>> = [];
  for (const raw of table.slice(1)) {
    if (raw.every((cell) => !cell.trim())) continue;
    const values: Record<string, DatabaseValue> = {};
    for (const { property, index } of columns) {
      const text = (raw[index] ?? '').trim();
      if (!text) {
        values[property.id] = property.type === 'multi_select' ? [] : null;
        continue;
      }
      switch (property.type) {
        case 'number': {
          const number = Number(text.replace(/[$,%\s]/g, ''));
          values[property.id] = Number.isFinite(number) ? number : null;
          break;
        }
        case 'checkbox':
          values[property.id] = /^(yes|true|done|checked|1|x)$/i.test(text);
          break;
        case 'select':
        case 'status': {
          const option = property.options?.find((candidate) => candidate.name.toLowerCase() === text.toLowerCase() || candidate.id === text);
          values[property.id] = option?.id ?? null;
          break;
        }
        case 'multi_select': {
          const names = text.split(/[,;]/).map((part) => part.trim().toLowerCase()).filter(Boolean);
          values[property.id] = (property.options ?? [])
            .filter((option) => names.includes(option.name.toLowerCase()) || names.includes(option.id.toLowerCase()))
            .map((option) => option.id);
          break;
        }
        case 'date': {
          const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : (() => {
            const date = new Date(text);
            return Number.isFinite(date.getTime()) ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : null;
          })();
          values[property.id] = normalized;
          break;
        }
        default:
          values[property.id] = text;
      }
    }
    rows.push(values);
    if (rows.length >= 50) break;
  }
  return rows;
}

export function PagesAi({
  page,
  title,
  blocks,
  database,
  onClose,
  onApplyText,
  onApplyRows,
}: PagesAiProps) {
  const isDatabase = page.kind === 'database' && Boolean(database);
  const actions = isDatabase ? DB_ACTIONS : DOC_ACTIONS;
  const [action, setAction] = useState<AiAction>(isDatabase ? 'sheet' : 'write');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ text: string; provider: string; model: string } | null>(null);
  const [applying, setApplying] = useState(false);
  const selectedAction = actions.find((candidate) => candidate.id === action) ?? actions[0]!;

  const pageText = useMemo(() => {
    const lines = blocks
      .map((block) => {
        if (block.type === 'divider') return '---';
        if (block.type === 'table' && block.table) {
          return [block.table.headers.join(' | '), ...block.table.rows.map((row) => row.join(' | '))].join('\n');
        }
        return htmlToPlainText(block.html);
      })
      .filter(Boolean)
      .join('\n');
    return [title, lines].filter(Boolean).join('\n\n').slice(0, 14_000);
  }, [blocks, title]);

  const generatedRows = useMemo(() => {
    if (!isDatabase || !database || !result || action !== 'sheet') return [];
    try {
      return parseDatabaseRows(result.text, database);
    } catch {
      return [];
    }
  }, [action, database, isDatabase, result]);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const context = isDatabase && database ? databaseContext(database, page) : pageText;
      let effectivePrompt = prompt.trim();
      let effectiveAction: AiAction = action;
      if (action === 'grammar') effectivePrompt = 'Correct the spelling, grammar, punctuation, and awkward phrasing in the supplied page. Preserve the author\'s voice and meaning. Return only the corrected text.';
      if (action === 'summarize' && !effectivePrompt) effectivePrompt = isDatabase ? 'Summarize the key patterns, gaps, and next actions in this database.' : 'Summarize this page in a compact set of useful key points.';
      if (action === 'rewrite' && !effectivePrompt) effectivePrompt = 'Rewrite this page so it is clearer, tighter, and stronger while preserving its meaning.';
      if (action === 'sheet') {
        if (!database) return;
        const columns = database.properties
          .filter((property) => property.type !== 'formula' && property.type !== 'relation')
          .map((property) => `${property.name} (${property.type}${property.options?.length ? `: ${property.options.map((option) => option.name).join(' / ')}` : ''})`)
          .join(', ');
        effectivePrompt = [
          'Populate this database with useful, realistic rows.',
          `Brief: ${prompt.trim() || 'Create a thoughtful starter set of 8 rows that demonstrate how this database is used.'}`,
          `Return only RFC-4180 CSV with a header row. Use exactly these columns in order: ${columns}.`,
          'Use one of the listed option names for select/status fields. Use YYYY-MM-DD for dates. No code fences, no prose.',
        ].join('\n');
        effectiveAction = 'sheet';
        setAction('sheet');
      }
      if (!effectivePrompt) effectivePrompt = 'Write something useful for this page.';
      const response = await window.api.studioAi({
        action: effectiveAction === 'sheet' ? 'sheet' : effectiveAction,
        kind: effectiveAction === 'sheet' ? 'sheet' : 'document',
        prompt: effectivePrompt,
        context: action === 'sheet' ? `Current database columns and context:\n${context}` : context,
      }) as { text: string; provider: string; model: string };
      const text = response.text?.trim();
      if (!text) throw new Error('The model returned an empty response. Try again.');
      setResult({ ...response, text });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'AI could not finish that.');
    } finally {
      setBusy(false);
    }
  };

  const applyText = (mode: 'replace' | 'append') => {
    if (!result) return;
    onApplyText(result.text, mode);
    onClose();
  };

  const applyRows = async () => {
    if (!generatedRows.length) return;
    setApplying(true);
    try {
      await onApplyRows(generatedRows);
      useNotificationStore.getState().addToast({ type: 'success', title: `${generatedRows.length} rows added` });
      onClose();
    } finally {
      setApplying(false);
    }
  };

  return (
    <aside className="pages-ai-panel">
      <div className="pages-ai-head">
        <div className="flex items-center gap-2">
          <span className="pages-ai-orb"><Sparkles size={14} /></span>
          <div>
            <div className="pages-ai-title">Pages AI</div>
            <div className="pages-ai-subtitle">Writes with your connected model</div>
          </div>
        </div>
        <button type="button" className="pages-icon-button small" onClick={onClose}><X size={15} /></button>
      </div>

      <div className="pages-ai-actions">
        {actions.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            className={`pages-ai-action ${action === candidate.id ? 'is-active' : ''}`}
            onClick={() => { setAction(candidate.id); setResult(null); setError(null); }}
          >
            <span>{candidate.label}</span>
            <small>{candidate.description}</small>
          </button>
        ))}
      </div>

      <div className="pages-ai-prompt">
        <label htmlFor="pages-ai-prompt-input">{selectedAction.description}</label>
        <textarea
          id="pages-ai-prompt-input"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={isDatabase
            ? 'Describe the rows you want, e.g. “10 launch tasks across design, engineering, and marketing, due over the next month”'
            : action === 'write' ? 'What should this page become? Add details, audience, tone, and structure…'
              : action === 'custom' ? 'Tell the AI exactly what to do with this page…'
                : 'Optional: add direction for the AI…'}
          rows={4}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              void run();
            }
          }}
        />
        <div className="pages-ai-run-row">
          <span><kbd>⌘</kbd> <kbd>↵</kbd></span>
          <button type="button" className="pages-ai-run" disabled={busy || (isDatabase && action === 'sheet' && !database)} onClick={() => void run()}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {busy ? 'Thinking…' : isDatabase && action === 'sheet' ? 'Generate rows' : 'Generate'}
          </button>
        </div>
      </div>

      {error ? <div className="pages-ai-error">{error}</div> : null}

      {result ? (
        <div className="pages-ai-result">
          <div className="pages-ai-result-head">
            <span>Result</span>
            <span className="pages-ai-model">{result.provider} · {result.model}</span>
          </div>
          {isDatabase && action === 'sheet' ? (
            generatedRows.length ? (
              <>
                <div className="pages-ai-row-preview">
                  <table>
                    <thead>
                      <tr>
                        {database?.properties.filter((property) => property.type !== 'formula' && property.type !== 'relation').map((property) => (
                          <th key={property.id}>{property.name}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {generatedRows.slice(0, 6).map((row, index) => (
                        <tr key={index}>
                          {database?.properties.filter((property) => property.type !== 'formula' && property.type !== 'relation').map((property) => (
                            <td key={property.id}>{String(row[property.id] ?? '')}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="pages-ai-result-meta">
                  {generatedRows.length} row{generatedRows.length === 1 ? '' : 's'} ready to add
                </div>
                <button type="button" className="pages-ai-apply" disabled={applying} onClick={() => void applyRows()}>
                  {applying ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  Add {generatedRows.length} rows
                </button>
              </>
            ) : (
              <div className="pages-ai-parse-error">
                The model returned data that could not be mapped to these columns. Try a more specific brief, or ask for a table with exact column names.
              </div>
            )
          ) : (
            <>
              <div className="pages-ai-preview custom-scrollbar">{result.text}</div>
              <div className="pages-ai-apply-row">
                <button type="button" className="pages-ai-apply" onClick={() => applyText('append')}>
                  <Sparkles size={14} /> Append to page
                </button>
                <button type="button" className="pages-secondary-button" onClick={() => applyText('replace')}>
                  Replace page
                </button>
              </div>
              <div className="pages-ai-hint">Append is safest. Replace rewrites the entire page body.</div>
            </>
          )}
        </div>
      ) : null}

      {!result && !busy ? (
        <div className="pages-ai-empty">
          <div className="pages-ai-empty-glyph">✦</div>
          <p>AI works on the page you can see. Nothing changes until you press Apply.</p>
        </div>
      ) : null}
    </aside>
  );
}
