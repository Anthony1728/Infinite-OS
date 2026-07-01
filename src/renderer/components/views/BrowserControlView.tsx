import { useState, useRef, useCallback } from 'react';
import {
  Globe,
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Search,
  MousePointerClick,
  Type,
  Copy,
  Camera,
  Code,
  Clock,
  Play,
  Plus,
  ChevronUp,
  ChevronDown,
  Trash2,
  Terminal,
  ListOrdered,
  Activity,
  X,
} from 'lucide-react';

interface ActivityLogEntry {
  id: string;
  timestamp: Date;
  action: string;
  detail: string;
  result: string;
}

interface SequenceStep {
  id: string;
  type: 'navigate' | 'click' | 'fill' | 'extract' | 'wait' | 'script';
  selector?: string;
  value?: string;
  seconds?: number;
}

export function BrowserControlView() {
  const [url, setUrl] = useState('https://');
  const [currentUrl, setCurrentUrl] = useState('');
  const [pageTitle, setPageTitle] = useState('');
  const [inspectorSelector, setInspectorSelector] = useState('');
  const [clickSelector, setClickSelector] = useState('');
  const [fillSelector, setFillSelector] = useState('');
  const [fillValue, setFillValue] = useState('');
  const [extractSelector, setExtractSelector] = useState('');
  const [extractResult, setExtractResult] = useState('');
  const [waitSeconds, setWaitSeconds] = useState('1');
  const [scriptCode, setScriptCode] = useState('');
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const [sequenceSteps, setSequenceSteps] = useState<SequenceStep[]>([]);
  const [sequenceRunning, setSequenceRunning] = useState(false);
  const [addStepType, setAddStepType] = useState<SequenceStep['type']>('navigate');
  const [addStepSelector, setAddStepSelector] = useState('');
  const [addStepValue, setAddStepValue] = useState('');
  const [addStepSeconds, setAddStepSeconds] = useState('1');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const addLog = useCallback((action: string, detail: string, result: string) => {
    setActivityLog((prev) => [
      {
        id: Math.random().toString(36).slice(2),
        timestamp: new Date(),
        action,
        detail,
        result,
      },
      ...prev,
    ].slice(0, 200));
  }, []);

  const handleNavigate = () => {
    let target = url.trim();
    if (!target || target === 'https://') return;
    if (!target.startsWith('http://') && !target.startsWith('https://')) {
      target = 'https://' + target;
    }
    setCurrentUrl(target);
    setPageTitle(target);
    addLog('Navigate', target, 'Page loaded');
  };

  const handleBack = () => {
    addLog('Navigate', 'Back', 'Navigated back');
  };

  const handleForward = () => {
    addLog('Navigate', 'Forward', 'Navigated forward');
  };

  const handleRefresh = () => {
    if (currentUrl) {
      addLog('Navigate', 'Refresh', 'Page refreshed');
    }
  };

  const handleClick = () => {
    if (!clickSelector.trim()) return;
    addLog('Click', clickSelector, `Clicked element: ${clickSelector}`);
    setClickSelector('');
  };

  const handleFill = () => {
    if (!fillSelector.trim()) return;
    addLog('Fill', `${fillSelector} = "${fillValue}"`, `Filled ${fillSelector} with "${fillValue}"`);
    setFillSelector('');
    setFillValue('');
  };

  const handleExtract = () => {
    if (!extractSelector.trim()) return;
    addLog('Extract', extractSelector, `Extracted from ${extractSelector}`);
    setExtractResult(`[Extracted content from "${extractSelector}"]`);
  };

  const handleScreenshot = () => {
    addLog('Screenshot', 'Full page', 'Screenshot captured');
  };

  const handleExecuteScript = () => {
    if (!scriptCode.trim()) return;
    addLog('Script', scriptCode.slice(0, 60), 'Script executed');
    setScriptCode('');
  };

  const handleWait = () => {
    const secs = Number(waitSeconds) || 1;
    addLog('Wait', `${secs}s`, `Waited ${secs} second${secs !== 1 ? 's' : ''}`);
  };

  const generateStepId = () => Math.random().toString(36).slice(2);

  const addSequenceStep = () => {
    const step: SequenceStep = {
      id: generateStepId(),
      type: addStepType,
    };
    if (['click', 'fill', 'extract'].includes(addStepType)) {
      step.selector = addStepSelector || `.${addStepType}-element`;
    }
    if (addStepType === 'fill') {
      step.value = addStepValue || 'sample value';
    }
    if (addStepType === 'navigate') {
      step.value = addStepValue || currentUrl || 'https://example.com';
    }
    if (addStepType === 'wait') {
      step.seconds = Number(addStepSeconds) || 1;
    }
    if (addStepType === 'script') {
      step.value = addStepValue || 'console.log("hello")';
    }
    setSequenceSteps((prev) => [...prev, step]);
    setAddStepSelector('');
    setAddStepValue('');
    setAddStepSeconds('1');
  };

  const moveStep = (index: number, direction: 'up' | 'down') => {
    const newSteps = [...sequenceSteps];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newSteps.length) return;
    [newSteps[index], newSteps[targetIndex]] = [newSteps[targetIndex], newSteps[index]];
    setSequenceSteps(newSteps);
  };

  const removeStep = (id: string) => {
    setSequenceSteps((prev) => prev.filter((s) => s.id !== id));
  };

  const executeStep = async (step: SequenceStep) => {
    switch (step.type) {
      case 'navigate':
        setCurrentUrl(step.value || 'https://example.com');
        setPageTitle(step.value || 'https://example.com');
        addLog('Sequence: Navigate', step.value || 'https://example.com', 'Navigated');
        break;
      case 'click':
        addLog('Sequence: Click', step.selector || '', `Clicked ${step.selector}`);
        break;
      case 'fill':
        addLog('Sequence: Fill', `${step.selector} = "${step.value}"`, `Filled ${step.selector}`);
        break;
      case 'extract':
        addLog('Sequence: Extract', step.selector || '', `Extracted from ${step.selector}`);
        break;
      case 'wait': {
        const secs = step.seconds || 1;
        addLog('Sequence: Wait', `${secs}s`, `Waiting ${secs}s...`);
        await new Promise((r) => setTimeout(r, secs * 1000));
        addLog('Sequence: Wait', `${secs}s`, 'Done waiting');
        break;
      }
      case 'script':
        addLog('Sequence: Script', (step.value || '').slice(0, 60), 'Script executed');
        break;
    }
  };

  const runSequence = async () => {
    if (sequenceSteps.length === 0) return;
    setSequenceRunning(true);
    addLog('Sequence', 'started', `Running ${sequenceSteps.length} steps`);
    for (const step of sequenceSteps) {
      await executeStep(step);
    }
    addLog('Sequence', 'completed', 'All steps executed');
    setSequenceRunning(false);
  };

  const stepTypeLabels: Record<SequenceStep['type'], string> = {
    navigate: 'Navigate',
    click: 'Click',
    fill: 'Fill',
    extract: 'Extract',
    wait: 'Wait',
    script: 'Script',
  };

  const stepTypeIcons: Record<SequenceStep['type'], React.ReactNode> = {
    navigate: <Globe className="w-3.5 h-3.5" />,
    click: <MousePointerClick className="w-3.5 h-3.5" />,
    fill: <Type className="w-3.5 h-3.5" />,
    extract: <Copy className="w-3.5 h-3.5" />,
    wait: <Clock className="w-3.5 h-3.5" />,
    script: <Code className="w-3.5 h-3.5" />,
  };

  const stepTypeColors: Record<SequenceStep['type'], string> = {
    navigate: 'text-blue-400 bg-blue-500/20',
    click: 'text-orange-400 bg-orange-500/20',
    fill: 'text-green-400 bg-green-500/20',
    extract: 'text-purple-400 bg-purple-500/20',
    wait: 'text-yellow-400 bg-yellow-500/20',
    script: 'text-cyan-400 bg-cyan-500/20',
  };

  return (
    <div className="flex-1 flex flex-col bg-[#0a0a0f] overflow-hidden animate-fade-in">
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col min-w-0">
          <div className="p-4 border-b border-white/10">
            <div className="flex items-center gap-3 mb-3">
              <h1 className="text-lg font-bold text-textMain flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center shadow-lg">
                  <Globe className="w-4 h-4 text-white" />
                </div>
                Browser Control
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleBack} className="p-2 rounded-lg bg-[#14141a] border border-white/10 text-textMuted hover:text-textMain hover:border-white/20 transition-all">
                <ArrowLeft className="w-4 h-4" />
              </button>
              <button onClick={handleForward} className="p-2 rounded-lg bg-[#14141a] border border-white/10 text-textMuted hover:text-textMain hover:border-white/20 transition-all">
                <ArrowRight className="w-4 h-4" />
              </button>
              <button onClick={handleRefresh} className="p-2 rounded-lg bg-[#14141a] border border-white/10 text-textMuted hover:text-textMain hover:border-white/20 transition-all">
                <RotateCw className="w-4 h-4" />
              </button>
              <div className="flex-1 flex items-center gap-2 bg-[#14141a] border border-white/10 rounded-lg px-3 py-1.5">
                <Search className="w-3.5 h-3.5 text-textMuted flex-shrink-0" />
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleNavigate()}
                  placeholder="Enter URL..."
                  className="flex-1 bg-transparent text-sm text-textMain outline-none placeholder:text-textMuted/50"
                />
              </div>
              <button onClick={handleNavigate} className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-sm font-medium hover:from-blue-500 hover:to-indigo-500 transition-all">
                Go
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 relative bg-[#0a0a0f]">
            {currentUrl ? (
              <iframe
                ref={iframeRef}
                src={currentUrl}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                className="w-full h-full border-0 bg-white"
                title="Browser View"
                onLoad={() => setPageTitle(currentUrl)}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <div className="text-center">
                  <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500/20 to-indigo-500/20 flex items-center justify-center mx-auto mb-4">
                    <Globe className="w-10 h-10 text-blue-400/50" />
                  </div>
                  <p className="text-textMuted text-sm">Enter a URL to start browsing</p>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-white/10 bg-[#14141a] p-3">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="text-[10px] font-medium text-textMuted uppercase tracking-wider flex-shrink-0">Inspector</span>
                <span className="text-xs text-textMain truncate max-w-[200px]" title={pageTitle}>{pageTitle || 'No page loaded'}</span>
                <span className="text-[10px] text-textMuted truncate">{currentUrl}</span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <input
                  value={inspectorSelector}
                  onChange={(e) => setInspectorSelector(e.target.value)}
                  placeholder="CSS selector..."
                  className="w-40 bg-[#0a0a0f] border border-white/10 rounded-md px-2 py-1 text-xs text-textMain outline-none focus:border-blue-500/50 placeholder:text-textMuted/50"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="w-80 border-l border-white/10 bg-[#0a0a0f] flex flex-col overflow-hidden flex-shrink-0">
          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="p-3 border-b border-white/10">
              <h2 className="text-xs font-semibold text-textMain uppercase tracking-wider flex items-center gap-1.5 mb-3">
                <Terminal className="w-3.5 h-3.5 text-blue-400" />
                Automation Tools
              </h2>

              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-medium text-textMuted uppercase tracking-wider mb-1.5 block">Click Element</label>
                  <div className="flex gap-1.5">
                    <input value={clickSelector} onChange={(e) => setClickSelector(e.target.value)} placeholder="CSS selector" className="flex-1 bg-[#14141a] border border-white/10 rounded-md px-2 py-1.5 text-xs text-textMain outline-none focus:border-orange-500/50 placeholder:text-textMuted/50" />
                    <button onClick={handleClick} className="px-3 py-1.5 rounded-md bg-orange-500/20 border border-orange-500/30 text-orange-400 text-xs font-medium hover:bg-orange-500/30 transition-all flex items-center gap-1">
                      <MousePointerClick className="w-3 h-3" />
                      Click
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-medium text-textMuted uppercase tracking-wider mb-1.5 block">Fill Form</label>
                  <div className="flex gap-1.5 mb-1.5">
                    <input value={fillSelector} onChange={(e) => setFillSelector(e.target.value)} placeholder="CSS selector" className="flex-1 bg-[#14141a] border border-white/10 rounded-md px-2 py-1.5 text-xs text-textMain outline-none focus:border-green-500/50 placeholder:text-textMuted/50" />
                    <input value={fillValue} onChange={(e) => setFillValue(e.target.value)} placeholder="Value" className="w-20 bg-[#14141a] border border-white/10 rounded-md px-2 py-1.5 text-xs text-textMain outline-none focus:border-green-500/50 placeholder:text-textMuted/50" />
                  </div>
                  <button onClick={handleFill} className="w-full px-3 py-1.5 rounded-md bg-green-500/20 border border-green-500/30 text-green-400 text-xs font-medium hover:bg-green-500/30 transition-all flex items-center justify-center gap-1">
                    <Type className="w-3 h-3" />
                    Fill
                  </button>
                </div>

                <div>
                  <label className="text-[10px] font-medium text-textMuted uppercase tracking-wider mb-1.5 block">Extract Text</label>
                  <div className="flex gap-1.5 mb-1.5">
                    <input value={extractSelector} onChange={(e) => setExtractSelector(e.target.value)} placeholder="CSS selector" className="flex-1 bg-[#14141a] border border-white/10 rounded-md px-2 py-1.5 text-xs text-textMain outline-none focus:border-purple-500/50 placeholder:text-textMuted/50" />
                    <button onClick={handleExtract} className="px-3 py-1.5 rounded-md bg-purple-500/20 border border-purple-500/30 text-purple-400 text-xs font-medium hover:bg-purple-500/30 transition-all flex items-center gap-1">
                      <Copy className="w-3 h-3" />
                      Extract
                    </button>
                  </div>
                  {extractResult && (
                    <div className="bg-[#14141a] border border-purple-500/20 rounded-md px-2 py-1.5 text-xs text-purple-300 mb-1.5 break-all">
                      {extractResult}
                    </div>
                  )}
                </div>

                <div className="flex gap-1.5">
                  <button onClick={handleScreenshot} className="flex-1 px-3 py-1.5 rounded-md bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 text-xs font-medium hover:bg-cyan-500/30 transition-all flex items-center justify-center gap-1">
                    <Camera className="w-3 h-3" />
                    Screenshot
                  </button>
                  <div className="flex items-center gap-1.5 flex-1">
                    <input type="number" min="1" value={waitSeconds} onChange={(e) => setWaitSeconds(e.target.value)} className="w-14 bg-[#14141a] border border-white/10 rounded-md px-2 py-1.5 text-xs text-textMain outline-none focus:border-yellow-500/50 text-center" />
                    <button onClick={handleWait} className="flex-1 px-3 py-1.5 rounded-md bg-yellow-500/20 border border-yellow-500/30 text-yellow-400 text-xs font-medium hover:bg-yellow-500/30 transition-all flex items-center justify-center gap-1">
                      <Clock className="w-3 h-3" />
                      Wait
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-medium text-textMuted uppercase tracking-wider mb-1.5 block">Run Script</label>
                  <textarea
                    value={scriptCode}
                    onChange={(e) => setScriptCode(e.target.value)}
                    placeholder="document.querySelector('.title').textContent"
                    rows={3}
                    className="w-full bg-[#14141a] border border-white/10 rounded-md px-2 py-1.5 text-xs text-textMain outline-none focus:border-cyan-500/50 placeholder:text-textMuted/50 font-mono resize-none mb-1.5"
                  />
                  <button onClick={handleExecuteScript} className="w-full px-3 py-1.5 rounded-md bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 text-xs font-medium hover:bg-cyan-500/30 transition-all flex items-center justify-center gap-1">
                    <Code className="w-3 h-3" />
                    Execute
                  </button>
                </div>
              </div>
            </div>

            <div className="p-3 border-b border-white/10">
              <h2 className="text-xs font-semibold text-textMain uppercase tracking-wider flex items-center gap-1.5 mb-3">
                <ListOrdered className="w-3.5 h-3.5 text-indigo-400" />
                Sequence Builder
              </h2>

              <div className="bg-[#14141a] border border-white/10 rounded-lg p-2.5 mb-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <select
                    value={addStepType}
                    onChange={(e) => setAddStepType(e.target.value as SequenceStep['type'])}
                    className="flex-1 bg-[#0a0a0f] border border-white/10 rounded-md px-2 py-1 text-xs text-textMain outline-none"
                  >
                    {(['navigate', 'click', 'fill', 'extract', 'wait', 'script'] as const).map((t) => (
                      <option key={t} value={t}>{stepTypeLabels[t]}</option>
                    ))}
                  </select>
                  <button onClick={addSequenceStep} className="p-1.5 rounded-md bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/30 transition-all">
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
                {addStepType === 'navigate' && (
                  <input value={addStepValue} onChange={(e) => setAddStepValue(e.target.value)} placeholder="URL" className="w-full bg-[#0a0a0f] border border-white/10 rounded-md px-2 py-1 text-xs text-textMain outline-none focus:border-indigo-500/50 placeholder:text-textMuted/50 mb-1.5" />
                )}
                {['click', 'fill', 'extract'].includes(addStepType) && (
                  <input value={addStepSelector} onChange={(e) => setAddStepSelector(e.target.value)} placeholder="CSS selector" className="w-full bg-[#0a0a0f] border border-white/10 rounded-md px-2 py-1 text-xs text-textMain outline-none focus:border-indigo-500/50 placeholder:text-textMuted/50 mb-1.5" />
                )}
                {addStepType === 'fill' && (
                  <input value={addStepValue} onChange={(e) => setAddStepValue(e.target.value)} placeholder="Value" className="w-full bg-[#0a0a0f] border border-white/10 rounded-md px-2 py-1 text-xs text-textMain outline-none focus:border-indigo-500/50 placeholder:text-textMuted/50 mb-1.5" />
                )}
                {addStepType === 'wait' && (
                  <input type="number" min="1" value={addStepSeconds} onChange={(e) => setAddStepSeconds(e.target.value)} placeholder="Seconds" className="w-full bg-[#0a0a0f] border border-white/10 rounded-md px-2 py-1 text-xs text-textMain outline-none focus:border-indigo-500/50 placeholder:text-textMuted/50 mb-1.5" />
                )}
                {addStepType === 'script' && (
                  <input value={addStepValue} onChange={(e) => setAddStepValue(e.target.value)} placeholder="JavaScript code" className="w-full bg-[#0a0a0f] border border-white/10 rounded-md px-2 py-1 text-xs text-textMain outline-none focus:border-indigo-500/50 placeholder:text-textMuted/50 font-mono mb-1.5" />
                )}
              </div>

              {sequenceSteps.length > 0 && (
                <div className="space-y-1 mb-3">
                  {sequenceSteps.map((step, i) => (
                    <div key={step.id} className="flex items-center gap-1.5 bg-[#14141a] border border-white/10 rounded-md px-2 py-1.5">
                      <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 ${stepTypeColors[step.type]}`}>
                        {stepTypeIcons[step.type]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-[10px] text-textMuted mr-1">{i + 1}.</span>
                        <span className="text-xs text-textMain font-medium">{stepTypeLabels[step.type]}</span>
                        {step.selector && <span className="text-[10px] text-textMuted ml-1 truncate">{step.selector}</span>}
                        {step.value && <span className="text-[10px] text-textMuted ml-1 truncate">{step.value}</span>}
                        {step.type === 'wait' && <span className="text-[10px] text-textMuted ml-1">{step.seconds}s</span>}
                      </div>
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        <button onClick={() => moveStep(i, 'up')} disabled={i === 0} className="p-0.5 rounded text-textMuted hover:text-textMain disabled:opacity-30 transition-all">
                          <ChevronUp className="w-3 h-3" />
                        </button>
                        <button onClick={() => moveStep(i, 'down')} disabled={i === sequenceSteps.length - 1} className="p-0.5 rounded text-textMuted hover:text-textMain disabled:opacity-30 transition-all">
                          <ChevronDown className="w-3 h-3" />
                        </button>
                        <button onClick={() => removeStep(step.id)} className="p-0.5 rounded text-textMuted hover:text-red-400 transition-all">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {sequenceSteps.length === 0 && (
                <p className="text-[10px] text-textMuted text-center py-2 mb-3">Add steps to build a sequence</p>
              )}

              <button
                onClick={runSequence}
                disabled={sequenceRunning || sequenceSteps.length === 0}
                className="w-full px-3 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-xs font-semibold hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-1.5"
              >
                {sequenceRunning ? (
                  <>
                    <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Running...
                  </>
                ) : (
                  <>
                    <Play className="w-3 h-3" />
                    Run Sequence ({sequenceSteps.length})
                  </>
                )}
              </button>

              {sequenceSteps.length > 0 && (
                <button onClick={() => setSequenceSteps([])} className="w-full mt-1.5 px-3 py-1.5 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium hover:bg-red-500/20 transition-all flex items-center justify-center gap-1">
                  <Trash2 className="w-3 h-3" />
                  Clear Sequence
                </button>
              )}
            </div>

            <div className="p-3">
              <h2 className="text-xs font-semibold text-textMain uppercase tracking-wider flex items-center gap-1.5 mb-2">
                <Activity className="w-3.5 h-3.5 text-green-400" />
                Activity Log
              </h2>
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {activityLog.length === 0 ? (
                  <p className="text-[10px] text-textMuted text-center py-3">No activity yet</p>
                ) : (
                  activityLog.map((entry) => (
                    <div key={entry.id} className="bg-[#14141a] border border-white/5 rounded-md px-2 py-1.5">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-[10px] font-medium text-blue-400">{entry.action}</span>
                        <span className="text-[9px] text-textMuted ml-auto">
                          {entry.timestamp.toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="text-[10px] text-textMuted truncate">{entry.detail}</div>
                      <div className="text-[10px] text-green-400/70 truncate">{entry.result}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

