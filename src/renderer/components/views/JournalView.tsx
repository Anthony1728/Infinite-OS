/* Journal & Notes — write freely, get corrected, then learn from it.
 *
 * Three jobs:
 *   1. Keep notes (create, edit, search, delete) that persist across restarts.
 *   2. Watch every note for spelling and grammar slips, and auto-correct them
 *      on demand so the note you save is the note you meant.
 *   3. Log each slip — with the reason it was wrong — into a Learn list, and
 *      mirror spelling slips into Spell Forge so the deck drills them too.
 */
import './JournalView.css';
import { useState, useEffect, useRef, useCallback } from 'react';
import * as J from './journal/store';
import * as SF from './spellforge/store';
import { countWords } from './spellforge/text';
import {
  ensureDictionary,
  checkTextSync,
  applyCorrections,
  type Finding,
  type GrammarFinding,
} from './spellforge/check';

type Tab = 'notes' | 'learn';
type Span = { start: number; end: number; correction: string | null };

interface Issue {
  id: string;
  kind: 'spelling' | 'grammar';
  found: string;
  correction: string | null;
  why: string;
  label: string;
  span: Span;
  count: number;
  suggestions: string[];
}

const SPELLING_TIP =
  'Not in the dictionary. Read the sentence again — the correction below is the closest common word.';

function spellingWhy(f: Finding): string {
  if (f.source === 'curated') {
    return 'A classic slip: this form is a real word, just not the one you meant here.';
  }
  return SPELLING_TIP;
}

function toIssues(spelling: Finding[], grammar: GrammarFinding[]): Issue[] {
  const out: Issue[] = [];
  const seen = new Set<string>();
  for (const f of spelling) {
    const id = 's:' + f.bare;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      kind: 'spelling',
      found: f.raw,
      correction: f.correction,
      why: spellingWhy(f),
      label: 'Spelling',
      span: { start: f.start, end: f.end, correction: f.correction },
      count: f.count,
      suggestions: (f.suggestions || []).slice(1, 4).map((s) => s.word).filter(Boolean),
    });
  }
  for (const g of grammar) {
    const id = 'g:' + g.ruleId + ':' + g.found.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      kind: 'grammar',
      found: g.found,
      correction: g.correction,
      why: g.why,
      label: g.title,
      span: { start: g.start, end: g.end, correction: g.correction },
      count: g.count,
      suggestions: [],
    });
  }
  out.sort((a, b) => a.span.start - b.span.start);
  return out;
}

/** Overlapping spans would corrupt the text, so keep the first of any run. */
function uniqueSpans(issues: Issue[]): Span[] {
  const sorted = issues
    .filter((i) => i.correction)
    .slice()
    .sort((a, b) => a.span.start - b.span.start || a.span.end - b.span.end);
  const kept: Span[] = [];
  for (const s of sorted) {
    if (kept.some((k) => k.start < s.span.end && s.span.start < k.end)) continue;
    kept.push(s.span);
  }
  return kept;
}

