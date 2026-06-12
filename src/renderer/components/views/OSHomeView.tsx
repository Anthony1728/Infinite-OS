const MODULES = [
  {
    id: 'chats',
    title: 'AI Workspace',
    status: 'Live',
    metric: 'Multi-model chat',
    accent: 'from-indigo-500 to-cyan-500',
    icon: 'M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501c1.153-.086 2.294-.213 3.423-.379 1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z',
  },
  {
    id: 'agents',
    title: 'Agent Builder',
    status: 'Live',
    metric: '84 agent templates',
    accent: 'from-emerald-500 to-teal-500',
    icon: 'M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z',
  },
  {
    id: 'automations',
    title: 'Automation Studio',
    status: 'Live',
    metric: 'Workflow engine',
    accent: 'from-amber-500 to-orange-500',
    icon: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z',
  },
  {
    id: 'computer',
    title: 'Computer Control',
    status: 'Live',
    metric: 'Device actions',
    accent: 'from-sky-500 to-blue-500',
    icon: 'M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25A2.25 2.25 0 015.25 3h13.5A2.25 2.25 0 0121 5.25z',
  },
  {
    id: 'cloud',
    title: 'Cloud Workspace',
    status: 'Beta',
    metric: 'Sync layer',
    accent: 'from-cyan-500 to-blue-500',
    icon: 'M2.25 15a4.5 4.5 0 014.5-4.5h.51A6.75 6.75 0 1120.25 13.5H18a3.75 3.75 0 00-7.244-1.344A4.5 4.5 0 002.25 15z',
  },
  {
    id: 'business',
    title: 'Business Suite',
    status: 'Live',
    metric: 'CRM and analytics',
    accent: 'from-rose-500 to-pink-500',
    icon: 'M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387M8.25 6.144V5.25A2.25 2.25 0 0110.5 3h3A2.25 2.25 0 0115.75 5.25v.894',
  },
  {
    id: 'documents',
    title: 'Knowledge Hub',
    status: 'Live',
    metric: 'Files and memory',
    accent: 'from-violet-500 to-fuchsia-500',
    icon: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5A3.375 3.375 0 0010.125 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25z',
  },
  {
    id: 'plugins',
    title: 'Plugin Marketplace',
    status: 'Alpha',
    metric: 'Extensions',
    accent: 'from-lime-500 to-green-500',
    icon: 'M14.25 6.087c0-.355.186-.676.476-.88l1.282-.897a1.125 1.125 0 011.572.275l1.5 2.25c.343.514.208 1.209-.304 1.554l-1.155.779a1.08 1.08 0 00-.467.894v3.876c0 .36.18.697.48.897l1.142.761c.512.342.65 1.034.309 1.547l-1.5 2.25a1.125 1.125 0 01-1.57.286l-1.29-.882a1.08 1.08 0 00-.609-.189H9.884c-.218 0-.43.066-.609.189l-1.29.882a1.125 1.125 0 01-1.57-.286l-1.5-2.25a1.125 1.125 0 01.309-1.547l1.142-.761c.3-.2.48-.537.48-.897v-3.876c0-.358-.177-.693-.474-.894l-1.148-.779a1.125 1.125 0 01-.304-1.554l1.5-2.25a1.125 1.125 0 011.572-.275l1.282.897c.29.204.476.525.476.88v.163a1.5 1.5 0 001.5 1.5h1.5a1.5 1.5 0 001.5-1.5v-.163z',
  },
];

const OPERATIONS = [
  { label: 'Assistant sessions', value: '12', detail: '4 active contexts' },
  { label: 'Automations', value: '9', detail: '3 running now' },
  { label: 'Cloud sync', value: '98%', detail: 'Last sync 2 min ago' },
  { label: 'Knowledge items', value: '1.2k', detail: 'Indexed locally' },
];

const WORKFLOWS = [
  { name: 'Capture customer request', stage: 'Business Suite', progress: 72 },
  { name: 'Review repository changes', stage: 'AI Coding', progress: 54 },
  { name: 'Publish campaign assets', stage: 'Creative Studio', progress: 38 },
];

interface OSHomeViewProps {
  onOpenView: (view: string) => void;
}

