import { useState, useEffect } from 'react';
import { TestTube, Play, Plus, Trash2, CheckCircle2, XCircle, SkipForward, Zap, BarChart3 } from 'lucide-react';

interface TestSuite {
  id: string;
  name: string;
  description: string;
  framework: string;
  tests: any[];
  status: string;
  results?: { total: number; passed: number; failed: number; skipped: number; duration: number };
}

export function TestView() {
  const [suites, setSuites] = useState<TestSuite[]>([]);
  const [selectedSuite, setSelectedSuite] = useState<TestSuite | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newFramework, setNewFramework] = useState('vitest');
  const [newDesc, setNewDesc] = useState('');
  const [stats, setStats] = useState({ total: 0, passed: 0, failed: 0, skipped: 0 });
  const [genDesc, setGenDesc] = useState('');
  const [generating, setGenerating] = useState(false);

  useEffect(() => { loadSuites(); loadStats(); }, []);

  const loadSuites = async () => {
    try { setSuites(await (window as any).api.testListSuites()); } catch {}
  };
  const loadStats = async () => {
    try { setStats(await (window as any).api.testStats()); } catch {}
  };

  const createSuite = async () => {
    if (!newName) return;
    await (window as any).api.testCreateSuite({ name: newName, framework: newFramework, description: newDesc });
    setShowNew(false);
    setNewName('');
    setNewDesc('');
    loadSuites();
  };

  const deleteSuite = async (id: string) => {
    await (window as any).api.testDeleteSuite({ id });
    if (selectedSuite?.id === id) setSelectedSuite(null);
    loadSuites();
    loadStats();
  };

  const runSuite = async (suite: TestSuite) => {
    const result = await (window as any).api.testRunSuite({ suiteId: suite.id });
    if (result) {
      setSelectedSuite({ ...suite, results: result, status: result.failed > 0 ? 'failed' : 'passed' });
    }
    loadSuites();
    loadStats();
  };

  const generateTests = async () => {
    if (!genDesc) return;
    setGenerating(true);
    try {
      const tests = await (window as any).api.testGenerateTests({ description: genDesc });
      if (selectedSuite && tests?.length) {
        for (const t of tests) {
          await (window as any).api.testAddTest({ suiteId: selectedSuite.id, test: t });
        }
        loadSuites();
      }
    } catch {}
    setGenerating(false);
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case 'passed': return <CheckCircle2 size={14} className="text-green-400" />;
      case 'failed': return <XCircle size={14} className="text-red-400" />;
      case 'skipped': return <SkipForward size={14} className="text-yellow-400" />;
      case 'running': return <Zap size={14} className="text-blue-400 animate-pulse" />;
      default: return <div className="w-3.5 h-3.5 rounded-full border border-[var(--border)]" />;
    }
  };

  return (
    <div className="h-full flex bg-[var(--bg-primary)]">
      <div className="w-72 border-r border-[var(--border)] flex flex-col">
        <div className="p-3 border-b border-[var(--border)]">
          <div className="grid grid-cols-4 gap-2 mb-3">
            <div className="text-center p-2 bg-[var(--bg-secondary)] rounded">
              <div className="text-lg font-bold">{stats.total}</div>
              <div className="text-xs text-[var(--text-secondary)]">Total</div>
            </div>
            <div className="text-center p-2 bg-green-500/10 rounded">
              <div className="text-lg font-bold text-green-400">{stats.passed}</div>
              <div className="text-xs text-[var(--text-secondary)]">Pass</div>
            </div>
            <div className="text-center p-2 bg-red-500/10 rounded">
              <div className="text-lg font-bold text-red-400">{stats.failed}</div>
              <div className="text-xs text-[var(--text-secondary)]">Fail</div>
            </div>
            <div className="text-center p-2 bg-yellow-500/10 rounded">
              <div className="text-lg font-bold text-yellow-400">{stats.skipped}</div>
              <div className="text-xs text-[var(--text-secondary)]">Skip</div>
            </div>
          </div>
          <button onClick={() => setShowNew(true)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded bg-[var(--accent)] text-white text-sm">
            <Plus size={14} /> New Suite
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {suites.map((s) => (
            <div key={s.id} onClick={() => setSelectedSuite(s)}
              className={`p-3 border-b border-[var(--border)] cursor-pointer hover:bg-[var(--bg-tertiary)] ${
                selectedSuite?.id === s.id ? 'bg-[var(--bg-tertiary)]' : ''}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {statusIcon(s.status)}
                  <span className="text-sm font-medium">{s.name}</span>
                </div>
                <div className="flex gap-1">
                  <button onClick={(e) => { e.stopPropagation(); runSuite(s); }}
                    className="p-1 hover:text-green-400"><Play size={12} /></button>
                  <button onClick={(e) => { e.stopPropagation(); deleteSuite(s.id); }}
                    className="p-1 hover:text-red-400"><Trash2 size={12} /></button>
                </div>
              </div>
              <p className="text-xs text-[var(--text-secondary)] mt-1">
                {s.tests.length} tests · {s.framework}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        {showNew ? (
          <div className="p-6 max-w-md">
            <h2 className="text-lg font-semibold mb-4">New Test Suite</h2>
            <div className="space-y-3">
              <input type="text" placeholder="Suite name" value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-sm" />
              <select value={newFramework} onChange={(e) => setNewFramework(e.target.value)}
                className="w-full p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-sm">
                <option value="vitest">Vitest</option>
                <option value="jest">Jest</option>
                <option value="mocha">Mocha</option>
                <option value="pytest">Pytest</option>
                <option value="go-test">Go Test</option>
              </select>
              <textarea placeholder="Description" value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                className="w-full p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-sm h-20 resize-none" />
              <div className="flex gap-2">
                <button onClick={createSuite} className="px-4 py-2 rounded bg-[var(--accent)] text-white text-sm">Create</button>
                <button onClick={() => setShowNew(false)} className="px-4 py-2 rounded bg-[var(--bg-tertiary)] text-sm">Cancel</button>
              </div>
            </div>
          </div>
        ) : selectedSuite ? (
          <div className="flex-1 flex flex-col p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold">{selectedSuite.name}</h2>
                <p className="text-sm text-[var(--text-secondary)]">{selectedSuite.framework} · {selectedSuite.tests.length} tests</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => runSuite(selectedSuite)}
                  className="px-3 py-2 rounded bg-green-600 text-white text-sm flex items-center gap-1">
                  <Play size={14} /> Run All
                </button>
              </div>
            </div>

            {selectedSuite.results && (
              <div className="grid grid-cols-5 gap-2 mb-4">
                <div className="p-3 bg-[var(--bg-secondary)] rounded text-center">
                  <div className="text-xl font-bold">{selectedSuite.results.total}</div>
                  <div className="text-xs text-[var(--text-secondary)]">Total</div>
                </div>
                <div className="p-3 bg-green-500/10 rounded text-center">
                  <div className="text-xl font-bold text-green-400">{selectedSuite.results.passed}</div>
                  <div className="text-xs text-[var(--text-secondary)]">Passed</div>
                </div>
                <div className="p-3 bg-red-500/10 rounded text-center">
                  <div className="text-xl font-bold text-red-400">{selectedSuite.results.failed}</div>
                  <div className="text-xs text-[var(--text-secondary)]">Failed</div>
                </div>
                <div className="p-3 bg-yellow-500/10 rounded text-center">
                  <div className="text-xl font-bold text-yellow-400">{selectedSuite.results.skipped}</div>
                  <div className="text-xs text-[var(--text-secondary)]">Skipped</div>
                </div>
                <div className="p-3 bg-[var(--bg-secondary)] rounded text-center">
                  <div className="text-xl font-bold">{(selectedSuite.results.duration / 1000).toFixed(1)}s</div>
                  <div className="text-xs text-[var(--text-secondary)]">Duration</div>
                </div>
              </div>
            )}

            <div className="mb-4 p-3 bg-[var(--bg-secondary)] rounded">
              <h3 className="text-sm font-medium mb-2">AI Test Generator</h3>
              <div className="flex gap-2">
                <input type="text" placeholder="Describe what to test..."
                  value={genDesc} onChange={(e) => setGenDesc(e.target.value)}
                  className="flex-1 p-2 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-sm" />
                <button onClick={generateTests} disabled={generating}
                  className="px-3 py-2 rounded bg-[var(--accent)] text-white text-sm disabled:opacity-50">
                  {generating ? 'Generating...' : 'Generate'}
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto space-y-1">
              {selectedSuite.tests.map((t: any) => (
                <div key={t.id} className="flex items-center gap-3 p-3 bg-[var(--bg-secondary)] rounded">
                  {statusIcon(t.status || 'idle')}
                  <div className="flex-1">
                    <span className="text-sm font-medium">{t.name}</span>
                    <span className="text-xs text-[var(--text-secondary)] ml-2">{t.type}</span>
                  </div>
                  {t.tags?.length > 0 && (
                    <div className="flex gap-1">
                      {t.tags.map((tag: string) => (
                        <span key={tag} className="text-xs px-1.5 py-0.5 bg-[var(--bg-tertiary)] rounded">{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[var(--text-secondary)]">
            <div className="text-center">
              <TestTube size={48} className="mx-auto mb-4 opacity-50" />
              <p>Select a test suite or create one</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
