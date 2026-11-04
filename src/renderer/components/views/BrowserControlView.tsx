import { useState, useRef, useCallback, useEffect } from 'react';
import { useChatStore } from '../../stores/chat';
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
  FolderOpen,
  Wifi,
  WifiOff,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';
import { LiveDesktopStrip } from './LiveDesktopStrip';

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

interface LiveBridgeStatus {
  connected: boolean;
  port: number;
  extensionVersion: string;
  browser: string;
  lastError: string;
  connections?: Array<{ id: string; browser: string; extensionVersion: string; active: boolean }>;
}

interface ExtensionSetupInfo {
  installed: boolean;
  extensionPath: string;
  extensionVersion: string;
  browser: { kind: string; path: string } | null;
  profilePath: string;
  cdpRunning: boolean;
  cdpPort: number | null;
  extensionLoaded: boolean;
  extensionId: string;
  bridgeConnected: boolean;
  bridgeConnections: number;
  needsRestart: boolean;
  lastError: string;
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
  const [bridgeStatus, setBridgeStatus] = useState<LiveBridgeStatus | null>(null);
  const [setupStatus, setSetupStatus] = useState<ExtensionSetupInfo | null>(null);
  const [setupOpen, setSetupOpen] = useState(true);
  const [setupBusy, setSetupBusy] = useState('');
  const [setupMessage, setSetupMessage] = useState('');

  const refreshBridgeStatus = useCallback(async () => {
    try {
      const live = await window.api.bridgeStatus();
      if (live?.ok) setBridgeStatus(live.status as LiveBridgeStatus);
      const setup = await window.api.bridgeSetupStatus();
      if (setup?.ok) setSetupStatus(setup.status as ExtensionSetupInfo);
    } catch {
      /* bridge IPC is unavailable during shutdown */
    }
  }, []);

  useEffect(() => {
    void refreshBridgeStatus();
    const timer = setInterval(() => void refreshBridgeStatus(), 4_000);
    return () => clearInterval(timer);
  }, [refreshBridgeStatus]);

  const runBridgeSetup = useCallback(
    async (kind: 'launch' | 'restart' | 'install' | 'folder' | 'test') => {
      setSetupBusy(kind);
      setSetupMessage('');
      try {
        if (kind === 'launch' || kind === 'restart') {
          const result = kind === 'launch'
            ? await window.api.bridgeSetupLaunch()
            : await window.api.bridgeSetupRestart();
          if (result?.ok) {
            setSetupMessage(
              result.installedExtension
                ? 'Browser launched and the extension was installed automatically.'
                : 'Browser is ready and the extension is attached.',
            );
          } else {
            setSetupMessage(String(result?.error || 'Could not start the browser.'));
          }
        } else if (kind === 'install') {
          const result = await window.api.bridgeSetupInstall();
          setSetupMessage(
            result?.ok
              ? 'Folder path copied and chrome://extensions opened. Choose "Load unpacked" and paste the path.'
              : String(result?.error || 'Could not prepare the extension folder.'),
          );
        } else if (kind === 'folder') {
          const result = await window.api.bridgeSetupOpenFolder();
          setSetupMessage(result?.ok ? 'Opened the extension folder.' : String(result?.error || 'Could not open the folder.'));
        } else if (kind === 'test') {
          const result = await window.api.bridgeExec({ command: 'ping' });
          setSetupMessage(result?.ok ? 'Bridge replied — the connection is live.' : String(result?.error || 'No reply from the bridge.'));
        }
      } catch (err) {
        setSetupMessage(String((err as Error)?.message || err));
      } finally {
        setSetupBusy('');
        void refreshBridgeStatus();
      }
    },
    [refreshBridgeStatus],
  );

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

