import { useState } from 'react';

const PROJECTS = [
  {
    title: 'Client App',
    color: '#60a5fa',
    items: [
      { name: 'components/', icon: 'folder', color: '#60a5fa' },
      { name: 'hooks/', icon: 'folder', color: '#60a5fa' },
      { name: 'package.json', icon: 'file', color: '#a1a1aa' },
    ],
  },
  {
    title: 'Core Server',
    color: '#10b981',
    items: [
      { name: 'controllers/', icon: 'folder', color: '#10b981' },
      { name: 'middleware/', icon: 'folder', color: '#10b981' },
      { name: 'server.js', icon: 'file', color: '#a1a1aa' },
    ],
  },
  {
    title: 'DB Cluster',
    color: '#c084fc',
    items: [
      { name: 'migrations/', icon: 'folder', color: '#c084fc' },
      { name: 'seeds/', icon: 'folder', color: '#c084fc' },
      { name: 'schema.sql', icon: 'file', color: '#f472b6' },
    ],
  },
  {
    title: 'System Docs',
    color: '#a1a1aa',
    items: [
      { name: 'README.md', icon: 'file', color: '#38bdf8' },
      { name: 'ARCH.md', icon: 'file', color: '#a1a1aa' },
    ],
  },
];

export function ProjectCards() {
  const [deployed, setDeployed] = useState(true);

  return (
    <div className="mt-4 bg-bgPanel border border-borderSubtle rounded-xl p-3.5 flex flex-col gap-3.5 w-full max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-borderSubtle/60 pb-2">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-textMain">Project Tree Architecture</span>
          <span className="text-[9px] text-textMuted bg-bgMain px-1.5 py-0.5 rounded border border-borderSubtle">main</span>
          <div className="flex -space-x-1 ml-2">
            <div className="w-4 h-4 rounded-full bg-indigo-500 border border-bgPanel text-[7px] text-white flex items-center justify-center">A</div>
            <div className="w-4 h-4 rounded-full bg-emerald-500 border border-bgPanel text-[7px] text-white flex items-center justify-center">B</div>
          </div>
        </div>
        <div className="flex items-center gap-2.5 text-textMuted">
          <svg className="w-3.5 h-3.5 hover:text-textMain cursor-pointer" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
          <div className="w-px h-2.5 bg-borderSubtle" />
          <svg className="w-3.5 h-3.5 hover:text-textMain cursor-pointer" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"/></svg>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {PROJECTS.map((p) => (
          <div key={p.title} className="space-y-1.5">
            <div className="text-textMain font-medium mb-0.5 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: p.color }} /> {p.title}
            </div>
            {p.items.map((it) => (
              <div key={it.name} className="text-textMuted hover:text-textMain cursor-pointer flex items-center gap-1.5">
                <span style={{ color: it.color }}>{it.icon === 'folder' ? '\uD83D\uDCC1' : '\uD83D\uDCC4'}</span> {it.name}
              </div>
            ))}
          </div>
        ))}

        {/* Deploy */}
        <div className="space-y-1.5">
          <div className="text-textMain font-medium">Vercel Pipeline</div>
          <div className="bg-bgMain border border-borderSubtle rounded-lg p-2 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-semibold text-textMain flex items-center gap-1">&#9650; Production</span>
              <span className="text-[7px] text-brandGreen bg-brandGreen/10 px-1 py-0.5 rounded font-bold uppercase">Live</span>
            </div>
            <div className="text-[9px] text-textMuted truncate font-mono mb-2">app.infinityai.dev</div>
            <button
              onClick={() => setDeployed((d) => !d)}
              className="w-full py-1 bg-gradient-to-r from-indigo-600 to-blue-600 text-white rounded font-medium text-[9px] shadow-md"
            >
              {deployed ? 'Open Url' : 'Deploy'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
