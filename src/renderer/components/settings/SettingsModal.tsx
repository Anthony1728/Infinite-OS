import { useEffect, useState } from 'react';
import type { ProviderInfo } from '../../../shared/types';

interface CurrentSettings {
  provider: string;
  model: string;
  cwd: string;
  brainMode?: boolean;
  hasApiKey?: boolean;
}

function loadCurrent(): CurrentSettings {
  try {
    const raw = localStorage.getItem('infinite:current');
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct:free', cwd: '.' };
}

function saveCurrent(patch: Partial<CurrentSettings>) {
  const current = loadCurrent();
  localStorage.setItem('infinite:current', JSON.stringify({ ...current, ...patch }));
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [activeProvider, setActiveProvider] = useState<string>(() => loadCurrent().provider);
  const [apiKey, setApiKey] = useState('');
  const [apiKeyLoaded, setApiKeyLoaded] = useState(false);
  const [status, setStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [models, setModels] = useState<{ id: string; label: string; free: boolean }[]>([]);
  const [currentModel, setCurrentModel] = useState(() => loadCurrent().model);

  useEffect(() => {
    window.api.listProviders().then((p: ProviderInfo[]) => {
      setProviders(p);
      setActiveProvider(loadCurrent().provider);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setApiKey('');
    setApiKeyLoaded(false);
    setStatus('idle');
    setStatusMessage('');
    setModels([]);

    const selectedProvider = providers.find((item) => item.id === activeProvider);
    if (selectedProvider && !selectedProvider.requiresApiKey) {
      setStatus('testing');
      setStatusMessage('Checking local provider…');
      window.api
        .testProvider({ provider: activeProvider, apiKey: '' })
        .then(async (result: { ok: boolean; error?: string }) => {
          if (cancelled) return;
          if (!result.ok) {
            setStatus('fail');
            setStatusMessage(result.error || 'Local provider is unavailable.');
            return;
          }
          const list = await window.api.listProviderModels({ provider: activeProvider });
          if (cancelled) return;
          const nextModels = list as { id: string; label: string; free: boolean }[];
          const nextModel = nextModels[0]?.id;
          setModels(nextModels);
          saveCurrent({ provider: activeProvider, model: nextModel, hasApiKey: false });
          if (nextModel) setCurrentModel(nextModel);
          setStatus('ok');
          setStatusMessage(nextModel ? `Connected · ${nextModel}` : 'Connected');
          window.dispatchEvent(new Event('storage'));
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setStatus('fail');
            setStatusMessage(error instanceof Error ? error.message : 'Local provider is unavailable.');
          }
        });
      return () => {
        cancelled = true;
      };
    }

    window.api
      .hasProviderKey({ provider: activeProvider })
      .then(async (has: boolean) => {
        if (cancelled) return;
        setApiKeyLoaded(has);
        if (!has) return;
        setStatus('ok');
        setStatusMessage('API key saved');
        const list = await window.api.listProviderModels({ provider: activeProvider });
        if (!cancelled) setModels(list as { id: string; label: string; free: boolean }[]);
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('fail');
          setStatusMessage('Could not read the saved credential.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeProvider, providers]);

  const test = async () => {
    setStatus('testing');
    setStatusMessage('Checking provider connection…');
    try {
      const res = await window.api.testProvider({ provider: activeProvider, apiKey });
      if (res.ok) {
        setStatus('ok');
        if (apiKey) {
          await window.api.setProviderKey({ provider: activeProvider, key: apiKey });
          setApiKeyLoaded(true);
        }
        const list = await window.api.listProviderModels({ provider: activeProvider, apiKey });
        const nextModels = list as { id: string; label: string; free: boolean }[];
        setModels(nextModels);

        const saved = loadCurrent();
        const modelIsCompatible =
          saved.provider === activeProvider && nextModels.some((model) => model.id === saved.model);
        const fallbackModel =
          providers.find((item) => item.id === activeProvider)?.freeModels[0]?.id ?? nextModels[0]?.id;
        const nextModel = modelIsCompatible ? saved.model : fallbackModel;
        saveCurrent({ provider: activeProvider, model: nextModel, hasApiKey: true });
        if (nextModel) setCurrentModel(nextModel);
        setStatusMessage(nextModel ? `Connected · ${nextModel}` : 'Connected');
        window.dispatchEvent(new Event('storage'));
      } else {
        setStatus('fail');
        setStatusMessage(res.error || 'The provider rejected this credential.');
      }
    } catch (error) {
      setStatus('fail');
      setStatusMessage(error instanceof Error ? error.message : 'Connection failed.');
    }
  };

  const [selectedModelName, setSelectedModelName] = useState('');

  const pickModel = (id: string) => {
    saveCurrent({ provider: activeProvider, model: id });
    setCurrentModel(id);
    setSelectedModelName(id);
    // Dispatch storage event so other components update immediately
    window.dispatchEvent(new Event('storage'));
  };

  const provider = providers.find((p) => p.id === activeProvider);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-[#12121a] rounded-xl border border-white/[0.08] w-full max-w-2xl max-h-[80vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-white/[0.06]">
          <h2 className="text-lg font-semibold text-white">Settings</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl transition-colors">
            &times;
          </button>
        </div>

        <div className="p-5 space-y-6">
          <section>
            <h3 className="text-sm font-semibold text-white mb-3">Provider</h3>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {providers.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setActiveProvider(p.id)}
                  className={`text-left p-3 rounded-xl border transition-all ${
                    p.id === activeProvider
                      ? 'border-indigo-500/50 bg-indigo-500/10'
                      : 'border-white/[0.06] hover:border-white/[0.12] bg-white/[0.02]'
                  }`}
                >
                  <div className="font-medium text-sm text-white">{p.label}</div>
                  {p.requiresApiKey && <div className="text-xs text-gray-500 mt-0.5">Requires API key</div>}
                  {p.freeModels.length > 0 && (
                    <div className="text-xs text-emerald-400 mt-0.5">{p.freeModels.length} free models</div>
                  )}
                </button>
              ))}
            </div>

            {provider?.requiresApiKey && (
              <div className="flex gap-2 mb-3">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={apiKeyLoaded ? 'Key saved (enter new to replace)' : 'Paste your API key'}
                  className="flex-1 rounded-xl border border-white/[0.08] bg-[#0d0d11] px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500/50 transition-colors placeholder:text-gray-600"
                />
                <button
                  onClick={test}
                  disabled={(!apiKey && !apiKeyLoaded) || status === 'testing'}
                  className="rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white px-5 py-2.5 text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {status === 'testing' ? 'Testing...' : 'Test & Save'}
                </button>
              </div>
            )}

            {status === 'ok' && <div className="text-sm text-emerald-400 mb-2">{statusMessage || 'Connected'}</div>}
            {status === 'fail' && (
              <div className="text-sm text-red-400 mb-2">{statusMessage || 'Connection failed'}</div>
            )}

            {models.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-white mb-2">Models</h4>
                {selectedModelName && (
                  <div className="mb-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs text-emerald-400 flex items-center gap-2">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                    Model updated: {selectedModelName}
                  </div>
                )}
                <ul className="space-y-1 max-h-64 overflow-y-auto custom-scrollbar">
                  {models.map((m) => (
                    <li key={m.id}>
                      <button
                        onClick={() => pickModel(m.id)}
                        className={`w-full text-left p-2.5 rounded-xl text-sm flex items-center justify-between transition-all ${
                          currentModel === m.id
                            ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30'
                            : 'hover:bg-white/[0.04] text-gray-400 border border-transparent'
                        }`}
                      >
                        <span>{m.label}</span>
                        <div className="flex items-center gap-2">
                          {m.free && <span className="text-xs text-emerald-400">free</span>}
                          {currentModel === m.id && <span className="text-xs text-indigo-400">selected</span>}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {models.length === 0 && provider?.freeModels && provider.freeModels.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-white mb-2">Free Models</h4>
                <ul className="space-y-1 max-h-64 overflow-y-auto custom-scrollbar">
                  {provider.freeModels.map((m) => (
                    <li key={m.id}>
                      <button
                        onClick={() => pickModel(m.id)}
                        className={`w-full text-left p-2.5 rounded-xl text-sm flex items-center justify-between transition-all ${
                          currentModel === m.id
                            ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30'
                            : 'hover:bg-white/[0.04] text-gray-400 border border-transparent'
                        }`}
                      >
                        <span>{m.label}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-emerald-400">free</span>
                          {currentModel === m.id && <span className="text-xs text-indigo-400">selected</span>}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