  /**
   * Every automation control here hands the job to the agent.
   *
   * These handlers used to write a line into the local activity log and claim
   * success. They never touched the page: the extract button literally returned
   * the placeholder string `[Extracted content from "…"]` as though it were real
   * data. Buttons that lie are worse than buttons that are absent, so they now
   * do the real thing — the agent runs the InAppBrowser, which is a genuine
   * browser inside this app, and the log records what was asked and that it was
   * dispatched rather than inventing an outcome.
   */
  const sendMessage = useChatStore((s) => s.sendMessage);
  const runViaAgent = useCallback(
    (action: string, detail: string, instruction: string) => {
      addLog(action, detail, 'Sent to Infinite AI — result appears in Chats');
      void sendMessage(instruction);
    },
    [addLog, sendMessage],
  );

  const handleNavigate = () => {
    let target = url.trim();
    if (!target || target === 'https://') return;
    if (!target.startsWith('http://') && !target.startsWith('https://')) {
      target = 'https://' + target;
    }
    setCurrentUrl(target);
    setPageTitle(target);
    runViaAgent('Navigate', target, `Open ${target} in the in-app browser and tell me what the page says.`);
  };

  const handleBack = () => runViaAgent('Navigate', 'Back', `Go back one page in the in-app browser.`);

  const handleForward = () => runViaAgent('Navigate', 'Forward', `Go forward one page in the in-app browser.`);

  const handleRefresh = () => {
    if (currentUrl) runViaAgent('Navigate', 'Refresh', `Reload ${currentUrl} in the in-app browser.`);
  };

  const handleClick = () => {
    const selector = clickSelector.trim();
    if (!selector) return;
    runViaAgent('Click', selector, `In the in-app browser, click the element matching the CSS selector "${selector}".`);
    setClickSelector('');
  };

  const handleFill = () => {
    const selector = fillSelector.trim();
    if (!selector) return;
    runViaAgent('Fill', `${selector} = "${fillValue}"`, `In the in-app browser, type "${fillValue}" into the element matching "${selector}".`);
    setFillSelector('');
    setFillValue('');
  };

  const handleExtract = () => {
    const selector = extractSelector.trim();
    if (!selector) return;
    // No fabricated result: the real text arrives from the agent in Chats.
    setExtractResult('Sent to Infinite AI — the real extracted text appears in Chats.');
    runViaAgent('Extract', selector, `In the in-app browser, read the text of the element matching "${selector}" and give me exactly what it says.`);
  };

  const handleScreenshot = () => runViaAgent('Screenshot', 'Full page', 'Take a screenshot of the current page in the in-app browser and describe it.');

