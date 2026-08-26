import { useRef, useState } from 'react';
import { InfiniteLogo } from '../brand/InfiniteLogo';
import { useAuthStore } from '../../stores/auth';
import {
  TEMPLATE_PRESETS,
  appearanceFromPrompt,
  type LogoStyle,
  type UITemplate,
  useUIStore,
} from '../../stores/ui';

export type ExperienceSettingsSection = 'profile' | 'appearance' | 'designer';

const TEMPLATES: Array<{ id: UITemplate; name: string; description: string; colors: string[] }> = [
  { id: 'infinite', name: 'Infinite', description: 'Balanced cosmic workspace', colors: ['#080b14', '#8b5cf6', '#22d3ee'] },
  { id: 'aurora', name: 'Aurora', description: 'Luminous glass and color', colors: ['#06131b', '#22d3ee', '#ec4899'] },
  { id: 'onyx', name: 'Onyx Green', description: 'Focused grid with lime phosphor', colors: ['#070908', '#a3e635', '#252a25'] },
  { id: 'cloud', name: 'Cloud', description: 'Bright and calm daylight', colors: ['#eef2ff', '#4f46e5', '#ffffff'] },
  { id: 'chatgpt', name: 'ChatGPT', description: 'Warm graphite with mint pulse', colors: ['#1a1a1c', '#10a37f', '#212124'] },
  { id: 'zcode', name: 'ZCode', description: 'Cobalt terminal with electric blue', colors: ['#0a1020', '#38bdf8', '#0e1630'] },
  { id: 'matrix', name: 'Matrix', description: 'Phosphor green on near-black', colors: ['#050808', '#00e676', '#0a100e'] },
];

const LOGO_STYLES: Array<{ id: LogoStyle; name: string; description: string }> = [
  { id: 'spectrum', name: 'Original Spectrum', description: 'The Infinite AI violet, cyan, and pink signature with a subtle orbit.' },
  { id: 'luminous', name: 'White Infinite', description: 'The original clean white loop with a soft white glow.' },
  { id: 'ice', name: 'Light Blue Infinite', description: 'The original light-blue loop with moving blue and icy-white light.' },
];

