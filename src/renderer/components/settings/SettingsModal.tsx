import { useEffect, useState } from 'react';
import type { ProviderInfo } from '../../../shared/types';
import { AppIcon, type AppIconName } from '../brand/AppIcon';
import { useUiTheme, UI_THEMES } from '../../theme/uiTheme';
import { TEMPLATE_PRESETS, useUIStore, type UITemplate } from '../../stores/ui';

const TEMPLATE_CARDS: Array<{ id: UITemplate; name: string; description: string; colors: string[] }> = [
  { id: 'infinite', name: 'Infinite', description: 'Balanced cosmic workspace', colors: ['#080b14', '#8b5cf6', '#22d3ee'] },
  { id: 'aurora', name: 'Aurora', description: 'Luminous glass and color', colors: ['#06131b', '#22d3ee', '#ec4899'] },
  { id: 'onyx', name: 'Onyx Green', description: 'Focused grid with lime phosphor', colors: ['#070908', '#a3e635', '#252a25'] },
  { id: 'cloud', name: 'Cloud', description: 'Bright and calm daylight', colors: ['#eef2ff', '#4f46e5', '#ffffff'] },
  { id: 'chatgpt', name: 'ChatGPT', description: 'Warm graphite with mint pulse', colors: ['#1a1a1c', '#10a37f', '#212124'] },
  { id: 'zcode', name: 'ZCode', description: 'Cobalt terminal with electric blue', colors: ['#0a1020', '#38bdf8', '#0e1630'] },
  { id: 'matrix', name: 'Matrix', description: 'Phosphor green on near-black', colors: ['#050808', '#00e676', '#0a100e'] },
];

interface CurrentSettings {
  provider: string;
  model: string;
  cwd: string;
  brainMode?: boolean;
  hasApiKey?: boolean;
}

type PermissionProfile = ':read-only' | ':workspace' | ':accept-edits' | ':full-system-access';

type SettingsSection = 'provider' | 'email' | 'permissions' | 'features' | 'appearance';

const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string; icon: AppIconName }> = [
  { id: 'appearance', label: 'Appearance', icon: 'home.canvas' },
  { id: 'provider', label: 'Provider', icon: 'topbar.engine' },
  { id: 'email', label: 'Email Account', icon: 'inf.writer' },
  { id: 'permissions', label: 'Agent Permissions', icon: 'inf.shield' },
  { id: 'features', label: 'Feature Stack', icon: 'inf.hex-stack' },
];

interface EmailSettings {
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  user: string;
  password: string;
}

const EMPTY_EMAIL: EmailSettings = {
  imapHost: 'imap.gmail.com',
  imapPort: 993,
  imapSecure: true,
  smtpHost: 'smtp.gmail.com',
  smtpPort: 465,
  smtpSecure: true,
  user: '',
  password: '',
};

const PERMISSION_PROFILES: Array<{
  id: PermissionProfile;
  label: string;
  description: string;
}> = [
  {
    id: ':full-system-access',
    label: 'Full system access',
    description: 'Codex-style full PC, shell, browser, filesystem, and source-code autonomy.',
  },
  {
    id: ':workspace',
    label: 'Workspace',
    description: 'Auto-read and edit this project, asking before broader system actions.',
  },
  {
    id: ':accept-edits',
    label: 'Accept edits',
    description: 'Apply code edits without asking; confirm shell, browser, email, and PC actions.',
  },
  {
    id: ':read-only',
    label: 'Read only',
    description: 'Inspect, search, explain, and plan without modifying the system.',
  },
];