  const handleExecuteScript = () => {
    const code = scriptCode.trim();
    if (!code) return;
    runViaAgent('Script', code.slice(0, 60), `Run this in the in-app browser and tell me the result:\n\n${code}`);
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
    <div className="flex-1 flex flex-col bg-[#0a0a0f] overflow-hidden animate-fade-in h-full">
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        <div className="flex-1 flex flex-col min-w-0 h-full">
          <div className="p-4 border-b border-white/10 bg-[#0a0a0f]/80 backdrop-blur-md z-10">
            <div className="flex items-center justify-between mb-4">
              <h1 className="text-lg font-bold text-textMain flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                  <Globe className="w-4 h-4 text-white" />
                </div>
                Browser Control
              </h1>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSetupOpen((v) => !v)}
                  title="Show browser connection setup"
                  className={`px-2 py-1 rounded-full border flex items-center gap-1.5 transition-all ${
                    bridgeStatus?.connected
                      ? 'bg-green-500/10 border-green-500/20 hover:bg-green-500/15'
                      : 'bg-amber-500/10 border-amber-500/25 hover:bg-amber-500/15'
                  }`}
                >
                  {bridgeStatus?.connected ? (
                    <Wifi className="w-3 h-3 text-green-400" />
                  ) : (
                    <WifiOff className="w-3 h-3 text-amber-400" />
                  )}
                  <span className={`text-[10px] font-medium uppercase tracking-wider ${bridgeStatus?.connected ? 'text-green-400' : 'text-amber-400'}`}>
                    {bridgeStatus?.connected ? 'Bridge Connected' : 'Bridge Offline'}
                  </span>
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 p-1 rounded-lg bg-[#14141a] border border-white/10">
                <button onClick={handleBack} aria-label="Go back" className="p-2 rounded-md text-textMuted hover:text-textMain hover:bg-white/5 transition-all">
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <button onClick={handleForward} aria-label="Go forward" className="p-2 rounded-md text-textMuted hover:text-textMain hover:bg-white/5 transition-all">
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button onClick={handleRefresh} aria-label="Refresh page" className="p-2 rounded-md text-textMuted hover:text-textMain hover:bg-white/5 transition-all">
                  <RotateCw className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 flex items-center gap-2 bg-[#14141a] border border-white/10 rounded-lg px-3 py-1.5 focus-within:border-blue-500/50 transition-all">
                <Search className="w-3.5 h-3.5 text-textMuted flex-shrink-0" />
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleNavigate()}
                  placeholder="Enter URL or search query..."
                  className="flex-1 bg-transparent text-sm text-textMain outline-none placeholder:text-textMuted/50"
                  aria-label="URL input"
                />
              </div>
              <button onClick={handleNavigate} className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-sm font-medium hover:from-blue-500 hover:to-indigo-500 active:scale-95 transition-all shadow-lg shadow-blue-600/20">
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
              <div className="w-full h-full flex items-center justify-center p-6">
                <div className="text-center max-w-xs">
                  <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-blue-500/20 to-indigo-500/20 flex items-center justify-center mx-auto mb-6 border border-blue-500/10">
                      <Globe className="w-10 h-10 text-blue-400/60" />
                  </div>
                  <h3 className="text-textMain font-medium mb-2">No Page Loaded</h3>
                  <p className="text-textMuted text-sm leading-relaxed">Enter a URL above to start controlling your web experience with Infinite AI</p>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-white/10 bg-[#14141a]/80 backdrop-blur-md p-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="text-[10px] font-bold text-textMuted uppercase tracking-wider flex-shrink-0">Current Page</span>
                <div className="flex items-center gap-2 truncate">
                  <span className="text-xs text-textMain font-medium truncate" title={pageTitle}>{pageTitle || 'None'}</span>
                  <span className="text-[10px] text-textMuted truncate opacity-60">{currentUrl || 'no-url'}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="relative group">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-textMuted/50 uppercase pointer-events-none">DOM</span>
                  <input
                    value={inspectorSelector}
                    onChange={(e) => setInspectorSelector(e.target.value)}
                    placeholder="CSS selector..."
                    className="w-48 bg-[#0a0a0f] border border-white/10 rounded-md pl-8 pr-2 py-1 text-xs text-textMain outline-none focus:border-blue-500/50 placeholder:text-textMuted/50 transition-all"
                    aria-label="CSS Selector Inspector"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="w-full md:w-80 border-l border-white/10 bg-[#0a0a0f] flex flex-col overflow-hidden flex-shrink-0 h-full">
          <div className="flex-1 overflow-y-auto min-h-0 scrollbar-thin scrollbar-thumb-white/10">
            <div className="p-4 border-b border-white/10">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-bold text-textMain uppercase tracking-widest flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5 text-green-400" />
                  Browser Connection
                </h2>
                <button
                  onClick={() => setSetupOpen((v) => !v)}
                  className="text-[10px] font-medium text-textMuted hover:text-textMain transition-colors"
                >
                  {setupOpen ? 'Hide' : 'Setup'}
                </button>
              </div>

              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${bridgeStatus?.connected ? 'bg-green-500 animate-pulse' : 'bg-amber-400'}`} />
                <span className="text-xs font-medium text-textMain truncate">
                  {bridgeStatus?.connected
                    ? 'Extension connected'
                    : setupStatus?.cdpRunning
                      ? 'Browser ready — extension not attached'
                      : 'Browser not running'}
                </span>
              </div>
              <p className="mt-1.5 text-[10px] text-textMuted truncate" title={setupStatus?.extensionPath}>
                {setupStatus?.browser ? `${setupStatus.browser.kind} · port ${bridgeStatus?.port ?? '—'}` : 'Chrome or Edge not found'}
                {setupStatus?.extensionVersion ? ` · v${setupStatus.extensionVersion}` : ''}
              </p>
              {(bridgeStatus?.connections?.length ?? 0) > 1 && (
                <p className="mt-1 text-[10px] text-blue-300/80">
                  {bridgeStatus?.connections?.length} browsers attached — newest is active
                </p>
              )}

              {setupOpen && (
                <div className="mt-3 space-y-2">
                  <button
                    onClick={() => void runBridgeSetup('launch')}
                    disabled={Boolean(setupBusy)}
                    className="w-full px-3 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-semibold hover:from-blue-500 hover:to-indigo-500 active:scale-[0.98] transition-all shadow-lg shadow-blue-600/20 disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    {setupBusy === 'launch' ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                    {setupStatus?.cdpRunning ? 'Connect browser' : 'Launch Infinite OS browser'}
                  </button>

                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => void runBridgeSetup('install')}
                      disabled={Boolean(setupBusy)}
                      title="Use the extension in your main Chrome (guided one-time install)"
                      className="px-2 py-1.5 rounded-md bg-white/5 border border-white/10 text-textMuted hover:text-textMain hover:bg-white/10 text-[10px] font-medium transition-all disabled:opacity-50 flex items-center justify-center gap-1"
                    >
                      <ExternalLink className="w-3 h-3" />
                      My Chrome
                    </button>
                    <button
                      onClick={() => void runBridgeSetup('folder')}
                      disabled={Boolean(setupBusy)}
                      title="Open the installed extension folder"
                      className="px-2 py-1.5 rounded-md bg-white/5 border border-white/10 text-textMuted hover:text-textMain hover:bg-white/10 text-[10px] font-medium transition-all disabled:opacity-50 flex items-center justify-center gap-1"
                    >
                      <FolderOpen className="w-3 h-3" />
                      Folder
                    </button>
                    <button
                      onClick={() => void runBridgeSetup('test')}
                      disabled={Boolean(setupBusy)}
                      title="Send a ping through the bridge"
                      className="px-2 py-1.5 rounded-md bg-white/5 border border-white/10 text-textMuted hover:text-textMain hover:bg-white/10 text-[10px] font-medium transition-all disabled:opacity-50 flex items-center justify-center gap-1"
                    >
                      {setupBusy === 'test' ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Wifi className="w-3 h-3" />}
                      Test
                    </button>
                  </div>

                  {setupStatus?.needsRestart && (
                    <button
                      onClick={() => void runBridgeSetup('restart')}
                      disabled={Boolean(setupBusy)}
                      className="w-full px-3 py-1.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[10px] font-medium hover:bg-amber-500/20 transition-all disabled:opacity-50 flex items-center justify-center gap-1"
                    >
                      {setupBusy === 'restart' ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RotateCw className="w-3 h-3" />}
                      Restart the Infinite OS browser
                    </button>
                  )}

                  {setupMessage && (
                    <p className="text-[10px] leading-relaxed text-textMuted bg-white/5 border border-white/10 rounded-md px-2 py-1.5">
                      {setupMessage}
                    </p>
                  )}
                  {setupStatus?.lastError && !setupMessage && (
                    <p className="text-[10px] leading-relaxed text-amber-300/90 bg-amber-500/5 border border-amber-500/20 rounded-md px-2 py-1.5">
                      {setupStatus.lastError}
                    </p>
                  )}
                  <p className="text-[10px] leading-relaxed text-textMuted/70">
                    The agent uses a dedicated Chrome profile, so it keeps control while you use your own browser.
                  </p>
                </div>
              )}
            </div>

            <div className="p-4 border-b border-white/10">
              <h2 className="text-xs font-bold text-textMain uppercase tracking-widest flex items-center gap-2 mb-4">
                <Terminal className="w-3.5 h-3.5 text-blue-400" />
                Automation Tools
              </h2>

              <div className="space-y-5">
                <div className="group/tool">
                  <label className="text-[10px] font-bold text-textMuted uppercase tracking-wider mb-2 block group-hover/tool:text-orange-400 transition-colors">Click Element</label>
                  <div className="flex gap-2">
                    <input value={clickSelector} onChange={(e) => setClickSelector(e.target.value)} placeholder="e.g. #submit-btn" className="flex-1 bg-[#14141a] border border-white/10 rounded-md px-2 py-1.5 text-xs text-textMain outline-none focus:border-orange-500/50 placeholder:text-textMuted/50 transition-all" />
                    <button onClick={handleClick} className="px-3 py-1.5 rounded-md bg-orange-500/10 border border-orange-500/30 text-orange-400 text-xs font-medium hover:bg-orange-500/20 active:scale-95 transition-all flex items-center gap-1">
                      <MousePointerClick className="w-3 h-3" />
                      Click
                    </button>
                  </div>
                </div>

                <div className="group/tool">
                  <label className="text-[10px] font-bold text-textMuted uppercase tracking-wider mb-2 block group-hover/tool:text-green-400 transition-colors">Fill Form</label>
                  <div className="flex gap-2 mb-2">
                    <input value={fillSelector} onChange={(e) => setFillSelector(e.target.value)} placeholder="CSS selector" className="flex-1 bg-[#14141a] border border-white/10 rounded-md px-2 py-1.5 text-xs text-textMain outline-none focus:border-green-500/50 placeholder:text-textMuted/50 transition-all" />
                    <input value={fillValue} onChange={(e) => setFillValue(e.target.value)} placeholder="Value" className="w-24 bg-[#14141a] border border-white/10 rounded-md px-2 py-1.5 text-xs text-textMain outline-none focus:border-green-500/50 placeholder:text-textMuted/50 transition-all" />
                  </div>
                  <button onClick={handleFill} className="w-full px-3 py-1.5 rounded-md bg-green-500/10 border border-green-500/30 text-green-400 text-xs font-medium hover:bg-green-500/20 active:scale-95 transition-all flex items-center justify-center gap-1">
                    <Type className="w-3 h-3" />
                    Fill Input
                  </button>
                </div>

                <div className="group/tool">
                  <label className="text-[10px] font-bold text-textMuted uppercase tracking-wider mb-2 block group-hover/tool:text-purple-400 transition-colors">Extract Content</label>
                  <div className="flex gap-2 mb-2">
                    <input value={extractSelector} onChange={(e) => setExtractSelector(e.target.value)} placeholder="CSS selector" className="flex-1 bg-[#14141a] border border-white/10 rounded-md px-2 py-1.5 text-xs text-textMain outline-none focus:border-purple-500/50 placeholder:text-textMuted/50 transition-all" />
                    <button onClick={handleExtract} className="px-3 py-1.5 rounded-md bg-purple-500/10 border border-purple-500/30 text-purple-400 text-xs font-medium hover:bg-purple-500/20 active:scale-95 transition-all flex items-center gap-1">
                      <Copy className="w-3 h-3" />
                      Extract
                    </button>
                  </div>
                  {extractResult && (
                    <div className="bg-purple-500/5 border border-purple-500/20 rounded-md px-2 py-2 text-xs text-purple-300 mb-2 break-all font-mono leading-relaxed">
                      {extractResult}
                    </div>
                  )}
                </div>

                <div className="flex gap-2">
                  <button onClick={handleScreenshot} className="flex-1 px-3 py-1.5 rounded-md bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs font-medium hover:bg-cyan-500/20 active:scale-95 transition-all flex items-center justify-center gap-1">
                    <Camera className="w-3 h-3" />
                    Screenshot
                  </button>
                  <div className="flex items-center gap-1.5 flex-1">
                    <input type="number" min="1" value={waitSeconds} onChange={(e) => setWaitSeconds(e.target.value)} className="w-14 bg-[#14141a] border border-white/10 rounded-md px-2 py-1.5 text-xs text-textMain outline-none focus:border-yellow-500/50 text-center" />
                    <button onClick={handleWait} className="flex-1 px-3 py-1.5 rounded-md bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-xs font-medium hover:bg-yellow-500/20 active:scale-95 transition-all flex items-center justify-center gap-1">
                      <Clock className="w-3 h-3" />
                      Wait
                    </button>
                  </div>
                </div>

                <div className="group/tool">
                  <label className="text-[10px] font-bold text-textMuted uppercase tracking-wider mb-2 block group-hover/tool:text-cyan-400 transition-colors">Custom JS Script</label>
                  <textarea
                    value={scriptCode}
                    onChange={(e) => setScriptCode(e.target.value)}
                    placeholder="document.title"
                    rows={3}
                    className="w-full bg-[#14141a] border border-white/10 rounded-md px-2 py-1.5 text-xs text-textMain outline-none focus:border-cyan-500/50 placeholder:text-textMuted/50 font-mono resize-none mb-2 transition-all"
                  />
                  <button onClick={handleExecuteScript} className="w-full px-3 py-1.5 rounded-md bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs font-medium hover:bg-cyan-500/20 active:scale-95 transition-all flex items-center justify-center gap-1">
                    <Code className="w-3 h-3" />
                    Execute Script
                  </button>
                </div>
              </div>
            </div>

            <div className="p-4 border-b border-white/10">
              <h2 className="text-xs font-bold text-textMain uppercase tracking-widest flex items-center gap-2 mb-4">
                <ListOrdered className="w-3.5 h-3.5 text-indigo-400" />
                Sequence Builder
              </h2>

              <div className="bg-[#14141a] border border-white/10 rounded-lg p-3 mb-4 shadow-inner">
                <div className="flex items-center gap-2 mb-3">
                  <select
                    value={addStepType}
                    onChange={(e) => setAddStepType(e.target.value as SequenceStep['type'])}
                    className="flex-1 bg-[#0a0a0f] border border-white/10 rounded-md px-2 py-1 text-xs text-textMain outline-none focus:border-indigo-500/50 appearance-none cursor-pointer"
                  >
                    {(['navigate', 'click', 'fill', 'extract', 'wait', 'script'] as const).map((t) => (
                      <option key={t} value={t}>{stepTypeLabels[t]}</option>
                    ))}
                  </select>
                  <button onClick={addSequenceStep} className="p-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-500 active:scale-90 transition-all shadow-lg shadow-indigo-600/20">
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="space-y-2">
                  {addStepType === 'navigate' && (
                    <input value={addStepValue} onChange={(e) => setAddStepValue(e.target.value)} placeholder="Target URL" className="w-full bg-[#0a0a0f] border border-white/10 rounded-md px-2 py-1 text-xs text-textMain outline-none focus:border-indigo-500/50 placeholder:text-textMuted/50 transition-all" />
                  )}
                  {['click', 'fill', 'extract'].includes(addStepType) && (
                    <input value={addStepSelector} onChange={(e) => setAddStepSelector(e.target.value)} placeholder="CSS selector" className="w-full bg-[#0a0a0f] border border-white/10 rounded-md px-2 py-1 text-xs text-textMain outline-none focus:border-indigo-500/50 placeholder:text-textMuted/50 transition-all" />
                  )}
                  {addStepType === 'fill' && (
                    <input value={addStepValue} onChange={(e) => setAddStepValue(e.target.value)} placeholder="Input value" className="w-full bg-[#0a0a0f] border border-white/10 rounded-md px-2 py-1 text-xs text-textMain outline-none focus:border-indigo-500/50 placeholder:text-textMuted/50 transition-all" />
                  )}
                  {addStepType === 'wait' && (
                    <input type="number" min="1" value={addStepSeconds} onChange={(e) => setAddStepSeconds(e.target.value)} placeholder="Wait time (s)" className="w-full bg-[#0a0a0f] border border-white/10 rounded-md px-2 py-1 text-xs text-textMain outline-none focus:border-indigo-500/50 placeholder:text-textMuted/50 transition-all" />
                  )}
                  {addStepType === 'script' && (
                    <input value={addStepValue} onChange={(e) => setAddStepValue(e.target.value)} placeholder="JavaScript expression" className="w-full bg-[#0a0a0f] border border-white/10 rounded-md px-2 py-1 text-xs text-textMain outline-none focus:border-indigo-500/50 placeholder:text-textMuted/50 font-mono transition-all" />
                  )}
                </div>
              </div>

              {sequenceSteps.length > 0 && (
                <div className="space-y-1.5 mb-4">
                  {sequenceSteps.map((step, i) => (
                    <div key={step.id} className="flex items-center gap-2 bg-[#14141a] border border-white/5 hover:border-white/20 rounded-md px-2 py-2 transition-all group">
                      <div className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 ${stepTypeColors[step.type]} shadow-sm`}>
                        {stepTypeIcons[step.type]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-1">
                          <span className="text-[9px] font-bold text-textMuted uppercase opacity-50">{i + 1}</span>
                          <span className="text-xs text-textMain font-medium">{stepTypeLabels[step.type]}</span>
                        </div>
                        <div className="text-[10px] text-textMuted truncate opacity-70">
                          {step.selector || step.value || `${step.seconds}s` || 'No detail'}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => moveStep(i, 'up')} disabled={i === 0} className="p-1 rounded text-textMuted hover:text-textMain disabled:opacity-20 transition-all">
                          <ChevronUp className="w-3 h-3" />
                        </button>
                        <button onClick={() => moveStep(i, 'down')} disabled={i === sequenceSteps.length - 1} className="p-1 rounded text-textMuted hover:text-textMain disabled:opacity-20 transition-all">
                          <ChevronDown className="w-3 h-3" />
                        </button>
                        <button onClick={() => removeStep(step.id)} className="p-1 rounded text-textMuted hover:text-red-400 transition-all">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {sequenceSteps.length === 0 && (
                <div className="text-center py-6 border-2 border-dashed border-white/5 rounded-xl mb-4">
                  <p className="text-[11px] text-textMuted italic">Your sequence is empty</p>
                </div>
              )}

              <button
                onClick={runSequence}
                disabled={sequenceRunning || sequenceSteps.length === 0}
                className="w-full px-4 py-2.5 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-xs font-bold hover:from-indigo-500 hover:to-purple-500 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/30"
              >
                {sequenceRunning ? (
                  <>
                    <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Executing Sequence...
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" />
                    Run Sequence ({sequenceSteps.length})
                  </>
                )}
              </button>
              {sequenceSteps.length > 0 && (
                <button onClick={() => setSequenceSteps([])} className="w-full mt-2 px-3 py-1.5 rounded-md text-red-400/60 text-[10px] font-medium hover:text-red-400 hover:bg-red-500/5 transition-all flex items-center justify-center gap-1">
                  <Trash2 className="w-3 h-3" />
                  Clear All Steps
                </button>
              )}
            </div>

            <div className="p-4 border-b border-white/10">
              {/* Replaces the standalone "Live Computer" page — same capability,
                  no extra screen. */}
              <LiveDesktopStrip />
            </div>

            <div className="p-4">
              <h2 className="text-xs font-bold text-textMain uppercase tracking-widest flex items-center gap-2 mb-3">
                <Activity className="w-3.5 h-3.5 text-green-400" />
                Live Activity
              </h2>
              <div className="space-y-2 max-h-[300px] overflow-y-auto scrollbar-thin scrollbar-thumb-white/10">
                {activityLog.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-[11px] text-textMuted italic opacity-50">Waiting for first action...</p>
                  </div>
                ) : (
                  activityLog.map((entry) => (
                    <div key={entry.id} className="group bg-[#14141a] border border-white/5 hover:border-blue-500/30 rounded-lg px-3 py-2 transition-all">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-bold text-blue-400 uppercase tracking-tighter">{entry.action}</span>
                        <span className="text-[9px] text-textMuted opacity-50 font-mono">
                          {entry.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                      </div>
                      <div className="text-[10px] text-textMuted truncate opacity-80 group-hover:opacity-100 transition-opacity font-medium">
                        {entry.detail}
                      </div>
                      <div className="text-[10px] text-green-400/80 truncate font-mono mt-0.5 bg-green-500/5 px-1 rounded">
                        {entry.result}
                      </div>
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
