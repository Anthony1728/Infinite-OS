import { useChatStore } from '../../stores/chat';

export function DemoChat() {
  const createSession = useChatStore((s) => s.createSession);

  const start = async () => {
    const settings = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
    await createSession(settings.cwd ?? '.', settings.model ?? 'meta-llama/llama-3.3-70b-instruct:free', settings.provider ?? 'openrouter');
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <UserBubble
        avatar="A"
        name="You"
        time="10:42 AM"
        text="Build me a modern SaaS dashboard with analytics, user management and billing."
      />

      <AssistantBubble
        time="10:43 AM"
        text="I'll build a complete SaaS dashboard for you."
      >
        <DashboardResultCard />
      </AssistantBubble>

      <div className="flex justify-center pt-2">
        <button
          onClick={start}
          className="text-xs text-fg-muted hover:text-fg border border-border rounded-full px-4 py-1.5 transition-colors"
        >
          Start a real session →
        </button>
      </div>
    </div>
  );
}

function UserBubble({ avatar, name, time, text }: { avatar: string; name: string; time: string; text: string }) {
  return (
    <div className="flex gap-3 flex-row-reverse animate-slide-up">
      <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-300 flex items-center justify-center text-sm font-semibold flex-shrink-0">
        {avatar}
      </div>
      <div className="max-w-2xl text-right">
        <div className="flex items-center gap-2 mb-1 text-xs text-fg-subtle justify-end">
          <span>{time}</span>
          <span>·</span>
          <span className="font-medium text-fg">{name}</span>
        </div>
        <div className="bg-bg-elevated rounded-2xl px-4 py-3 inline-block text-left text-sm leading-relaxed">
          {text}
        </div>
      </div>
    </div>
  );
}

function AssistantBubble({ time, text, children }: { time: string; text: string; children?: React.ReactNode }) {
  return (
    <div className="flex gap-3 animate-slide-up">
      <div className="w-8 h-8 rounded-full bg-gradient-brand text-white flex items-center justify-center text-sm font-bold flex-shrink-0 shadow-glow-sm">
        ∞
      </div>
      <div className="max-w-3xl flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 text-xs text-fg-subtle">
          <span className="font-medium text-fg">InfiniteAI OS</span>
          <span>·</span>
          <span>{time}</span>
          <span className="ml-1">⋯</span>
        </div>
        <div className="card rounded-2xl p-4 text-left">
          <p className="text-sm leading-relaxed text-fg mb-3">{text}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

function DashboardResultCard() {
  const items = [
    { label: 'Frontend', tech: 'Next.js + Tailwind', desc: 'Modern responsive dashboard UI', done: true },
    { label: 'Backend API', tech: 'Node.js + Express', desc: 'RESTful API with authentication', done: true },
    { label: 'Database', tech: 'PostgreSQL', desc: 'Users, teams, billing, analytics schema', done: true },
    { label: 'Authentication', tech: '', desc: 'JWT auth with role-based access', done: true },
    { label: 'Charts & Analytics', tech: '', desc: 'Real-time analytics and reporting', done: true },
  ];

  return (
    <div className="card overflow-hidden border-border-strong">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px]">
        <div className="p-5 border-r border-border">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-5 h-5 rounded-full bg-success/20 flex items-center justify-center">
              <span className="text-success text-xs">✓</span>
            </div>
            <h3 className="text-sm font-semibold">SaaS Dashboard Generated Successfully</h3>
          </div>
          <div className="space-y-3">
            {items.map((it) => (
              <div key={it.label} className="flex gap-3">
                <div className="w-5 h-5 rounded-full bg-success/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-success text-[10px]">✓</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">
                    {it.label} {it.tech && <span className="text-fg-muted font-normal">({it.tech})</span>}
                  </div>
                  <div className="text-xs text-fg-muted">{it.desc}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 mt-5">
            <button className="px-3 py-1.5 rounded-lg bg-bg-elevated border border-border text-xs font-medium hover:border-border-strong transition-colors flex items-center gap-1.5">
              <span>👁</span> Preview
            </button>
            <button className="px-3 py-1.5 rounded-lg bg-bg-elevated border border-border text-xs font-medium hover:border-border-strong transition-colors flex items-center gap-1.5">
              <span>⟨/⟩</span> Edit Code
            </button>
            <button className="px-3 py-1.5 rounded-lg bg-bg-elevated border border-border text-xs font-medium hover:border-border-strong transition-colors flex items-center gap-1.5">
              <span>🚀</span> Deploy
            </button>
            <button className="px-3 py-1.5 rounded-lg bg-bg-elevated border border-border text-xs font-medium hover:border-border-strong transition-colors flex items-center gap-1.5">
              <span>＋</span> Add to Project
            </button>
          </div>
        </div>

        <DashboardPreviewMock />
      </div>
    </div>
  );
}

function DashboardPreviewMock() {
  return (
    <div className="p-3 bg-bg-elevated/40">
      <div className="flex items-center justify-between mb-2 text-[9px] text-fg-subtle">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-danger" />
          <span className="w-1.5 h-1.5 rounded-full bg-warning" />
          <span className="w-1.5 h-1.5 rounded-full bg-success" />
          <span className="ml-2">app.infinityai.dev</span>
        </div>
        <span>↑ ↓</span>
      </div>
      <div className="bg-bg rounded-lg p-2 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-semibold">Dashboard</div>
          <div className="flex gap-1">
            <div className="w-3 h-1.5 rounded-sm bg-bg-card" />
            <div className="w-3 h-1.5 rounded-sm bg-bg-card" />
            <div className="w-3 h-1.5 rounded-sm bg-bg-card" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {['$24,450', '1,245', '58,300'].map((v, i) => (
            <div key={i} className="bg-bg-card rounded p-1.5">
              <div className="text-[7px] text-fg-subtle">Metric {i + 1}</div>
              <div className="text-[9px] font-bold gradient-text">{v}</div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <div className="bg-bg-card rounded p-1.5">
            <div className="text-[7px] text-fg-subtle mb-1">Revenue</div>
            <svg viewBox="0 0 60 24" className="w-full h-8">
              <defs>
                <linearGradient id="line" x1="0" x2="1">
                  <stop offset="0%" stopColor="#8b5cf6" />
                  <stop offset="100%" stopColor="#3b82f6" />
                </linearGradient>
              </defs>
              <polyline
                fill="none"
                stroke="url(#line)"
                strokeWidth="1.5"
                points="0,18 8,14 16,16 24,8 32,11 40,6 48,9 56,4 60,5"
              />
            </svg>
          </div>
          <div className="bg-bg-card rounded p-1.5">
            <div className="text-[7px] text-fg-subtle mb-1">Users</div>
            <div className="flex items-end gap-0.5 h-8">
              {[10, 14, 8, 18, 12, 20, 16, 22, 18, 24, 20, 28].map((h, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-sm"
                  style={{ height: `${h}px`, background: 'linear-gradient(180deg, #8b5cf6, #3b82f6)' }}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="bg-bg-card rounded p-1.5">
          <div className="text-[7px] text-fg-subtle mb-1">Activity</div>
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-1.5 py-0.5">
              <div className="w-2 h-2 rounded-full bg-violet-500/40" />
              <div className="flex-1 h-1 rounded-full bg-bg-elevated" />
              <div className="text-[6px] text-fg-subtle">2m</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

