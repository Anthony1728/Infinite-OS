import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Search,
  BookOpen,
  Zap,
  Target,
  Brain,
  CheckCircle2,
  Clock,
  Copy,
  FileText,
  ChevronRight,
  Globe,
  Sparkles,
  Loader2,
} from 'lucide-react';

type Depth = 'quick' | 'standard' | 'deep';

interface Source {
  title: string;
  url: string;
  relevance: number;
}

interface ResearchResult {
  query: string;
  depth: Depth;
  summary: string;
  keyFindings: string[];
  sources: Source[];
  relatedTopics: string[];
  completedAt: number;
}

interface ResearchHistoryItem {
  id: string;
  query: string;
  depth: Depth;
  completedAt: number;
}

type StepStatus = 'pending' | 'active' | 'complete';

interface StepState {
  id: number;
  label: string;
  status: StepStatus;
  progress: number;
}

const DEPTH_CONFIG: Record<Depth, { sources: number; label: string; time: number; color: string }> = {
  quick: { sources: 1, label: 'Quick', time: 3000, color: 'from-cyan-500 to-blue-500' },
  standard: { sources: 3, label: 'Standard', time: 6000, color: 'from-indigo-500 to-violet-500' },
  deep: { sources: 5, label: 'Deep', time: 10000, color: 'from-purple-500 to-pink-500' },
};

const STEPS = [
  { id: 1, label: 'Analyzing query' },
  { id: 2, label: 'Searching sources' },
  { id: 3, label: 'Extracting information' },
  { id: 4, label: 'Synthesizing findings' },
  { id: 5, label: 'Complete' },
];