export function ExperienceSettingsModal({
  onClose,
  initialSection = 'profile',
}: {
  onClose: () => void;
  initialSection?: ExperienceSettingsSection;
}) {
  const user = useAuthStore((state) => state.user);
  const updateAccount = useAuthStore((state) => state.updateAccount);
  const appearance = useUIStore();
  const [section, setSection] = useState<ExperienceSettingsSection>(initialSection);
  const [name, setName] = useState(user?.name ?? '');
  const [prompt, setPrompt] = useState('');
  const [designerMessage, setDesignerMessage] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const applyTemplate = (id: UITemplate) => appearance.setAppearance(TEMPLATE_PRESETS[id]);
  const runDesigner = () => {
    const patch = appearanceFromPrompt(prompt);
    if (!patch) {
      setDesignerMessage('Try a color, “more glass”, “compact”, “rounder”, or a template name.');
      return;
    }
    appearance.setAppearance(patch);
    setDesignerMessage('Applied instantly. Your workspace remembers this design.');
  };

  const chooseAvatar = (file?: File) => {
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 3_000_000) {
      setDesignerMessage('Please choose an image under 3 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => updateAccount({ avatar: String(reader.result) });
    reader.readAsDataURL(file);
  };

  return (
    <div className="os-modal-backdrop fixed inset-0 z-[80] flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="os-settings-window w-full max-w-4xl overflow-hidden" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Infinite OS settings">
        <aside className="os-settings-nav">
          <div className="flex items-center gap-3 px-3 pb-5 pt-2">
            <span className="os-logo-orb"><InfiniteLogo className="h-6 w-10" animated /></span>
            <div><div className="text-sm font-semibold text-white">Infinite OS</div><div className="text-[9px] text-zinc-500">Control Center</div></div>
          </div>
          {([
            ['profile', 'Profile', 'Account and avatar'],
            ['appearance', 'Appearance', 'Themes and layout'],
            ['designer', 'AI UI Designer', 'Describe your interface'],
          ] as Array<[ExperienceSettingsSection, string, string]>).map(([id, label, detail]) => (
            <button key={id} onClick={() => setSection(id)} className={`os-settings-nav-item ${section === id ? 'is-active' : ''}`}>
              <span>{label}</span><small>{detail}</small>
            </button>
          ))}
          <div className="mt-auto rounded-xl border border-white/[0.06] bg-white/[0.025] p-3 text-[9px] leading-relaxed text-zinc-500">
            Preferences are saved locally and applied instantly across Infinite OS.
          </div>
        </aside>

        <main className="os-settings-content">
          <div className="mb-6 flex items-start justify-between">
            <div><div className="text-[10px] uppercase tracking-[0.18em] text-violet-400">System settings</div><h2 className="mt-1 text-xl font-semibold text-white">{section === 'profile' ? 'Your profile' : section === 'appearance' ? 'Make it yours' : 'Design with a sentence'}</h2></div>
            <button onClick={onClose} className="os-close-button" aria-label="Close settings">×</button>
          </div>

          {section === 'profile' && (
            <section className="animate-fade-in space-y-5">
              <div className="os-profile-card">
                <button className="os-avatar-large group" onClick={() => fileRef.current?.click()} aria-label="Change profile picture">
                  {user?.avatar ? <img src={user.avatar} alt="Profile" /> : <span>{user?.name?.charAt(0)?.toUpperCase() || 'U'}</span>}
                  <i className="group-hover:opacity-100">Change</i>
                </button>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => chooseAvatar(event.target.files?.[0])} />
                <div className="min-w-0 flex-1"><div className="text-base font-semibold text-white">{user?.name}</div><div className="truncate text-xs text-zinc-500">{user?.email}</div><div className="mt-2 flex gap-2"><button className="os-secondary-button" onClick={() => fileRef.current?.click()}>Upload picture</button>{user?.avatar && <button className="os-text-button" onClick={() => updateAccount({ avatar: undefined })}>Remove</button>}</div></div>
                <span className="os-status-pill"><i /> Online</span>
              </div>
              <label className="os-field"><span>Display name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" /></label>
              <label className="os-field"><span>Email address</span><input value={user?.email ?? ''} disabled /></label>
              <div className="flex justify-end"><button className="os-primary-button" onClick={() => name.trim() && updateAccount({ name: name.trim() })}>Save profile</button></div>
            </section>
          )}

          {section === 'appearance' && (
            <section className="animate-fade-in space-y-6">
              <div><h3 className="os-section-title">Workspace templates</h3><p className="os-section-copy">Switch the entire visual language with one click.</p></div>
              <div className="grid grid-cols-2 gap-3">
                {TEMPLATES.map((item) => (
                  <button key={item.id} onClick={() => applyTemplate(item.id)} className={`os-theme-card ${appearance.template === item.id ? 'is-active' : ''}`}>
                    <span className="os-theme-preview" style={{ background: `linear-gradient(135deg, ${item.colors[0]}, ${item.colors[2]})` }}><i style={{ background: item.colors[1] }} /><b /><em /></span>
                    <span><strong>{item.name}</strong><small>{item.description}</small></span>
                    {appearance.template === item.id && <mark>Active</mark>}
                  </button>
                ))}
              </div>
              <div><h3 className="os-section-title">Infinite AI logo</h3><p className="os-section-copy">The standard Infinite OS mark is used consistently across desktop and development launches.</p></div>
              <div className="grid grid-cols-2 gap-3">
                {LOGO_STYLES.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => appearance.setAppearance({ logoStyle: item.id })}
                    className={`os-logo-style-card ${appearance.logoStyle === item.id ? 'is-active' : ''}`}
                    aria-label={`Use ${item.name} logo style`}
                  >
                    <span className="os-logo-style-preview"><InfiniteLogo className="h-14 w-24" animated variant={item.id} /></span>
                    <span><strong>{item.name}</strong><small>{item.description}</small></span>
                    {appearance.logoStyle === item.id && <mark>Active</mark>}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <label className="os-control"><span>Accent color <b>{appearance.accent}</b></span><input type="color" value={appearance.accent} onChange={(e) => appearance.setAppearance({ accent: e.target.value })} /></label>
                <label className="os-control"><span>Corner radius <b>{appearance.radius}px</b></span><input type="range" min="4" max="24" value={appearance.radius} onChange={(e) => appearance.setAppearance({ radius: Number(e.target.value) })} /></label>
                <label className="os-control"><span>Glass intensity <b>{appearance.glass}%</b></span><input type="range" min="20" max="100" value={appearance.glass} onChange={(e) => appearance.setAppearance({ glass: Number(e.target.value) })} /></label>
                <label className="os-control"><span>Glow <b>{appearance.glow}%</b></span><input type="range" min="0" max="100" value={appearance.glow} onChange={(e) => appearance.setAppearance({ glow: Number(e.target.value) })} /></label>
              </div>
              <div className="flex flex-wrap gap-2">
                {(['compact', 'comfortable', 'spacious'] as const).map((density) => <button key={density} onClick={() => appearance.setAppearance({ density })} className={`os-choice-chip ${appearance.density === density ? 'is-active' : ''}`}>{density}</button>)}
                <button onClick={() => appearance.setAppearance({ shinyBars: !appearance.shinyBars })} className={`os-choice-chip ${appearance.shinyBars ? 'is-active' : ''}`}>Shiny bars</button>
                <button onClick={() => appearance.setAppearance({ motion: !appearance.motion })} className={`os-choice-chip ${appearance.motion ? 'is-active' : ''}`}>Motion</button>
                <button onClick={appearance.resetAppearance} className="os-choice-chip ml-auto">Reset</button>
              </div>
            </section>
          )}

          {section === 'designer' && (
            <section className="animate-fade-in">
              <div className="os-designer-hero"><div className="os-designer-logo"><InfiniteLogo className="h-12 w-20" animated labelled /></div><h3>Tell Infinite how the OS should feel</h3><p>This local designer understands color, glow, glass, spacing, corners, shine, and all four templates—no model or connection required.</p></div>
              <div className="os-designer-box"><textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder='Try “Make the bars shiny, use cyan, add more glow and make everything rounder”' /><button onClick={runDesigner}>Apply design</button></div>
              <div className="mt-3 flex flex-wrap gap-2">{['Aurora with more glow', 'Compact onyx with lime', 'Bright cloud workspace', 'Shiny purple bars'].map((idea) => <button key={idea} onClick={() => setPrompt(idea)} className="os-choice-chip">{idea}</button>)}</div>
              {designerMessage && <div className="mt-4 rounded-xl border border-violet-400/20 bg-violet-500/[0.07] px-4 py-3 text-xs text-violet-200">{designerMessage}</div>}
              <div className="mt-5 flex items-center gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
                <span className="os-logo-orb"><InfiniteLogo className="h-6 w-10" animated /></span>
                <div className="min-w-0 flex-1"><div className="text-xs font-semibold text-zinc-200">Continuous improvement</div><div className="mt-1 text-[9px] text-zinc-500">Create a reviewed automation that audits, tests, and proposes the next Infinite OS improvement on your schedule.</div></div>
                <button className="os-secondary-button" onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('infinite:navigate', { detail: 'automations' })); }}>Open automation studio</button>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
