import { useCallback, useEffect, useState } from 'react';
import type { ProviderInfo } from '../../../shared/types';
import { useNotificationStore } from '../../stores/notifications';
import { syncActiveModelToMain } from '../../utils/active-model-sync';
import { useUIStore, type LogoStyle } from '../../stores/ui';
import { InfiniteLogo } from '../brand/InfiniteLogo';
import { useChatStore } from '../../stores/chat';

const LOGO_STYLES: Array<{ id: LogoStyle; name: string; description: string }> = [
  { id: 'spectrum', name: 'Original Spectrum', description: 'The violet, cyan, and pink Infinite AI signature.' },
  { id: 'luminous', name: 'White Infinite', description: 'A clean white Infinite loop with a soft white glow.' },
  { id: 'ice', name: 'Light Blue Infinite', description: 'The original light-blue loop with moving blue and icy-white light.' },
];

const OS_COLORS = [
  { name: 'Violet', value: '#8b5cf6' },
  { name: 'Electric blue', value: '#3b82f6' },
  { name: 'Cyan', value: '#06b6d4' },
  { name: 'Emerald', value: '#10b981' },
  { name: 'Lime', value: '#84cc16' },
  { name: 'Rose', value: '#f43f5e' },
  { name: 'Pink', value: '#ec4899' },
  { name: 'Amber', value: '#f59e0b' },
];

interface CurrentSettings {
  provider: string;
  model: string;
  cwd: string;
  brainMode?: boolean;
  ollamaModel?: string;
  hasApiKey?: boolean;
}

/** Shape returned by the continuous evolution loop (main/brain/evolution-loop.ts). */
interface EvolutionLoopStatus {
  enabled: boolean;
  intervalMs: number;
  cycleInFlight: boolean;
  cyclesCompleted: number;
  lastRunAt: number | null;
  nextRunAt: number | null;
  lastSummary: string | null;
  lastError: string | null;
}

function loadCurrent(): CurrentSettings {
  try {
    const raw = localStorage.getItem('infinite:current');
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { provider: 'openrouter', model: 'google/gemma-4-31b-it:free', cwd: '.' };
}

function saveCurrent(patch: Partial<CurrentSettings>) {
  const current = loadCurrent();
  localStorage.setItem('infinite:current', JSON.stringify({ ...current, ...patch }));
  // Background consumers (WhatsApp/Telegram turns, scheduled runs) read the
  // selection from the main-process store — keep it in sync so they answer on
  // the picked model instead of a silent local fallback.
  if (patch.provider !== undefined || patch.model !== undefined || patch.cwd !== undefined) {
    syncActiveModelToMain({ ...current, ...patch });
  }
}

function PhoneConnectCard() {
  const [info, setInfo] = useState<{ url: string; qrDataUrl?: string; lanIp?: string; port?: number } | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await (window as unknown as { api?: { remotePhoneInfo?: () => Promise<unknown> } }).api?.remotePhoneInfo?.() as { url?: string; qrDataUrl?: string; lanIp?: string; port?: number } | undefined;
        if (alive && res?.url) setInfo(res as never);
      } catch { /* offline */ }
    };
    void load();
    const id = window.setInterval(load, 8000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);
  const url = info?.url ?? '';
  return (
    <div className="card-premium border-cyan-500/15">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium text-textMain flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-500 text-white text-xs">◈</span>
            Connect Your Phone
          </h3>
          <p className="text-xs text-textMuted mt-1 max-w-[560px]">Chat with your AI from anywhere on your network. Scan the QR or open the link on your phone — same Wi-Fi / LAN. Token-secured, no cloud.</p>
        </div>
        <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-white/5 border border-white/10 px-2.5 py-1 text-[10px] text-textMuted">LAN only · 8766</span>
      </div>
      {url ? (
        <div className="mt-3 flex flex-wrap items-center gap-4">
          {info?.qrDataUrl ? <img src={info.qrDataUrl} alt="Phone QR" className="h-28 w-28 rounded-lg border border-white/10 bg-white p-1" /> : null}
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wider text-textMuted/60">Phone URL</div>
            <div className="mt-1 break-all font-mono text-xs text-textMain bg-black/20 border border-white/10 rounded-lg px-2.5 py-2">{url}</div>
            <div className="mt-2 flex gap-2">
              <button onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ } }} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-textMain hover:bg-white/[0.07]">{copied ? 'Copied!' : 'Copy link'}</button>
              <button onClick={() => window.open(url, '_blank')} className="rounded-lg bg-white text-black px-3 py-1.5 text-xs font-medium hover:bg-zinc-100">Open preview</button>
            </div>

            <p className="text-[10px] text-textMuted mt-2">Phone &amp; PC must be on the same Wi-Fi/network (or VPN). If the page doesn&apos;t load, allow Infinite OS through Windows Firewall for port 8766.</p>          </div>
        </div>
      ) : (
        <p className="text-xs text-textMuted mt-3">Starting phone server… If this persists, check that Infinite OS is running and port 8766 is free.</p>
      )}
    </div>
  );
}