export function ResearchView() {
  const [query, setQuery] = useState('');
  const [depth, setDepth] = useState<Depth>('standard');
  const [researching, setResearching] = useState(false);
  const [steps, setSteps] = useState<StepState[]>(STEPS.map((s) => ({ ...s, status: 'pending' as StepStatus, progress: 0 })));
  const [history, setHistory] = useState<ResearchHistoryItem[]>([]);
  const [currentResult, setCurrentResult] = useState<ResearchResult | null>(null);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [results, setResults] = useState<Map<string, ResearchResult>>(new Map());
  const [dotCount, setDotCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dotRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (dotRef.current) clearInterval(dotRef.current);
    };
  }, []);

  const startResearch = useCallback(() => {
    if (!query.trim() || researching) return;

    setResearching(true);
    setCurrentResult(null);
    setCopied(false);

    const initialSteps = STEPS.map((s) => ({ ...s, status: 'pending' as StepStatus, progress: 0 }));
    setSteps(initialSteps);

    const totalTime = DEPTH_CONFIG[depth].time;
    const stepTime = totalTime / 5;
    let currentStep = 0;

    dotRef.current = setInterval(() => {
      setDotCount((prev) => (prev + 1) % 4);
    }, 400);

    const advanceStep = () => {
      if (currentStep >= 5) {
        if (dotRef.current) clearInterval(dotRef.current);
        setDotCount(0);

        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const result: ResearchResult = {
          query: query.trim(),
          depth,
          summary: '',
          keyFindings: [],
          sources: [],
          relatedTopics: [],
          completedAt: Date.now(),
        };

        setResults((prev) => {
          const next = new Map(prev);
          next.set(id, result);
          return next;
        });
        setHistory((prev) => [{ id, query: query.trim(), depth, completedAt: Date.now() }, ...prev]);
        setCurrentResult(result);
        setSelectedHistoryId(id);
        setResearching(false);
        return;
      }

      currentStep++;
      setSteps((prev) =>
        prev.map((s, i) => {
          if (i < currentStep - 1) return { ...s, status: 'complete', progress: 100 };
          if (i === currentStep - 1) return { ...s, status: 'active', progress: 0 };
          return s;
        })
      );

      let progressVal = 0;
      const progressInterval = setInterval(() => {
        progressVal += 100 / (stepTime / 100);
        if (progressVal >= 100) {
          progressVal = 100;
          clearInterval(progressInterval);
        }
        setSteps((prev) =>
          prev.map((s, i) => (i === currentStep - 1 ? { ...s, progress: Math.min(progressVal, 100) } : s))
        );
      }, 100);

      timerRef.current = setTimeout(advanceStep, stepTime);
    };

    timerRef.current = setTimeout(advanceStep, 200);
  }, [query, depth, researching]);

  const selectHistoryItem = (id: string) => {
    const result = results.get(id);
    if (result) {
      setCurrentResult(result);
      setSelectedHistoryId(id);
    }
  };

  const exportMarkdown = () => {
    if (!currentResult) return;
    const md = `# Research: ${currentResult.query}\n\n**Depth:** ${DEPTH_CONFIG[currentResult.depth].label}\n**Completed:** ${new Date(currentResult.completedAt).toLocaleString()}\n\n---\n\n## Summary\n\n${currentResult.summary || 'Research in progress...'}\n\n## Key Findings\n\n${currentResult.keyFindings.length > 0 ? currentResult.keyFindings.map((f) => `- ${f}`).join('\n') : '- Pending...'}\n\n## Sources\n\n${currentResult.sources.length > 0 ? currentResult.sources.map((s) => `- [${s.title}](${s.url}) (Relevance: ${s.relevance}%)`).join('\n') : '- Pending...'}\n\n## Related Topics\n\n${currentResult.relatedTopics.length > 0 ? currentResult.relatedTopics.map((t) => `- ${t}`).join('\n') : '- Pending...'}`;
    navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyToClipboard = () => {
    if (!currentResult) return;
    const text = `Research: ${currentResult.query}\n\nSummary:\n${currentResult.summary || 'Research in progress...'}\n\nKey Findings:\n${currentResult.keyFindings.length > 0 ? currentResult.keyFindings.map((f) => `• ${f}`).join('\n') : '• Pending...'}\n\nSources:\n${currentResult.sources.length > 0 ? currentResult.sources.map((s) => `• ${s.title} - ${s.url} (${s.relevance}%)`).join('\n') : '• Pending...'}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const dots = '.'.repeat(dotCount);

  return (
    <div className="h-full flex bg-[#0a0a0f]">
      <div className="w-64 flex-shrink-0 border-r border-white/10 flex flex-col bg-[#0d0d11]">
        <div className="p-4 border-b border-white/10">
          <div className="flex items-center gap-2 mb-3">
            <Clock size={14} className="text-textMuted" />
            <span className="text-xs font-semibold text-textMuted uppercase tracking-wider">History</span>
          </div>
          <span className="text-[10px] text-textMuted">{history.length} queries</span>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {history.length === 0 ? (
            <div className="p-4 text-center">
              <Search size={24} className="mx-auto mb-2 text-textMuted opacity-30" />
              <p className="text-xs text-textMuted">No research history yet</p>
            </div>
          ) : (
            history.map((item) => (
              <button
                key={item.id}
                onClick={() => selectHistoryItem(item.id)}
                className={`w-full text-left px-4 py-3 border-b border-white/[0.04] transition-all ${
                  selectedHistoryId === item.id
                    ? 'bg-indigo-500/10 border-l-2 border-l-indigo-500'
                    : 'hover:bg-white/[0.03]'
                }`}
              >
                <div className="text-sm text-textMain truncate font-medium">{item.query}</div>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded bg-gradient-to-r ${DEPTH_CONFIG[item.depth].color} bg-clip-text text-transparent`}>
                    {DEPTH_CONFIG[item.depth].label}
                  </span>
                  <span className="text-[10px] text-textMuted">
                    {new Date(item.completedAt).toLocaleTimeString()}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-6 pb-0">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg">
              <Search size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-textMain">Research Engine</h1>
              <p className="text-textMuted text-sm">Deep research with multi-source analysis and synthesis.</p>
            </div>
          </div>
        </div>

        <div className="p-6 flex-1 overflow-y-auto custom-scrollbar">
          <div className="bg-[#14141a] border border-white/10 rounded-2xl p-5 mb-6">
            <div className="flex gap-3 mb-4">
              <div className="flex-1 relative">
                <Globe size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-textMuted" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') startResearch(); }}
                  placeholder="Enter a research query or topic..."
                  disabled={researching}
                  className="input-premium w-full pl-10"
                />
              </div>
              <button
                onClick={startResearch}
                disabled={!query.trim() || researching}
                className="btn-premium flex items-center gap-2 disabled:opacity-50 min-w-[120px]"
              >
                {researching ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Researching...
                  </>
                ) : (
                  <>
                    <Search size={16} />
                    Research
                  </>
                )}
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-textMuted mr-1">Depth:</span>
              {(['quick', 'standard', 'deep'] as Depth[]).map((d) => (
                <button
                  key={d}
                  onClick={() => setDepth(d)}
                  disabled={researching}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                    depth === d
                      ? `bg-gradient-to-r ${DEPTH_CONFIG[d].color} bg-clip-text text-transparent border-white/10`
                      : 'text-textMuted hover:text-textMain border-white/[0.04] hover:border-white/10'
                  }`}
                >
                  {d === 'quick' && <Zap size={12} />}
                  {d === 'standard' && <Target size={12} />}
                  {d === 'deep' && <Brain size={12} />}
                  {DEPTH_CONFIG[d].label}
                  <span className="text-[10px] opacity-60">({DEPTH_CONFIG[d].sources} src)</span>
                </button>
              ))}
            </div>
          </div>

          {researching && (
            <div className="bg-[#14141a] border border-white/10 rounded-2xl p-5 mb-6 animate-fade-in">
              <div className="flex items-center gap-2 mb-5">
                <div className="w-2 h-2 rounded-full bg-indigo-400 animate-live-pulse" />
                <span className="text-sm font-semibold text-textMain">Research in Progress</span>
                <span className="text-xs text-textMuted">&mdash; {DEPTH_CONFIG[depth].label} mode</span>
              </div>

              <div className="space-y-3">
                {steps.map((step) => (
                  <div key={step.id} className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-300 ${
                      step.status === 'complete'
                        ? 'bg-green-500/20'
                        : step.status === 'active'
                        ? 'bg-indigo-500/20'
                        : 'bg-white/[0.04]'
                    }`}>
                      {step.status === 'complete' ? (
                        <CheckCircle2 size={16} className="text-green-400" />
                      ) : step.status === 'active' ? (
                        <Loader2 size={16} className="text-indigo-400 animate-spin" />
                      ) : (
                        <span className="text-xs text-textMuted">{step.id}</span>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-sm font-medium transition-all ${
                          step.status === 'complete' ? 'text-green-400' :
                          step.status === 'active' ? 'text-textMain' :
                          'text-textMuted'
                        }`}>
                          {step.label}
                          {step.status === 'active' && step.id === 1 && (
                            <span className="text-textMuted ml-1">{dots}</span>
                          )}
                          {step.status === 'active' && step.id === 4 && (
                            <span className="text-textMuted ml-1">{dots}</span>
                          )}
                        </span>
                        {step.status !== 'pending' && (
                          <span className="text-[10px] text-textMuted">{Math.round(step.progress)}%</span>
                        )}
                      </div>
                      {step.status !== 'pending' && (
                        <div className="h-1 bg-white/[0.06] rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-200 ${
                              step.status === 'complete'
                                ? 'bg-green-500'
                                : 'bg-indigo-500'
                            }`}
                            style={{ width: `${step.progress}%` }}
                          />
                        </div>
                      )}
                      {step.status === 'active' && step.id === 3 && (
                        <div className="mt-2 space-y-1">
                          {Array.from({ length: DEPTH_CONFIG[depth].sources }).map((_, si) => (
                            <div key={si} className="flex items-center gap-2">
                              <Globe size={10} className="text-textMuted" />
                              <div className="h-1 flex-1 bg-white/[0.04] rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-cyan-500/60 transition-all duration-300"
                                  style={{ width: `${Math.max(0, Math.min(100, step.progress - si * 15))}%` }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {currentResult && !researching && (
            <div className="animate-fade-in space-y-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-lg font-bold text-textMain flex items-center gap-2">
                  <Sparkles size={18} className="text-indigo-400" />
                  Results
                </h2>
                <div className="flex gap-2">
                  <button
                    onClick={copyToClipboard}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06] text-xs font-medium text-textMuted hover:text-textMain hover:border-white/10 transition-all"
                  >
                    <Copy size={12} />
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                  <button
                    onClick={exportMarkdown}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06] text-xs font-medium text-textMuted hover:text-textMain hover:border-white/10 transition-all"
                  >
                    <FileText size={12} />
                    Export MD
                  </button>
                </div>
              </div>

              <div className="bg-[#14141a] border border-white/10 rounded-2xl p-5">
                <h3 className="text-sm font-semibold text-textMuted uppercase tracking-wider mb-3">Summary</h3>
                <p className="text-sm text-textMain leading-relaxed">
                  {currentResult.summary || 'Research complete. Summary will be available when connected to a research backend.'}
                </p>
              </div>

              <div className="bg-[#14141a] border border-white/10 rounded-2xl p-5">
                <h3 className="text-sm font-semibold text-textMuted uppercase tracking-wider mb-3">Key Findings</h3>
                {currentResult.keyFindings.length > 0 ? (
                  <ul className="space-y-2">
                    {currentResult.keyFindings.map((finding, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-textMain">
                        <ChevronRight size={14} className="text-indigo-400 mt-0.5 flex-shrink-0" />
                        <span>{finding}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-textMuted italic">Key findings will appear when connected to a research backend.</p>
                )}
              </div>

              <div className="bg-[#14141a] border border-white/10 rounded-2xl p-5">
                <h3 className="text-sm font-semibold text-textMuted uppercase tracking-wider mb-3">Sources</h3>
                {currentResult.sources.length > 0 ? (
                  <div className="space-y-2">
                    {currentResult.sources.map((source, i) => (
                      <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-bgInput border border-white/[0.04]">
                        <Globe size={14} className="text-textMuted flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-textMain font-medium truncate">{source.title}</div>
                          <div className="text-[10px] text-textMuted truncate">{source.url}</div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <div className="w-16 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full bg-indigo-500"
                              style={{ width: `${source.relevance}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-textMuted w-8">{source.relevance}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-textMuted italic">Sources will appear when connected to a research backend.</p>
                )}
              </div>

              <div className="bg-[#14141a] border border-white/10 rounded-2xl p-5">
                <h3 className="text-sm font-semibold text-textMuted uppercase tracking-wider mb-3">Related Topics</h3>
                {currentResult.relatedTopics.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {currentResult.relatedTopics.map((topic, i) => (
                      <button
                        key={i}
                        onClick={() => { setQuery(topic); }}
                        className="px-3 py-1.5 rounded-lg bg-bgInput border border-white/[0.06] text-xs font-medium text-textMuted hover:text-textMain hover:border-indigo-500/30 transition-all"
                      >
                        {topic}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-textMuted italic">Related topics will appear when connected to a research backend.</p>
                )}
              </div>
            </div>
          )}

          {!researching && !currentResult && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center mb-4">
                <BookOpen size={32} className="text-cyan-400/60" />
              </div>
              <h3 className="text-lg font-semibold text-textMain mb-2">Start Researching</h3>
              <p className="text-sm text-textMuted max-w-md">
                Enter a query above and choose a research depth to begin deep analysis across multiple sources.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

