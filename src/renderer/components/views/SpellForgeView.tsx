/* SpellForge — the main React component.
 * A fun spelling tutor: write, get corrected, learn, and level up.
 */
import './SpellForgeView.css';
import { useState, useEffect, useRef, useCallback } from 'react';
import { countWords } from './spellforge/text';
import { TRICKY, PROMPTS } from './spellforge/data';
import * as SF from './spellforge/store';
import type { Entry, WordRecord } from './spellforge/store';
import { ensureDictionary, checkTextSync, type Finding } from './spellforge/check';

type Suggestion = { word: string; dist: number; score: number };
type ActivityDay = { day: string; words: number; weekday: number };
type ViewId = 'write' | 'deck' | 'drill' | 'library' | 'progress';

const ACHIEVEMENTS = SF.achievementList;
type Achievement = (typeof ACHIEVEMENTS)[number];
type AchievementState = Achievement & { earned: boolean };

/* ---------- Helpers ---------- */

function esc(s: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  return String(s).replace(/[&<>"]/g, (c) => map[c]);
}

function formatTime(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function randomPrompt(): string {
  return PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
}

/* ---------- Sub-components ---------- */

function Toast({ msg, kind, onDone }: { msg: string; kind: string; onDone?: () => void }) {
  useEffect(() => {
    const t = setTimeout(() => { if (onDone) onDone(); }, 2600);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className={`sf-toast sf-toast-${kind}`}>
      <span>{kind === 'good' ? '✨' : kind === 'warn' ? '⚠' : '💡'} {msg}</span>
    </div>
  );
}

/* ---------- Main View ---------- */

export function SpellForgeView() {
  const [view, setView] = useState<ViewId>('write');
  const [editorText, setEditorText] = useState('');
  const [title, setTitle] = useState('');
  const [findings, setFindings] = useState<Finding[]>([]);
  const [analysisMs, setAnalysisMs] = useState(0);
  const [startedAt] = useState(Date.now());
  const [toasts, setToasts] = useState<Array<{ msg: string; kind: string; id: number }>>([]);
  const [levelInfo, setLevelInfo] = useState(SF.level());
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const [dictReady, setDictReady] = useState(false);

  const [deckCards, setDeckCards] = useState<WordRecord[]>([]);
  const [deckIdx, setDeckIdx] = useState(0);
  const [deckFlipped, setDeckFlipped] = useState(false);
  const [drillCards, setDrillCards] = useState<WordRecord[]>([]);
  const [drillIdx, setDrillIdx] = useState(0);
  const [drillAnswer, setDrillAnswer] = useState('');
  const [drillLocked, setDrillLocked] = useState(false);
  const [drillVerdict, setDrillVerdict] = useState('');

  const [inkSearch, setInkSearch] = useState('');
  const [personalInput, setPersonalInput] = useState('');
  const [stats, setStats] = useState(SF.stats());
  const [achievementStates, setAchievementStates] = useState<AchievementState[]>(
    ACHIEVEMENTS.map((a) => ({ ...a, earned: false })),
  );

  const editorRef = useRef<HTMLTextAreaElement>(null);
  const toastId = useRef(0);

  const addToast = useCallback((msg: string, kind: string = 'info') => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev, { msg, kind, id }]);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /* Initialize */
  useEffect(() => {
    let cancelled = false;
    try {
      SF.load();
      setLevelInfo(SF.level());
      setStats(SF.stats());
      setAchievementStates(
        ACHIEVEMENTS.map((a) => ({ ...a, earned: SF.achievementIds().indexOf(a.id) !== -1 })),
      );
      const entry = SF.activeEntry();
      setEditorText(entry.text || '');
      setTitle(entry.title || '');
      setActiveEntryId(entry.id);
      ensureDictionary().then((ok) => {
        if (cancelled) return;
        setDictReady(ok);
        analyzeEditor(entry.text || '');
      });
    } catch (e) {
      console.error('SpellForge init error:', e);
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const analyzeEditor = useCallback((text: string) => {
    const personal = new Set<string>(SF.personalList());
    const result = checkTextSync(text, personal);
    setFindings(result.spelling);
    setAnalysisMs(result.analysisMs);
    const realFindings = result.spelling.filter((f: Finding) => f.source !== 'personal');
    realFindings.forEach((f: Finding) => SF.recordMisspelling(f.bare, f.correction));
    setLevelInfo(SF.level());
  }, []);

  /* Auto-analyze on edit */
  useEffect(() => {
    const handler = setTimeout(() => {
      analyzeEditor(editorText);
      if (activeEntryId) {
        SF.saveEntry(activeEntryId, { text: editorText, title });
      }
    }, 400);
    return () => clearTimeout(handler);
  }, [editorText, title, activeEntryId, analyzeEditor, dictReady]);

  /* ---------- Handlers ---------- */

  const handleCommit = () => {
    const entry = SF.activeEntry();
    const wordCount = countWords(editorText);
    const left = findings.filter((f: Finding) => f.source !== 'personal');
    SF.saveEntry(entry.id, { text: editorText, title, words: wordCount, findings: left });
    SF.recordWrite(wordCount, left);
    const gained = SF.checkAchievements();
    gained.forEach((id: string) => {
      const ach = ACHIEVEMENTS.find((a) => a.id === id);
      if (ach) addToast(`🏆 Achievement: ${ach.name}!`, 'good');
    });
    addToast(`Saved. ${wordCount} words written.`, gained.length ? ` and ${gained.length} achievement(s)!` : '');
    setStats(SF.stats());
  };

  const handleFixWord = (bare: string, correction: string) => {
    const targets: [number, number][] = [];
    for (let i = 0; i < findings.length; i++) {
      const f = findings[i];
      if (f.bare !== bare) continue;
      for (let j = 0; j < f.occurrences.length; j++) {
        targets.push([f.occurrences[j], f.end]);
      }
    }
    targets.sort((a, b) => b[0] - a[0]);
    let text = editorText;
    for (let n = 0; n < targets.length; n++) {
      text = text.slice(0, targets[n][0]) + correction + text.slice(targets[n][1]);
    }
    setEditorText(text);
    SF.recordFix(bare, correction, true);
    if (activeEntryId) SF.saveEntry(activeEntryId, { text });
    setFindings(findings.filter((f: Finding) => f.bare !== bare));
    addToast(`Fixed "${bare}" → "${correction}"`, 'good');
  };

  const handleFixAll = () => {
    const fixes = findings.filter((f: Finding) => f.correction);
    if (!fixes.length) { addToast('Nothing to fix.', 'warn'); return; }
    let text = editorText;
    const targets: [number, number, string][] = [];
    for (let i = 0; i < fixes.length; i++) {
      const f = fixes[i];
      if (!f.correction) continue;
      for (let j = 0; j < f.occurrences.length; j++) {
        targets.push([f.occurrences[j], f.end, f.correction]);
      }
    }
    targets.sort((a, b) => b[0] - a[0]);
    for (let n = 0; n < targets.length; n++) {
      text = text.slice(0, targets[n][0]) + targets[n][2] + text.slice(targets[n][1]);
    }
    setEditorText(text);
    fixes.forEach((f: Finding) => SF.recordFix(f.bare, f.correction, true));
    if (activeEntryId) SF.saveEntry(activeEntryId, { text });
    const n = fixes.reduce((s: number, f: Finding) => s + f.occurrences.length, 0);
    addToast(`Fixed ${n} word${n !== 1 ? 's' : ''}.`, 'good');
    setFindings(findings.filter((f: Finding) => !f.correction));
    setStats(SF.stats());
  };

  const handleMarkFine = (bare: string) => {
    SF.addPersonal(bare);
    addToast(`"${bare}" added to your words.`, 'good');
    setFindings(findings.filter((f: Finding) => f.bare !== bare));
  };

  const handlePersonalAdd = () => {
    const w = personalInput.trim();
    if (!w) return;
    if (SF.addPersonal(w)) { addToast(`"${w}" added to your words.`, 'good'); setPersonalInput(''); }
    else { addToast(`"${w}" is already in your words.`); }
  };

  const handlePersonalRemove = (w: string) => {
    SF.removePersonal(w);
    addToast(`"${w}" removed.`);
  };

  const handleNewEntry = () => {
    const e = SF.newEntry('');
    setEditorText('');
    setTitle('');
    setActiveEntryId(e.id);
    SF.saveEntry(e.id, { text: '' });
    setFindings([]);
    addToast('New entry started.', 'info');
  };

  const handleOpenEntry = (e: Entry) => {
    SF.setActive(e.id);
    setEditorText(e.text || '');
    setTitle(e.title || '');
    setActiveEntryId(e.id);
    analyzeEditor(e.text || '');
  };

  const handleDeleteEntry = (id: string) => {
    if (!confirm('Delete this entry?')) return;
    SF.deleteEntry(id);
    addToast('Entry deleted.');
  };

  const handlePromptClick = (prompt: string) => {
    setEditorText(prompt + '\n\n');
    setTitle('Prompt');
    if (activeEntryId) SF.saveEntry(activeEntryId, { text: prompt + '\n\n' });
    addToast('Prompt copied!', 'good');
  };

  /* ---------- Deck ---------- */

  const loadDeck = () => {
    const due = SF.dueWords();
    const seen = new Set<string>();
    const out = [];
    for (let i = 0; i < due.length; i++) {
      if (seen.has(due[i].word)) continue;
      seen.add(due[i].word);
      out.push(due[i]);
    }
    setDeckCards(out);
    setDeckIdx(0);
    setDeckFlipped(false);
  };

  useEffect(() => {
    if (view === 'deck') loadDeck();
  }, [view]);

  const handleDeckGrade = (wasCorrect: boolean) => {
    if (deckIdx >= deckCards.length) return;
    const rec = deckCards[deckIdx];
    SF.recordFix(rec.word, rec.correct || rec.word, wasCorrect);
    setDeckIdx((prev) => prev + 1);
    setDeckFlipped(false);
    setStats(SF.stats());
    addToast(wasCorrect ? '✅ Correct!' : `💔 It's "${rec.correct || rec.word}"`, wasCorrect ? 'good' : 'warn');
  };

  /* ---------- Drill ---------- */

  const loadDrill = () => {
    const due = SF.dueWords();
    const seen = new Set<string>();
    const out = [];
    for (let i = 0; i < due.length; i++) {
      if (seen.has(due[i].word)) continue;
      seen.add(due[i].word);
      out.push(due[i]);
    }
    setDrillCards(out);
    setDrillIdx(0);
    setDrillAnswer('');
    setDrillLocked(false);
    setDrillVerdict('');
  };

  useEffect(() => {
    if (view === 'drill') loadDrill();
  }, [view]);

  const handleDrillSubmit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (drillIdx >= drillCards.length) return;
    const rec = drillCards[drillIdx];
    const given = drillAnswer.trim().toLowerCase();
    const want = (rec.correct || rec.word).toLowerCase();
    const right = given === want;
    setDrillLocked(true);
    setDrillVerdict(right ? '✅ Correct!' : `💔 It's "${rec.correct || rec.word}"`);
    SF.recordFix(rec.word, rec.correct || rec.word, right);
    setStats(SF.stats());
    if (!right) addToast(`It's "${rec.correct || rec.word}"`, 'warn');
  };

  const advanceDrill = () => {
    const next = drillIdx + 1;
    setDrillIdx(next);
    setDrillAnswer('');
    setDrillLocked(false);
    setDrillVerdict('');
  };

  /* ---------- Progress ---------- */

  useEffect(() => {
    if (view === 'progress') {
      setAchievementStates(
        ACHIEVEMENTS.map((a) => ({ ...a, earned: SF.achievementIds().indexOf(a.id) !== -1 })),
      );
    }
  }, [view]);

  const renderProgress = () => {
    const lv = SF.level();
    const act = SF.recentActivity(14);
    const peak = Math.max(1, ...act.map((a: ActivityDay) => a.words));
    const today = SF.dayKey();
    const problems = SF.topProblemWords(8);
    const achStates = achievementStates;
    const nextName = SF.levelNames[lv.index + 1]?.name || '';

    return (
      <div className="sf-prog-grid">
        <div className="sf-card sf-card-level">
          <div className="sf-level-row">
            <div>
              <div className="sf-level-name">{lv.name}</div>
              <div className="sf-muted sf-level-next">
                {lv.next ? `${lv.next - lv.xp} XP to ${nextName}` : 'The top of the forge.'}
              </div>
            </div>
            <div className="sf-level-xp">{lv.xp} XP</div>
          </div>
          <div className="sf-bar"><div className="sf-bar-fill" style={{ width: `${lv.fraction * 100}%` }} /></div>
        </div>

        <div className="sf-card">
          <h3>Last 14 days</h3>
          <div className="sf-heat">
            {act.map((a: ActivityDay, i: number) => (
              <div key={i} className={`sf-heat-day lvl${a.words > peak * 0.66 ? 4 : a.words > peak * 0.33 ? 3 : a.words > peak * 0.1 ? 2 : a.words > 0 ? 1 : 0}${a.day === today ? ' sf-today' : ''}`} title={`${a.day}: ${a.words} words`} />
            ))}
          </div>
          <div className="sf-stat-row">
            {[
              [`${lv.xp} XP`, 'total'],
              [`${SF.stats().streak} day${SF.stats().streak !== 1 ? 's' : ''}`, 'streak'],
              [`${SF.stats().bestStreak}d best`, 'best'],
              [`${SF.learnedWords().length} words learned`, 'learned'],
            ].map(([val, key]) => (
              <div key={key} className="sf-stat"><span className="sf-stat-n">{val}</span><span className="sf-stat-l">{key}</span></div>
            ))}
          </div>
        </div>

        <div className="sf-card">
          <h3>Words to work on</h3>
          <ul className="sf-problem-list">
            {problems.length === 0 && <li className="sf-muted">Nothing yet. Misspell something and it lands here.</li>}
            {problems.map((p: WordRecord, i: number) => (
              <li key={i}>
                <span className="sf-w">{p.word}</span> → <span className="sf-c">{p.correct}</span> <span className="sf-n">×{p.errors}</span>
                <button onClick={() => { /* forget */ }} className="sf-x-btn" title="Forget">×</button>
              </li>
            ))}
          </ul>
        </div>

        <div className="sf-card sf-card-wide">
          <h3>Achievements</h3>
          <div className="sf-ach-grid">
            {achStates.map((a, i) => (
              <div key={i} className={`sf-ach${a.earned ? ' sf-ach-on' : ''}`}>
                <div className="sf-ach-n">{a.earned ? '🏆' : '🌟'} {a.name}</div>
                <div className="sf-ach-h">{a.hint}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="sf-card sf-card-wide">
          <h3>Your data</h3>
          <div className="sf-data-actions">
            <button onClick={() => { const blob = new Blob([SF.exportJSON()], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'spellforge-backup.json'; a.click(); URL.revokeObjectURL(url); addToast('Backup saved.', 'good'); }} className="sf-btn">Export backup</button>
            <button onClick={() => { if (!confirm('Erase everything? This cannot be undone.')) return; SF.resetAll(); addToast('Everything erased.'); setStats(SF.stats()); setAchievementStates(ACHIEVEMENTS.map((a) => ({ ...a, earned: false }))); }} className="sf-btn sf-btn-danger">Erase everything</button>
          </div>
        </div>
      </div>
    );
  };

  /* ---------- Render ---------- */

  const sortedFindings = [...findings].sort(
    (a: Finding, b: Finding) => b.count - a.count || (a.bare < b.bare ? -1 : 1),
  );
  const realFindings = findings.filter((f: Finding) => f.source !== 'personal');

  return (
    <div className="sf-app">
      {/* Header */}
      <header className="sf-topbar">
        <div className="sf-brand">
          <span className="sf-brand-mark">🔤 SpellForge</span>
          <span className="sf-brand-sub">a quiet place to write correctly</span>
        </div>
        <nav className="sf-nav">
          {[
            { id: 'write', label: '✏️ Write' },
            { id: 'deck', label: '🃏 Deck' },
            { id: 'drill', label: '💪 Drill' },
            { id: 'library', label: '📚 Library' },
            { id: 'progress', label: '📊 Progress' },
          ].map((v) => (
            <button key={v.id} className={`sf-nav-btn${view === v.id ? ' sf-active' : ''}`} onClick={() => setView(v.id as ViewId)}>
              {v.label}
            </button>
          ))}
        </nav>
        <div className="sf-topbar-right">
          <span className="sf-chip sf-chip-level">{levelInfo.name}</span>
          <span className="sf-chip sf-chip-streak">{stats.streak > 0 ? `${stats.streak}d 🔥` : ''}</span>
          <span className="sf-chip">{stats.xp} XP</span>
        </div>
      </header>

      {/* Write View */}
      {view === 'write' && (
        <div className="sf-write-grid animate-fade-in">
          <div className="sf-write-main">
            <input className="sf-title-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Untitled entry" maxLength={120} />
            <div className="sf-editor-wrap">
              <textarea ref={editorRef} className="sf-editor" value={editorText} onChange={(e) => setEditorText(e.target.value)}
                placeholder="Start writing. The forge watches quietly and only speaks up when it is sure." autoFocus />
            </div>
            <div className="sf-write-foot">
              <div className="sf-counters">
                <span>{countWords(editorText)} words</span>
                <span className="sf-dot">·</span>
                <span>{realFindings.length} to fix</span>
                <span className="sf-dot">·</span>
                <span>{formatTime(Date.now() - startedAt)}</span>
              </div>
              <div className="sf-write-actions">
                <button className="sf-btn sf-btn-ghost" onClick={handleNewEntry}>New entry</button>
                <button className="sf-btn sf-btn-ghost" onClick={() => handlePromptClick(randomPrompt())}>💡 Prompt</button>
                <button className="sf-btn sf-btn-primary" onClick={handleFixAll}>Fix All</button>
                <button className="sf-btn sf-btn-primary" onClick={handleCommit}>💾 Save</button>
              </div>
            </div>
          </div>
          <aside className="sf-write-side">
            <div className="sf-side-head">
              <h2>The Forge</h2>
              <span className="sf-side-sub">{analysisMs}ms</span>
            </div>
            <div className="sf-findings">
              {findings.length === 0 ? (
                <div className="sf-all-clear">✓ Nothing to raise. The forge stays quiet.</div>
              ) : (
                sortedFindings.map((f: Finding, i: number) => (
                  <div key={i} className="sf-finding">
                    <div className="sf-finding-main">
                      <span className="sf-bad">{esc(f.raw)}</span>
                      <span className="sf-arrow">→ {f.correction || 'not sure'}</span>
                      {f.count > 1 && <span className="sf-sub">×{f.count}</span>}
                      {f.correction && <button className="sf-x-btn" onClick={() => handleFixWord(f.bare, f.correction as string)} title="Fix this everywhere">↵</button>}
                    </div>
                    {f.source === 'personal' ? (
                      <div className="sf-sub">In your personal dictionary.</div>
                    ) : (
                      <>
                        {f.suggestions && f.suggestions.length > 1 && f.suggestions.slice(1, 4).map((s: Suggestion, j: number) => (
                          <button key={j} className="sf-alt" onClick={() => handleFixWord(f.bare, s.word)}>{s.word}</button>
                        ))}
                        <div className="sf-sub">
                          {f.confidence != null && f.confidence < 0.7 ? 'fairly sure' : f.confidence != null && f.confidence >= 0.7 ? 'sure' : ''}
                          {f.correction && ` · ${sfPhonetic(f.correction)}`}
                          {f.correction && ` · ${sfMnemonic(f.correction)}`}
                        </div>
                        {f.source !== 'curated' && <button className="sf-alt" onClick={() => handleMarkFine(f.bare)}>this is fine</button>}
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>
      )}

      {/* Deck View */}
      {view === 'deck' && (
        <div className="sf-page sf-page-narrow animate-slide-up">
          <div className="sf-page-head"><h1>🃏 Deck</h1><p className="sf-page-note">Most-forgotten first. Say the word out loud, then turn it over.</p></div>
          <div className="sf-deck-body">
            {deckCards.length === 0 ? (
              <div className="sf-empty"><h3>Nothing due.</h3><p>Cards appear as you misspell words.</p><button className="sf-btn sf-btn-primary" onClick={loadDeck}>Check again</button></div>
            ) : deckIdx >= deckCards.length ? (
              <div className="sf-empty"><h3>Deck cleared.</h3><p>You worked through {deckCards.length} card{deckCards.length !== 1 ? 's' : ''}.</p><button className="sf-btn sf-btn-primary" onClick={loadDeck}>Check again</button></div>
            ) : (
              <div className="sf-card-face">
                <div className="sf-card-word sf-typo">{deckCards[deckIdx].word}</div>
                {deckFlipped ? (
                  <>
                    <div className="sf-card-answer">{deckCards[deckIdx].correct || deckCards[deckIdx].word}</div>
                    <div className="sf-card-hint">{sfPhonetic(deckCards[deckIdx].correct || deckCards[deckIdx].word)}</div>
                    <div className="sf-card-note">{sfMnemonic(deckCards[deckIdx].correct || deckCards[deckIdx].word)}</div>
                  </>
                ) : (
                  <div className="sf-card-hint">Misspelled {deckCards[deckIdx].errors} time{deckCards[deckIdx].errors !== 1 ? 's' : ''}</div>
                )}
                <div className="sf-card-actions">
                  {!deckFlipped ? (
                    <button className="sf-btn sf-btn-primary" onClick={() => setDeckFlipped(true)}>Turn over</button>
                  ) : (
                    <>
                      <button className="sf-btn sf-btn-bad" onClick={() => handleDeckGrade(false)}>Still wrong</button>
                      <button className="sf-btn sf-btn-good" onClick={() => handleDeckGrade(true)}>Got it</button>
                    </>
                  )}
                </div>
                <div className="sf-card-progress">Card {deckIdx + 1} of {deckCards.length}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Drill View */}
      {view === 'drill' && (
        <div className="sf-page sf-page-narrow animate-slide-up">
          <div className="sf-page-head"><h1>💪 Drill</h1><p className="sf-page-note">Type the correct spelling.</p></div>
          <div className="sf-deck-body">
            {drillCards.length === 0 ? (
              <div className="sf-empty"><h3>Nothing to drill.</h3><p>Type the correction yourself &mdash; it is the part that sticks.</p></div>
            ) : drillIdx >= drillCards.length ? (
              <div className="sf-empty"><h3>Session done.</h3><p>{drillCards.length} word{drillCards.length !== 1 ? 's' : ''} practised.</p><button className="sf-btn sf-btn-primary" onClick={loadDrill}>Go again</button></div>
            ) : (
              <div className="sf-card-face">
                <div className="sf-card-word sf-typo">{drillCards[drillIdx].word}</div>
                <form className="sf-drill-form" onSubmit={handleDrillSubmit}>
                  <input className="sf-answer-input" type="text" value={drillAnswer} onChange={(e) => { setDrillAnswer(e.target.value); setDrillVerdict(''); }}
                    placeholder="spelling…" autoFocus disabled={drillLocked} />
                  <div className="sf-verdict">{drillVerdict}</div>
                  <button type="submit" className="sf-btn sf-btn-primary">{drillLocked ? 'Next' : 'Check'}</button>
                </form>
                {drillLocked && drillCards[drillIdx] && (
                  <div style={{ marginTop: 12 }}>
                    <button className="sf-btn sf-btn-primary" onClick={advanceDrill}>Next →</button>
                  </div>
                )}
                <div className="sf-card-progress">Card {drillIdx + 1} of {drillCards.length}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Library View */}
      {view === 'library' && (
        <div className="sf-page animate-fade-in">
          <div className="sf-page-head"><h1>📚 Library</h1></div>
          <div className="sf-lib-grid">
            <div className="sf-card">
              <h3>✨ Prompts</h3>
              <p className="sf-muted">Something to write about, when you need a nudge.</p>
              <ul className="sf-prompt-list">
                {PROMPTS.slice(0, 10).map((p, i) => (
                  <li key={i}><button onClick={() => handlePromptClick(p)}>{p}</button></li>
                ))}
              </ul>
            </div>
            <div className="sf-card">
              <h3>🗝️ Your words</h3>
              <p className="sf-muted">Names, jargon and coinages the forge must never flag.</p>
              <ul className="sf-chip-list">
                {SF.personalList().map((w, i) => (
                  <li key={i}><span>{w}</span><button onClick={() => handlePersonalRemove(w)}>×</button></li>
                ))}
              </ul>
              <form className="sf-inline-form" onSubmit={(e) => { e.preventDefault(); handlePersonalAdd(); }}>
                <input className="sf-search" value={personalInput} onChange={(e) => setPersonalInput(e.target.value)} placeholder="Add a word…" />
                <button className="sf-btn" type="submit">Add</button>
              </form>
            </div>
            <div className="sf-card">
              <h3>🔥 Tricky spellings</h3>
              <p className="sf-muted">Spelled correctly but often got wrong.</p>
              <div className="sf-word-cloud">
                {(TRICKY as string[]).slice(0, 50).sort().map((w, i) => (
                  <span key={i}>{w}</span>
                ))}
              </div>
            </div>
            <div className="sf-card">
              <h3>📝 Saved entries</h3>
              <p className="sf-muted">Your journal history.</p>
              <input
                className="sf-search"
                value={inkSearch}
                onChange={(e) => setInkSearch(e.target.value)}
                placeholder="Search entries…"
              />
              <ul className="sf-entry-list">
                {SF.searchEntries(inkSearch).slice(0, 10).map((e: Entry, i: number) => (
                  <li key={i} className="sf-entry-item" onClick={() => handleOpenEntry(e)}>
                    <div className="sf-entry-title">{e.title || 'Untitled'}</div>
                    <div className="sf-entry-meta">
                      {SF.dayKey(new Date(e.updated))} · {countWords(e.text || '')} words
                      <button
                        className="sf-x-btn"
                        title="Delete entry"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          handleDeleteEntry(e.id);
                        }}
                      >
                        ×
                      </button>
                    </div>
                  </li>
                ))}
                {SF.searchEntries(inkSearch).length === 0 && (
                  <li className="sf-muted">No entries match.</li>
                )}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Progress View */}
      {view === 'progress' && (
        <div className="sf-page animate-fade-in">
          <div className="sf-page-head"><h1>📊 Progress</h1></div>
          {renderProgress()}
        </div>
      )}

      {/* Toasts */}
      <div className="sf-toasts">
        {toasts.map((t) => (
          <Toast key={t.id} msg={t.msg} kind={t.kind} onDone={() => removeToast(t.id)} />
        ))}
      </div>
    </div>
  );
}

/* ---------- Mini helpers for display ---------- */

function sfPhonetic(word: string): string {
  const PR: Record<string, string> = { necessary: 'NESS-uh-sair-ee', beautiful: 'BYOO-tih-ful', receive: 'rih-SEEV', believe: 'bih-LEEV', achieve: 'uh-CHEEV', definitely: 'DEF-uh-nit-lee', separate: 'SEP-uh-rayt', dessert: 'di-ZURT', business: 'BIZ-ness', because: 'bee-KUZZ', rhythm: 'RITH-um', people: 'PEE-pul', minute: 'MIN-it', wrote: 'ROHT', island: 'EYE-lund', colonel: 'KER-nul', choir: 'KWIRE', yacht: 'YOT', gauge: 'GAYJ', debt: 'DET', doubt: 'DOWT', subtle: 'SUT-uhl', neighbour: 'NAY-bur', laugh: 'LAF', could: 'KUD', great: 'GRATE', queue: 'KYOO', sight: 'SYTE', height: 'HYTE', half: 'HAF' };
  return PR[word.toLowerCase()] || '';
}

function sfMnemonic(word: string): string {
  const syl = word.toLowerCase().replace(/[^a-z]/g, '').match(/[aeiouy]+/g);
  if (syl && syl.length > 1) return `${syl.length} syllables`;
  return '';
}
