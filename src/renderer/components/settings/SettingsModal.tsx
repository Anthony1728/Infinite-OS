import { useEffect, useState } from 'react';
import type { ProviderInfo } from '../../../shared/types';

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [activeProvider, setActiveProvider] = useState<string>('openrouter');
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [models, setModels] = useState<{ id: string; label: string; free: boolean }[]>([]);

  useEffect(() => {
    window.api.listProviders().then((p: ProviderInfo[]) => {
      setProviders(p);
      const has = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
      if (has.provider) setActiveProvider(has.provider);
    });
  }, []);

  const test = async () => {
    setStatus('testing');
    const res = await window.api.testProvider({ provider: activeProvider, apiKey });
    if (res.ok) {
      setStatus('ok');
      if (apiKey) await window.api.setProviderKey({ provider: activeProvider, key: apiKey });
      const list = await window.api.listProviderModels({ provider: activeProvider, apiKey });
      setModels(list as { id: string; label: string; free: boolean }[]);
    } else {
      setStatus('fail');
    }
  };

  const pickModel = (id: string) => {
    const current = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
    localStorage.setItem('infinite:current', JSON.stringify({ ...current, provider: activeProvider, model: id }));
  };

  const provider = providers.find((p) => p.id === activeProvider);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-bg-elevated rounded-lg border border-border w-full max-w-2xl max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button onClick={onClose} className="text-fg-muted hover:text-fg">×</button>
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
                  placeholder="Paste your API key"
                  className="flex-1 rounded-md border border-border bg-bg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                />
                <button onClick={test} disabled={!apiKey || status === 'testing'} className="rounded-md bg-accent text-accent-fg px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50">
                  {status === 'testing' ? 'Testing…' : 'Test & save'}
                </button>
              </div>
            )}

            {status === 'ok' && <div className="text-sm text-success mb-2">✓ Connected</div>}
            {status === 'fail' && <div className="text-sm text-danger mb-2">✗ Connection failed</div>}

            {models.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-2">Models</h4>
                <ul className="space-y-1 max-h-64 overflow-y-auto">
                  {models.map((m) => (
                    <li key={m.id}>
                      <button onClick={() => pickModel(m.id)} className="w-full text-left p-2 rounded-md hover:bg-bg-subtle text-sm flex items-center justify-between">
                        <span>{m.label}</span>
                        {m.free && <span className="text-xs text-success">free</span>}
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
