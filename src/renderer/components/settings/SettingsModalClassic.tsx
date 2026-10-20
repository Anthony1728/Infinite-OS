import { useCallback, useEffect, useState } from 'react';
import type { ProviderInfo } from '../../../shared/types';
import { useUiTheme, UI_THEMES } from '../../theme/uiTheme';
import { LocalModelPanel } from './LocalModelPanel';
import { PerformancePanel } from './PerformancePanel';
import { syncActiveModelToMain } from '../../utils/active-model-sync';
import { useVoiceSessionStore } from '../../stores/voice-session';

interface CurrentSettings {
  provider: string;
  model: string;
  cwd: string;
  brainMode?: boolean;
  hasApiKey?: boolean;
}

type PermissionProfile = ':read-only' | ':workspace' | ':accept-edits' | ':full-system-access';

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

export function SettingsModalClassic({ onClose }: { onClose: () => void }) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [activeProvider, setActiveProvider] = useState<string>(() => loadCurrent().provider);
  const [apiKey, setApiKey] = useState('');
  const [apiKeyLoaded, setApiKeyLoaded] = useState(false);
  const [status, setStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [models, setModels] = useState<{ id: string; label: string; free: boolean; provider?: string }[]>([]);
  const [currentModel, setCurrentModel] = useState(() => loadCurrent().model);
  const [cloudflareAccountId, setCloudflareAccountId] = useState('');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [failoverEnabled, setFailoverEnabled] = useState(true);
  const [permissionProfile, setPermissionProfile] = useState<PermissionProfile>(':workspace');
  const [alwaysOnVoice, setAlwaysOnVoice] = useState(false);
  const [alwaysOnVoicePending, setAlwaysOnVoicePending] = useState(false);

  /**
   * Background builds, token usage and the self-evolution loop.
   *
   * These mirror the cards added to SettingsModal.tsx. Both modals are shipped
   * and App.tsx picks between them on the UI theme, with 'classic' (this file)
   * as the default — so a feature added to only one of them is invisible to
   * most users while looking complete in source review.
   */
  const [buildStatus, setBuildStatus] = useState<{
    phase: 'idle' | 'building' | 'ready' | 'failed' | 'applying';
    error?: string;
  } | null>(null);
  const [buildPending, setBuildPending] = useState(false);

  const [usage, setUsage] = useState<{
    requests: number;
    costUsd: number;
    unpricedRequests?: number;
    formatted: { cost: string; input: string; output: string; note?: string };
    byModel: { provider: string; model: string; requests: number; costUsd: number; pricing?: string }[];
  } | null>(null);
  const [usagePending, setUsagePending] = useState(false);

  const [evolveRunning, setEvolveRunning] = useState(false);
  const [evolvePending, setEvolvePending] = useState(false);
  const [evolveStatus, setEvolveStatus] = useState<{
    enabled?: boolean; cyclesCompleted?: number; lastRunAt?: number | null;
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

  const refreshBuildStatus = useCallback(async () => {
    const s = await window.api.buildStatus().catch(() => null);
    setBuildStatus(s && typeof s === 'object' ? s : null);
  }, []);

  const refreshUsage = useCallback(async () => {
    const t = await window.api.usageGet().catch(() => null);
    setUsage(t && typeof t === 'object' ? t : null);
  }, []);

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

  const clearUsage = async () => {
    setUsagePending(true);
    try {
      await window.api.usageReset();
      await refreshUsage();
    } finally {
      setUsagePending(false);
    }
  };

  const toggleEvolveLoop = async () => {
    setEvolvePending(true);
    try {
      const next = await (evolveRunning
        ? window.api.evolveLoopStop()
        : window.api.evolveLoopStart());
      if (next && typeof next === 'object') setEvolveStatus(next as typeof evolveStatus);
      setEvolveRunning(!evolveRunning);
      if (!evolveRunning) await loadEvolveSuggestions();
    } catch {
      await refreshEvolveStatus();
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
      setEvolveSuggestions((prev) => prev.filter((s) => s.id !== id));
    } finally {
      setEvolvePending(false);
    }
  };

  // Load on mount, and subscribe to build progress pushes.
  useEffect(() => {
    void refreshEvolveStatus();
    void loadEvolveSuggestions();
    void refreshUsage();
    void refreshBuildStatus();
    const off = window.api.onBuildStatus((s: unknown) => setBuildStatus(s as typeof buildStatus));
    return () => off?.();
  }, [refreshEvolveStatus, loadEvolveSuggestions, refreshUsage, refreshBuildStatus]);
  const voiceState = useVoiceSessionStore((s) => s.state);
  const [email, setEmail] = useState<EmailSettings>(EMPTY_EMAIL);
  const [emailSaved, setEmailSaved] = useState(false);
  const [emailStatus, setEmailStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [emailMessage, setEmailMessage] = useState('');

  // Always-on voice: the preference is owned by the main process (it holds the
  // microphone), so this only reflects and flips it. It rolls back on failure —
  // a switch that controls the mic must never lie about its own state.
  useEffect(() => {
    let cancelled = false;
    void window.api
      .voiceSessionState()
      .then((state: { enabled?: boolean } | undefined) => {
        if (!cancelled && state) setAlwaysOnVoice(state.enabled === true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
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
    window.api.emailConfigGet().then((config: EmailSettings | null) => {
      if (config) {
        setEmail({ ...config, password: '' });
        setEmailSaved(true);
      }
    }).catch(() => {});
  }, []);

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
          // Display only: browsing tabs must never rewrite the chat's saved
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

  const saveCloudflareAccountId = async (value?: string) => {
    const next = (value ?? cloudflareAccountId).trim();
    await window.api
      .setSetting({ scope: 'user', key: 'cloudflareAccountId', value: next, cwd: loadCurrent().cwd || '.' })
      .catch(() => undefined);
    if (value === undefined) setCloudflareAccountId(next);
  };

  const saveCustomFields = async () => {
    const cwdNow = loadCurrent().cwd || '.';
    await window.api
      .setSetting({ scope: 'user', key: 'customBaseUrl', value: customBaseUrl.trim().replace(/\/+$/, ''), cwd: cwdNow })
      .catch(() => undefined);
    await window.api
      .setSetting({ scope: 'user', key: 'customModel', value: customModel.trim(), cwd: cwdNow })
      .catch(() => undefined);
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

  const test = async () => {
    setStatus('testing');
    setStatusMessage('Checking provider connection...');
    try {
      if (activeProvider === 'cloudflare') await saveCloudflareAccountId();
      if (activeProvider === 'custom') await saveCustomFields();
      const res = await window.api.testProvider({ provider: activeProvider, apiKey });
      if (res.ok) {
        if (apiKey.trim()) {
          await window.api.setProviderKey({ provider: activeProvider, key: apiKey.trim() });
          setApiKeyLoaded(true);
          setApiKey('');
        }
        setStatus('ok');
        const list = await window.api.listProviderModels({ provider: activeProvider, apiKey });
        const nextModels = (list as { id: string; label: string; free: boolean; provider?: string }[])
          .filter((model) => !model.provider || model.provider === activeProvider);
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

  const pickModel = (id: string) => {
    saveCurrent({ provider: activeProvider, model: id });
    setCurrentModel(id);
    setSelectedModelName(id);
    // Dispatch storage event so other components update immediately
    window.dispatchEvent(new Event('storage'));
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
  const { theme: uiTheme, setTheme: setUiTheme } = useUiTheme();

  // Strict per-provider scoping: this pane only ever shows the active
  // provider's own models — never another provider's catalog.
  const scopedModels = models.filter((m) => !m.provider || m.provider === activeProvider);
  const scopedFreeModels = (provider?.freeModels ?? []).filter((m) => !m.provider || m.provider === activeProvider);
  const freeModelList = scopedModels.filter((m) => m.free);
  const paidModelList = scopedModels.filter((m) => !m.free);

  const renderModelSection = (heading: string, items: { id: string; label: string; free: boolean }[]) =>
    items.length === 0 ? null : (
      <div className="mb-4">
        <h4 className="text-sm font-semibold text-white mb-2">
          {heading} <span className="text-xs font-normal text-gray-500">({items.length})</span>
        </h4>
        <ul className="space-y-1 max-h-64 overflow-y-auto custom-scrollbar">
          {items.map((m) => (
            <li key={m.id}>
              <button
                onClick={() => pickModel(m.id)}
                className={`w-full text-left p-2.5 rounded-xl text-sm flex items-center justify-between transition-all ${
                  currentModel === m.id
                    ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30'
                    : 'hover:bg-white/[0.04] text-gray-400 border border-transparent'
                }`}
              >
                <span>{m.label}</span>
                <div className="flex items-center gap-2">
                  {m.free && <span className="text-xs text-emerald-400">free</span>}
                  {currentModel === m.id && <span className="text-xs text-indigo-400">selected</span>}
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
        className="bg-[#12121a] rounded-xl border border-white/[0.08] w-full max-w-2xl max-h-[80vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-white/[0.06]">
          <h2 className="text-lg font-semibold text-white">Settings</h2>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                onClose();
                window.dispatchEvent(new CustomEvent('infinite:open-personalization', { detail: 'appearance' }));
              }}
              className="rounded-lg border border-violet-400/20 bg-violet-500/[0.07] px-3 py-1.5 text-[10px] text-violet-200 transition-colors hover:bg-violet-500/[0.13]"
            >
              Appearance &amp; logo
            </button>
            <button onClick={onClose} className="text-gray-500 hover:text-white text-xl transition-colors" aria-label="Close settings">
              &times;
            </button>
          </div>
        </div>

        <div className="p-5 space-y-6">
          <section className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
            <h3 className="text-sm font-semibold text-white mb-1">UI Design</h3>
            <p className="text-xs text-gray-500 mb-3">Switch between the original Infinite OS look and the redesigned monochrome interface. Applies instantly — all features stay available either way.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {UI_THEMES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setUiTheme(t.id)}
                  className={`text-left p-3 rounded-xl border transition-all ${
                    uiTheme === t.id
                      ? 'border-indigo-500/50 bg-indigo-500/10'
                      : 'border-white/[0.06] hover:border-white/[0.12] bg-white/[0.02]'
                  }`}
                >
                  <div className="font-medium text-sm text-white">{t.label}</div>
                  <div className="text-xs text-gray-500 mt-1 leading-relaxed">{t.description}</div>
                  {uiTheme === t.id && <div className="text-xs text-indigo-300 mt-2">Active</div>}
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-white">Provider</h3>
                <p className="mt-1 text-xs text-gray-500">Choose where Infinite AI routes chat and agent requests.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={failoverEnabled}
                onClick={() => void toggleFailover()}
                title={failoverEnabled ? 'Turn OFF to make the selected model answer or fail plainly (diagnosing)' : 'Turn ON to let failing models hand over to backups'}
                className="flex shrink-0 items-center gap-2 text-xs text-gray-400 hover:text-white transition-colors"
              >
                <span className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${failoverEnabled ? 'bg-emerald-500/70' : 'bg-white/10'}`}>
                  <span className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${failoverEnabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                </span>
                Model fallback {failoverEnabled ? 'on' : 'off'}
              </button>
            </div>
            {!failoverEnabled && (
              <p className="text-[11px] text-amber-400/90 mb-3">Fallback off — the selected model answers or fails plainly.</p>
            )}
            <div className="grid grid-cols-2 gap-2 mb-4">
              {providers.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setActiveProvider(p.id)}
                  className={`text-left p-3 rounded-xl border transition-all ${
                    p.id === activeProvider
                      ? 'border-indigo-500/50 bg-indigo-500/10'
                      : 'border-white/[0.06] hover:border-white/[0.12] bg-white/[0.02]'
                  }`}
                >
                  <div className="font-medium text-sm text-white">{p.label}</div>
                  {p.requiresApiKey && <div className="text-xs text-gray-500 mt-0.5">Requires API key</div>}
                  {p.freeModels.length > 0 && (
                    <div className="text-xs text-emerald-400 mt-0.5">{p.freeModels.length} free models</div>
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
                      className="flex-1 rounded-xl border border-white/[0.08] bg-[#0d0d11] px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500/50 transition-colors placeholder:text-gray-600"
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
                      className="flex-1 rounded-xl border border-white/[0.08] bg-[#0d0d11] px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500/50 transition-colors placeholder:text-gray-600"
                    />
                    <input
                      type="text"
                      value={customModel}
                      onChange={(e) => setCustomModel(e.target.value)}
                      onBlur={() => void saveCustomFields()}
                      placeholder="Model ID — e.g. my-model-name"
                      className="flex-1 rounded-xl border border-white/[0.08] bg-[#0d0d11] px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500/50 transition-colors placeholder:text-gray-600"
                    />
                    <p className="text-xs text-gray-500">Any OpenAI-compatible endpoint works: private gateways, local servers, new providers. Fill in all three fields, paste the key below, then Test & Save.</p>
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={apiKeyLoaded ? 'Key saved securely (enter a new key to replace it)' : 'Paste your API key'}
                    className="flex-1 rounded-xl border border-white/[0.08] bg-[#0d0d11] px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500/50 transition-colors placeholder:text-gray-600"
                  />
                  <button
                    onClick={test}
                    disabled={(provider.requiresApiKey && !apiKey && !apiKeyLoaded) || status === 'testing'}
                    className="rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white px-5 py-2.5 text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
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
              <div className="mb-3 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-white">Free models — no API key needed</div>
                    <p className="mt-0.5 text-xs text-gray-500">Uses your installed OpenCode CLI and its signed-in account.</p>
                  </div>
                  <button
                    onClick={() => void handleUseInstalledOpenCode()}
                    disabled={status === 'testing'}
                    className="shrink-0 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400 disabled:opacity-50"
                  >
                    {status === 'testing' ? 'Connecting…' : models.length > 0 ? `Connected · ${models.length} free` : 'Use OpenCode Free'}
                  </button>
                </div>
              </div>
            )}

            {status === 'ok' && <div className="text-sm text-emerald-400 mb-2">{statusMessage || 'Connected'}</div>}
            {status === 'fail' && (
              <div className="text-sm text-red-400 mb-2">{statusMessage || 'Connection failed'}</div>
            )}

            {scopedModels.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-white mb-2">Models</h4>
                {selectedModelName && (
                  <div className="mb-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs text-emerald-400 flex items-center gap-2">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
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
                <h4 className="text-sm font-semibold text-white mb-2">Free Models</h4>
                <ul className="space-y-1 max-h-64 overflow-y-auto custom-scrollbar">
                  {scopedFreeModels.map((m) => (
                    <li key={m.id}>
                      <button
                        onClick={() => pickModel(m.id)}
                        className={`w-full text-left p-2.5 rounded-xl text-sm flex items-center justify-between transition-all ${
                          currentModel === m.id
                            ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30'
                            : 'hover:bg-white/[0.04] text-gray-400 border border-transparent'
                        }`}
                      >
                        <span>{m.label}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-emerald-400">free</span>
                          {currentModel === m.id && <span className="text-xs text-indigo-400">selected</span>}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* Performance sits above local models because "why is my PC slow" is the
            first question, and it is answered with this machine's real
            measurements. */}
          <section>
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-white">Speed &amp; Cleanup</h3>
              <p className="text-xs text-gray-500 mt-1">
                What is slowing this computer down, measured live. Everything Infinite OS changes can be put
                back with one click.
              </p>
            </div>
            <PerformancePanel />
          </section>

          {/* Local models sit right after the model pickers, because that is where
            somebody who has just chosen "Ollama (local)" looks for "why is it
            slow?". The panel answers with this machine's real measured limits
            rather than generic advice. */}
          <section>
            <div className="mb-3">
              <h3 className="text-sm font-semibold text-white">Local Models &amp; Speed</h3>
              <p className="text-xs text-gray-500 mt-1">
                Runs on this computer with no internet. Infinite OS tunes context, reply length and memory
                use to your hardware automatically, and never loads a model at startup.
              </p>
            </div>
            <LocalModelPanel />
          </section>

          <section>
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <h3 className="text-sm font-semibold text-white">Email Account</h3>
                <p className="text-xs text-gray-500 mt-1">The saved account is reused whenever you ask Infinite AI to send email from chat.</p>
              </div>
              {emailSaved && <span className="text-[10px] rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-400">Configured</span>}
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
              {(['gmail', 'outlook', 'yahoo'] as const).map((preset) => (
                <button key={preset} onClick={() => applyEmailPreset(preset)} className="rounded-lg border border-white/[0.08] bg-white/[0.025] px-3 py-1.5 text-xs capitalize text-gray-400 hover:text-white">
                  {preset}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input type="email" value={email.user} onChange={(event) => setEmail((current) => ({ ...current, user: event.target.value }))} placeholder="Email address" className="rounded-xl border border-white/[0.08] bg-[#0d0d11] px-3 py-2.5 text-sm text-white outline-none placeholder:text-gray-600" />
              <input type="password" value={email.password} onChange={(event) => setEmail((current) => ({ ...current, password: event.target.value }))} placeholder={emailSaved ? 'Encrypted password saved (enter to replace)' : 'Password or app password'} className="rounded-xl border border-white/[0.08] bg-[#0d0d11] px-3 py-2.5 text-sm text-white outline-none placeholder:text-gray-600" />
              <div className="flex gap-2">
                <input value={email.imapHost} onChange={(event) => setEmail((current) => ({ ...current, imapHost: event.target.value }))} placeholder="IMAP host" className="min-w-0 flex-1 rounded-xl border border-white/[0.08] bg-[#0d0d11] px-3 py-2.5 text-sm text-white outline-none" />
                <input type="number" value={email.imapPort} onChange={(event) => setEmail((current) => ({ ...current, imapPort: Number(event.target.value) }))} className="w-20 rounded-xl border border-white/[0.08] bg-[#0d0d11] px-2 py-2.5 text-sm text-white outline-none" />
              </div>
              <div className="flex gap-2">
                <input value={email.smtpHost} onChange={(event) => setEmail((current) => ({ ...current, smtpHost: event.target.value }))} placeholder="SMTP host" className="min-w-0 flex-1 rounded-xl border border-white/[0.08] bg-[#0d0d11] px-3 py-2.5 text-sm text-white outline-none" />
                <input type="number" value={email.smtpPort} onChange={(event) => setEmail((current) => ({ ...current, smtpPort: Number(event.target.value) }))} className="w-20 rounded-xl border border-white/[0.08] bg-[#0d0d11] px-2 py-2.5 text-sm text-white outline-none" />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 mt-3">
              <p className="text-[11px] leading-5 text-gray-600">Passwords are protected with Windows encryption. Gmail, Outlook, and Yahoo commonly require an app password when two-factor authentication is enabled.</p>
              <button onClick={() => void testAndSaveEmail()} disabled={emailStatus === 'testing'} className="shrink-0 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">
                {emailStatus === 'testing' ? 'Testing...' : 'Test & Save'}
              </button>
            </div>
            {emailStatus === 'fail' && emailMessage && (
              <div className="mt-2">
                <div className="text-xs text-red-400 whitespace-pre-wrap">{emailMessage}</div>
                <button
                  onClick={() => void saveEmailAnyway()}
                  className="mt-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-1.5 text-xs text-yellow-300 hover:bg-yellow-500/20 transition-colors"
                >
                  Save anyway (without verification)
                </button>
              </div>
            )}
            {emailStatus !== 'fail' && emailMessage && (
              <div className={`mt-2 text-xs ${emailStatus === 'ok' ? 'text-emerald-400' : 'text-gray-400'}`}>{emailMessage}</div>
            )}
          </section>

          <section>
            <h3 className="text-sm font-semibold text-white mb-3">Agent Permissions</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {PERMISSION_PROFILES.map((profile) => (
                <button
                  key={profile.id}
                  onClick={() => pickPermissionProfile(profile.id)}
                  className={`text-left p-3 rounded-xl border transition-all ${
                    permissionProfile === profile.id
                      ? 'border-emerald-500/50 bg-emerald-500/10'
                      : 'border-white/[0.06] hover:border-white/[0.12] bg-white/[0.02]'
                  }`}
                >
                  <div className="font-medium text-sm text-white">{profile.label}</div>
                  <div className="text-xs text-gray-500 mt-1 leading-relaxed">{profile.description}</div>
                  {permissionProfile === profile.id && (
                    <div className="text-xs text-emerald-400 mt-2">Active</div>
                  )}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-3 leading-relaxed">
              Full system access gives Infinite OS direct autonomy through Infinite AI, similar to Codex danger-full-access. Use it only when
              you want the chat agent to operate across your PC without routine permission prompts.
            </p>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-white mb-3">Agent Feature Stack</h3>

              {/*
                These three cards are duplicated from SettingsModal.tsx on
                purpose. The app ships two parallel settings modals and picks
                between them on the UI theme: 'classic' renders this file, and
                classic is the default theme. Adding them only to
                SettingsModal.tsx left all three invisible to default users.
              */}

              {/* Background builds: the five handlers and auto-update/index.ts
                  were finished but never exposed on the preload bridge, and
                  nothing subscribed to onBuildStatusChange. */}
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 mb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-white text-sm font-medium">Background builds</div>
                    <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                      Rebuild the app without closing it. Useful after Infinite AI changes Infinite
                      OS itself — you can keep working while it compiles.
                    </p>
                    {buildStatus && (
                      <p className="mt-2 text-[11px] text-gray-400">
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
                        className="rounded-lg border border-white/[0.08] px-2 py-1 text-[11px] text-gray-300 hover:text-white"
                      >
                        Cancel
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void runBuildAction('buildStart')}
                        disabled={buildPending}
                        className="rounded-lg border border-white/[0.08] px-2 py-1 text-[11px] text-gray-300 hover:text-white disabled:opacity-50"
                      >
                        Build now
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Usage and cost: every provider reported usage per response and
                  the pricing table priced it, but nothing joined the two. An
                  estimate — free models are $0, and unpriced models are
                  disclosed below. */}
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 mb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-white text-sm font-medium">Usage and cost</div>
                    <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                      What your conversations have used since these totals were last cleared. An
                      estimate, based on the published rate for each model.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void clearUsage()}
                    disabled={usagePending || !usage?.requests}
                    className="mt-0.5 shrink-0 rounded-lg border border-white/[0.08] px-2 py-1 text-[11px] text-gray-300 hover:text-white disabled:opacity-40"
                  >
                    Clear
                  </button>
                </div>
                {usage && usage.requests > 0 ? (
                  <>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <div className="rounded-lg bg-white/[0.02] p-2">
                        <div className="text-[10px] text-gray-500">Estimated cost</div>
                        <div className="mt-0.5 text-sm font-medium text-white">{usage.formatted.cost}</div>
                      </div>
                      <div className="rounded-lg bg-white/[0.02] p-2">
                        <div className="text-[10px] text-gray-500">Input tokens</div>
                        <div className="mt-0.5 text-sm font-medium text-white">{usage.formatted.input}</div>
                      </div>
                      <div className="rounded-lg bg-white/[0.02] p-2">
                        <div className="text-[10px] text-gray-500">Output tokens</div>
                        <div className="mt-0.5 text-sm font-medium text-white">{usage.formatted.output}</div>
                      </div>
                    </div>
                    {usage.formatted.note && (
                      <p className="mt-2 text-[11px] text-amber-300/90">{usage.formatted.note}</p>
                    )}
                    {usage.byModel.length > 0 && (
                      <div className="mt-3 space-y-1 border-t border-white/[0.06] pt-3">
                        {usage.byModel.slice(0, 6).map((m) => (
                          <div key={m.provider + '/' + m.model} className="flex items-center justify-between gap-3 text-[11px]">
                            <span className="truncate text-gray-400" title={m.provider + '/' + m.model}>
                              {m.model}
                            </span>
                            <span className="shrink-0 tabular-nums text-gray-500">
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
                  <p className="mt-3 text-[11px] text-gray-500">
                    Nothing recorded yet. Totals appear after your first reply.
                  </p>
                )}
              </div>

              {/* Evolve continuously: the backend was finished and tested long
                  before any UI called it. */}
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 mb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-white text-sm font-medium">Evolve continuously</div>
                    <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                      Infinite OS watches how you actually work and suggests turning repeated things
                      into skills. Runs on a timer in the background and only ever suggests; nothing
                      is created without you saying yes.
                    </p>
                    {evolveStatus && (
                      <p className="mt-2 text-[11px] text-gray-400">
                        {evolveStatus.enabled ? 'Running' : 'Stopped'}
                        {evolveStatus.lastRunAt ? ` · last check ${new Date(evolveStatus.lastRunAt).toLocaleString()}` : ' · not run yet'}
                        {evolveStatus.cyclesCompleted ? ` · ${evolveStatus.cyclesCompleted} check${evolveStatus.cyclesCompleted === 1 ? '' : 's'}` : ''}
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
                      className={`absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full transition-all ${
                        evolveRunning ? 'left-[18px] bg-white' : 'left-[3px] bg-zinc-500'
                      }`}
                    />
                  </button>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void runEvolveNow()}
                    disabled={evolvePending}
                    className="rounded-lg border border-white/[0.08] px-2 py-1 text-[11px] text-gray-300 hover:text-white disabled:opacity-50"
                  >
                    Check now
                  </button>
                  {evolveRunning && (
                    <button
                      type="button"
                      onClick={() => void loadEvolveSuggestions()}
                      disabled={evolvePending}
                      className="rounded-lg border border-white/[0.08] px-2 py-1 text-[11px] text-gray-300 hover:text-white disabled:opacity-50"
                    >
                      Refresh suggestions
                    </button>
                  )}
                </div>
                {evolveSuggestions.length > 0 && (
                  <div className="mt-3 space-y-2 border-t border-white/[0.06] pt-3">
                    {evolveSuggestions.map((s) => (
                      <div key={s.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                        <div className="text-xs font-medium text-gray-200">{s.pattern}</div>
                        {s.description && <p className="mt-1 text-[11px] text-gray-500">{s.description}</p>}
                        <p className="mt-1 text-[10px] text-gray-500">
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
                            className="rounded-lg px-2 py-1 text-[11px] text-gray-500 hover:text-gray-300 disabled:opacity-50"
                          >
                            Not interested
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            {/* ── Always-on voice ──────────────────────────────────────────── */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 mb-3">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-white text-sm font-medium">Always-on voice</div>
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed">
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
                    className={`absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full transition-all ${
                      alwaysOnVoice ? 'left-[18px] bg-white' : 'left-[3px] bg-zinc-500'
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
                  <span className={`h-1.5 w-1.5 rounded-full ${alwaysOnVoice && voiceState.listening ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
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
              {alwaysOnVoice && voiceState.error && <p className="mt-2 text-[11px] leading-relaxed text-rose-300">{voiceState.error}</p>}
              {alwaysOnVoice && (
                <p className="mt-2 text-[10px] leading-relaxed text-gray-600">
                  Wake word “{voiceState.wakeWord}” · stop anytime by saying “stop listening”. Runs while Infinite OS is open; the
                  microphone is released the moment you turn this off.
                </p>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-gray-400">
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <div className="text-white text-sm font-medium mb-1">Codex-style</div>
                Plans, source edits, terminal validation, sessions, branches, full-system permission profiles.
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <div className="text-white text-sm font-medium mb-1">Claude Code-style</div>
                Allow/deny/ask rules, project memory, multi-agent tasks, safe permission prompts.
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <div className="text-white text-sm font-medium mb-1">OpenCode-style</div>
                Build/test/lint loops, project-aware tooling, local model fallback, extensible tool registry.
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <div className="text-white text-sm font-medium mb-1">Computer-agent style</div>
                Browser control, desktop state, mouse/keyboard actions, app launching, local automation.
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
