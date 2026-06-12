import { useEffect, useState } from 'react';
import type { ProviderInfo } from '../../../shared/types';
import { useNotificationStore } from '../../stores/notifications';

export function SettingsView() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [activeProvider, setActiveProvider] = useState<string>('openrouter');
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [models, setModels] = useState<{ id: string; label: string; free: boolean }[]>([]);
  const addToast = useNotificationStore((s) => s.addToast);

  useEffect(() => {
    window.api.listProviders().then((p: ProviderInfo[]) => {
      setProviders(p);
      const has = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
      if (has.provider) setActiveProvider(has.provider);
    });
  }, []);

  const test = async () => {
    setStatus('testing');
    try {
      const res = await window.api.testProvider({ provider: activeProvider, apiKey });
      if (res.ok) {
        setStatus('ok');
        if (apiKey) await window.api.setProviderKey({ provider: activeProvider, key: apiKey });
        const list = await window.api.listProviderModels({ provider: activeProvider, apiKey });
        setModels(list as { id: string; label: string; free: boolean }[]);
        addToast({ type: 'success', title: 'Provider connected successfully' });
      } else {
        setStatus('fail');
        addToast({ type: 'error', title: 'Connection failed' });
      }
    } catch (e) {
      setStatus('fail');
      addToast({ type: 'error', title: 'Connection error' });
    }
  };

  const pickModel = (id: string) => {
    const current = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
    localStorage.setItem('infinite:current', JSON.stringify({ ...current, provider: activeProvider, model: id }));
    addToast({ type: 'success', title: `Model set to ${id}` });
  };

  const provider = providers.find((p) => p.id === activeProvider);

  return (
    <div className="flex-1 overflow-y-auto p-6 animate-fade-in">
      <h1 className="text-2xl font-bold mb-4 text-textMain">Settings</h1>
      <p className="text-textMuted text-sm mb-6">Configure your Infinite AI OS experience and AI Providers.</p>
      
      <div className="space-y-6 max-w-3xl">
        <div className="card-premium">
          <h3 className="font-medium mb-3 text-textMain">AI Provider</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
            {providers.map((p) => (
              <button
                key={p.id}
                onClick={() => { setActiveProvider(p.id); setStatus('idle'); setModels(p.freeModels || []); }}
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
              </button>
            ))}
          </div>

          {provider?.requiresApiKey && (
            <div className="flex gap-2 mb-4">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={`Enter your ${provider.label} API key`}
                className="input-premium flex-1"
              />
              <button 
                onClick={test} 
                disabled={!apiKey || status === 'testing'} 
                className="btn-premium whitespace-nowrap"
              >
                {status === 'testing' ? 'Testing...' : 'Test & Save'}
              </button>
            </div>
          )}

          {status === 'ok' && <div className="text-sm text-green-400 mb-4 bg-green-400/10 px-3 py-2 rounded-lg inline-block">✓ Connection successful</div>}
          {status === 'fail' && <div className="text-sm text-red-400 mb-4 bg-red-400/10 px-3 py-2 rounded-lg inline-block">✗ Connection failed</div>}

          {models.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold mb-2 text-textMain">Available Models</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto custom-scrollbar pr-2">
                {models.map((m) => {
                  const isCurrent = JSON.parse(localStorage.getItem('infinite:current') ?? '{}').model === m.id;
                  return (
                    <button 
                      key={m.id} 
                      onClick={() => pickModel(m.id)} 
                      className={`text-left p-2.5 rounded-lg text-sm flex items-center justify-between border transition-all ${
                        isCurrent 
                          ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-100' 
                          : 'bg-bgInput border-borderSubtle text-textMuted hover:text-textMain hover:border-indigo-500/30'
                      }`}
                    >
                      <span className="truncate pr-2 font-medium">{m.label}</span>
                      {m.free && <span className="text-[10px] uppercase font-bold tracking-wider text-green-400 bg-green-400/10 px-2 py-0.5 rounded">Free</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
