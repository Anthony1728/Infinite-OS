import { useCallback, useEffect, useState } from 'react';
import type { ProviderInfo } from '../../../shared/types';
import { LocalModelPanel } from './LocalModelPanel';
import { PerformancePanel } from './PerformancePanel';
import { AppIcon, type AppIconName } from '../brand/AppIcon';
import { useUiTheme, UI_THEMES } from '../../theme/uiTheme';
import { TEMPLATE_PRESETS, useUIStore, type UITemplate } from '../../stores/ui';
import { syncActiveModelToMain } from '../../utils/active-model-sync';
import { useVoiceSessionStore } from '../../stores/voice-session';

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
  // Keep the main-process store in sync so background turns (WhatsApp,
  // Telegram, scheduled runs) use the picked model, never a local fallback.
  if (patch.provider !== undefined || patch.model !== undefined || patch.cwd !== undefined) {
    syncActiveModelToMain({ ...current, ...patch });
  }
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [section, setSection] = useState<SettingsSection>('provider');
  const { theme: uiTheme, setTheme: setUiTheme } = useUiTheme();
  const appearance = useUIStore();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [activeProvider, setActiveProvider] = useState<string>(() => loadCurrent().provider);
  const [apiKey, setApiKey] = useState('');
  const [apiKeyLoaded, setApiKeyLoaded] = useState(false);
  const [status, setStatus] = useState<'idle' | 'testing' | 'ok' | 'fail' | 'warn'>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [models, setModels] = useState<{ id: string; label: string; free: boolean; provider?: string }[]>([]);
  const [currentModel, setCurrentModel] = useState(() => loadCurrent().model);
  const [cloudflareAccountId, setCloudflareAccountId] = useState('');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [failoverEnabled, setFailoverEnabled] = useState(true);
  const [permissionProfile, setPermissionProfile] = useState<PermissionProfile>(':workspace');
  /**
   * Whether Infinite AI is kept out of the files that version its changes.
   *
   * Defaults to on. It is read by the guard on every write, so the value has to
   * be loaded here rather than assumed — a toggle that displays the wrong state
   * is worse than no toggle, because it tells the user a protection is active
   * when it is not.
   */
  const [selfProtectionEnabled, setSelfProtectionEnabled] = useState(true);

  /**
   * Token and cost totals.
   *
   * Every provider already reported usage per response and the pricing table
   * knew how to turn it into money, but nothing joined them up — the app took
   * the numbers and dropped them. This is the readout that makes them mean
   * something.
   */
  const [usage, setUsage] = useState<{
    requests: number;
    costUsd: number;
    unpricedRequests?: number;
    formatted: { cost: string; input: string; output: string; note?: string };
    byModel: { provider: string; model: string; requests: number; costUsd: number; pricing?: string }[];
  } | null>(null);
  const [usagePending, setUsagePending] = useState(false);

  /** Background-build state, pushed from main as the build progresses. */
  const [buildStatus, setBuildStatus] = useState<{
    phase: 'idle' | 'building' | 'ready' | 'failed' | 'applying';
    error?: string;
  } | null>(null);
  const [buildPending, setBuildPending] = useState(false);

  const runBuildAction = async (action: 'buildStart' | 'buildCancel') => {
    setBuildPending(true);
    try {
      const next = await window.api[action]().catch(() => null);
      if (next && typeof next === 'object') setBuildStatus(next as typeof buildStatus);
      else await refreshBuildStatus();
    } finally {
      setBuildPending(false);
    }
  };

  const refreshBuildStatus = useCallback(async () => {
    const s = await window.api.buildStatus().catch(() => null);
    setBuildStatus(s && typeof s === 'object' ? s : null);
  }, []);

  // Subscribe to progress pushes, and clean up on close so a stale listener
  // cannot keep writing to unmounted state.
  useEffect(() => {
    const off = window.api.onBuildStatus((s: unknown) => setBuildStatus(s as typeof buildStatus));
    void refreshBuildStatus();
    return () => off?.();
  }, [refreshBuildStatus]);

  const refreshUsage = useCallback(async () => {
    const t = await window.api.usageGet().catch(() => null);
    setUsage(t && typeof t === 'object' ? t : null);
  }, []);

  const clearUsage = async () => {
    setUsagePending(true);
    try {
      await window.api.usageReset();
      await refreshUsage();
    } finally {
      setUsagePending(false);
    }
  };

  /**
   * The self-evolution loop.
   *
   * The backend and the four preload calls already existed; only the UI was
   * missing, so the feature could never be reached. State is loaded on open so
   * the toggle shows the truth rather than an optimistic guess.
   */
  const [evolveRunning, setEvolveRunning] = useState(false);
  const [evolvePending, setEvolvePending] = useState(false);
  const [evolveStatus, setEvolveStatus] = useState<{
    enabled?: boolean; cyclesCompleted?: number; lastRunAt?: number | null;
    lastError?: string | null;
  } | null>(null);
  const [evolveSuggestions, setEvolveSuggestions] = useState<{
    id: string; pattern: string; description: string; frequency: number;
    confidence: number; automationProposal: string;
  }[]>([]);

  const loadEvolveSuggestions = useCallback(async () => {
    const list = await window.api.selfEvolveSuggestions({ status: 'suggested' }).catch(() => []);
    setEvolveSuggestions(Array.isArray(list) ? list : []);
  }, []);

  const refreshEvolveStatus = useCallback(async () => {
    const s = await window.api.evolveLoopStatus().catch(() => null);
    if (s && typeof s === 'object') {
      setEvolveStatus(s as typeof evolveStatus);
      setEvolveRunning(Boolean((s as { enabled?: boolean }).enabled));
    }
  }, []);

  const toggleEvolveLoop = async () => {
    setEvolvePending(true);
    try {
      const next = await (evolveRunning
        ? window.api.evolveLoopStop()
        : window.api.evolveLoopStart());
      if (next && typeof next === 'object') setEvolveStatus(next as typeof evolveStatus);
      setEvolveRunning(!evolveRunning);
      // Suggestions are only meaningful once a check has run.
      if (!evolveRunning) await loadEvolveSuggestions();
    } catch {
      await refreshEvolveStatus(); // fall back to what the loop actually says
    } finally {
      setEvolvePending(false);
    }
  };

  const runEvolveNow = async () => {
    setEvolvePending(true);
    try {
      await window.api.evolveLoopRunNow();
      await refreshEvolveStatus();
      await loadEvolveSuggestions();
    } finally {
      setEvolvePending(false);
    }
  };

  const acceptEvolveSuggestion = async (id: string) => {
    setEvolvePending(true);
    try {
      await window.api.selfEvolveAccept({ id });
      await loadEvolveSuggestions();
    } finally {
      setEvolvePending(false);
    }
  };

  const dismissEvolveSuggestion = async (id: string) => {
    setEvolvePending(true);
    try {
      await window.api.selfEvolveDismiss({ id });
      setEvolveSuggestions(prev => prev.filter(s => s.id !== id));
    } finally {
      setEvolvePending(false);
    }
  };

  const toggleSelfProtection = async () => {
    const next = !selfProtectionEnabled;
    const cwdNow = loadCurrent().cwd || '.';
    try {
      await window.api.setSetting({ scope: 'user', key: 'selfProtectionEnabled', value: next, cwd: cwdNow });
      setSelfProtectionEnabled(next);
    } catch {
      // Leave the displayed state alone. Flipping the label while the write
      // failed would show protection as off when it is still on.
    }
  };
  const [alwaysOnVoice, setAlwaysOnVoice] = useState(false);
  const [alwaysOnVoicePending, setAlwaysOnVoicePending] = useState(false);
  const voiceState = useVoiceSessionStore((s) => s.state);
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
      .getSetting({ key: 'customBaseUrl' })
      .then((value: unknown) => {
        if (typeof value === 'string') setCustomBaseUrl(value);
      })
      .catch(() => undefined);
    window.api
      .getSetting({ key: 'customModel' })
      .then((value: unknown) => {
        if (typeof value === 'string') setCustomModel(value);
      })
      .catch(() => undefined);
    window.api
      .getSetting({ key: 'failoverEnabled' })
      .then((value: unknown) => {
        if (typeof value === 'boolean') setFailoverEnabled(value);
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
    // Only an explicit `false` turns protection off; anything else, including a
    // failed read, leaves it on, which matches the guard's own default.
    window.api
      .getSetting({ key: 'selfProtectionEnabled' })
      .then((value: unknown) => setSelfProtectionEnabled(value !== false))
      .catch(() => undefined);
    // The evolve toggle must show the loop's real state on open, not a stale
    // default — it auto-resumes across launches, so it can already be running.
    void refreshEvolveStatus();
    void loadEvolveSuggestions();
    void refreshUsage();
    window.api.emailConfigGet().then((config: EmailSettings | null) => {
      if (config) {
        setEmail({ ...config, password: '' });
        setEmailSaved(true);
      }
    }).catch(() => {});
  }, [refreshEvolveStatus, loadEvolveSuggestions, refreshUsage]);

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
            return;
          }
          const list = await window.api.listProviderModels({ provider: activeProvider });
          if (cancelled) return;
          const nextModels = (list as { id: string; label: string; free: boolean; provider?: string }[]).filter((m) => !m.provider || m.provider === activeProvider);
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
        const nextModels = (list as { id: string; label: string; free: boolean; provider?: string }[]).filter((m) => !m.provider || m.provider === activeProvider);
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
  }, [activeProvider, providers, currentModel]);

  const test = async () => {
    setStatus('testing');
    setStatusMessage('Checking provider connection...');
    // Pasted keys routinely carry stray whitespace/newlines — trim before
    // testing AND saving, or every provider 401s a perfectly good key.
    const trimmedKey = apiKey.trim();
    try {
      if (activeProvider === 'custom') await saveCustomFields();
      const res = await window.api.testProvider({ provider: activeProvider, apiKey: trimmedKey });
      if (res.ok) {
        if (trimmedKey) {
          await window.api.setProviderKey({ provider: activeProvider, key: trimmedKey });
          setApiKeyLoaded(true);
          setApiKey('');
        }
        setStatus('ok');
        const list = await window.api.listProviderModels({ provider: activeProvider, apiKey: trimmedKey });
        const nextModels = (list as { id: string; label: string; free: boolean; provider?: string }[]).filter((m) => !m.provider || m.provider === activeProvider);
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
          nextModel
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
    setStatusMessage('Checking OpenCode and loading free models…');
    try {
      await window.api.setProviderKey({ provider: 'opencode', key: '' });
      setApiKey('');
      setApiKeyLoaded(false);
      const result = await window.api.testProvider({ provider: 'opencode', apiKey: '' });
      const list = await window.api.listProviderModels({ provider: 'opencode', apiKey: '' });
      const modelList = (list as { id: string; label: string; free: boolean; provider?: string }[])
        .filter((model) => !model.provider || model.provider === 'opencode');
      setModels(modelList);
      if (result.ok && modelList.length > 0) {
        setStatus('ok');
        setStatusMessage(`${modelList.length} free models available`);
        const saved = loadCurrent();
        const nextModel = modelList.some((model) => model.id === saved.model) ? saved.model : modelList[0]?.id;
        saveCurrent({ provider: 'opencode', model: nextModel, hasApiKey: false });
        if (nextModel) setCurrentModel(nextModel);
        window.dispatchEvent(new Event('storage'));
      } else {
        setStatus('fail');
        setStatusMessage(result.error || 'OpenCode CLI is unavailable.');
      }
    } catch (error) {
      setStatus('fail');
      setStatusMessage(error instanceof Error ? error.message : 'Could not connect to OpenCode');
    }
  };

  const [selectedModelName, setSelectedModelName] = useState('');

  const pickModel = async (id: string) => {
    saveCurrent({ provider: activeProvider, model: id });
    setCurrentModel(id);
    setSelectedModelName(id);
    // Warn at selection time when the provider has no key: otherwise the
    // chat silently answers from a fallback model and nobody knows why.
    try {
      if (provider?.requiresApiKey) {
        const has = (await window.api.hasProviderKey({ provider: activeProvider })) as boolean;
        if (!has && !apiKey.trim()) {
          setStatus('warn');
          setStatusMessage(`Heads-up: no API key saved for ${provider.label ?? activeProvider} — add one and Test & Save, or turns will fall back to other models.`);
        }
      }
    } catch { /* advisory only */ }
    // Dispatch storage event so other components update immediately
    window.dispatchEvent(new Event('storage'));
  };

  const toggleFailover = async () => {
    const next = !failoverEnabled;
    setFailoverEnabled(next);
    await window.api.setSetting({
      scope: 'user',
      key: 'failoverEnabled',
      value: next,
      cwd: loadCurrent().cwd || '.',
    }).catch(() => undefined);
  };

  const saveCloudflareAccountId = async () => {
    await window.api.setSetting({
      scope: 'user',
      key: 'cloudflareAccountId',
      value: cloudflareAccountId.trim(),
      cwd: loadCurrent().cwd || '.',
    }).catch(() => undefined);
  };

  const saveCustomFields = async () => {
    const cwdNow = loadCurrent().cwd || '.';
    await window.api.setSetting({
      scope: 'user',
      key: 'customBaseUrl',
      value: customBaseUrl.trim().replace(/\/+$/, ''),
      cwd: cwdNow,
    }).catch(() => undefined);
    await window.api.setSetting({
      scope: 'user',
      key: 'customModel',
      value: customModel.trim(),
      cwd: cwdNow,
    }).catch(() => undefined);
  };

  // Always-on voice: the preference lives in the main process (it owns the mic),
// so this only reflects and flips it. Rolls back on failure like the
// uncensored toggle — a safety-relevant switch must never lie about its state.
// Load the live loop state once so the toggle opens on the truth.
useEffect(() => {
  let cancelled = false;
  void window.api.voiceSessionState()
    .then((state: { enabled?: boolean } | undefined) => {
      if (!cancelled && state) setAlwaysOnVoice(state.enabled === true);
    })
    .catch(() => undefined);
  return () => { cancelled = true; };
}, []);

const toggleAlwaysOnVoice = async () => {
  const next = !alwaysOnVoice;
  setAlwaysOnVoice(next);
  setAlwaysOnVoicePending(true);
  try {
    await window.api.voiceSessionSetEnabled({ enabled: next, cwd: loadCurrent().cwd || '.' });
  } catch {
    setAlwaysOnVoice(!next);
  } finally {
    setAlwaysOnVoicePending(false);
  }
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

  // Strict per-provider scoping: this pane only ever shows the active
  // provider's own models — never another provider's catalog.
  const scopedModels = models.filter((m) => !m.provider || m.provider === activeProvider);
  const scopedFreeModels = (provider?.freeModels ?? []).filter((m) => !m.provider || m.provider === activeProvider);
  const freeModelList = scopedModels.filter((m) => m.free);
  const paidModelList = scopedModels.filter((m) => !m.free);

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
                  <h3 className="text-sm font-semibold text-zinc-100">Speed &amp; Cleanup</h3>
                  <p className="mt-1 text-xs text-zinc-500">
                    What is slowing this computer down, measured live. Everything Infinite OS changes can be
                    put back with one click.
                  </p>
                </div>
                <PerformancePanel />
              </section>
            )}
            {section === 'provider' && (
              <section>
                <div className="mb-5 pr-8">
                  <h3 className="text-sm font-semibold text-zinc-100">Local Models &amp; Speed</h3>
                  <p className="mt-1 text-xs text-zinc-500">
                    Runs on this computer with no internet. Infinite OS tunes context, reply length and memory
                    use to your hardware automatically, and never loads a model at startup.
                  </p>
                </div>
                <LocalModelPanel />
              </section>
            )}
            {section === 'provider' && (
              <section>
                <div className="mb-5 pr-8">
                  <h3 className="text-sm font-semibold text-zinc-100">Provider</h3>
                  <p className="mt-1 text-xs text-zinc-500">Choose where Infinite AI routes chat and agent requests.</p>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={failoverEnabled}
                    onClick={() => void toggleFailover()}
                    title={failoverEnabled ? 'Turn OFF to make the selected model answer or fail plainly (diagnosing)' : 'Turn ON to let failing models hand over to backups'}
                    className="mt-2.5 flex items-center gap-2 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                  >
                    <span className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${failoverEnabled ? 'bg-emerald-500/70' : 'bg-white/10'}`}>
                      <span className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${failoverEnabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                    </span>
                    Model fallback {failoverEnabled ? 'on' : 'off'}
                    {!failoverEnabled && <span className="text-amber-400/90">— selected model answers or fails plainly</span>}
                  </button>
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
                    {activeProvider === 'custom' && (
                      <div className="flex flex-col gap-2 mb-2">
                        <input
                          type="text"
                          value={customBaseUrl}
                          onChange={(e) => setCustomBaseUrl(e.target.value)}
                          onBlur={() => void saveCustomFields()}
                          placeholder="Base URL — e.g. https://my-gateway.example.com/v1"
                          className="flex-1 rounded-lg border border-white/[0.08] bg-black/30 px-3.5 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-white/[0.25] transition-colors placeholder:text-zinc-600"
                        />
                        <input
                          type="text"
                          value={customModel}
                          onChange={(e) => setCustomModel(e.target.value)}
                          onBlur={() => void saveCustomFields()}
                          placeholder="Model ID — e.g. my-model-name"
                          className="flex-1 rounded-lg border border-white/[0.08] bg-black/30 px-3.5 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-white/[0.25] transition-colors placeholder:text-zinc-600"
                        />
                        <p className="text-xs text-zinc-500">Any OpenAI-compatible endpoint works: private gateways, local servers, new providers. Fill in all three fields, paste the key below, then Test & Save.</p>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <input
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder={apiKeyLoaded ? 'Key saved securely (enter a new key to replace it)' : 'Paste your API key'}
                        className="flex-1 rounded-lg border border-white/[0.08] bg-black/30 px-3.5 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-white/[0.25] transition-colors placeholder:text-zinc-600"
                      />
                      <button
                        onClick={test}
                        disabled={(provider.requiresApiKey && !apiKey && !apiKeyLoaded) || status === 'testing'}
                        className="btn-premium shrink-0 px-4 py-2.5 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {status === 'testing'
                          ? 'Testing...'
                          : apiKey.trim()
                            ? 'Test & Save'
                            : 'Test Connection'}
                      </button>
                    </div>
                  </div>
                )}

                {activeProvider === 'opencode' && (
                  <div className="mb-3 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] px-3 py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-zinc-100">Free models — no API key needed</div>
                        <p className="mt-0.5 text-xs text-zinc-500">Uses your installed OpenCode CLI and its signed-in account.</p>
                      </div>
                      <button
                        onClick={() => void handleUseInstalledOpenCode()}
                        disabled={status === 'testing'}
                        className="shrink-0 rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-medium text-black hover:bg-emerald-400 disabled:opacity-50"
                      >
                        {status === 'testing' ? 'Connecting…' : models.length > 0 ? `Connected · ${models.length} free` : 'Use OpenCode Free'}
                      </button>
                    </div>
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
                {status === 'warn' && (
                  <div className="mb-3 text-sm text-amber-400">{statusMessage}</div>
                )}

                {scopedModels.length > 0 && (
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

                {scopedModels.length === 0 && scopedFreeModels.length > 0 && (
                  <div>
                    <h4 className="text-xs font-medium uppercase tracking-wide text-zinc-500 mb-2">Free Models</h4>
                    <ul className="space-y-1 max-h-64 overflow-y-auto custom-scrollbar">
                      {scopedFreeModels.map((m) => (
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

                {/*
                  Self-protection, stated plainly rather than buried.

                  Every change Infinite AI makes to its own source is versioned
                  and can be rolled back, and every action it takes is recorded.
                  A small set of files that implement that is kept out of reach,
                  so the agent cannot quietly remove your ability to see or undo
                  what it did. It is a user choice, not a limit on what it can
                  build — everything else, including all of its own features, is
                  fair game.
                */}
                <button
                  type="button"
                  onClick={() => void toggleSelfProtection()}
                  className="mt-4 w-full text-left p-3 rounded-lg border transition-colors border-white/[0.06] hover:border-white/[0.12] bg-white/[0.02]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium text-sm text-zinc-100">Protect Infinite OS&apos;s own undo</div>
                    <span
                      className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                        selfProtectionEnabled
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : 'bg-white/[0.07] text-zinc-400'
                      }`}
                    >
                      {selfProtectionEnabled ? 'On' : 'Off'}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-500 mt-1 leading-relaxed">
                    {selfProtectionEnabled
                      ? 'Infinite AI cannot edit the files that version its changes, record its actions, or decide what it may do. Everything else it can rewrite.'
                      : 'Infinite AI can edit the files that version its changes, record its actions, and decide what it may do. Turn this on unless you have a reason not to.'}
                  </div>
                </button>
              </section>
            )}

            {section === 'features' && (
              <section>
                <div className="mb-5 pr-8">
                  <h3 className="text-sm font-semibold text-zinc-100">Agent Feature Stack</h3>
                  <p className="mt-1 text-xs text-zinc-500">Capabilities inherited from each agent paradigm.</p>
                </div>

                {/*
                  Background builds.

                  The five IPC handlers and auto-update/index.ts were finished
                  but never exposed on the preload bridge, and nothing subscribed
                  to onBuildStatusChange — so a rebuild could start, finish or
                  fail and the UI never learned, leaving the app looking idle
                  while work happened or died. Now reachable and reported.
                */}
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 mb-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-zinc-100">Background builds</div>
                      <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                        Rebuild the app without closing it. Useful after Infinite AI changes Infinite
                        OS itself — you can keep working while it compiles.
                      </p>
                      {buildStatus && (
                        <p className="mt-2 text-[11px] text-zinc-400">
                          {buildStatus.phase === 'idle' && 'Idle'}
                          {buildStatus.phase === 'building' && 'Building…'}
                          {buildStatus.phase === 'ready' && 'A new build is ready to apply.'}
                          {buildStatus.phase === 'applying' && 'Applying…'}
                          {buildStatus.phase === 'failed' && `Last build failed: ${buildStatus.error}`}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {buildStatus?.phase === 'building' ? (
                        <button
                          type="button"
                          onClick={() => void runBuildAction('buildCancel')}
                          className="rounded-lg border border-white/[0.08] px-2 py-1 text-[11px] text-zinc-300 hover:text-white"
                        >
                          Cancel
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void runBuildAction('buildStart')}
                          disabled={buildPending}
                          className="rounded-lg border border-white/[0.08] px-2 py-1 text-[11px] text-zinc-300 hover:text-white disabled:opacity-50"
                        >
                          Build now
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/*
                  Usage and cost.

                  Providers always reported usage per response, and the pricing
                  table knew how to turn it into money. Nothing joined them, so
                  a conversation's cost was computed nowhere and shown nowhere.
                  It is an estimate: genuinely free models are $0, and a model
                  with no published rate contributes tokens but no cost — the
                  note below the figures says how many replies that affects, so
                  the total is not mistaken for a complete bill.
                */}
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 mb-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-zinc-100">Usage and cost</div>
                      <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                        What your conversations have used since these totals were last cleared. An
                        estimate, based on the published rate for each model.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void clearUsage()}
                      disabled={usagePending || !usage?.requests}
                      className="mt-0.5 shrink-0 rounded-lg border border-white/[0.08] px-2 py-1 text-[11px] text-zinc-300 hover:text-white disabled:opacity-40"
                    >
                      Clear
                    </button>
                  </div>

                  {usage && usage.requests > 0 ? (
                    <>
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        <div className="rounded-lg bg-white/[0.02] p-2">
                          <div className="text-[10px] text-zinc-500">Estimated cost</div>
                          <div className="mt-0.5 text-sm font-medium text-zinc-100">{usage.formatted.cost}</div>
                        </div>
                        <div className="rounded-lg bg-white/[0.02] p-2">
                          <div className="text-[10px] text-zinc-500">Input tokens</div>
                          <div className="mt-0.5 text-sm font-medium text-zinc-100">{usage.formatted.input}</div>
                        </div>
                        <div className="rounded-lg bg-white/[0.02] p-2">
                          <div className="text-[10px] text-zinc-500">Output tokens</div>
                          <div className="mt-0.5 text-sm font-medium text-zinc-100">{usage.formatted.output}</div>
                        </div>
                      </div>

                      {usage.formatted.note && (
                        <p className="mt-2 text-[11px] text-amber-300/90">{usage.formatted.note}</p>
                      )}

                      {usage.byModel.length > 0 && (
                        <div className="mt-3 space-y-1 border-t border-white/[0.06] pt-3">
                          {usage.byModel.slice(0, 6).map((m) => (
                            <div key={`${m.provider}/${m.model}`} className="flex items-center justify-between gap-3 text-[11px]">
                              <span className="truncate text-zinc-400" title={`${m.provider}/${m.model}`}>
                                {m.model}
                              </span>
                              <span className="shrink-0 tabular-nums text-zinc-500">
                                {m.requests} req{m.requests === 1 ? '' : 's'}
                                {m.costUsd > 0 && ` · $${m.costUsd.toFixed(4)}`}
                                {m.pricing === 'unknown' && ' · no price'}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="mt-3 text-[11px] text-zinc-500">
                      Nothing recorded yet. Totals appear after your first reply.
                    </p>
                  )}
                </div>

                {/*
                  Evolve continuously.

                  The backend has been finished and tested for a long time
                  (`brain/evolution-loop.ts`, `brain/self-evolution.ts`) and the
                  four IPC calls were already exposed on the preload bridge — but
                  nothing ever called them, and the comment in `ipc/index.ts`
                  described a Settings toggle that was never built. So the whole
                  feature was unreachable: Infinite OS could notice "you do this
                  every week" and suggest automating it, and no user could ever
                  see it.
                */}
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 mb-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-zinc-100">Evolve continuously</div>
                      <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                        Infinite OS watches how you actually work and suggests turning repeated things into
                        skills — “you do this every week, want me to automate it?” Runs on a timer in the
                        background and only ever suggests; nothing is created without you saying yes.
                      </p>
                      {evolveStatus && (
                        <p className="mt-2 text-[11px] text-zinc-400">
                          {evolveStatus.enabled ? 'Running' : 'Stopped'}
                          {evolveStatus.lastRunAt ? ` · last check ${new Date(evolveStatus.lastRunAt).toLocaleString()}` : ' · not run yet'}
                          {evolveStatus.cyclesCompleted ? ` · ${evolveStatus.cyclesCompleted} check${evolveStatus.cyclesCompleted === 1 ? '' : 's'}` : ''}
                          {evolveStatus.lastError ? ` · last error: ${evolveStatus.lastError}` : ''}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={evolveRunning}
                      aria-label="Evolve continuously"
                      disabled={evolvePending}
                      onClick={() => void toggleEvolveLoop()}
                      title={evolveRunning ? 'Turn OFF to stop the background checks' : 'Turn ON to look for repeated work to automate'}
                      className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors disabled:opacity-50 ${
                        evolveRunning ? 'border-emerald-400/40 bg-emerald-500/80' : 'border-white/[0.12] bg-white/[0.06]'
                      }`}
                    >
                      <span
                        className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-transform ${
                          evolveRunning ? 'translate-x-[18px]' : 'translate-x-[2px]'
                        }`}
                      />
                    </button>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void runEvolveNow()}
                      disabled={evolvePending}
                      className="rounded-lg border border-white/[0.08] px-2.5 py-1 text-[11px] text-zinc-300 hover:text-white disabled:opacity-50"
                    >
                      Check now
                    </button>
                    {evolveRunning && (
                      <button
                        type="button"
                        onClick={() => void loadEvolveSuggestions()}
                        disabled={evolvePending}
                        className="rounded-lg border border-white/[0.08] px-2.5 py-1 text-[11px] text-zinc-300 hover:text-white disabled:opacity-50"
                      >
                        Refresh suggestions
                      </button>
                    )}
                  </div>

                  {/* Suggestions are only shown after a real check, so this is
                      never an empty box sitting on the settings page. */}
                  {evolveSuggestions.length > 0 && (
                    <div className="mt-3 space-y-2 border-t border-white/[0.06] pt-3">
                      {evolveSuggestions.map((s) => (
                        <div key={s.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                          <div className="text-xs font-medium text-zinc-200">{s.pattern}</div>
                          {s.description && <p className="mt-1 text-[11px] text-zinc-500">{s.description}</p>}
                          <p className="mt-1 text-[10px] text-zinc-500">
                            seen {s.frequency}× · {Math.round(s.confidence * 100)}% confident
                            {s.automationProposal ? ` · ${s.automationProposal}` : ''}
                          </p>
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              onClick={() => void acceptEvolveSuggestion(s.id)}
                              disabled={evolvePending}
                              className="rounded-lg bg-emerald-500/15 px-2 py-1 text-[11px] text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
                            >
                              Create skill
                            </button>
                            <button
                              type="button"
                              onClick={() => void dismissEvolveSuggestion(s.id)}
                              disabled={evolvePending}
                              className="rounded-lg px-2 py-1 text-[11px] text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
                            >
                              Not interested
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* ── Always-on voice ─────────────────────────────────────── */}
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 mb-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-zinc-100">Always-on voice</div>
                      <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                        Infinite AI keeps listening with the app in the background — no need to sit on the Voice page. It hears you in any
                        section, runs the same agent with your full tool access, and answers out loud.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={alwaysOnVoice}
                      aria-label="Always-on voice"
                      disabled={alwaysOnVoicePending}
                      onClick={() => void toggleAlwaysOnVoice()}
                      title={alwaysOnVoice ? 'Turn OFF to release the microphone' : 'Turn ON to let Infinite AI listen in the background'}
                      className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors disabled:opacity-50 ${
                        alwaysOnVoice ? 'border-emerald-400/40 bg-emerald-500/80' : 'border-white/[0.12] bg-white/[0.06]'
                      }`}
                    >
                      <span
                        className={`absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-white transition-all ${
                          alwaysOnVoice ? 'left-[18px]' : 'left-[3px] bg-zinc-500'
                        }`}
                      />
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${
                        alwaysOnVoice && voiceState.listening
                          ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-300'
                          : 'border-white/[0.08] bg-white/[0.03] text-zinc-400'
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${alwaysOnVoice && voiceState.listening ? 'animate-pulse bg-emerald-400' : 'bg-zinc-600'}`} />
                      {alwaysOnVoice
                        ? voiceState.listening
                          ? 'Listening now'
                          : voiceState.phase === 'error'
                            ? 'Mic unavailable'
                            : 'Starting…'
                        : 'Off'}
                    </span>
                    {alwaysOnVoice && (
                      <>
                        <button
                          type="button"
                          onClick={() => void window.api.voiceSessionPause()}
                          className="rounded-lg border border-white/[0.08] px-2.5 py-1 text-zinc-300 transition-colors hover:border-white/[0.16] hover:text-white"
                        >
                          Pause
                        </button>
                        <button
                          type="button"
                          onClick={() => void window.api.voiceSessionResume()}
                          className="rounded-lg border border-white/[0.08] px-2.5 py-1 text-zinc-300 transition-colors hover:border-white/[0.16] hover:text-white"
                        >
                          Resume
                        </button>
                        <button
                          type="button"
                          onClick={() => void window.api.voiceSessionSay({ text: 'Infinite AI is listening.' })}
                          className="rounded-lg border border-white/[0.08] px-2.5 py-1 text-zinc-300 transition-colors hover:border-white/[0.16] hover:text-white"
                        >
                          Test voice
                        </button>
                      </>
                    )}
                  </div>
                  {alwaysOnVoice && voiceState.error && (
                    <p className="mt-2 text-[11px] leading-relaxed text-rose-300">{voiceState.error}</p>
                  )}
                  {alwaysOnVoice && (
                    <p className="mt-2 text-[10px] leading-relaxed text-zinc-600">
                      Wake word “{voiceState.wakeWord}” · stop anytime by saying “stop listening”. Runs while Infinite OS is open; the
                      microphone is released the moment you turn this off.
                    </p>
                  )}
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