function loadCurrent(): CurrentSettings {
  try {
    const raw = localStorage.getItem('infinite:current');
    if (raw) {
      const current = JSON.parse(raw) as CurrentSettings;
      return current.provider === 'local' ? { ...current, provider: 'ollama' } : current;
    }
  } catch {
    /* ignore */
  }
  return { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct:free', cwd: '.' };
}

function saveCurrent(patch: Partial<CurrentSettings>) {
  const current = loadCurrent();
  localStorage.setItem('infinite:current', JSON.stringify({ ...current, ...patch }));
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [section, setSection] = useState<SettingsSection>('provider');
  const { theme: uiTheme, setTheme: setUiTheme } = useUiTheme();
  const appearance = useUIStore();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [activeProvider, setActiveProvider] = useState<string>(() => loadCurrent().provider);
  const [apiKey, setApiKey] = useState('');
  const [apiKeyLoaded, setApiKeyLoaded] = useState(false);
  const [status, setStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [models, setModels] = useState<{ id: string; label: string; free: boolean }[]>([]);
  const [currentModel, setCurrentModel] = useState(() => loadCurrent().model);
  const [cloudflareAccountId, setCloudflareAccountId] = useState('');
  const [permissionProfile, setPermissionProfile] = useState<PermissionProfile>(':workspace');
  const [email, setEmail] = useState<EmailSettings>(EMPTY_EMAIL);
  const [emailSaved, setEmailSaved] = useState(false);
  const [emailStatus, setEmailStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [emailMessage, setEmailMessage] = useState('');

  useEffect(() => {
    window.api.listProviders().then((p: ProviderInfo[]) => {
      setProviders(p);
      setActiveProvider(loadCurrent().provider);
    });
    window.api
      .getSetting({ key: 'cloudflareAccountId' })
      .then((value: unknown) => {
        if (typeof value === 'string') setCloudflareAccountId(value);
      })
      .catch(() => undefined);
    window.api
      .getSetting({ key: 'permissionProfile' })
      .then((value: unknown) => {
        if (PERMISSION_PROFILES.some((profile) => profile.id === value)) {
          setPermissionProfile(value as PermissionProfile);
        }
      })
      .catch(() => {});
    window.api.emailConfigGet().then((config: EmailSettings | null) => {
      if (config) {
        setEmail({ ...config, password: '' });
        setEmailSaved(true);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setApiKey('');
    setApiKeyLoaded(false);
    setStatus('idle');
    setStatusMessage('');
    setModels([]);

    const selectedProvider = providers.find((item) => item.id === activeProvider);
    if (selectedProvider && !selectedProvider.requiresApiKey) {
      setStatus('testing');
      setStatusMessage('Checking local provider...');
      window.api
        .testProvider({ provider: activeProvider, apiKey: '' })
        .then(async (result: { ok: boolean; error?: string }) => {
          if (cancelled) return;
          const has = await window.api.hasProviderKey({ provider: activeProvider }) as boolean;
          if (cancelled) return;
          setApiKeyLoaded(has);
          if (!result.ok) {
            setStatus('fail');
            setStatusMessage(result.error || 'Local provider is unavailable.');
            if (selectedProvider.acceptsApiKey) {
              const fallbackList = await window.api.listProviderModels({ provider: activeProvider });
              if (!cancelled) setModels(fallbackList as { id: string; label: string; free: boolean }[]);
            }
            return;
          }
          const list = await window.api.listProviderModels({ provider: activeProvider });
          if (cancelled) return;
          const nextModels = list as { id: string; label: string; free: boolean }[];
          // Display only: opening Settings must never hijack the chat's
          // provider/model — selection happens via Test or model pick.
          setModels(nextModels);
          setStatus('ok');
          setStatusMessage(`Connected - ${nextModels.length} model${nextModels.length === 1 ? '' : 's'}`);
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setStatus('fail');
            setStatusMessage(error instanceof Error ? error.message : 'Local provider is unavailable.');
          }
        });
      return () => {
        cancelled = true;
      };
    }

    window.api
      .hasProviderKey({ provider: activeProvider })
      .then(async (has: boolean) => {
        if (cancelled) return;
        setApiKeyLoaded(has);
        if (!has) return;
        const list = await window.api.listProviderModels({ provider: activeProvider });
        if (cancelled) return;
        const nextModels = list as { id: string; label: string; free: boolean }[];
        // Display only (see above): never rewrite the chat selection here.
        setModels(nextModels);
        if (nextModels.length && !currentModel) setCurrentModel(nextModels[0].id);
        setStatus('ok');
        setStatusMessage(`API key saved - ${nextModels.length} model${nextModels.length === 1 ? '' : 's'}`);
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('fail');
          setStatusMessage('Could not read the saved credential.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeProvider, providers]);

  const test = async () => {
    setStatus('testing');
    setStatusMessage(activeProvider === 'opencode' ? 'Validating key and scanning available models...' : 'Checking provider connection...');
    // Pasted keys routinely carry stray whitespace/newlines — trim before
    // testing AND saving, or every provider 401s a perfectly good key.
    const trimmedKey = apiKey.trim();
    try {
      const res = await window.api.testProvider({ provider: activeProvider, apiKey: trimmedKey });
      if (res.ok) {
        if (trimmedKey) {
          await window.api.setProviderKey({ provider: activeProvider, key: trimmedKey });
          setApiKeyLoaded(true);
          setApiKey('');
        }
        setStatus('ok');
        const list = await window.api.listProviderModels({ provider: activeProvider, apiKey: trimmedKey });
        const nextModels = list as { id: string; label: string; free: boolean }[];
        setModels(nextModels);

        const saved = loadCurrent();
        const modelIsCompatible =
          saved.provider === activeProvider && nextModels.some((model) => model.id === saved.model);
        const fallbackModel =
          nextModels[0]?.id ?? providers.find((item) => item.id === activeProvider)?.freeModels[0]?.id;
        const nextModel = modelIsCompatible ? saved.model : fallbackModel;
        saveCurrent({ provider: activeProvider, model: nextModel, hasApiKey: Boolean(apiKey.trim() || apiKeyLoaded) });
        if (nextModel) setCurrentModel(nextModel);
        setStatusMessage(
          activeProvider === 'opencode'
            ? `OpenCode connected - ${nextModels.length} model${nextModels.length === 1 ? '' : 's'} available`
            : nextModel
              ? `Connected - ${nextModel}`
              : 'Connected',
        );
        window.dispatchEvent(new Event('storage'));
      } else {
        setStatus('fail');
        setStatusMessage(res.error || 'The provider rejected this credential. Nothing was saved.');
      }
    } catch (error) {
      setStatus('fail');
      setStatusMessage(error instanceof Error ? error.message : 'Connection failed.');
    }
  };

  const handleUseInstalledOpenCode = async () => {
    setStatus('testing');
    setStatusMessage('Switching to installed OpenCode credentials...');
    try {
      await window.api.setProviderKey({ provider: 'opencode', key: '' });
      setApiKey('');
      setApiKeyLoaded(false);
      const result = await window.api.testProvider({ provider: 'opencode', apiKey: '' });
      const list = await window.api.listProviderModels({ provider: 'opencode', apiKey: '' });
      const nextModels = list as { id: string; label: string; free: boolean }[];
      setModels(nextModels);
      const saved = loadCurrent();
      const nextModel = nextModels.some((model) => model.id === saved.model) ? saved.model : nextModels[0]?.id;
      saveCurrent({ provider: 'opencode', model: nextModel, hasApiKey: false });
      if (nextModel) setCurrentModel(nextModel);
      setStatus(result.ok ? 'ok' : 'fail');
      setStatusMessage(result.ok ? 'Using installed OpenCode CLI credentials.' : result.error || 'OpenCode CLI is unavailable.');
      window.dispatchEvent(new Event('storage'));
    } catch (error) {
      setStatus('fail');
      setStatusMessage(error instanceof Error ? error.message : 'Could not switch to installed OpenCode credentials.');
    }
  };

  const [selectedModelName, setSelectedModelName] = useState('');

  const pickModel = (id: string) => {
    saveCurrent({ provider: activeProvider, model: id });
    setCurrentModel(id);
    setSelectedModelName(id);
    // Dispatch storage event so other components update immediately
    window.dispatchEvent(new Event('storage'));
  };

  const saveCloudflareAccountId = async () => {
    await window.api.setSetting({
      scope: 'user',
      key: 'cloudflareAccountId',
      value: cloudflareAccountId.trim(),
      cwd: loadCurrent().cwd || '.',
    }).catch(() => undefined);
  };

  const pickPermissionProfile = async (id: PermissionProfile) => {
    setPermissionProfile(id);
    saveCurrent({ cwd: loadCurrent().cwd });
    await window.api.setSetting({
      scope: 'user',
      key: 'permissionProfile',
      value: id,
      cwd: loadCurrent().cwd || '.',
    });
    await window.api.setSetting({
      scope: 'user',
      key: 'permissionMode',
      value:
        id === ':full-system-access'
          ? 'fullSystemAccess'
          : id === ':read-only'
            ? 'readOnly'
            : id === ':workspace'
              ? 'workspace'
              : 'acceptEdits',
      cwd: loadCurrent().cwd || '.',
    });
  };

  const applyEmailPreset = (preset: 'gmail' | 'outlook' | 'yahoo') => {
    const hosts = {
      gmail: { imapHost: 'imap.gmail.com', smtpHost: 'smtp.gmail.com', smtpPort: 465, smtpSecure: true },
      outlook: { imapHost: 'outlook.office365.com', smtpHost: 'smtp.office365.com', smtpPort: 587, smtpSecure: false },
      yahoo: { imapHost: 'imap.mail.yahoo.com', smtpHost: 'smtp.mail.yahoo.com', smtpPort: 465, smtpSecure: true },
    }[preset];
    setEmail((current) => ({ ...current, ...hosts, imapPort: 993, imapSecure: true }));
    setEmailStatus('idle');
    setEmailMessage('');
  };

  const testAndSaveEmail = async () => {
    if (!email.user.trim() || (!email.password && !emailSaved)) {
      setEmailStatus('fail');
      setEmailMessage('Enter the mailbox email and password or app password.');
      return;
    }
    setEmailStatus('testing');
    setEmailMessage('Verifying IMAP and SMTP...');
    try {
      const config = email;
      if (!email.password && emailSaved) {
        // Existing encrypted password cannot be returned to the renderer. Saving
        // unchanged settings preserves it, while a connection test requires a new value.
        await window.api.emailConfigSave(config);
        setEmailStatus('ok');
        setEmailMessage('Mailbox settings saved; the encrypted password was preserved.');
        return;
      }
      const result = await window.api.emailTest(config) as { ok: boolean; error?: string };
      if (!result.ok) {
        setEmailStatus('fail');
        setEmailMessage(result.error || 'The mailbox rejected these credentials.');
        return;
      }
      await window.api.emailConfigSave(config);
      setEmail((current) => ({ ...current, password: '' }));
      setEmailSaved(true);
      setEmailStatus('ok');
      setEmailMessage('Mailbox verified and saved securely. Infinite AI can now send from this account.');
    } catch (error) {
      setEmailStatus('fail');
      setEmailMessage(error instanceof Error ? error.message : 'Could not save mailbox settings.');
    }
  };

  /** Save email config even when the connection test fails. */
  const saveEmailAnyway = async () => {
    if (!email.user.trim() || !email.password) {
      setEmailStatus('fail');
      setEmailMessage('Enter the mailbox email and password to save.');
      return;
    }
    setEmailStatus('testing');
    setEmailMessage('Saving without verification...');
    try {
      await window.api.emailConfigSave(email);
      setEmail((current) => ({ ...current, password: '' }));
      setEmailSaved(true);
      setEmailStatus('ok');
      setEmailMessage('Mailbox settings saved (unverified). Infinite AI will attempt to use this account.');
    } catch (error) {
      setEmailStatus('fail');
      setEmailMessage(error instanceof Error ? error.message : 'Could not save mailbox settings.');
    }
  };

  const provider = providers.find((p) => p.id === activeProvider);

  const freeModelList = models.filter((m) => m.free);
  const paidModelList = models.filter((m) => !m.free);

  const renderModelSection = (heading: string, items: { id: string; label: string; free: boolean }[]) =>
    items.length === 0 ? null : (
      <div className="mb-5">
        <h4 className="text-xs font-medium uppercase tracking-wide text-zinc-500 mb-2">
          {heading} <span className="tracking-normal normal-case">({items.length})</span>
        </h4>
        <ul className="space-y-1 max-h-64 overflow-y-auto custom-scrollbar">
          {items.map((m) => (
            <li key={m.id}>
              <button
                onClick={() => pickModel(m.id)}
                className={`w-full text-left p-2.5 rounded-lg text-sm flex items-center justify-between border transition-colors ${
                  currentModel === m.id
                    ? 'bg-white/[0.07] text-zinc-100 border-white/[0.14]'
                    : 'hover:bg-white/[0.04] text-zinc-400 border-transparent hover:text-zinc-200'
                }`}
              >
                <span>{m.label}</span>
                <div className="flex items-center gap-2">
                  {m.free && <span className="text-xs text-zinc-500">free</span>}
                  {currentModel === m.id && <span className="text-xs text-zinc-300">selected</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="os-settings-window flex w-full max-w-3xl h-[600px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left navigation rail */}
        <aside className="flex w-52 shrink-0 flex-col border-r border-white/[0.06] p-3">
          <div className="px-3 pt-2 pb-4">
            <h2 className="text-sm font-semibold text-zinc-100">Settings</h2>
          </div>
          <nav className="flex flex-col gap-0.5">
            {SETTINGS_SECTIONS.map((item) => (
              <button
                key={item.id}
                onClick={() => setSection(item.id)}
                aria-current={section === item.id}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors ${
                  section === item.id
                    ? 'bg-white/[0.07] text-zinc-100'
                    : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
                }`}
              >
                <AppIcon name={item.icon} className="h-4 w-4" />
                <span className="truncate">{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="mt-auto flex flex-col gap-0.5 border-t border-white/[0.06] pt-3">
            <button
              onClick={() => {
                onClose();
                window.dispatchEvent(new CustomEvent('infinite:open-personalization', { detail: 'appearance' }));
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-zinc-200"
            >
              <AppIcon name="home.canvas" className="h-4 w-4" />
              Appearance &amp; logo
            </button>
          </div>
        </aside>

        {/* Section content */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          <button
            onClick={onClose}
            className="absolute right-4 top-4 z-10 rounded-md p-1 text-zinc-500 transition-colors hover:bg-white/[0.05] hover:text-zinc-200"
            aria-label="Close settings"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>

          <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar p-6">
            {section === 'appearance' && (
              <section>
                <div className="mb-5 pr-8">
                  <h3 className="text-sm font-semibold text-zinc-100">UI Design</h3>
                  <p className="mt-1 text-xs text-zinc-500">Switch between the original Infinite OS look and the redesigned monochrome interface. Applies instantly — all features stay available either way.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {UI_THEMES.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setUiTheme(t.id)}
                      className={`text-left p-3 rounded-lg border transition-colors ${
                        uiTheme === t.id
                          ? 'border-white/[0.16] bg-white/[0.07]'
                          : 'border-white/[0.06] hover:border-white/[0.12] bg-white/[0.02]'
                      }`}
                    >
                      <div className="font-medium text-sm text-zinc-100">{t.label}</div>
                      <div className="text-xs text-zinc-500 mt-1 leading-relaxed">{t.description}</div>
                      {uiTheme === t.id && (
                        <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-zinc-300">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                          Active
                        </div>
                      )}
                    </button>
                  ))}
                </div>

                <div className="mt-6 mb-2">
                  <h3 className="text-sm font-semibold text-zinc-100">Theme atmosphere</h3>
                  <p className="mt-1 text-xs text-zinc-500">Pick a full visual language — surfaces, colors, and glow — that tints every corner of Infinite OS. Applies instantly.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {TEMPLATE_CARDS.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => appearance.setAppearance(TEMPLATE_PRESETS[t.id])}
                      className={`text-left p-3 rounded-lg border transition-colors ${
                        appearance.template === t.id
                          ? 'border-white/[0.16] bg-white/[0.07]'
                          : 'border-white/[0.06] hover:border-white/[0.12] bg-white/[0.02]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className="h-8 w-8 rounded-md flex-none border border-white/10"
                          style={{ background: `linear-gradient(135deg, ${t.colors[0]}, ${t.colors[2]})` }}
                        >
                          <span
                            className="mx-auto mt-2.5 block h-2 w-2 rounded-full"
                            style={{ background: t.colors[1], boxShadow: `0 0 6px ${t.colors[1]}` }}
                          />
                        </span>
                        <div className="min-w-0">
                          <div className="font-medium text-sm text-zinc-100">{t.name}</div>
                          <div className="text-xs text-zinc-500 mt-0.5 leading-relaxed">{t.description}</div>
                        </div>
                      </div>
                      {appearance.template === t.id && (
                        <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-zinc-300">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                          Active
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {section === 'provider' && (
              <section>
                <div className="mb-5 pr-8">
                  <h3 className="text-sm font-semibold text-zinc-100">Provider</h3>
                  <p className="mt-1 text-xs text-zinc-500">Choose where Infinite AI routes chat and agent requests.</p>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-4">
                  {providers.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setActiveProvider(p.id)}
                      className={`text-left p-3 rounded-lg border transition-colors ${
                        p.id === activeProvider
                          ? 'border-white/[0.16] bg-white/[0.07]'
                          : 'border-white/[0.06] hover:border-white/[0.12] bg-white/[0.02]'
                      }`}
                    >
                      <div className="font-medium text-sm text-zinc-100">{p.label}</div>
                      {p.requiresApiKey && <div className="text-xs text-zinc-500 mt-0.5">Requires API key</div>}
                      {!p.requiresApiKey && p.acceptsApiKey && (
                        <div className="text-xs text-zinc-500 mt-0.5">CLI or optional subscription key</div>
                      )}
                      {p.freeModels.length > 0 && (
                        <div className="text-xs text-zinc-400 mt-0.5">{p.freeModels.length} free models</div>
                      )}
                    </button>
                  ))}
                </div>

                {(provider?.requiresApiKey || provider?.acceptsApiKey) && (
                  <div className="mb-3">
                    {activeProvider === 'cloudflare' && (
                      <div className="flex gap-2 mb-2">
                        <input
                          type="text"
                          value={cloudflareAccountId}
                          onChange={(e) => setCloudflareAccountId(e.target.value)}
                          onBlur={() => void saveCloudflareAccountId()}
                          placeholder="Cloudflare account ID (from your dashboard URL)"
                          className="flex-1 rounded-lg border border-white/[0.08] bg-black/30 px-3.5 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-white/[0.25] transition-colors placeholder:text-zinc-600"
                        />
                      </div>
                    )}
                    <div className="flex gap-2">
                      <input
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder={apiKeyLoaded ? 'Key saved securely (enter a new key to replace it)' : provider.acceptsApiKey ? 'Paste your OpenCode Zen API key' : 'Paste your API key'}
                        className="flex-1 rounded-lg border border-white/[0.08] bg-black/30 px-3.5 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-white/[0.25] transition-colors placeholder:text-zinc-600"
                      />
                      <button
                        onClick={test}
                        disabled={(provider.requiresApiKey && !apiKey && !apiKeyLoaded) || status === 'testing'}
                        className="btn-premium shrink-0 px-4 py-2.5 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {status === 'testing'
                          ? activeProvider === 'opencode' ? 'Scanning...' : 'Testing...'
                          : activeProvider === 'opencode' && apiKey.trim()
                            ? 'Save & Scan Models'
                            : apiKey.trim()
                              ? 'Test & Save'
                              : 'Test Connection'}
                      </button>
                    </div>
                    {provider.acceptsApiKey && (
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <p className="text-xs text-zinc-500">Free path: use your installed OpenCode CLI credentials — no key needed. Or paste an OpenCode Zen key to scan Zen models.</p>
                        <button onClick={() => void handleUseInstalledOpenCode()} className="shrink-0 text-xs text-zinc-300 underline-offset-2 hover:text-zinc-100 hover:underline">Use installed CLI (free)</button>
                      </div>
                    )}
                  </div>
                )}

                {status === 'ok' && (
                  <div className="mb-3 flex items-center gap-2 text-sm text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    {statusMessage || 'Connected'}
                  </div>
                )}
                {status === 'fail' && (
                  <div className="mb-3 text-sm text-red-400">{statusMessage || 'Connection failed'}</div>
                )}

                {models.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-zinc-100 mb-3">Models</h4>
                    {selectedModelName && (
                      <div className="mb-3 inline-flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/[0.08] px-2.5 py-1 text-xs text-emerald-400">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                        Model updated: {selectedModelName}
                      </div>
                    )}
                    {renderModelSection('Free Models', freeModelList)}
                    {renderModelSection('Paid Models', paidModelList)}
                  </div>
                )}

                {models.length === 0 && provider?.freeModels && provider.freeModels.length > 0 && (
                  <div>
                    <h4 className="text-xs font-medium uppercase tracking-wide text-zinc-500 mb-2">Free Models</h4>
                    <ul className="space-y-1 max-h-64 overflow-y-auto custom-scrollbar">
                      {provider.freeModels.map((m) => (
                        <li key={m.id}>
                          <button
                            onClick={() => pickModel(m.id)}
                            className={`w-full text-left p-2.5 rounded-lg text-sm flex items-center justify-between border transition-colors ${
                              currentModel === m.id
                                ? 'bg-white/[0.07] text-zinc-100 border-white/[0.14]'
                                : 'hover:bg-white/[0.04] text-zinc-400 border-transparent hover:text-zinc-200'
                            }`}
                          >
                            <span>{m.label}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-zinc-500">free</span>
                              {currentModel === m.id && <span className="text-xs text-zinc-300">selected</span>}
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            )}

            {section === 'email' && (
              <section>
                <div className="mb-5 flex items-start justify-between gap-3 pr-8">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-100">Email Account</h3>
                    <p className="mt-1 text-xs text-zinc-500">The saved account is reused whenever you ask Infinite AI to send email from chat.</p>
                  </div>
                  {emailSaved && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[11px] text-zinc-300">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      Configured
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 mb-3">
                  {(['gmail', 'outlook', 'yahoo'] as const).map((preset) => (
                    <button key={preset} onClick={() => applyEmailPreset(preset)} className="rounded-md border border-white/[0.08] bg-white/[0.025] px-3 py-1.5 text-xs capitalize text-zinc-400 transition-colors hover:text-zinc-100 hover:border-white/[0.16]">
                      {preset}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input type="email" value={email.user} onChange={(event) => setEmail((current) => ({ ...current, user: event.target.value }))} placeholder="Email address" className="rounded-lg border border-white/[0.08] bg-black/30 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-white/[0.25] transition-colors placeholder:text-zinc-600" />
                  <input type="password" value={email.password} onChange={(event) => setEmail((current) => ({ ...current, password: event.target.value }))} placeholder={emailSaved ? 'Encrypted password saved (enter to replace)' : 'Password or app password'} className="rounded-lg border border-white/[0.08] bg-black/30 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-white/[0.25] transition-colors placeholder:text-zinc-600" />
                  <div className="flex gap-2">
                    <input value={email.imapHost} onChange={(event) => setEmail((current) => ({ ...current, imapHost: event.target.value }))} placeholder="IMAP host" className="min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-black/30 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-white/[0.25] transition-colors" />
                    <input type="number" value={email.imapPort} onChange={(event) => setEmail((current) => ({ ...current, imapPort: Number(event.target.value) }))} className="w-20 rounded-lg border border-white/[0.08] bg-black/30 px-2 py-2.5 text-sm text-zinc-100 outline-none focus:border-white/[0.25] transition-colors" />
                  </div>
                  <div className="flex gap-2">
                    <input value={email.smtpHost} onChange={(event) => setEmail((current) => ({ ...current, smtpHost: event.target.value }))} placeholder="SMTP host" className="min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-black/30 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-white/[0.25] transition-colors" />
                    <input type="number" value={email.smtpPort} onChange={(event) => setEmail((current) => ({ ...current, smtpPort: Number(event.target.value) }))} className="w-20 rounded-lg border border-white/[0.08] bg-black/30 px-2 py-2.5 text-sm text-zinc-100 outline-none focus:border-white/[0.25] transition-colors" />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 mt-4">
                  <p className="text-[11px] leading-5 text-zinc-600">Passwords are protected with Windows encryption. Gmail, Outlook, and Yahoo commonly require an app password when two-factor authentication is enabled.</p>
                  <button onClick={() => void testAndSaveEmail()} disabled={emailStatus === 'testing'} className="btn-premium shrink-0 px-4 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed">
                    {emailStatus === 'testing' ? 'Testing...' : 'Test & Save'}
                  </button>
                </div>
                {emailStatus === 'fail' && emailMessage && (
                  <div className="mt-3">
                    <div className="text-xs text-red-400 whitespace-pre-wrap">{emailMessage}</div>
                    <button
                      onClick={() => void saveEmailAnyway()}
                      className="mt-2 rounded-md border border-amber-500/25 bg-amber-500/[0.08] px-3 py-1.5 text-xs text-amber-300 transition-colors hover:bg-amber-500/[0.15]"
                    >
                      Save anyway (without verification)
                    </button>
                  </div>
                )}
                {emailStatus !== 'fail' && emailMessage && (
                  <div className={`mt-3 text-xs ${emailStatus === 'ok' ? 'text-emerald-400' : 'text-zinc-400'}`}>{emailMessage}</div>
                )}
              </section>
            )}

            {section === 'permissions' && (
              <section>
                <div className="mb-5 pr-8">
                  <h3 className="text-sm font-semibold text-zinc-100">Agent Permissions</h3>
                  <p className="mt-1 text-xs text-zinc-500">How much of this machine agents may act on without asking.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {PERMISSION_PROFILES.map((profile) => (
                    <button
                      key={profile.id}
                      onClick={() => pickPermissionProfile(profile.id)}
                      className={`text-left p-3 rounded-lg border transition-colors ${
                        permissionProfile === profile.id
                          ? 'border-white/[0.16] bg-white/[0.07]'
                          : 'border-white/[0.06] hover:border-white/[0.12] bg-white/[0.02]'
                      }`}
                    >
                      <div className="font-medium text-sm text-zinc-100">{profile.label}</div>
                      <div className="text-xs text-zinc-500 mt-1 leading-relaxed">{profile.description}</div>
                      {permissionProfile === profile.id && (
                        <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-zinc-300">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                          Active
                        </div>
                      )}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-zinc-500 mt-4 leading-relaxed">
                  Full system access gives Infinite OS direct autonomy through Infinite AI, similar to Codex danger-full-access. Use it only when
                  you want the chat agent to operate across your PC without routine permission prompts.
                </p>
              </section>
            )}

            {section === 'features' && (
              <section>
                <div className="mb-5 pr-8">
                  <h3 className="text-sm font-semibold text-zinc-100">Agent Feature Stack</h3>
                  <p className="mt-1 text-xs text-zinc-500">Capabilities inherited from each agent paradigm.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-zinc-400">
                  <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                    <div className="text-zinc-100 text-sm font-medium mb-1">Codex-style</div>
                    Plans, source edits, terminal validation, sessions, branches, full-system permission profiles.
                  </div>
                  <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                    <div className="text-zinc-100 text-sm font-medium mb-1">Claude Code-style</div>
                    Allow/deny/ask rules, project memory, multi-agent tasks, safe permission prompts.
                  </div>
                  <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                    <div className="text-zinc-100 text-sm font-medium mb-1">OpenCode-style</div>
                    Build/test/lint loops, project-aware tooling, local model fallback, extensible tool registry.
                  </div>
                  <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                    <div className="text-zinc-100 text-sm font-medium mb-1">Computer-agent style</div>
                    Browser control, desktop state, mouse/keyboard actions, app launching, local automation.
                  </div>
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
