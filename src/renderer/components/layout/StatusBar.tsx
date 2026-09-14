import { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/auth';
import { useChatStore } from '../../stores/chat';
import { AgentBuddy } from '../brand/AgentBuddy';

// Bottom status bar — Hermes' "Gateway ready" strip in Infinite glass:
// provider/model, engine pulse, session count, version, user.
export function StatusBar() {
  const user = useAuthStore((s) => s.user);
  const sessionCount = useChatStore((s) => s.sessions.length);
  const streaming = useChatStore((s) => s.streaming);
  const [provider, setProvider] = useState('…');
  const [model, setModel] = useState('');
  const [version, setVersion] = useState('');
  const [engineOk, setEngineOk] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const cur = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
        if (alive && cur.provider) {
          setProvider(cur.provider === 'opencode' ? 'OpenCode Zen' : String(cur.provider));
          const m = String(cur.model ?? '').split('/').pop()?.replace(/:free$/, '') ?? '';
          setModel(m);
        }
      } catch {
        /* keep placeholders */
      }
      try {
        const v = (await window.api.appVersion()) as string | { version?: string };
        if (alive) setVersion(typeof v === 'string' ? v : (v.version ?? ''));
      } catch {
        /* skip */
      }
      try {
        const st = (await window.api.engineStatus()) as { ok?: boolean; status?: string } | boolean;
        if (alive) setEngineOk(typeof st === 'boolean' ? st : (st.ok ?? true));
      } catch {
        if (alive) setEngineOk(null);
      }
    };
    void refresh();
    const onStorage = () => void refresh();
    window.addEventListener('storage', onStorage);
    const timer = setInterval(refresh, 30000);
    return () => {
      alive = false;
      window.removeEventListener('storage', onStorage);
      clearInterval(timer);
    };
  }, []);

  return (
    <footer className="flex h-8 shrink-0 items-center gap-3 border-t border-white/[0.06] bg-[#0a0a0e]/90 px-3 text-[11px] text-zinc-500 select-none">
      <AgentBuddy working={streaming} />
      <span className="inline-flex items-center gap-1.5" title={engineOk === false ? 'Engine issue' : 'Engine status'}>
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            engineOk === false ? 'bg-red-400' : engineOk ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,.8)]' : 'bg-zinc-600'
          }`}
        />
        <span className="font-medium text-zinc-400">{engineOk === false ? 'Engine issue' : 'Ready'}</span>
      </span>
      <span className="hidden sm:inline text-zinc-600">|</span>
      <span className="hidden sm:inline truncate" title="Active provider / model">
        {provider}
        {model ? <span className="text-zinc-600"> · {model}</span> : null}
      </span>
      <span className="hidden md:inline text-zinc-600">|</span>
      <span className="hidden md:inline">{sessionCount} session{sessionCount === 1 ? '' : 's'}</span>
      <span className="ml-auto inline-flex items-center gap-3">
        {version && <span className="font-mono text-zinc-600">v{version}</span>}
        <span className="max-w-[140px] truncate text-zinc-400" title={user?.email ?? ''}>
          {user?.name ?? 'User'}
        </span>
      </span>
    </footer>
  );
}
