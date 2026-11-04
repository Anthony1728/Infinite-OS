/**
 * Connectors — one honest page for everything the OS talks to.
 *
 * Otto-inspired: each connection is a status tile with its live state and a
 * one-click jump to wherever it is managed. No settings are duplicated here —
 * this is the map, not the machinery.
 */

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { AppIcon, type AppIconName } from '../brand/AppIcon';

interface ConnectorsViewProps {
  onViewChange: (view: string) => void;
}

type ConnectorState = 'checking' | 'online' | 'offline' | 'unknown';

interface Connector {
  id: string;
  name: string;
  desc: string;
  icon: AppIconName;
  accent: string;
  view?: string;
  state: ConnectorState;
  detail: string;
}

function StateDot({ state }: { state: ConnectorState }) {
  if (state === 'checking') {
    return <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />;
  }
  if (state === 'online') {
    return <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" /></span>;
  }
  if (state === 'offline') {
    return <span className="h-2 w-2 rounded-full bg-zinc-600" />;
  }
  return <span className="h-2 w-2 rounded-full border border-zinc-500" />;
}

function stateLabel(state: ConnectorState): string {
  switch (state) {
    case 'online': return 'Connected';
    case 'offline': return 'Not connected';
    case 'checking': return 'Checking…';
    default: return 'Status unknown';
  }
}

function ConnectorTile({ connector, onOpen, index }: { connector: Connector; onOpen: (view: string) => void; index: number }) {
  const tone =
    connector.state === 'online' ? 'border-emerald-500/20' :
    connector.state === 'checking' ? 'border-amber-500/20' :
    'border-white/[0.07]';
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: index * 0.05 }}
      className={`relative overflow-hidden rounded-2xl border bg-[#12131a] p-4 transition-colors hover:border-white/[0.14] ${tone}`}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className="flex h-10 w-10 items-center justify-center rounded-xl"
          style={{ background: `${connector.accent}1c`, border: `1px solid ${connector.accent}38`, color: connector.accent }}
        >
          <AppIcon name={connector.icon} className="h-5 w-5" strokeWidth={1.7} />
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.03] px-2 py-0.5 text-[9px] font-medium text-zinc-400">
          <StateDot state={connector.state} />
          {stateLabel(connector.state)}
        </span>
      </div>
      <div className="mt-3 text-[14px] font-semibold text-white">{connector.name}</div>
      <p className="mt-1 min-h-[32px] text-[11.5px] leading-4 text-zinc-500">{connector.desc}</p>
      {connector.detail && (
        <div className="mt-2 truncate rounded-lg border border-white/[0.05] bg-black/25 px-2 py-1 font-mono text-[10px] text-zinc-500" title={connector.detail}>
          {connector.detail}
        </div>
      )}
      {connector.view && (
        <button
          onClick={() => onOpen(connector.view!)}
          className="mt-3 w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[11.5px] font-medium text-zinc-200 transition-colors hover:bg-white/[0.09]"
        >
          Manage →
        </button>
      )}
    </motion.div>
  );
}

