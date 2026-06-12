import { useEffect, useState } from 'react';
import { useNotificationStore } from '../../../renderer/stores/notifications';

export function ComputerControlView() {
  const addToast = useNotificationStore((s) => s.addToast);
  const [stats, setStats] = useState<{ totalActions: number; screenshotsTaken: number; appsOpened: number } | null>(null);
  const [appPath, setAppPath] = useState('');

  useEffect(() => {
    window.api.computerStats().then((s: unknown) => setStats(s as typeof stats)).catch(() => {});
  }, []);

  const handleMouseMove = async (x: number, y: number) => {
    try { await window.api.computerMoveMouse({ x, y }); addToast({ type: 'info', title: `Mouse moved to (${x}, ${y})` }); }
    catch { addToast({ type: 'error', title: 'Mouse move failed' }); }
  };

  const handleClick = async (button: string) => {
    try { await window.api.computerClickMouse({ button }); addToast({ type: 'success', title: `${button} click` }); }
    catch { addToast({ type: 'error', title: 'Click failed' }); }
  };

  const handleType = async (text: string) => {
    try { await window.api.computerTypeText({ text }); addToast({ type: 'success', title: 'Text typed' }); }
    catch { addToast({ type: 'error', title: 'Type failed' }); }
  };

  const handleKeyPress = async (key: string) => {
    try { await window.api.computerPressKey({ key }); addToast({ type: 'info', title: `Key pressed: ${key}` }); }
    catch { addToast({ type: 'error', title: 'Key press failed' }); }
  };

  const handleScreenshot = async () => {
    try { await window.api.computerCaptureScreen(); addToast({ type: 'success', title: 'Screenshot captured' }); }
    catch { addToast({ type: 'error', title: 'Screenshot failed' }); }
  };

  const handleOpenApp = async () => {
    if (!appPath.trim()) return;
    try { await window.api.computerOpenApp({ path: appPath }); addToast({ type: 'success', title: `Opened: ${appPath}` }); setAppPath(''); }
    catch { addToast({ type: 'error', title: 'Failed to open app' }); }
  };

  const quickKeys = ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'Space', 'Ctrl+C', 'Ctrl+V', 'Ctrl+A', 'Alt+Tab'];

  return (
    <div className="flex-1 overflow-y-auto p-6 animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-textMain flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" /></svg>
          </div>
          Computer Control
        </h1>
        <p className="text-textMuted text-sm mt-1">Control mouse, keyboard, and open applications on your system.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total Actions', value: stats?.totalActions ?? 0, color: 'from-purple-500 to-pink-500' },
          { label: 'Screenshots', value: stats?.screenshotsTaken ?? 0, color: 'from-cyan-500 to-blue-500' },
          { label: 'Apps Opened', value: stats?.appsOpened ?? 0, color: 'from-green-500 to-emerald-500' },
        ].map((stat, i) => (
          <div key={i} className="card-premium animate-slide-up" style={{ animationDelay: `${i * 25}ms` }}>
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${stat.color} flex items-center justify-center shadow-lg`}>
                <span className="text-white text-lg font-bold">{stat.value}</span>
              </div>
              <div>
                <div className="text-xs text-textMuted">{stat.label}</div>
                <div className="text-lg font-bold text-textMain">{stat.value}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Mouse Control */}
      <div className="card-premium mb-4 animate-slide-up" style={{ animationDelay: '50ms' }}>
        <h2 className="text-sm font-semibold text-textMain mb-3 flex items-center gap-2">
          <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zM12 2.25V4.5m5.834.166l-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243l-1.59-1.59" /></svg>
          Mouse Control
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-textMuted mb-1 block">X Coordinate</label>
            <input type="number" defaultValue={500} id="mouseX" className="input-premium" />
          </div>
          <div>
            <label className="text-xs text-textMuted mb-1 block">Y Coordinate</label>
            <input type="number" defaultValue={300} id="mouseY" className="input-premium" />
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          <button onClick={() => { const x = (document.getElementById('mouseX') as HTMLInputElement)?.value; const y = (document.getElementById('mouseY') as HTMLInputElement)?.value; handleMouseMove(Number(x), Number(y)); }} className="btn-premium flex-1">Move Mouse</button>
          <button onClick={() => handleClick('left')} className="px-4 py-2 rounded-xl bg-bgCard border border-borderSubtle text-textMain hover:border-purple-500/30 transition-all">Left Click</button>
          <button onClick={() => handleClick('right')} className="px-4 py-2 rounded-xl bg-bgCard border border-borderSubtle text-textMain hover:border-purple-500/30 transition-all">Right Click</button>
        </div>
      </div>

      {/* Keyboard Control */}
      <div className="card-premium mb-4 animate-slide-up" style={{ animationDelay: '75ms' }}>
        <h2 className="text-sm font-semibold text-textMain mb-3 flex items-center gap-2">
          <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" /></svg>
          Keyboard Control
        </h2>
        <div className="flex gap-2 mb-3">
          <input id="typeText" type="text" placeholder="Type text..." className="input-premium flex-1" onKeyDown={(e) => { if (e.key === 'Enter') { handleType((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).value = ''; } }} />
          <button onClick={() => { const el = document.getElementById('typeText') as HTMLInputElement; handleType(el.value); el.value = ''; }} className="btn-premium">Type</button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {quickKeys.map((key) => (
            <button key={key} onClick={() => handleKeyPress(key)} className="px-3 py-1.5 rounded-lg bg-bgCard border border-borderSubtle text-xs font-mono text-textMain hover:border-indigo-500/30 hover:bg-indigo-500/10 transition-all">
              {key}
            </button>
          ))}
        </div>
      </div>

      {/* App Control */}
      <div className="card-premium mb-4 animate-slide-up" style={{ animationDelay: '100ms' }}>
        <h2 className="text-sm font-semibold text-textMain mb-3 flex items-center gap-2">
          <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" /></svg>
          Application Control
        </h2>
        <div className="flex gap-2">
          <input value={appPath} onChange={(e) => setAppPath(e.target.value)} placeholder="App path or name (e.g., notepad, chrome)..." className="input-premium flex-1" onKeyDown={(e) => e.key === 'Enter' && handleOpenApp()} />
          <button onClick={handleOpenApp} className="btn-premium">Open App</button>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-3">
          {['notepad', 'chrome', 'explorer', 'calculator', 'cmd', 'powershell'].map((app) => (
            <button key={app} onClick={() => { setAppPath(app); window.api.computerOpenApp({ path: app }); addToast({ type: 'success', title: `Opening ${app}` }); }} className="px-3 py-1.5 rounded-lg bg-bgCard border border-borderSubtle text-xs text-textMain hover:border-green-500/30 hover:bg-green-500/10 transition-all capitalize">
              {app}
            </button>
          ))}
        </div>
      </div>

      {/* Screenshot */}
      <div className="card-premium animate-slide-up" style={{ animationDelay: '125ms' }}>
        <button onClick={handleScreenshot} className="btn-premium w-full flex items-center justify-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" /><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" /></svg>
          Take Screenshot
        </button>
      </div>
    </div>
  );
}
