import { useEffect, useState } from 'react';
import { useBrowserStore } from '../../../renderer/stores/browser';
import { useNotificationStore } from '../../../renderer/stores/notifications';

export function BrowserControlView() {
  const { sessions, stats, loading, loadSessions, loadStats, createSession, navigate, screenshot, deleteSession } = useBrowserStore();
  const addToast = useNotificationStore((s) => s.addToast);
  const [url, setUrl] = useState('https://');
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => { loadSessions(); loadStats(); }, [loadSessions, loadStats]);

  const handleCreateSession = async () => {
    setCreating(true);
    try {
      const id = await createSession('Browser Session');
      setActiveSession(id);
      addToast({ type: 'success', title: 'Browser session created' });
    } catch { addToast({ type: 'error', title: 'Failed to create session' }); }
    setCreating(false);
  };

  const handleNavigate = async () => {
    if (!activeSession || !url.trim()) return;
    try {
      await navigate(activeSession, url);
      addToast({ type: 'info', title: 'Navigating...', message: url });
    } catch { addToast({ type: 'error', title: 'Navigation failed' }); }
  };

  const handleScreenshot = async () => {
    if (!activeSession) return;
    try {
      const dataUrl = await screenshot(activeSession);
      setScreenshotUrl(dataUrl);
      addToast({ type: 'success', title: 'Screenshot captured' });
    } catch { addToast({ type: 'error', title: 'Screenshot failed' }); }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-textMain flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center shadow-lg">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" /></svg>
          </div>
          Browser Control
        </h1>
        <p className="text-textMuted text-sm mt-1">Automate web browsing with AI-powered browser sessions.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Active Sessions', value: stats?.totalSessions ?? sessions.length, color: 'from-blue-500 to-indigo-500' },
          { label: 'Total Actions', value: stats?.totalActions ?? 0, color: 'from-purple-500 to-pink-500' },
          { label: 'Screenshots', value: sessions.length, color: 'from-cyan-500 to-blue-500' },
        ].map((stat, i) => (
          <div key={i} className="card-premium animate-slide-up" style={{ animationDelay: `${i * 25}ms` }}>
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${stat.color} flex items-center justify-center shadow-lg`}>
                <span className="text-white text-lg font-bold">{typeof stat.value === 'number' ? stat.value : 0}</span>
              </div>
              <div>
                <div className="text-xs text-textMuted">{stat.label}</div>
                <div className="text-lg font-bold text-textMain">{stat.value}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex gap-3 mb-6">
        <button onClick={handleCreateSession} disabled={creating} className="btn-premium flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
          {creating ? 'Creating...' : 'New Session'}
        </button>
        {activeSession && (
          <>
            <div className="flex-1 flex gap-2">
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Enter URL..." className="input-premium flex-1" onKeyDown={(e) => e.key === 'Enter' && handleNavigate()} />
              <button onClick={handleNavigate} className="btn-premium">Navigate</button>
            </div>
            <button onClick={handleScreenshot} className="px-4 py-2 rounded-xl bg-bgCard border border-borderSubtle text-textMain hover:border-indigo-500/30 transition-all">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" /><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" /></svg>
            </button>
          </>
        )}
      </div>

      {/* Sessions List */}
      <div className="space-y-3 mb-6">
        <h2 className="text-sm font-semibold text-textMain">Sessions</h2>
        {loading ? (
          <div className="text-center py-8 text-textMuted"><div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" /></div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-12 text-textMuted">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/20 to-indigo-500/20 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" /></svg>
            </div>
            <p className="text-lg font-medium text-textMain">No browser sessions</p>
            <p className="text-sm text-textMuted">Create a session to start automating web browsing</p>
          </div>
        ) : (
          sessions.map((session, i) => (
            <div key={session.id} className={`card-premium cursor-pointer group animate-slide-up ${activeSession === session.id ? 'border-indigo-500/50' : ''}`}
              style={{ animationDelay: `${i * 20}ms` }}
              onClick={() => setActiveSession(session.id)}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" /></svg>
                  </div>
                  <div>
                    <div className="font-medium text-textMain text-sm">{session.name}</div>
                    <div className="text-xs text-textMuted">{session.url || 'No URL loaded'}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="status-dot-active" />
                  <button onClick={(e) => { e.stopPropagation(); deleteSession(session.id); }} className="opacity-0 group-hover:opacity-100 text-textMuted hover:text-brandRed transition-all p-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Screenshot Preview */}
      {screenshotUrl && (
        <div className="card-premium animate-scale-in">
          <h2 className="text-sm font-semibold text-textMain mb-3">Latest Screenshot</h2>
          <img src={screenshotUrl} alt="Browser screenshot" className="w-full rounded-lg border border-borderSubtle" />
        </div>
      )}
    </div>
  );
}
