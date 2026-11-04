import { useState } from 'react';
import { Clock3, RotateCcw, Save } from 'lucide-react';
import type { PageRecord } from '../../../shared/pages';
import { usePagesStore } from '../../stores/pages';
import { formatDateTime, htmlToPlainText } from './pageUtils';

export function PageHistory({
  page,
  onClose,
  onRestored,
}: {
  page: PageRecord;
  onClose: () => void;
  onRestored: (page: PageRecord) => void;
}) {
  const saveVersion = usePagesStore((state) => state.saveVersion);
  const restoreVersion = usePagesStore((state) => state.restoreVersion);
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const versions = [...page.versions].sort((a, b) => b.at - a.at);

  const restore = async (versionId: string) => {
    setBusy(true);
    try {
      await restoreVersion(page.id, versionId);
      const restored = usePagesStore.getState().pages[page.id];
      if (restored) onRestored(restored);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pages-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="pages-modal pages-history-modal">
        <div className="pages-modal-head">
          <div>
            <h2>Version history</h2>
            <p>Every restore creates a fresh snapshot, so nothing is ever lost.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="pages-secondary-button"
              disabled={busy}
              onClick={() => { setBusy(true); void saveVersion(page.id).finally(() => setBusy(false)); }}
            >
              <Save size={14} /> Save current
            </button>
            <button type="button" className="pages-icon-button" onClick={onClose}>×</button>
          </div>
        </div>
        <div className="pages-history-list custom-scrollbar">
          {versions.length === 0 ? (
            <div className="pages-history-empty">
              <Clock3 size={26} />
              <h3>No snapshots yet</h3>
              <p>Save a version before a big rewrite, or let automatic snapshots collect as you work.</p>
            </div>
          ) : versions.map((version, index) => {
            const excerpt = version.blocks
              .map((block) => htmlToPlainText(block.html))
              .filter(Boolean)
              .join(' ')
              .slice(0, 240);
            return (
              <article key={version.id} className="pages-history-item">
                <div className="pages-history-rail">
                  <span className="pages-history-dot" />
                  {index < versions.length - 1 ? <span className="pages-history-line" /> : null}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="pages-history-title-row">
                    <strong>{version.title}</strong>
                    <span className={`pages-history-badge ${version.reason === 'manual' ? 'is-manual' : ''}`}>{version.reason}</span>
                  </div>
                  <div className="pages-history-meta">{formatDateTime(version.at)} · {version.blocks.length} blocks · {version.author}</div>
                  {excerpt ? <p className="pages-history-excerpt">{excerpt}…</p> : null}
                  <div className="pages-history-actions">
                    {confirmId === version.id ? (
                      <>
                        <button type="button" className="pages-danger-button" disabled={busy} onClick={() => void restore(version.id)}>
                          <RotateCcw size={13} /> Confirm restore
                        </button>
                        <button type="button" className="pages-text-button" onClick={() => setConfirmId(null)}>Cancel</button>
                      </>
                    ) : (
                      <button type="button" className="pages-secondary-button" onClick={() => setConfirmId(version.id)}>
                        <RotateCcw size={13} /> Restore this version
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
