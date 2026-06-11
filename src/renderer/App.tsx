import { useEffect, useState } from 'react';
import { TopBar } from './components/layout/TopBar';
import { Sidebar } from './components/layout/Sidebar';
import { RightPanel } from './components/layout/RightPanel';
import { MainView } from './components/layout/MainView';
import { CommandPalette } from './components/command/CommandPalette';
import { DeployModal } from './components/deploy/DeployModal';
import { SettingsModal } from './components/settings/SettingsModal';
import { PermissionDialog } from './components/permissions/PermissionDialog';
import { ToastContainer } from './components/notifications/ToastContainer';
import { useUIStore } from './stores/ui';
import { useChatStore } from './stores/chat';

export function App() {
  const [ready, setReady] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [activeView, setActiveView] = useState('chats');
  const settingsOpen = useUIStore((s) => s.settingsOpen);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const initStreamListener = useChatStore((s) => s.initStreamListener);

  useEffect(() => {
    initStreamListener();
    setReady(true);
  }, [initStreamListener]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
        e.preventDefault();
        setDeployOpen(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (!ready) return null;

  return (
    <div className="h-screen w-full flex overflow-hidden text-[11px] selection:bg-indigo-500/30">
      <Sidebar
        activeView={activeView}
        onNavChange={setActiveView}
        onOpenSettings={() => setActiveView('settings')}
      />
      <div className="flex-1 flex flex-col min-w-0 bg-bgMain">
        <TopBar onOpenCommand={() => setCommandOpen(true)} />
        <main className="flex-1 min-h-0 overflow-hidden">
          <MainView activeView={activeView} onViewChange={setActiveView} />
        </main>
      </div>
      <RightPanel />
      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        onCommand={(cmd) => {
          if (cmd === 'deploy') setDeployOpen(true);
          else if (cmd === 'memory') setActiveView('memory');
          else if (cmd === 'settings') setActiveView('settings');
          else if (cmd === 'browser') setActiveView('browser');
          else if (cmd === 'computer') setActiveView('computer');
          else if (cmd === 'automations') setActiveView('automations');
          else if (cmd === 'website-builder') setActiveView('website-builder');
          else if (cmd === 'app-builder') setActiveView('app-builder');
          else if (cmd === 'business') setActiveView('business');
          else if (cmd === 'plugins') setActiveView('plugins');
          else if (cmd === 'cloud') setActiveView('cloud');
          else if (cmd === 'multi-agent') setActiveView('multi-agent');
          else if (cmd === 'workspace') setActiveView('workspace');
          else if (cmd === 'projects') setActiveView('projects');
          else if (cmd === 'documents') setActiveView('documents');
          else if (cmd === 'agents') setActiveView('agents');
          else if (cmd === 'new-chat') {
            setActiveView('chats');
          }
        }}
      />
      {deployOpen && <DeployModal onClose={() => setDeployOpen(false)} />}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      <PermissionDialog />
      <ToastContainer />
    </div>
  );
}