export function SettingsView() {
  const appearance = useUIStore();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [activeProvider, setActiveProvider] = useState<string>(() => loadCurrent().provider);
  const [apiKey, setApiKey] = useState('');
  const [apiKeyLoaded, setApiKeyLoaded] = useState(false);
  const [status, setStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [models, setModels] = useState<{ id: string; label: string; free: boolean; provider?: string }[]>([]);
  const [currentModel, setCurrentModel] = useState(() => loadCurrent().model);
  const [cloudflareAccountId, setCloudflareAccountId] = useState('');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [failoverEnabled, setFailoverEnabled] = useState(true);
  const [cwd, setCwd] = useState(() => loadCurrent().cwd);
  const [brainMode, setBrainMode] = useState(() => loadCurrent().brainMode ?? true);
  const [cliVersion, setCliVersion] = useState<{ version: string | null; serverVersion: string | null; minFreeVersion: string; freeTierSupported: boolean; serverStale: boolean } | null>(null);
  const [upgradingCli, setUpgradingCli] = useState(false);
  const [restartingServer, setRestartingServer] = useState(false);
  const currentSettings = loadCurrent();
  const addToast = useNotificationStore((s) => s.addToast);

  // Continuous self-evolution loop status (Settings → Self-Evolve card).
  const [evolve, setEvolve] = useState<EvolutionLoopStatus | null>(null);
  const [evolveBusy, setEvolveBusy] = useState(false);

  /**
   * Token/cost totals and background-build state.
   *
   * Both were finished in main and unreachable from the renderer. These cards
   * live here because SettingsView is what the sidebar actually opens; the
   * SettingsModal variants are only reachable through a control that is not
   * currently rendered, so anything added there is invisible in the packaged app.
   */
  const [usageTotals, setUsageTotals] = useState<{
    requests: number;
    costUsd: number;
    unpricedRequests?: number;
    formatted: { cost: string; input: string; output: string; note?: string };
    byModel: { provider: string; model: string; requests: number; costUsd: number; pricing?: string }[];
  } | null>(null);
  const [usageBusy, setUsageBusy] = useState(false);

  const [buildStatus, setBuildStatus] = useState<{
    phase: 'idle' | 'building' | 'ready' | 'failed' | 'applying';
    error?: string;
  } | null>(null);
  const [buildBusy, setBuildBusy] = useState(false);

  const refreshUsage = useCallback(async () => {
    const t = await window.api.usageGet().catch(() => null);
    setUsageTotals(t && typeof t === 'object' ? (t as typeof usageTotals) : null);
  }, []);

  const clearUsage = async () => {
    setUsageBusy(true);
    try {
      await window.api.usageReset();
      await refreshUsage();
    } finally {
      setUsageBusy(false);
    }
  };

  const refreshBuildStatus = useCallback(async () => {
    const s = await window.api.buildStatus().catch(() => null);
    setBuildStatus(s && typeof s === 'object' ? (s as typeof buildStatus) : null);
  }, []);

  const runBackgroundBuild = async (action: 'buildStart' | 'buildCancel') => {
    setBuildBusy(true);
    try {
      const next = await window.api[action]().catch(() => null);
      if (next && typeof next === 'object') setBuildStatus(next as typeof buildStatus);
      else await refreshBuildStatus();
    } finally {
      setBuildBusy(false);
    }
  };
  // Self-apply (rebuild + relaunch) progress for packaged builds.
  const [applyPhase, setApplyPhase] = useState<string | null>(null);

  // Token/cost totals and background-build state.
  //
  // Both backends already existed and returned real data; they simply had no
  // caller. The build listener is torn down on unmount so a stale push cannot
  // write into a view that is no longer mounted.
  useEffect(() => {
    void refreshUsage();
    void refreshBuildStatus();
    const off = window.api.onBuildStatus((s: unknown) => {
      setBuildStatus(s && typeof s === 'object' ? (s as typeof buildStatus) : null);
    });
    return () => off?.();
  }, [refreshUsage, refreshBuildStatus]);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void window.api
        .evolveLoopStatus()
        .then((s: unknown) => {
          if (alive && s) setEvolve(s as EvolutionLoopStatus);
        })
        .catch(() => undefined);
    };
    refresh();
    const id = setInterval(refresh, 8000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => window.api.onSelfApplyEvent((e: unknown) => {
    const phase = (e as { phase?: string })?.phase;
    if (phase) setApplyPhase(phase === 'done' ? null : phase);
  }), []);

  const toggleEvolveContinuous = async () => {
    setEvolveBusy(true);
    try {
      const next = (evolve?.enabled
        ? await window.api.evolveLoopStop()
        : await window.api.evolveLoopStart()) as EvolutionLoopStatus;
      setEvolve(next);
      addToast({
        title: next.enabled ? 'Evolve continuously on' : 'Evolve continuously off',
        message: next.enabled
          ? `A fresh self-evolution cycle runs every ${Math.round(next.intervalMs / 60_000)} minutes — research → build → verify, even across restarts.`
          : 'The evolution loop is paused. One-off Research & Evolve still works.',
        type: 'success',
      });
    } catch (e) {
      addToast({ title: 'Evolution loop', message: (e as Error).message, type: 'error' });
    } finally {
      setEvolveBusy(false);
    }
  };

  const runSelfApply = async () => {
    setApplyPhase('building');
    try {
      const res = (await window.api.selfApplyRun()) as {
        ok: boolean;
        plan: { action: string; reason: string };
      };
      if (res.ok && res.plan.action === 'hot-reload') {
        setApplyPhase(null);
        addToast({ title: 'Already live', message: res.plan.reason, type: 'success' });
      } else if (res.ok) {
        setApplyPhase(null);
        addToast({ title: 'Applied', message: 'Build passed — Infinite OS relaunched with your self-edits.', type: 'success' });
      } else {
        setApplyPhase('failed');
        addToast({ title: 'Rebuild failed', message: res.plan.reason, type: 'error' });
      }
    } catch (e) {
      setApplyPhase(null);
      addToast({ title: 'Rebuild failed', message: (e as Error).message, type: 'error' });
    }
  };

  useEffect(() => {
    const syncFromStorage = () => {
      const cur = loadCurrent();
      setBrainMode(cur.brainMode ?? true);
      setCurrentModel(cur.model);
    };
    window.addEventListener('storage', syncFromStorage);
    window.api.listProviders().then((p: ProviderInfo[]) => {
      setProviders(p);
      const cur = loadCurrent();
      setActiveProvider(cur.provider);
      setCwd(cur.cwd);
      setBrainMode(cur.brainMode ?? true);
    });
    window.api
      .getSetting({ key: 'cloudflareAccountId' })
      .then((value: unknown) => {
        if (typeof value === 'string') setCloudflareAccountId(value);
      })
      .catch(() => undefined);
    window.api
      .getSetting({ key: 'customBaseUrl' })
      .then((value: unknown) => {
        if (typeof value === 'string') setCustomBaseUrl(value);
      })
      .catch(() => undefined);
    window.api
      .getSetting({ key: 'customModel' })
      .then((value: unknown) => {
        if (typeof value === 'string') setCustomModel(value);
      })
      .catch(() => undefined);
    window.api
      .getSetting({ key: 'failoverEnabled' })
      .then((value: unknown) => {
        if (typeof value === 'boolean') setFailoverEnabled(value);
      })
      .catch(() => undefined);

    return () => window.removeEventListener('storage', syncFromStorage);
  }, []);

  useEffect(() => {
    const selectedProvider = providers.find((item) => item.id === activeProvider);
    if (!selectedProvider) return;
    let cancelled = false;
    setApiKey('');
    setApiKeyLoaded(false);
    setModels([]);
    setStatus('idle');
    setStatusMessage('');

    void (async () => {
      const has = await window.api.hasProviderKey({ provider: activeProvider }) as boolean;
      if (cancelled) return;
      setApiKeyLoaded(has);
      if (selectedProvider.requiresApiKey && !has) return;

      setStatus('testing');
      setStatusMessage('Checking provider…');
      const result = await window.api.testProvider({ provider: activeProvider, apiKey: '' });
      if (cancelled) return;
      const list = await window.api.listProviderModels({ provider: activeProvider });
      if (cancelled) return;
      const modelList = (list as { id: string; label: string; free: boolean; provider?: string }[])
        .filter((model) => !model.provider || model.provider === activeProvider);
      setModels(modelList);
      setStatus(result.ok ? 'ok' : 'fail');
      setStatusMessage(result.ok ? `${modelList.length} models available` : result.error || 'Connection failed');
      // Display only: browsing provider tabs must never rewrite the chat's
      // saved provider/model. Selection happens explicitly via Test & Save,
      // "Use installed CLI", or clicking a model.
    })().catch((error) => {
      if (!cancelled) {
        setStatus('fail');
        setStatusMessage(error instanceof Error ? error.message : 'Could not load provider models.');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeProvider, providers]);

  useEffect(() => {
    if (activeProvider !== 'opencode') return;
    let cancelled = false;
    setCliVersion(null);
    const api = window.api as unknown as { opencodeCliVersion?: () => Promise<{ version: string | null; serverVersion: string | null; minFreeVersion: string; freeTierSupported: boolean; serverStale: boolean }> };
    if (typeof api.opencodeCliVersion !== 'function') return;
    void api.opencodeCliVersion()
      .then((info) => { if (!cancelled) setCliVersion(info); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [activeProvider]);

  const test = async () => {
    setStatus('testing');
    setStatusMessage('Checking provider connection…');
    try {
      if (activeProvider === 'cloudflare') await saveCloudflareAccountId();
      if (activeProvider === 'custom') await saveCustomFields();
      const enteredKey = apiKey.trim();
      const res = await window.api.testProvider({ provider: activeProvider, apiKey: enteredKey });
      if (res.ok) {
        setStatus('ok');
        if (enteredKey) {
          await window.api.setProviderKey({ provider: activeProvider, key: enteredKey });
          setApiKeyLoaded(true);
          setApiKey('');
        }
        const list = await window.api.listProviderModels({ provider: activeProvider, apiKey: enteredKey });
        const modelList = (list as { id: string; label: string; free: boolean; provider?: string }[])
          .filter((model) => !model.provider || model.provider === activeProvider);
        setModels(modelList);

        // A model id from the previously selected provider is not usable here.
        // Preserve the saved selection only when the new provider actually
        // reports it, otherwise pick a real model from this provider.
        const cur = loadCurrent();
        const nextModel = modelList.some((model) => model.id === cur.model)
          ? cur.model
          : modelList.find((model) => model.free)?.id ?? modelList[0]?.id ?? '';
        saveCurrent({
          provider: activeProvider,
          model: nextModel,
          hasApiKey: Boolean(enteredKey || apiKeyLoaded),
        });
        setCurrentModel(nextModel);
        setStatusMessage(`Connected · ${modelList.length} model${modelList.length === 1 ? '' : 's'} available`);
        window.dispatchEvent(new Event('storage'));

        addToast({ type: 'success', title: 'Provider connected and saved' });
      } else {
        setStatus('fail');
        setStatusMessage(res.error || 'Connection failed');
        addToast({ type: 'error', title: res.error || 'Connection failed' });
      }
    } catch (e) {
      setStatus('fail');
      const message = e instanceof Error ? e.message : String(e);
      setStatusMessage(message);
      addToast({ type: 'error', title: `Connection error: ${message}` });
    }
  };

  const handleUseInstalledOpenCode = async () => {
    setStatus('testing');

    setStatusMessage('Checking OpenCode and loading models…');    try {
      await window.api.setProviderKey({ provider: 'opencode', key: '' });
      setApiKey('');
      setApiKeyLoaded(false);
      const result = await window.api.testProvider({ provider: 'opencode', apiKey: '' });
      const list = await window.api.listProviderModels({ provider: 'opencode', apiKey: '' });
      const modelList = (list as { id: string; label: string; free: boolean; provider?: string }[])
        .filter((model) => !model.provider || model.provider === 'opencode');
      setModels(modelList);

      // Only switch the saved provider when the CLI actually answered with
      // models — a failed probe must never overwrite a working selection
      // with an empty opencode model.
      if (result.ok && modelList.length > 0) {
        setStatus('ok');
        setStatusMessage(`${modelList.length} CLI models available`);        const current = loadCurrent();
        const nextModel = current.provider === 'opencode' && modelList.some((model) => model.id === current.model)
          ? current.model
          : modelList.find((model) => model.free)?.id ?? modelList[0]?.id ?? '';
        saveCurrent({ provider: 'opencode', model: nextModel, hasApiKey: false });
        setCurrentModel(nextModel);
        window.dispatchEvent(new Event('storage'));

        addToast({ type: 'success', title: 'Using installed OpenCode credentials' });
      } else {
        setStatus('fail');
        const message = result.error || (modelList.length === 0 ? 'OpenCode reported no usable free models. Sign in (`opencode auth login`) and try again.' : 'OpenCode CLI connection failed');        setStatusMessage(message);
        addToast({ type: 'error', title: message });
      }
    } catch (error) {
      setStatus('fail');
      const message = error instanceof Error ? error.message : 'Could not connect to OpenCode';
      setStatusMessage(message);
      addToast({ type: 'error', title: message });
    }
  };

  const handleUpgradeOpenCodeCli = async () => {
    const api = window.api as unknown as {
      opencodeCliUpgrade?: () => Promise<{ ok: boolean; output?: string; error?: string }>;
      opencodeCliVersion?: () => Promise<{ version: string | null; serverVersion: string | null; minFreeVersion: string; freeTierSupported: boolean; serverStale: boolean }>;
    };
    if (typeof api.opencodeCliUpgrade !== 'function') {
      addToast({ type: 'error', title: 'Upgrade requires a rebuilt app — run `npm run build` first.' });
      return;
    }
    setUpgradingCli(true);
    setStatusMessage('Upgrading OpenCode CLI (npm install --global opencode-ai@latest)…');
    try {
      const res = await api.opencodeCliUpgrade();
      if (res.ok) {
        addToast({ type: 'success', title: 'OpenCode CLI upgraded — re-checking free models' });
        if (typeof api.opencodeCliVersion === 'function') {
          await api.opencodeCliVersion().then(setCliVersion).catch(() => undefined);
        }
        await handleUseInstalledOpenCode();
      } else {
        addToast({ type: 'error', title: res.error || 'CLI upgrade failed' });
        setStatusMessage(res.error || 'CLI upgrade failed. Try `npm i -g opencode-ai@latest` in a terminal.');
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'CLI upgrade failed';
      addToast({ type: 'error', title: message });
      setStatusMessage(message);
    } finally {
      setUpgradingCli(false);
    }
  };

  const handleRestartOpenCodeServer = async () => {
    const api = window.api as unknown as {
      opencodeServerRestart?: () => Promise<{ version: string | null }>;
      opencodeCliVersion?: () => Promise<{ version: string | null; serverVersion: string | null; minFreeVersion: string; freeTierSupported: boolean; serverStale: boolean }>;
    };
    if (typeof api.opencodeServerRestart !== 'function') {
      addToast({ type: 'error', title: 'Restart requires a rebuilt app — run `npm run build` first.' });
      return;
    }
    setRestartingServer(true);
    setStatusMessage('Restarting OpenCode runtime with the installed CLI…');
    try {
      const res = await api.opencodeServerRestart();
      if (typeof api.opencodeCliVersion === 'function') {
        await api.opencodeCliVersion().then(setCliVersion).catch(() => undefined);
      }
      if (res.version) {
        addToast({ type: 'success', title: `Runtime restarted (v${res.version}) — re-checking free models` });
        await handleUseInstalledOpenCode();
      } else {
        setStatus('fail');
        setStatusMessage('Runtime did not come back. Run `opencode serve --pure --port 4096` in a terminal.');
        addToast({ type: 'error', title: 'Runtime restart failed' });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Runtime restart failed';
      addToast({ type: 'error', title: message });
      setStatusMessage(message);
    } finally {
      setRestartingServer(false);
    }
  };

  const pickModel = (id: string) => {
    const patch: Partial<CurrentSettings> = { provider: activeProvider, model: id };
    if (activeProvider === 'ollama') patch.ollamaModel = id;
    saveCurrent(patch);
    setCurrentModel(id);
    window.dispatchEvent(new Event('storage'));
    addToast({ type: 'success', title: `Model set to ${id}` });
  };

  const saveCwd = () => {
    saveCurrent({ cwd: cwd || '.' });
    addToast({ type: 'success', title: `Working directory set to ${cwd}` });
  };

  const provider = providers.find((p) => p.id === activeProvider);

  // Strict per-provider scoping: this pane only ever shows the active
  // provider's own models — never another provider's catalog.
  const scopedModels = models.filter((m) => !m.provider || m.provider === activeProvider);
  const scopedFreeModels = (provider?.freeModels ?? []).filter((m) => !m.provider || m.provider === activeProvider);

  const saveCloudflareAccountId = async (value?: string) => {
    const next = (value ?? cloudflareAccountId).trim();
    await window.api
      .setSetting({ scope: 'user', key: 'cloudflareAccountId', value: next, cwd: loadCurrent().cwd || '.' })
      .catch(() => undefined);
    if (value === undefined) setCloudflareAccountId(next);
  };

  const saveCustomFields = async () => {
    const cwdNow = loadCurrent().cwd || '.';
    await window.api
      .setSetting({ scope: 'user', key: 'customBaseUrl', value: customBaseUrl.trim().replace(/\/+$/, ''), cwd: cwdNow })
      .catch(() => undefined);
    await window.api
      .setSetting({ scope: 'user', key: 'customModel', value: customModel.trim(), cwd: cwdNow })
      .catch(() => undefined);
  };

  const toggleBrainMode = () => {
    const newVal = !brainMode;
    setBrainMode(newVal);
    saveCurrent({ brainMode: newVal });
    addToast({ type: 'success', title: newVal ? 'InfiniteAI Brain Mode enabled — all chats use the Brain' : 'InfiniteAI Brain Mode disabled — using connected API' });
  };

  const toggleFailover = async () => {
    const next = !failoverEnabled;
    setFailoverEnabled(next);
    await window.api.setSetting({
      scope: 'user',
      key: 'failoverEnabled',
      value: next,
      cwd: loadCurrent().cwd || '.',
    }).catch(() => undefined);
    addToast({ type: 'success', title: next ? 'Model fallback on — failing models hand over to backups' : 'Model fallback off — the selected model answers or fails plainly' });
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 animate-fade-in">
      <h1 className="text-2xl font-bold mb-2 text-textMain">Settings</h1>
      <p className="text-textMuted text-sm mb-6">Configure your AI providers, model, and workspace.</p>

      <div className="space-y-6 max-w-3xl">
        <div className="card-premium">
          <h3 className="font-medium text-textMain">Infinite AI logo</h3>
          <p className="mb-4 mt-1 text-xs text-textMuted">Choose the animated mark used throughout Infinite OS and during startup.</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {LOGO_STYLES.map((item) => (
              <button
                key={item.id}
                onClick={() => appearance.setAppearance({ logoStyle: item.id })}
                className={`os-logo-style-card ${appearance.logoStyle === item.id ? 'is-active' : ''}`}
                aria-label={`Use ${item.name} logo style`}
              >
                <span className="os-logo-style-preview"><InfiniteLogo className="h-14 w-24" animated variant={item.id} /></span>
                <span><strong>{item.name}</strong><small>{item.description}</small></span>
                {appearance.logoStyle === item.id && <mark>Active</mark>}
              </button>
            ))}
          </div>
        </div>

        <div className="card-premium">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-medium text-textMain">OS theme color</h3>
              <p className="mt-1 text-xs text-textMuted">Changes active tabs, New Chat, highlights, borders, glows, controls, and buttons throughout Infinite OS.</p>
            </div>
            <label className="flex shrink-0 items-center gap-2 text-xs text-textMuted">
              Custom
              <input
                type="color"
                value={appearance.accent}
                onChange={(event) => appearance.setAppearance({ accent: event.target.value })}
                className="h-8 w-12 cursor-pointer rounded-lg border border-white/10 bg-transparent p-0.5"
                aria-label="Choose custom OS theme color"
              />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {OS_COLORS.map((color) => (
              <button
                key={color.value}
                onClick={() => appearance.setAppearance({ accent: color.value })}
                className={`flex items-center gap-2 rounded-full border px-3 py-2 text-[10px] transition-all ${
                  appearance.accent.toLowerCase() === color.value
                    ? 'border-white/25 bg-white/[0.07] text-white'
                    : 'border-white/[0.07] text-zinc-500 hover:border-white/15 hover:text-zinc-200'
                }`}
                aria-label={`Use ${color.name} OS theme color`}
              >
                <span className="h-3 w-3 rounded-full" style={{ background: color.value, boxShadow: `0 0 9px ${color.value}99` }} />
                {color.name}
              </button>
            ))}
          </div>
        </div>

        {/* Working Directory */}
        <div className="card-premium">
          <h3 className="font-medium mb-3 text-textMain">Workspace</h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="Working directory (e.g. C:\Users\you\projects)"
              className="input-premium flex-1"
            />
            <button onClick={saveCwd} className="btn-premium whitespace-nowrap">Save</button>
          </div>
        </div>

        {/* InfiniteAI Brain Mode */}
        <div className="card-premium">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-textMain">InfiniteAI Brain Mode</h3>
              <p className="text-xs text-textMuted mt-1">
                When enabled, all chats go through the Infinite AI Brain — learning from every interaction and giving direct answers from accumulated knowledge.
              </p>
            </div>
            <button
              onClick={toggleBrainMode}
              className={`relative w-12 h-6 rounded-full transition-all duration-200 flex-shrink-0 ml-4 ${
                brainMode
                  ? 'bg-gradient-to-r from-purple-500 to-cyan-500 shadow-[0_0_12px_rgba(168,85,247,0.3)]'
                  : 'bg-white/10 border border-white/10'
              }`}
            >
              <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-all duration-200 ${
                brainMode ? 'left-[26px]' : 'left-0.5'
              }`} />
            </button>
          </div>
          {brainMode && (
            <div className="mt-3 px-3 py-2 bg-gradient-to-r from-purple-500/10 via-cyan-500/10 to-pink-500/10 border border-purple-500/20 rounded-lg">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-gradient-to-r from-purple-400 via-cyan-400 to-pink-400 animate-pulse" />
                <span className="text-xs text-purple-300 font-medium">Brain Mode Active</span>
              </div>
              <p className="text-[11px] text-textMuted mt-1">The Brain learns from every conversation and gets smarter over time. API keys are still used for external tools when needed.</p>
            </div>
          )}
        </div>

        {/* Self-Evolve — Infinite OS Lives */}
        <div className="card-premium relative overflow-hidden border-purple-500/20">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-purple-600/10 via-cyan-500/10 to-pink-500/10" />
          <div className="relative">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-medium text-textMain flex items-center gap-2">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-cyan-500 text-white text-xs">✦</span>
                  Self-Evolve — Infinite OS Lives
                </h3>
                <p className="text-xs text-textMuted mt-1 max-w-[560px]">

                  One click: Infinite AI goes online, researches the best features from Claude, OpenCode, OpenClaw, Antigravity and every top app, finds what we&apos;re missing, and builds it into Infinite OS automatically — new tools, skills, automations, UI. Validated &amp; checkpointed. Infinite OS improves itself.                </p>
              </div>
              <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/20 px-2.5 py-1 text-[10px] font-medium text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> Lives
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={async () => {
                  const prompt = `SELF-EVOLVE Infinite OS now. Go online and research the latest best features from Claude, OpenCode, OpenClaw, Antigravity and other top AI workspace apps that Infinite OS does not have yet. Use WebSearch and WebFetch to read their changelogs, feature pages and docs, build a gap list, prioritize the most valuable missing features, then IMPLEMENT them directly into Infinite OS using BuildFeature (validated, checkpointed). Cover new tools, automations, UI polish, browser control, skills — anything that makes Infinite OS the best app that can do anything on the PC. Be bold, create what we lack. Report what you researched and what you built.`;
                  try {
                    await useChatStore.getState().sendMessage(prompt);
                    useNotificationStore.getState().addToast({ title: 'Self-Evolve started', message: 'Infinite AI is researching and building — watch Chat for live progress.', type: 'success' });
                    window.dispatchEvent(new CustomEvent('infinite:navigate', { detail: 'chats' }));
                  } catch (e) {
                    useNotificationStore.getState().addToast({ title: 'Self-Evolve', message: (e as Error).message, type: 'error' });
                  }
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-500 px-4 py-2 text-sm font-medium text-white shadow-[0_6px_18px_rgba(124,58,237,0.35)] hover:from-violet-500 hover:to-cyan-400 transition-colors"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09Z" /></svg>
                Research & Evolve Now
              </button>
              <button
                onClick={async () => {
                  try {
                    const res = await (window as unknown as { api?: { selfImprovementAudit: (a:{cwd:string})=>Promise<unknown> } }).api?.selfImprovementAudit?.({ cwd: loadCurrent().cwd });
                    const msg = typeof res === 'string' ? res : JSON.stringify(res, null, 2)?.slice(0, 4000);
                    useNotificationStore.getState().addToast({ title: 'Health Audit done', message: msg?.slice(0, 300) ?? 'Done — see logs.', type: 'success' });
                  } catch (e) {
                    useNotificationStore.getState().addToast({ title: 'Audit failed', message: (e as Error).message, type: 'error' });
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs font-medium text-textMain hover:bg-white/[0.07]"
              >
                Quick Health Audit
              </button>
              <span className="text-[10px] text-textMuted">Uses WebSearch → WebFetch → BuildFeature. You can stop or talk to the AI mid-build in Chat.</span>
            </div>
            {/* Continuous evolution + self-apply row */}
            <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-white/[0.06] pt-3">
              <button
                type="button"
                role="switch"
                aria-checked={Boolean(evolve?.enabled)}
                onClick={() => void toggleEvolveContinuous()}
                disabled={evolveBusy}
                title="Run a fresh self-evolution cycle on an interval, even after restarts. Cycles never overlap; repeated failures auto-pause the loop."
                className="flex items-center gap-2 text-xs text-textMuted hover:text-textMain transition-colors disabled:opacity-50"
              >
                <span className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${evolve?.enabled ? 'bg-emerald-500/70' : 'bg-white/10'}`}>
                  <span className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${evolve?.enabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                </span>
                Evolve continuously {evolve?.enabled ? 'on' : 'off'}
              </button>
              {evolve && (
                <span className="text-[10px] text-textMuted">
                  {evolve.cycleInFlight ? (
                    <span className="text-emerald-300">Cycle running…</span>
                  ) : (
                    `${evolve.cyclesCompleted} cycle${evolve.cyclesCompleted === 1 ? '' : 's'} completed`
                  )}
                  {evolve.lastError
                    ? ` · ${evolve.lastError.slice(0, 160)}`
                    : evolve.lastSummary
                      ? ` · ${evolve.lastSummary.slice(0, 140)}`
                      : ''}
                </span>
              )}
              <button
                type="button"
                onClick={() => void runSelfApply()}
                disabled={applyPhase === 'building' || applyPhase === 'restarting'}
                title="Typecheck + rebuild + relaunch so self-edits load in packaged builds (dev mode hot-reloads automatically)."
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs font-medium text-textMain hover:bg-white/[0.07] disabled:opacity-60"
              >
                {applyPhase === 'building' ? 'Rebuilding…' : applyPhase === 'restarting' ? 'Relaunching…' : 'Rebuild & Apply'}
              </button>
            </div>
          </div>
        </div>

        {/* Connect Your Phone — Chat from anywhere on your network */}

        {/*
          Usage and cost.

          Every provider reported usage per response and the pricing table
          could turn it into money, but nothing joined the two, so a
          conversation's cost was computed nowhere and shown nowhere. An
          estimate: genuinely free models are $0, and models with no published
          rate are disclosed in a note rather than silently presented as free.

          This lives in SettingsView because that is the surface the sidebar
          actually opens. The two SettingsModal variants are reachable only
          through a control that is not rendered, so cards added there were
          invisible in the packaged app.
        */}
        <div className="card-premium">
          <div className="flex items-start justify-between gap-4 mb-1">
            <div>
              <h3 className="font-medium text-textMain">Usage and cost</h3>
              <p className="mt-1 text-xs text-textMuted">
                What your conversations have used since these totals were last cleared.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void clearUsage()}
              disabled={usageBusy || !usageTotals?.requests}
              className="shrink-0 rounded-lg border border-white/10 px-2 py-1 text-[11px] text-textMuted hover:text-textMain disabled:opacity-40"
            >
              Clear
            </button>
          </div>
          {usageTotals && usageTotals.requests > 0 ? (
            <>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-white/[0.02] p-2">
                  <div className="text-[10px] text-textMuted">Estimated cost</div>
                  <div className="mt-0.5 text-sm font-medium text-textMain">{usageTotals.formatted.cost}</div>
                </div>
                <div className="rounded-lg bg-white/[0.02] p-2">
                  <div className="text-[10px] text-textMuted">Input tokens</div>
                  <div className="mt-0.5 text-sm font-medium text-textMain">{usageTotals.formatted.input}</div>
                </div>
                <div className="rounded-lg bg-white/[0.02] p-2">
                  <div className="text-[10px] text-textMuted">Output tokens</div>
                  <div className="mt-0.5 text-sm font-medium text-textMain">{usageTotals.formatted.output}</div>
                </div>
              </div>
              {usageTotals.formatted.note && (
                <p className="mt-2 text-[11px] text-amber-300/90">{usageTotals.formatted.note}</p>
              )}
            </>
          ) : (
            <p className="mt-2 text-[11px] text-textMuted">
              Nothing recorded yet. Totals appear after your first reply.
            </p>
          )}
        </div>

        {/*
          Background builds.

          The five handlers and auto-update/index.ts were finished but never
          exposed on the preload bridge, and nothing subscribed to
          onBuildStatusChange — so a rebuild could start, finish or fail with
          the app simply looking idle.
        */}
        <div className="card-premium">
          <div className="flex items-start justify-between gap-4 mb-1">
            <div>
              <h3 className="font-medium text-textMain">Background builds</h3>
              <p className="mt-1 text-xs text-textMuted">
                Rebuild without closing the app. Useful after Infinite AI changes Infinite OS itself.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void runBackgroundBuild(buildStatus?.phase === 'building' ? 'buildCancel' : 'buildStart')}
              disabled={buildBusy}
              className="shrink-0 rounded-lg border border-white/10 px-2 py-1 text-[11px] text-textMuted hover:text-textMain disabled:opacity-40"
            >
              {buildStatus?.phase === 'building' ? 'Cancel' : 'Build now'}
            </button>
          </div>
          {buildStatus && (
            <p className="mt-2 text-[11px] text-textMuted">
              {buildStatus.phase === 'idle' && 'Idle'}
              {buildStatus.phase === 'building' && 'Building…'}
              {buildStatus.phase === 'ready' && 'A new build is ready to apply.'}
              {buildStatus.phase === 'applying' && 'Applying…'}
              {buildStatus.phase === 'failed' && `Last build failed: ${buildStatus.error}`}
            </p>
          )}
        </div>
        <PhoneConnectCard />

        {/* AI Provider */}
        <div className="card-premium">
          <div className="flex items-start justify-between gap-4 mb-1">
            <div>
              <h3 className="font-medium text-textMain">AI Provider</h3>
              <p className="mt-1 text-xs text-textMuted">Choose where Infinite AI routes chat and agent requests.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={failoverEnabled}
              onClick={() => void toggleFailover()}
              title={failoverEnabled ? 'Turn OFF to make the selected model answer or fail plainly (diagnosing)' : 'Turn ON to let failing models hand over to backups'}
              className="flex shrink-0 items-center gap-2 text-xs text-textMuted hover:text-textMain transition-colors"
            >
              <span className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${failoverEnabled ? 'bg-emerald-500/70' : 'bg-white/10'}`}>
                <span className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${failoverEnabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
              </span>
              Model fallback {failoverEnabled ? 'on' : 'off'}
            </button>
          </div>
          {!failoverEnabled && (
            <p className="text-[11px] text-amber-400/90 mb-3">Fallback off — the selected model answers or fails plainly. Turn it on to let failing models hand over to backups.</p>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
            {providers.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setActiveProvider(p.id);
                }}
                className={`text-left p-3 rounded-xl border transition-all ${
                  p.id === activeProvider
                    ? 'bg-indigo-500/15 border-indigo-500/50 shadow-sm'
                    : 'bg-bgInput border-borderSubtle hover:border-indigo-500/30'
                }`}
              >
                <div className="font-medium text-sm text-textMain">{p.label}</div>
                {p.requiresApiKey ? (
                  <div className="text-xs text-textMuted mt-1">Requires API key</div>
                ) : (
                  <div className="text-xs text-green-400 mt-1">Local / Free</div>
                )}
                {p.freeModels?.length > 0 && (
                  <div className="text-xs text-green-400/70 mt-0.5">{p.freeModels.length} free models</div>
                )}
              </button>
            ))}
          </div>

          {(provider?.requiresApiKey || provider?.acceptsApiKey) && (
            <div className="mb-4">
              {activeProvider === 'cloudflare' && (
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={cloudflareAccountId}
                    onChange={(e) => setCloudflareAccountId(e.target.value)}
                    onBlur={() => void saveCloudflareAccountId()}
                    placeholder="Cloudflare account ID (from your dashboard URL)"
                    className="input-premium flex-1"
                  />
                </div>
              )}
              {activeProvider === 'custom' && (
                <div className="flex flex-col gap-2 mb-2">
                  <input
                    type="text"
                    value={customBaseUrl}
                    onChange={(e) => setCustomBaseUrl(e.target.value)}
                    onBlur={() => void saveCustomFields()}
                    placeholder="Base URL — e.g. https://my-gateway.example.com/v1"
                    className="input-premium flex-1"
                  />
                  <input
                    type="text"
                    value={customModel}
                    onChange={(e) => setCustomModel(e.target.value)}
                    onBlur={() => void saveCustomFields()}
                    placeholder="Model ID — e.g. my-model-name"
                    className="input-premium flex-1"
                  />
                  <p className="text-xs text-textMuted">Any OpenAI-compatible endpoint works: private gateways, local servers, new providers. Fill in all three fields, paste the key below, then Test & Save.</p>
                </div>
              )}
              <div className="flex gap-2">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={apiKeyLoaded ? 'Key saved securely (enter a new key to replace it)' : `Enter your ${provider.label} API key`}
                  className="input-premium flex-1"
                />
                <button
                  onClick={test}
                  disabled={(provider.requiresApiKey && !apiKey && !apiKeyLoaded) || status === 'testing'}
                  className="btn-premium whitespace-nowrap"
                >
                  {status === 'testing'
                    ? 'Testing...'
                    : apiKey.trim()
                      ? 'Test & Save'
                      : 'Test Connection'}
                </button>
              </div>
              {activeProvider === 'opencode' && (

                <div className="mt-3 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-textMain">OpenCode free server — no API key needed</div>
                      <p className="mt-0.5 text-xs text-textMuted">
                        Infinite OS connects to the OpenCode runtime on this PC (127.0.0.1:4096) and uses its free-tier
                        models. Keep the OpenCode app running, or let Infinite OS start the runtime for you.
                      </p>
                    </div>
                    <button
                      onClick={() => void handleUseInstalledOpenCode()}
                      disabled={status === 'testing'}
                      className="shrink-0 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400 disabled:opacity-50"
                    >
                      {status === 'testing' ? 'Connecting…' : models.length > 0 ? `Connected · ${models.length} free models` : 'Connect free server'}
                    </button>
                  </div>
                </div>
              )}
              {provider.acceptsApiKey && activeProvider !== 'opencode' && (
                <div className="mt-2 flex items-center justify-between gap-3">
                  <p className="text-xs text-textMuted">Free path — no key needed: use your installed OpenCode CLI. Or paste an OpenCode Zen key to scan Zen models.</p>
                  <button onClick={() => void handleUseInstalledOpenCode()} className="shrink-0 text-xs text-indigo-300 hover:text-indigo-200">Use installed CLI (free)</button>
                </div>              )}
              {activeProvider === 'opencode' && (
                <p className="mt-2 text-xs text-textMuted">Optional: paste an OpenCode Zen subscription key above for Zen models, or leave it empty for the free server.</p>
              )}
              {activeProvider === 'opencode' && cliVersion && (
                <div className={`mt-2 flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs ${
                  cliVersion.version == null
                    ? 'border-white/10 bg-white/[0.03] text-textMuted'
                    : cliVersion.freeTierSupported && !cliVersion.serverStale
                      ? 'border-green-500/20 bg-green-500/5 text-green-300'
                      : 'border-amber-500/25 bg-amber-500/5 text-amber-300'
                }`}>
                  <span>
                    {cliVersion.version == null
                      ? 'OpenCode CLI not found — install it (`npm i -g opencode-ai`), then sign in (`opencode auth login`).'
                      : cliVersion.serverStale
                        ? `CLI v${cliVersion.version} installed, but the running server is v${cliVersion.serverVersion} — restart it for the free tier.`
                        : cliVersion.freeTierSupported
                          ? `Installed CLI v${cliVersion.version}${cliVersion.serverVersion ? ` · runtime v${cliVersion.serverVersion}` : ''} — free tier ready.`
                          : `Installed CLI v${cliVersion.version} — free tier needs v${cliVersion.minFreeVersion}+.`}
                  </span>
                  {cliVersion.version != null && !cliVersion.freeTierSupported && !cliVersion.serverStale && (
                    <button
                      onClick={() => void handleUpgradeOpenCodeCli()}
                      disabled={upgradingCli}
                      className="shrink-0 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 font-medium text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
                    >
                      {upgradingCli ? 'Upgrading…' : 'Upgrade CLI'}
                    </button>
                  )}
                  {cliVersion.serverStale && (
                    <button
                      onClick={() => void handleRestartOpenCodeServer()}
                      disabled={restartingServer}
                      className="shrink-0 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 font-medium text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
                    >
                      {restartingServer ? 'Restarting…' : 'Restart runtime'}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {activeProvider === 'opencode' && (
            <div className="mb-4 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-textMain">Free models — no API key needed</div>
                  <p className="mt-0.5 text-xs text-textMuted">
                    Uses your installed OpenCode CLI and its signed-in account. Keep the OpenCode app running or let Infinite OS start it for you.
                  </p>
                </div>
                <button
                  onClick={() => void handleUseInstalledOpenCode()}
                  disabled={status === 'testing'}
                  className="shrink-0 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400 disabled:opacity-50"
                >
                  {status === 'testing' ? 'Connecting…' : models.length > 0 ? `Connected · ${models.length} free models` : 'Use OpenCode Free'}
                </button>
              </div>
            </div>
          )}

          {!provider?.requiresApiKey && !provider?.acceptsApiKey && (
            <div className="flex gap-2 mb-4">
              <button
                onClick={test}
                disabled={status === 'testing'}
                className="btn-premium whitespace-nowrap"
              >
                {status === 'testing' ? 'Connecting...' : 'Test Connection'}
              </button>
              <span className="text-xs text-textMuted self-center">No API key needed — runs locally</span>
            </div>
          )}

          {status === 'ok' && <div className="text-sm text-green-400 mb-4 bg-green-400/10 px-3 py-2 rounded-lg inline-block">{statusMessage || 'Connected & saved'}</div>}
          {status === 'fail' && <div className="text-sm text-red-400 mb-4 bg-red-400/10 px-3 py-2 rounded-lg inline-block">{statusMessage || 'Connection failed'}</div>}

          {/* Show free models even without API key test */}
          {scopedModels.length === 0 && scopedFreeModels.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold mb-2 text-textMain">Free Models</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto custom-scrollbar pr-2">
                {scopedFreeModels.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => pickModel(m.id)}
                    className={`text-left p-2.5 rounded-lg text-sm flex items-center justify-between border transition-all ${
                      currentModel === m.id
                        ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-100'
                        : 'bg-bgInput border-borderSubtle text-textMuted hover:text-textMain hover:border-indigo-500/30'
                    }`}
                  >
                    <span className="truncate pr-2 font-medium">{m.label}</span>
                    {m.free && <span className="text-[10px] uppercase font-bold tracking-wider text-green-400 bg-green-400/10 px-2 py-0.5 rounded">Free</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {scopedModels.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold mb-2 text-textMain">Available Models</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto custom-scrollbar pr-2">
                {scopedModels.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => pickModel(m.id)}
                    className={`text-left p-2.5 rounded-lg text-sm flex items-center justify-between border transition-all ${
                      currentModel === m.id
                        ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-100'
                        : 'bg-bgInput border-borderSubtle text-textMuted hover:text-textMain hover:border-indigo-500/30'
                    }`}
                  >
                    <span className="truncate pr-2 font-medium">{m.label}</span>
                    {m.free && <span className="text-[10px] uppercase font-bold tracking-wider text-green-400 bg-green-400/10 px-2 py-0.5 rounded">Free</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Current Config Summary */}
        <div className="card-premium">
          <h3 className="font-medium mb-2 text-textMain">Current Configuration</h3>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-textMuted">Provider</span>
              <span className="text-textMain font-medium">{currentSettings.provider}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-textMuted">Model</span>
              <span className="text-textMain font-medium">{currentModel || 'Not selected'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-textMuted">Workspace</span>
              <span className="text-textMain font-medium font-mono text-xs">{cwd}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-textMuted">API Key</span>
              <span className="text-textMain font-medium">{apiKeyLoaded ? 'Saved' : 'Not set'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

