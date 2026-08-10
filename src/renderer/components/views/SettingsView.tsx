import { useEffect, useState } from 'react';
import type { ProviderInfo } from '../../../shared/types';
import { useNotificationStore } from '../../stores/notifications';
import { useUIStore, type LogoStyle } from '../../stores/ui';
import { InfiniteLogo } from '../brand/InfiniteLogo';

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

function loadCurrent(): CurrentSettings {
  try {
    const raw = localStorage.getItem('infinite:current');
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct:free', cwd: '.' };
}

function saveCurrent(patch: Partial<CurrentSettings>) {
  const current = loadCurrent();
  localStorage.setItem('infinite:current', JSON.stringify({ ...current, ...patch }));
}

export function SettingsView() {
  const appearance = useUIStore();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [activeProvider, setActiveProvider] = useState<string>(() => loadCurrent().provider);
  const [apiKey, setApiKey] = useState('');
  const [apiKeyLoaded, setApiKeyLoaded] = useState(false);
  const [status, setStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [models, setModels] = useState<{ id: string; label: string; free: boolean }[]>([]);
  const [currentModel, setCurrentModel] = useState(() => loadCurrent().model);
  const [cwd, setCwd] = useState(() => loadCurrent().cwd);
  const [brainMode, setBrainMode] = useState(() => loadCurrent().brainMode ?? true);
  const currentSettings = loadCurrent();
  const addToast = useNotificationStore((s) => s.addToast);

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
      setStatusMessage(activeProvider === 'opencode' ? 'Checking OpenCode and loading models…' : 'Checking provider…');
      const result = await window.api.testProvider({ provider: activeProvider, apiKey: '' });
      if (cancelled) return;
      const list = await window.api.listProviderModels({ provider: activeProvider });
      if (cancelled) return;
      const modelList = list as { id: string; label: string; free: boolean }[];
      setModels(modelList);
      setStatus(result.ok ? 'ok' : 'fail');
      setStatusMessage(result.ok ? `${modelList.length} models available` : result.error || 'Connection failed');

      if (result.ok) {
        const current = loadCurrent();
        const nextModel = current.provider === activeProvider && modelList.some((model) => model.id === current.model)
          ? current.model
          : modelList.find((model) => model.free)?.id ?? modelList[0]?.id ?? '';
        saveCurrent({ provider: activeProvider, model: nextModel, hasApiKey: has });
        setCurrentModel(nextModel);
        window.dispatchEvent(new Event('storage'));
      }
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

  const test = async () => {
    setStatus('testing');
    setStatusMessage(activeProvider === 'opencode' ? 'Validating key and scanning available models…' : 'Checking provider connection…');
    try {
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
        const modelList = list as { id: string; label: string; free: boolean }[];
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
        setStatusMessage(
          activeProvider === 'opencode'
            ? `OpenCode connected · ${modelList.length} model${modelList.length === 1 ? '' : 's'} available`
            : `Connected · ${modelList.length} model${modelList.length === 1 ? '' : 's'} available`,
        );
        window.dispatchEvent(new Event('storage'));

        addToast({
          type: 'success',
          title: activeProvider === 'opencode'
            ? `OpenCode key saved · ${modelList.length} models found`
            : 'Provider connected and saved',
        });
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
    try {
      await window.api.setProviderKey({ provider: 'opencode', key: '' });
      setApiKey('');
      setApiKeyLoaded(false);
      const result = await window.api.testProvider({ provider: 'opencode', apiKey: '' });
      const list = await window.api.listProviderModels({ provider: 'opencode', apiKey: '' });
      const modelList = list as { id: string; label: string; free: boolean }[];
      setModels(modelList);
      setStatus(result.ok ? 'ok' : 'fail');
      setStatusMessage(result.ok ? `${modelList.length} CLI models available` : result.error || 'OpenCode CLI connection failed');
      const current = loadCurrent();
      const nextModel = modelList.some((model) => model.id === current.model)
        ? current.model
        : modelList.find((model) => model.free)?.id ?? modelList[0]?.id ?? '';
      saveCurrent({ provider: 'opencode', model: nextModel, hasApiKey: false });
      setCurrentModel(nextModel);
      window.dispatchEvent(new Event('storage'));
      addToast({ type: result.ok ? 'success' : 'error', title: result.ok ? 'Using installed OpenCode credentials' : 'OpenCode CLI connection failed' });
    } catch (error) {
      setStatus('fail');
      const message = error instanceof Error ? error.message : 'Could not switch credentials';
      setStatusMessage(message);
      addToast({ type: 'error', title: message });
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

  const toggleBrainMode = () => {
    const newVal = !brainMode;
    setBrainMode(newVal);
    saveCurrent({ brainMode: newVal });
    addToast({ type: 'success', title: newVal ? 'InfiniteAI Brain Mode enabled — all chats use the Brain' : 'InfiniteAI Brain Mode disabled — using connected API' });
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

        {/* AI Provider */}
        <div className="card-premium">
          <h3 className="font-medium mb-3 text-textMain">AI Provider</h3>
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
                ) : p.acceptsApiKey ? (
                  <div className="text-xs text-textMuted mt-1">CLI or optional subscription key</div>
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
              <div className="flex gap-2">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={apiKeyLoaded ? 'Key saved securely (enter a new key to replace it)' : provider.acceptsApiKey ? 'Paste your OpenCode Zen API key' : `Enter your ${provider.label} API key`}
                  className="input-premium flex-1"
                />
                <button
                  onClick={test}
                  disabled={(provider.requiresApiKey && !apiKey && !apiKeyLoaded) || status === 'testing'}
                  className="btn-premium whitespace-nowrap"
                >
                  {status === 'testing'
                    ? activeProvider === 'opencode' ? 'Scanning...' : 'Testing...'
                    : activeProvider === 'opencode' && apiKey.trim()
                      ? 'Save & Scan Models'
                      : apiKey.trim()
                        ? 'Test & Save'
                        : 'Test Connection'}
                </button>
              </div>
              {provider.acceptsApiKey && (
                <div className="mt-2 flex items-center justify-between gap-3">
                  <p className="text-xs text-textMuted">Enter an OpenCode Zen key to validate it and scan the available Zen models. Your selected model is used by Infinite OS chat and agents.</p>
                  {apiKeyLoaded && (
                    <button onClick={() => void handleUseInstalledOpenCode()} className="shrink-0 text-xs text-indigo-300 hover:text-indigo-200">Use installed CLI</button>
                  )}
                </div>
              )}
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
          {models.length === 0 && provider?.freeModels && provider.freeModels.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold mb-2 text-textMain">Free Models</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto custom-scrollbar pr-2">
                {provider.freeModels.map((m) => (
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

          {models.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold mb-2 text-textMain">Available Models</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto custom-scrollbar pr-2">
                {models.map((m) => (
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