export function OSHomeView({ onOpenView }: OSHomeViewProps) {
  return (
    <div className="h-full overflow-y-auto custom-scrollbar animate-fade-in">
      <div className="p-5 space-y-5">
        <section className="grid grid-cols-12 gap-4">
          <div className="col-span-12 xl:col-span-8 bg-bgPanel border border-borderSubtle rounded-2xl p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-textMuted mb-2">InfiniteAI OS</div>
                <h1 className="text-2xl font-bold text-textMain mb-2">Unified AI workspace</h1>
                <p className="text-sm text-textMuted max-w-2xl">
                  Assistants, agents, coding, automation, cloud workspaces, business operations, content creation, and knowledge management in one operating layer.
                </p>
              </div>
              <button onClick={() => onOpenView('chats')} className="btn-premium flex items-center gap-2 flex-shrink-0">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                New Chat
              </button>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-6">
              {OPERATIONS.map((item) => (
                <div key={item.label} className="bg-bgCard border border-borderSubtle rounded-xl p-3">
                  <div className="text-[10px] text-textMuted mb-1">{item.label}</div>
                  <div className="text-xl font-semibold text-textMain">{item.value}</div>
                  <div className="text-[10px] text-textMuted mt-1">{item.detail}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="col-span-12 xl:col-span-4 bg-bgPanel border border-borderSubtle rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-textMuted">System Layer</div>
                <h2 className="text-sm font-semibold text-textMain mt-1">Core routing</h2>
              </div>
              <span className="px-2 py-1 rounded-full bg-green-500/15 text-green-400 text-[10px] font-medium">Online</span>
            </div>
            <div className="space-y-3">
              {['AI Core', 'Agent Core', 'Cloud Core'].map((layer, index) => (
                <div key={layer} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-bgCard border border-borderSubtle flex items-center justify-center text-xs text-textMain">
                    {index + 1}
                  </div>
                  <div className="flex-1">
                    <div className="text-xs font-medium text-textMain">{layer}</div>
                    <div className="h-1.5 bg-white/5 rounded-full mt-1 overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-500" style={{ width: `${88 - index * 14}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold text-textMain">Workspace Modules</h2>
              <p className="text-xs text-textMuted mt-1">Launch any operating surface from one place.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            {MODULES.map((module) => (
              <button
                key={module.id}
                onClick={() => onOpenView(module.id)}
                className="group text-left bg-bgCard border border-borderSubtle hover:border-indigo-500/30 rounded-xl p-4 transition-all"
              >
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${module.accent} flex items-center justify-center shadow-lg`}>
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d={module.icon} />
                    </svg>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-white/[0.04] text-[10px] text-textMuted group-hover:text-textMain">
                    {module.status}
                  </span>
                </div>
                <div className="font-medium text-textMain">{module.title}</div>
                <div className="text-xs text-textMuted mt-1">{module.metric}</div>
              </button>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-12 gap-4">
          <div className="col-span-12 lg:col-span-7 bg-bgPanel border border-borderSubtle rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-textMain">Active Workflows</h2>
                <p className="text-xs text-textMuted mt-1">Cross-module work moving through the OS.</p>
              </div>
              <button onClick={() => onOpenView('automations')} className="px-3 py-1.5 rounded-lg bg-indigo-500/15 text-indigo-400 text-xs font-medium hover:bg-indigo-500/25 transition-all">
                Open Studio
              </button>
            </div>
            <div className="space-y-3">
              {WORKFLOWS.map((workflow) => (
                <div key={workflow.name} className="bg-bgCard border border-borderSubtle rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <div className="text-sm font-medium text-textMain">{workflow.name}</div>
                      <div className="text-xs text-textMuted">{workflow.stage}</div>
                    </div>
                    <div className="text-xs font-medium text-textMain">{workflow.progress}%</div>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500" style={{ width: `${workflow.progress}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="col-span-12 lg:col-span-5 bg-bgPanel border border-borderSubtle rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-textMain">Quick Actions</h2>
                <p className="text-xs text-textMuted mt-1">Common entry points for daily work.</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Code', view: 'chats' },
                { label: 'Agents', view: 'multi-agent' },
                { label: 'Cloud', view: 'cloud' },
                { label: 'Business', view: 'business' },
              ].map((action) => (
                <button
                  key={action.label}
                  onClick={() => onOpenView(action.view)}
                  className="px-3 py-3 rounded-xl bg-bgCard border border-borderSubtle text-xs font-medium text-textMain hover:border-indigo-500/30 hover:bg-white/[0.03] transition-all"
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