export function JournalView() {
  const [tab, setTab] = useState<Tab>('notes');
  const [notes, setNotes] = useState<J.Note[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [search, setSearch] = useState('');
  const [issues, setIssues] = useState<Issue[]>([]);
  const [analysisMs, setAnalysisMs] = useState(0);
  const [dictReady, setDictReady] = useState(false);
  const [autoFix, setAutoFixState] = useState(J.autoFixEnabled());
  const [mistakes, setMistakes] = useState<J.Mistake[]>([]);
  const [stats, setStats] = useState(J.mistakeStats());
  const [toasts, setToasts] = useState<Array<{ id: number; msg: string; kind: string }>>([]);
  const [practice, setPractice] = useState(false);
  const [quizIdx, setQuizIdx] = useState(0);
  const [quizAnswer, setQuizAnswer] = useState('');
  const [quizVerdict, setQuizVerdict] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const toastId = useRef(0);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const loadedRef = useRef(false);

  const addToast = useCallback((msg: string, kind: string = 'info') => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev, { id, msg, kind }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3200);
  }, []);

  const refreshMistakes = useCallback(() => {
    setMistakes(J.pendingMistakes());
    setStats(J.mistakeStats());
  }, []);

  /* ------------------------------------------------------------- bootstrap */
  useEffect(() => {
    let cancelled = false;
    J.load();
    SF.load();
    const active = J.activeNote();
    if (!cancelled) {
      setNotes(J.notes());
      setActiveId(active.id);
      setTitle(active.title);
      setBody(active.body);
      setAutoFixState(J.autoFixEnabled());
      refreshMistakes();
    }
    ensureDictionary().then((ok) => {
      if (cancelled) return;
      setDictReady(ok);
      if (!ok) addToast('Dictionary unavailable — spelling checks are off.', 'warn');
    });
    loadedRef.current = true;
    return () => {
      cancelled = true;
    };
  }, [addToast, refreshMistakes]);

  /* ---------------------------------------------------------------- analyse */
  const analyse = useCallback(
    (text: string) => {
      const personal = new Set<string>(SF.personalList());
      const result = checkTextSync(text, personal);
      setAnalysisMs(result.analysisMs);
      const list = toIssues(result.spelling, result.grammar);
      setIssues(list);

      let changed = false;
      for (const issue of list) {
        const recorded = J.recordMistake({
          kind: issue.kind,
          wrong: issue.found,
          correct: issue.correction || '',
          why: issue.why,
        });
        if (recorded) changed = true;
        if (issue.kind === 'spelling' && issue.correction) {
          SF.recordMisspelling(issue.found.toLowerCase().replace(/['’]/g, ''), issue.correction);
        }
      }
      if (changed) refreshMistakes();
    },
    [refreshMistakes],
  );

  useEffect(() => {
    if (!loadedRef.current) return;
    const t = setTimeout(() => analyse(body), 350);
    return () => clearTimeout(t);
  }, [body, analyse, dictReady]);

  /* ------------------------------------------------------------------ notes */
  const openNote = (note: J.Note) => {
    J.setActiveNote(note.id);
    setActiveId(note.id);
    setTitle(note.title);
    setBody(note.body);
    setIssues([]);
    bodyRef.current?.focus();
  };

  const newNote = () => {
    const note = J.createNote('Untitled note', '');
    setNotes(J.notes());
    openNote(note);
    addToast('New note started.');
  };

  const removeNote = (id: string) => {
    if (!window.confirm('Delete this note?')) return;
    J.deleteNote(id);
    const next = J.notes();
    setNotes(next);
    if (id === activeId) {
      const active = J.activeNote();
      setActiveId(active.id);
      setTitle(active.title);
      setBody(active.body);
    }
    addToast('Note deleted.');
  };

  const persist = (nextTitle: string, nextBody: string) => {
    if (!activeId) return;
    J.updateNote(activeId, { title: nextTitle, body: nextBody });
    setNotes(J.notes());
    setSavedAt(Date.now());
  };

  const onTitleChange = (value: string) => {
    setTitle(value);
    persist(value, body);
  };

  const onBodyChange = (value: string) => {
    setBody(value);
    if (!activeId) return;
    J.updateNote(activeId, { body: value });
    setNotes(J.notes());
  };

  /* ------------------------------------------------------------- correcting */
  const correct = useCallback(
    (targets: Issue[], how: string) => {
      if (!targets.length) {
        addToast('Nothing to correct.', 'warn');
        return 0;
      }
      const { text, applied } = applyCorrections(body, uniqueSpans(targets));
      if (!applied) {
        addToast('Nothing changed.', 'warn');
        return 0;
      }
      setBody(text);
      if (activeId) {
        J.updateNote(activeId, { body: text });
        setNotes(J.notes());
        setSavedAt(Date.now());
      }
      targets.forEach((t) =>
        J.recordMistake(
          {
            kind: t.kind,
            wrong: t.found,
            correct: t.correction || '',
            why: t.why,
          },
          true,
        ),
      );
      refreshMistakes();
      addToast(`${how}: ${applied} correction${applied === 1 ? '' : 's'} applied.`, 'good');
      return applied;
    },
    [activeId, addToast, body, refreshMistakes],
  );

  const fixIssue = (issue: Issue, override?: string) =>
    correct([{ ...issue, correction: override ?? issue.correction }], 'Fixed');
  const fixAll = () => correct(issues, 'Auto-corrected');

  const markFine = (issue: Issue) => {
    if (issue.kind !== 'spelling') return;
    SF.addPersonal(issue.found);
    setIssues((prev) => prev.filter((i) => i.id !== issue.id));
    addToast(`"${issue.found}" added to your dictionary.`, 'good');
  };

  const saveNote = () => {
    persist(title, body);
    if (autoFix && issues.some((i) => i.correction)) {
      correct(issues, 'Saved & auto-corrected');
    } else {
      addToast('Note saved.', 'good');
    }
  };

  const toggleAutoFix = () => {
    const next = !autoFix;
    J.setAutoFix(next);
    setAutoFixState(next);
    addToast(next ? 'Auto-correct on save is ON.' : 'Auto-correct on save is OFF.');
  };

  /* ---------------------------------------------------------------- learn */
  const forget = (key: string) => {
    J.forgetMistake(key);
    refreshMistakes();
  };

  const markLearned = (key: string) => {
    J.markLearned(key, true);
    refreshMistakes();
    addToast('Nice — moved to learned.', 'good');
  };

  const startPractice = () => {
    setPractice(true);
    setQuizIdx(0);
    setQuizAnswer('');
    setQuizVerdict('');
  };

  const quizCards = mistakes.filter((m) => m.correct);
  const currentQuiz = quizCards[quizIdx];

  const submitQuiz = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!currentQuiz) return;
    const given = quizAnswer.trim().toLowerCase().replace(/['’]/g, '');
    const want = currentQuiz.correct.trim().toLowerCase().replace(/['’]/g, '');
    const right = given === want;
    setQuizVerdict(right ? 'Correct.' : `Not quite — it is "${currentQuiz.correct}".`);
    if (right) {
      J.markLearned(currentQuiz.key, true);
      refreshMistakes();
    }
  };

  const nextQuiz = () => {
    setQuizIdx((i) => i + 1);
    setQuizAnswer('');
    setQuizVerdict('');
  };

  const goSpellForge = () => {
    window.dispatchEvent(new CustomEvent('infinite:navigate', { detail: 'spell' }));
  };

  /* ---------------------------------------------------------------- render */
  const query = search.trim().toLowerCase();
  const visibleNotes = query
    ? notes.filter((n) => n.title.toLowerCase().includes(query) || n.body.toLowerCase().includes(query))
    : notes;
  const wordCount = countWords(body);

  return (
    <div className="jn-app">
      <header className="jn-topbar">
        <div className="jn-brand">
          <span className="jn-brand-mark">Journal &amp; Notes</span>
          <span className="jn-brand-sub">write it right, then learn from it</span>
        </div>
        <nav className="jn-nav">
          {([
            { id: 'notes', label: 'Write' },
            { id: 'learn', label: `Learn (${mistakes.length})` },
          ] as Array<{ id: Tab; label: string }>).map((t) => (
            <button
              key={t.id}
              className={`jn-nav-btn${tab === t.id ? ' jn-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="jn-topbar-right">
          <span className="jn-chip">{wordCount} words</span>
          <span className={`jn-chip${issues.length ? ' jn-chip-warn' : ''}`}>
            {issues.length} to fix
          </span>
          <span className="jn-chip">{dictReady ? 'dictionary ready' : 'loading…'}</span>
        </div>
      </header>

      {tab === 'notes' ? (
        <div className="jn-grid animate-fade-in">
          {/* Notes list */}
          <aside className="jn-list">
            <div className="jn-list-head">
              <input
                className="jn-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search notes…"
              />
              <button className="jn-btn jn-btn-primary" onClick={newNote}>
                New
              </button>
            </div>
            <ul className="jn-note-items">
              {visibleNotes.map((n) => (
                <li
                  key={n.id}
                  className={`jn-note-item${n.id === activeId ? ' jn-note-active' : ''}`}
                  onClick={() => openNote(n)}
                >
                  <div className="jn-note-title">{n.title || 'Untitled note'}</div>
                  <div className="jn-note-preview">{n.body.slice(0, 70) || 'Empty note'}</div>
                  <div className="jn-note-meta">
                    {new Date(n.updated).toLocaleDateString()} · {countWords(n.body)} words
                    <button
                      className="jn-x"
                      title="Delete note"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeNote(n.id);
                      }}
                    >
                      ×
                    </button>
                  </div>
                </li>
              ))}
              {visibleNotes.length === 0 && (
                <li className="jn-empty-list">No notes yet. Press New to start.</li>
              )}
            </ul>
          </aside>

          {/* Editor */}
          <main className="jn-editor">
            <input
              className="jn-title"
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              placeholder="Untitled note"
              maxLength={140}
            />
            <textarea
              ref={bodyRef}
              className="jn-body"
              value={body}
              onChange={(e) => onBodyChange(e.target.value)}
              placeholder="Start writing. Misspellings and grammar slips are caught as you go, and saved corrections become lessons."
              spellCheck={false}
              autoFocus
            />
            <div className="jn-editor-foot">
              <div className="jn-counters">
                <span>{wordCount} words</span>
                <span className="jn-dot">·</span>
                <span>{issues.length} issue{issues.length === 1 ? '' : 's'}</span>
                <span className="jn-dot">·</span>
                <span>{analysisMs}ms</span>
                {savedAt && (
                  <>
                    <span className="jn-dot">·</span>
                    <span>saved {new Date(savedAt).toLocaleTimeString()}</span>
                  </>
                )}
              </div>
              <div className="jn-actions">
                <button className="jn-btn" onClick={toggleAutoFix}>
                  Auto-correct on save: {autoFix ? 'On' : 'Off'}
                </button>
                <button className="jn-btn" onClick={fixAll}>
                  Correct all now
                </button>
                <button className="jn-btn jn-btn-primary" onClick={saveNote}>
                  Save
                </button>
              </div>
            </div>
          </main>

          {/* Issues */}
          <aside className="jn-issues">
            <div className="jn-side-head">
              <h2>Corrections</h2>
              <span className="jn-side-sub">
                {dictReady ? `${analysisMs}ms` : 'loading dictionary…'}
              </span>
            </div>
            {!dictReady && (
              <div className="jn-loading">Reading the dictionary so it can spot real misspellings…</div>
            )}
            {dictReady && issues.length === 0 && (
              <div className="jn-clear">✓ Nothing to fix. This note reads clean.</div>
            )}
            <div className="jn-issue-list">
              {issues.map((issue) => (
                <div key={issue.id} className={`jn-issue jn-issue-${issue.kind}`}>
                  <div className="jn-issue-top">
                    <span className="jn-kind">{issue.label}</span>
                    {issue.count > 1 && <span className="jn-times">×{issue.count}</span>}
                  </div>
                  <div className="jn-issue-line">
                    <span className="jn-bad">{issue.found}</span>
                    <span className="jn-arrow">→</span>
                    <span className="jn-good">{issue.correction || 'not sure'}</span>
                  </div>
                  <p className="jn-why">{issue.why}</p>
                  <div className="jn-issue-actions">
                    {issue.correction && (
                      <button className="jn-btn jn-btn-primary" onClick={() => fixIssue(issue)}>
                        Fix
                      </button>
                    )}
                    {issue.suggestions.map((s) => (
                      <button
                        key={s}
                        className="jn-btn jn-btn-ghost"
                        onClick={() => fixIssue(issue, s)}
                      >
                        {s}
                      </button>
                    ))}
                    {issue.kind === 'spelling' && (
                      <button className="jn-btn jn-btn-ghost" onClick={() => markFine(issue)}>
                        This is fine
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </div>
      ) : (
        /* ------------------------------------------------------- Learn view */
        <div className="jn-learn animate-fade-in">
          <div className="jn-learn-head">
            <div>
              <h1>Learn your words</h1>
              <p>
                Everything the journal caught while you wrote. Fix it once here and it stops coming
                back.
              </p>
            </div>
            <div className="jn-learn-actions">
              <button className="jn-btn" onClick={goSpellForge}>
                Open Spell Forge deck
              </button>
              <button
                className="jn-btn jn-btn-primary"
                onClick={startPractice}
                disabled={!quizCards.length}
              >
                Practice ({quizCards.length})
              </button>
            </div>
          </div>

          <div className="jn-stat-row">
            {[
              { label: 'To learn', value: stats.total - stats.learned },
              { label: 'Spelling', value: stats.spelling },
              { label: 'Grammar', value: stats.grammar },
              { label: 'Learned', value: stats.learned },
            ].map((s) => (
              <div key={s.label} className="jn-stat">
                <div className="jn-stat-n">{s.value}</div>
                <div className="jn-stat-l">{s.label}</div>
              </div>
            ))}
          </div>

          {practice && currentQuiz && (
            <div className="jn-quiz">
              <div className="jn-quiz-word">{currentQuiz.wrong}</div>
              <div className="jn-quiz-hint">
                {currentQuiz.kind === 'grammar'
                  ? currentQuiz.why
                  : 'Type the correct spelling.'}
              </div>
              <form
                className="jn-quiz-form"
                onSubmit={(e) => (quizVerdict ? nextQuiz() : submitQuiz(e))}
              >
                <input
                  className="jn-quiz-input"
                  value={quizAnswer}
                  onChange={(e) => {
                    setQuizAnswer(e.target.value);
                    setQuizVerdict('');
                  }}
                  placeholder="your answer…"
                  autoFocus
                />
                <button className="jn-btn jn-btn-primary" type="submit">
                  {quizVerdict ? 'Next' : 'Check'}
                </button>
              </form>
              {quizVerdict && <div className="jn-quiz-verdict">{quizVerdict}</div>}
              <div className="jn-quiz-progress">
                Card {Math.min(quizIdx + 1, quizCards.length)} of {quizCards.length}
                <button className="jn-btn jn-btn-ghost" onClick={() => setPractice(false)}>
                  Leave practice
                </button>
              </div>
            </div>
          )}

          <div className="jn-mistake-list">
            {mistakes.length === 0 && (
              <div className="jn-clear jn-clear-wide">
                Nothing to learn yet — write something with a slip in it and it will show up here
                with the reason it was wrong.
              </div>
            )}
            {mistakes.map((m) => (
              <div key={m.key} className={`jn-mistake jn-mistake-${m.kind}`}>
                <div className="jn-mistake-main">
                  <span className="jn-mistake-kind">
                    {m.kind === 'grammar' ? 'Grammar' : 'Spelling'}
                  </span>
                  <span className="jn-bad">{m.wrong}</span>
                  <span className="jn-arrow">→</span>
                  <span className="jn-good">{m.correct}</span>
                  <span className="jn-times">seen {m.count}×</span>
                </div>
                {m.why && <p className="jn-why">{m.why}</p>}
                <div className="jn-issue-actions">
                  <button className="jn-btn" onClick={() => markLearned(m.key)}>
                    I know this now
                  </button>
                  <button className="jn-btn jn-btn-ghost" onClick={() => forget(m.key)}>
                    Forget
                  </button>
                </div>
              </div>
            ))}
          </div>

          {stats.learned > 0 && (
            <div className="jn-learned-note">
              {stats.learned} word{stats.learned === 1 ? '' : 's'} retired from your list.
            </div>
          )}
        </div>
      )}

      <div className="jn-toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`jn-toast jn-toast-${t.kind}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
