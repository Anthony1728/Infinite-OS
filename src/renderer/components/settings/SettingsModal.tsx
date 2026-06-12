import { useEffect, useState } from 'react';
import type { ProviderInfo } from '../../../shared/types';

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

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [activeProvider, setActiveProvider] = useState<string>(() => loadCurrent().provider);
  const [apiKey, setApiKey] = useState('');
  const [apiKeyLoaded, setApiKeyLoaded] = useState(false);
  const [status, setStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [models, setModels] = useState<{ id: string; label: string; free: boolean }[]>([]);
  const currentModel = loadCurrent().model;

  useEffect(() => {
    window.api.listProviders().then((p: ProviderInfo[]) => {
      setProviders(p);
      const cur = loadCurrent();
      setActiveProvider(cur.provider);

      window.api.hasProviderKey({ provider: cur.provider }).then((has: boolean) => {
        if (has) {
          setApiKeyLoaded(true);
          setStatus('ok');
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
        saveCurrent({ provider: activeProvider });
        const list = await window.api.listProviderModels({ provider: activeProvider, apiKey });
        setModels(list as { id: string; label: string; free: boolean }[]);
      } else {
        setStatus('fail');
      }
    } catch {
      setStatus('fail');
    }
  };

  const pickModel = (id: string) => {
    saveCurrent({ provider: activeProvider, model: id });
  };

  const provider = providers.find((p) => p.id === activeProvider);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-bg-elevated rounded-lg border border-border w-full max-w-2xl max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button onClick={onClose} className="text-fg-muted hover:text-fg text-xl">&times;</button>
        </div>

        <div className="p-4 space-y-6">
          <section>
            <h3 className="text-sm font-semibold mb-3">Provider</h3>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {providers.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { setActiveProvider(p.id); setStatus('idle'); setModels([]); }}
                  className={`text-left p-3 rounded-md border ${
                    p.id === activeProvider ? 'border-accent bg-bg-subtle' : 'border-border'
                  }`}
                >
                  <div className="font-medium text-sm">{p.label}</div>
                  {p.requiresApiKey && <div className="text-xs text-fg-muted">Requires API key</div>}
                  {p.freeModels.length > 0 && <div className="text-xs text-success">{p.freeModels.length} free models</div>}
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
                  className="flex-1 rounded-md border border-border bg-bg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                />
                <button onClick={test} disabled={(!apiKey && !apiKeyLoaded) || status === 'testing'} className="rounded-md bg-accent text-accent-fg px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50">
                  {status === 'testing' ? 'Testing...' : 'Test & Save'}
                </button>
              </div>
            )}

            {status === 'ok' && <div className="text-sm text-success mb-2">Connected</div>}
            {status === 'fail' && <div className="text-sm text-danger mb-2">Connection failed</div>}

            {models.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-2">Models</h4>
                <ul className="space-y-1 max-h-64 overflow-y-auto">
                  {models.map((m) => (
                    <li key={m.id}>
                      <button onClick={() => pickModel(m.id)} className={`w-full text-left p-2 rounded-md text-sm flex items-center justify-between ${currentModel === m.id ? 'bg-accent/20 text-accent' : 'hover:bg-bg-subtle text-fg'}`}>
                        <span>{m.label}</span>
                        {m.free && <span className="text-xs text-success">free</span>}
                        {currentModel === m.id && <span className="text-xs text-accent">selected</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {models.length === 0 && provider?.freeModels && provider.freeModels.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-2">Free Models</h4>
                <ul className="space-y-1 max-h-64 overflow-y-auto">
                  {provider.freeModels.map((m) => (
                    <li key={m.id}>
                      <button onClick={() => pickModel(m.id)} className={`w-full text-left p-2 rounded-md text-sm flex items-center justify-between ${currentModel === m.id ? 'bg-accent/20 text-accent' : 'hover:bg-bg-subtle text-fg'}`}>
                        <span>{m.label}</span>
                        <span className="text-xs text-success">free</span>
                        {currentModel === m.id && <span className="text-xs text-accent">selected</span>}
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