export function ConnectorsView({ onViewChange }: ConnectorsViewProps) {
  const [phone, setPhone] = useState<{ state: ConnectorState; detail: string }>({ state: 'checking', detail: '' });
  const [bridge, setBridge] = useState<{ state: ConnectorState; detail: string }>({ state: 'checking', detail: '' });
  const [mcp, setMcp] = useState<{ state: ConnectorState; detail: string }>({ state: 'checking', detail: '' });
  const [messaging, setMessaging] = useState<{ state: ConnectorState; detail: string }>({ state: 'checking', detail: '' });
  const [provider, setProvider] = useState<{ state: ConnectorState; detail: string }>({ state: 'checking', detail: '' });
  const [workspace, setWorkspace] = useState<{ state: ConnectorState; detail: string }>({ state: 'checking', detail: '' });

  const probe = useCallback(async () => {
    const set = (
      promise: Promise<unknown>,
      ok: (data: unknown) => { state: ConnectorState; detail: string },
    ) => promise.then(ok).catch(() => ({ state: 'offline' as const, detail: 'Not available' }));

    void set(window.api.remotePhoneInfo(), (raw) => {
      const info = raw as { running?: boolean; url?: string; connections?: number; port?: number };
      return info?.running
        ? { state: 'online', detail: `Port ${info.port} · ${info.connections ?? 0} device(s)` }
        : { state: 'offline', detail: 'Companion server not running' };
    }).then(setPhone);

    void set(window.api.bridgeStatus(), (raw) => {
      const status = raw as { connected?: boolean; clients?: number; running?: boolean };
      const online = Boolean(status?.connected || (typeof status?.clients === 'number' && status.clients > 0) || status?.running);
      return online
        ? { state: 'online', detail: status?.clients != null ? `${status.clients} browser client(s)` : 'Extension linked' }
        : { state: 'offline', detail: 'Install the bridge extension to link Chrome' };
    }).then(setBridge);

    void set(window.api.mcpStatus(), (raw) => {
      const status = raw as { servers?: unknown[]; running?: number; total?: number } | Array<unknown> | null;
      const list = Array.isArray(status) ? status : (status?.servers ?? []);
      const count = list.length;
      return count > 0
        ? { state: 'online', detail: `${count} MCP server${count === 1 ? '' : 's'} configured` }
        : { state: 'offline', detail: 'No MCP servers configured' };
    }).then(setMcp);

    void set(window.api.messagingStatus(), (raw) => {
      const status = raw as Record<string, unknown>;
      const parts: string[] = [];
      let any = false;
      for (const [key, value] of Object.entries(status ?? {})) {
        const on = Boolean((value as { connected?: boolean; linked?: boolean; enabled?: boolean })?.connected
          ?? (value as { linked?: boolean })?.linked
          ?? (value as { enabled?: boolean })?.enabled);
        if (on) { any = true; parts.push(key); }
      }
      return any
        ? { state: 'online', detail: `Live: ${parts.join(', ')}` }
        : { state: 'offline', detail: 'WhatsApp, Telegram & co. not linked' };
    }).then(setMessaging);

    void set((async () => {
      const cur = JSON.parse(localStorage.getItem('infinite:current') ?? '{}') as { provider?: string };
      const providerId = cur.provider ?? 'openrouter';
      const result = await window.api.testProvider({ provider: providerId, apiKey: '' }) as { ok?: boolean };
      return { ok: result.ok, providerId };
    })(), (raw) => {
      const { ok, providerId } = raw as { ok?: boolean; providerId: string };
      return ok
        ? { state: 'online' as const, detail: `Active provider: ${providerId}` }
        : { state: 'offline' as const, detail: `No working key for ${providerId} — add one in Settings` };
    }).then(setProvider);

    void set(Promise.resolve(), () => {
      const cur = JSON.parse(localStorage.getItem('infinite:current') ?? '{}') as { cwd?: string };
      return cur.cwd && cur.cwd !== '.'
        ? { state: 'online' as const, detail: cur.cwd }
        : { state: 'offline' as const, detail: 'Open a folder in Workspace to link it' };
    }).then(setWorkspace);
  }, []);

  useEffect(() => {
    void probe();
  }, [probe]);

  const connectors: Connector[] = [
    { id: 'provider', name: 'AI provider', desc: 'The model engine behind every chat, agent and automation.', icon: 'topbar.engine', accent: '#8b5cf6', view: 'chats', state: provider.state, detail: provider.detail },
    { id: 'phone', name: 'Phone companion', desc: 'Chat with your agent and watch it work from your phone, over your Wi-Fi.', icon: 'action.phone', accent: '#22d3ee', state: phone.state, detail: phone.detail },
    { id: 'bridge', name: 'Browser bridge', desc: 'Drives your real Chrome — logged-in sites, tabs, cookies and history.', icon: 'agent.browser', accent: '#38bdf8', state: bridge.state, detail: bridge.detail },
    { id: 'mcp', name: 'MCP servers', desc: 'External tool servers the agent can call like built-in tools.', icon: 'automation.link', accent: '#34d399', state: mcp.state, detail: mcp.detail },
    { id: 'messaging', name: 'Messaging', desc: 'WhatsApp and Telegram in and out — your bots, your chats.', icon: 'home.chat', accent: '#f472b6', view: 'messaging', state: messaging.state, detail: messaging.detail },
    { id: 'workspace', name: 'Workspace folder', desc: 'The folder the agent reads, writes and builds in.', icon: 'nav.workspace', accent: '#fbbf24', view: 'workspace', state: workspace.state, detail: workspace.detail },
  ];

  const online = connectors.filter((c) => c.state === 'online').length;

  return (
    <div className="flex-1 overflow-auto chat-scrollbar bg-[#09090c] animate-fade-in">
      <div className="mx-auto max-w-[1100px] px-6 py-8 lg:px-8">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <span className="micro-label">System</span>
            <h1 className="mt-1 text-[24px] font-semibold tracking-tight text-white">Connectors</h1>
            <p className="mt-1 text-[12.5px] text-zinc-500">Everything your OS reaches — models, phone, browser, servers and folders.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void probe()}
              className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[11.5px] font-medium text-zinc-300 transition-colors hover:bg-white/[0.09]"
            >
              Re-check all
            </button>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.03] px-2.5 py-1 text-[10px] font-medium text-zinc-400">
              {online}/{connectors.length} connected
            </span>
          </div>
        </div>

        {/* Tiles */}
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {connectors.map((c, i) => (
            <ConnectorTile key={c.id} connector={c} onOpen={onViewChange} index={i} />
          ))}
        </div>

        {/* Jump-off points */}
        <div className="mt-6 rounded-2xl border border-white/[0.07] bg-[#12131a] p-4">
          <span className="micro-label">More surfaces</span>
          <div className="mt-3 flex flex-wrap gap-2">
            {([
              { id: 'cloud', label: 'Cloud sync', icon: 'nav.workspace' as AppIconName },
              { id: 'voice', label: 'Voice & speech', icon: 'nav.voice' as AppIconName },
              { id: 'deploy', label: 'Deploy', icon: 'action.launch' as AppIconName },
              { id: 'callcenter', label: 'Call center', icon: 'action.phone' as AppIconName },
              { id: 'plugins', label: 'Plugin marketplace', icon: 'home.plugins' as AppIconName },
              { id: 'capabilities', label: 'Tools & skills', icon: 'nav.capabilities' as AppIconName },
            ]).map((s) => (
              <button
                key={s.id}
                onClick={() => onViewChange(s.id)}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.03] px-3 py-1.5 text-[11.5px] text-zinc-300 transition-colors hover:border-violet-400/30 hover:bg-white/[0.07] hover:text-white"
              >
                <AppIcon name={s.icon} className="h-3.5 w-3.5" strokeWidth={1.7} />
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <p className="mt-6 text-center text-[11px] text-zinc-600">
          Every connection is local-first — nothing is reachable from the internet unless you start it.
        </p>
      </div>
    </div>
  );
}
