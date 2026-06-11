const TABS = [
  { id: 'chat', label: 'AI Chat', icon: '💬' },
  { id: 'canvas', label: 'Infinite Canvas', icon: '⊞' },
  { id: 'code', label: 'Code', icon: '⟨/⟩' },
  { id: 'analyze', label: 'Analyze', icon: '◇' },
  { id: 'automate', label: 'Automate', icon: '⚡' },
  { id: 'research', label: 'Research', icon: '🔍' },
  { id: 'design', label: 'Design', icon: '◆' },
];

export function QuickTabs({ active, onChange }: { active: string; onChange: (id: string) => void }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`tab-pill ${active === t.id ? 'active' : ''}`}
        >
          <span className="text-base">{t.icon}</span>
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  );
}
