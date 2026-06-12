import { useEffect, useState } from 'react';
import type { ProviderInfo } from '../../../shared/types';
import { useNotificationStore } from '../../stores/notifications';

interface CurrentSettings {
  provider: string;
  model: string;
  cwd: string;
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
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [activeProvider, setActiveProvider] = useState<string>(() => loadCurrent().provider);
  const [apiKey, setApiKey] = useState('');
  const [apiKeyLoaded, setApiKeyLoaded] = useState(false);
  const [status, setStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [models, setModels] = useState<{ id: string; label: string; free: boolean }[]>([]);
  const [cwd, setCwd] = useState(() => loadCurrent().cwd);
  const currentModel = loadCurrent().model;
  const addToast = useNotificationStore((s) => s.addToast);

  useEffect(() => {
    window.api.listProviders().then((p: ProviderInfo[]) => {
      setProviders(p);
      const cur = loadCurrent();
      setActiveProvider(cur.provider);
      setCwd(cur.cwd);

      // Check if API key already exists for this provider
      window.api.hasProviderKey({ provider: cur.provider }).then((has: boolean) => {
        if (has) {
          setApiKeyLoaded(true);
          setStatus('ok');
          // Load models list
          window.api.listProviderModels({ provider: cur.provider }).then((list: unknown[]) => {
            setModels(list as { id: string; label: string; free: boolean }[]);
          });
        }
      });
    });
  }, []);

  const test = async () => {
    setStatus('testing');
    try {
      const res = await window.api.testProvider({ provider: activeProvider, apiKey });
      if (res.ok) {
        setStatus('ok');
        if (apiKey) {
          await window.api.setProviderKey({ provider: activeProvider, key: apiKey });
          setApiKeyLoaded(true);
        }
        // Always save provider to localStorage
        saveCurrent({ provider: activeProvider });

        const list = await window.api.listProviderModels({ provider: activeProvider, apiKey });
        const modelList = list as { id: string; label: string; free: boolean }[];
        setModels(modelList);

        // Auto-select first free model if no model is currently set for this provider
        const cur = loadCurrent();
        if (!cur.model || cur.model === '') {
          const firstFree = modelList.find((m) => m.free);
          if (firstFree) {
            saveCurrent({ model: firstFree.id });
          }
        }

        addToast({ type: 'success', title: 'Provider connected and saved' });
      } else {
        setStatus('fail');
        addToast({ type: 'error', title: 'Connection failed' });
      }
    } catch (e) {
      setStatus('fail');
      addToast({ type: 'error', title: `Connection error: ${(e as Error).message}` });
    }
  };

  const pickModel = (id: string) => {
    saveCurrent({ provider: activeProvider, model: id });
    addToast({ type: 'success', title: `Model set to ${id}` });
  };

  const saveCwd = () => {
    saveCurrent({ cwd: cwd || '.' });
    addToast({ type: 'success', title: `Working directory set to ${cwd}` });
  };

  const provider = providers.find((p) => p.id === activeProvider);

  return (
    <div className="flex-1 overflow-y-auto p-6 animate-fade-in">
      <h1 className="text-2xl font-bold mb-2 text-textMain">Settings</h1>
      <p className="text-textMuted text-sm mb-6">Configure your AI providers, model, and workspace.</p>

      <div className="space-y-6 max-w-3xl">
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

        {/* AI Provider */}
        <div className="card-premium">
          <h3 className="font-medium mb-3 text-textMain">AI Provider</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
            {providers.map((p) => (
              <button
                key={p.id}
                onClick={() => { setActiveProvider(p.id); setStatus('idle'); setModels([]); }}
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

          {provider?.requiresApiKey && (
            <div className="flex gap-2 mb-4">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={apiKeyLoaded ? 'API key saved (enter new key to replace)' : `Enter your ${provider.label} API key`}
                className="input-premium flex-1"
              />
              <button
                onClick={test}
                disabled={(!apiKey && !apiKeyLoaded) || status === 'testing'}
                className="btn-premium whitespace-nowrap"
              >
                {status === 'testing' ? 'Testing...' : 'Test & Save'}
              </button>
            </div>
          )}

          {status === 'ok' && <div className="text-sm text-green-400 mb-4 bg-green-400/10 px-3 py-2 rounded-lg inline-block">Connected & saved</div>}
          {status === 'fail' && <div className="text-sm text-red-400 mb-4 bg-red-400/10 px-3 py-2 rounded-lg inline-block">Connection failed</div>}

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
              <span className="text-textMain font-medium">{activeProvider}</span>
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
