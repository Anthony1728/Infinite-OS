import { useEffect, useState } from 'react';
import { useWorkersStore } from '../../stores/workers';
import { WorkersPanel } from '../workers/WorkersPanel';
import { TeachingPanel } from '../workers/TeachingPanel';
import { AppsPanel } from '../workers/AppsPanel';
import { VaultPanel } from '../workers/VaultPanel';

type Tab = 'workers' | 'teach' | 'apps' | 'vault';

const TABS: Array<{ id: Tab; label: string; hint: string }> = [
  { id: 'workers', label: 'Workers', hint: 'Run, watch, pause, reset' },
  { id: 'teach', label: 'Teach', hint: 'Record a demo → steps' },
  { id: 'apps', label: 'Apps', hint: 'Install & launch' },
  { id: 'vault', label: 'Vault', hint: 'Per-worker passwords' },
];

export function WorkersView() {
  const init = useWorkersStore((s) => s.init);
  const [tab, setTab] = useState<Tab>('workers');

  useEffect(() => { init(); }, [init]);

  return (
    <div className="flex-1 overflow-hidden p-6 animate-fade-in flex flex-col min-h-0">
      <div className="flex items-center gap-1 border-b border-white/[0.07] pb-0 mb-4 flex-wrap">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            onClick={() => setTab(entry.id)}
            className={`px-3.5 py-2 text-sm rounded-t-lg transition-colors -mb-px border-b-2 ${
              tab === entry.id
                ? 'border-indigo-400 text-white'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {entry.label}
            <span className="ml-2 text-[10px] text-gray-600">{entry.hint}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-col min-h-0 flex-1">
        {tab === 'workers' && <WorkersPanel onOpenTeaching={() => setTab('teach')} />}
        {tab === 'teach' && <TeachingPanel onCreated={() => setTab('workers')} />}
        {tab === 'apps' && <AppsPanel />}
        {tab === 'vault' && <VaultPanel />}
      </div>
    </div>
  );
}
