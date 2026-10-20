/**
 * LocalModelPanel — the controls for local models, in Settings.
 *
 * This exists because the honest answer to "local models are slow" was invisible:
 * the app pinned 1.5-2.5 GB of RAM at every boot, asked a 1.7 GHz CPU for 8192
 * tokens of context, and blocked the model picker for 10 seconds while polling for
 * a server it had not been asked to start. None of that was visible, so it just
 * looked broken.
 *
 * Everything on this screen is a real measurement from the running machine or the
 * running Ollama, read through IPC at open time. No estimated numbers, no
 * optimistic labels — if Ollama is not running this says so and explains what to
 * do about it.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Cpu, HardDrive, MemoryStick, RefreshCw, Zap, ZapOff, Gauge, AlertTriangle, CheckCircle2,
} from 'lucide-react';

interface Capability {
  profile: {
    tier: 'low' | 'mid' | 'high';
    totalRamGb: number;
    cpuThreads: number;
    cpuModel: string;
    vramGb: number;
    hasNvidiaGpu: boolean;
  };
  budget: {
    numCtx: number;
    numPredict: number;
    numThread: number;
    keepAlive: string;
    thinkingFraction: number;
  };
  summary: string;
}

interface LocalModel {
  name: string;
  sizeBytes: number;
  sizeGb: number;
  parameterSize?: string;
  supportsThinking: boolean;
  supportsTools: boolean;
  comfortable: boolean;
}

interface Loaded {
  name: string;
  sizeBytes: number;
  sizeVramBytes: number;
  expiresAt: string;
}

export function LocalModelPanel() {
  const [capability, setCapability] = useState<Capability | null>(null);
  const [models, setModels] = useState<LocalModel[]>([]);
  const [loaded, setLoaded] = useState<Loaded[]>([]);
  const [health, setHealth] = useState<{ ok: boolean; error?: string; models?: number } | null>(null);
  const [showLocalThinking, setShowLocalThinking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setError('');
    try {
      const [cap, list, resident, status, thinking] = await Promise.all([
        window.api.ollamaCapability(),
        window.api.ollamaLocalModels(),
        window.api.ollamaLoaded(),
        window.api.ollamaHealth(),
        window.api.getSetting({ scope: 'user', key: 'showLocalModelThinking' }),
      ]);
      setCapability(cap as Capability);
      setModels((list as LocalModel[]) ?? []);
      setLoaded((resident as Loaded[]) ?? []);
      setHealth(status as { ok: boolean; error?: string });
      setShowLocalThinking(thinking === true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setThinking = async (value: boolean) => {
    setShowLocalThinking(value);
    await window.api.setSetting({ scope: 'user', key: 'showLocalModelThinking', value, cwd: '.' }).catch(() => undefined);
    setNote(
      value
        ? 'On. Expect roughly 10-20 extra seconds per turn on this machine - it reasons first, then answers.'
        : 'Off. Turns are much faster.',
    );
  };

  const preload = async (name: string) => {
    setBusy(name);
    setNote('');
    const result = await window.api.ollamaPreload({ model: name });
    setBusy(null);
    setNote(result?.ok ? `${name} loaded and ready.` : `Could not load ${name}: ${result?.error ?? 'unknown error'}`);
    await refresh();
  };

  const unload = async (name: string) => {
    setBusy(name);
    setNote('');
    await window.api.ollamaUnload({ model: name });
    setBusy(null);
    setNote(`${name} released.`);
    await refresh();
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-white/80">Local models</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-white/40">
          Runs on this computer, with no internet and no usage limit. These are the real limits of your
          machine, measured — so you can tell at a glance whether a model will be usable.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/[0.07] px-3 py-2 text-[11px] text-red-300">
          {error}
        </div>
      )}

      {/* Is Ollama even up? */}
      <div className="flex items-start gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
        {health?.ok ? (
          <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-400" />
        ) : (
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-400" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium text-white/70">
            {health?.ok ? `Ollama is running${health.models ? ` · ${health.models} model${health.models === 1 ? '' : 's'}` : ''}` : 'Ollama is not running'}
          </div>
          {health?.error && <div className="mt-0.5 text-[11px] leading-relaxed text-white/40">{health.error}</div>}
        </div>
        <button
          onClick={() => void refresh()}
          className="shrink-0 rounded-md p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white/70"
          title="Re-check"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {/* What this machine can run */}
      {capability && (
        <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
          <div className="mb-2 text-[11px] font-medium text-white/70">This computer</div>
          <div className="grid grid-cols-2 gap-2 text-[11px] text-white/45">
            <div className="flex items-center gap-1.5">
              <Cpu size={12} className="shrink-0 text-white/30" />
              <span className="truncate" title={capability.profile.cpuModel}>{capability.profile.cpuModel}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <MemoryStick size={12} className="shrink-0 text-white/30" />
              {capability.profile.totalRamGb} GB RAM
            </div>
            <div className="flex items-center gap-1.5">
              <HardDrive size={12} className="shrink-0 text-white/30" />
              {capability.profile.hasNvidiaGpu
                ? `NVIDIA GPU, ${capability.profile.vramGb} GB VRAM`
                : capability.profile.vramGb > 0
                  ? `Graphics only (${capability.profile.vramGb} GB shared) — CPU inference`
                  : 'No GPU — CPU inference'}
            </div>
            <div className="flex items-center gap-1.5">
              <Gauge size={12} className="shrink-0 text-white/30" />
              {capability.profile.cpuThreads} threads
            </div>
          </div>

          <div className="mt-3 border-t border-white/[0.06] pt-2.5">
            <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-white/30">
              Settings applied automatically
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-white/40">
              <span>Context window</span>
              <span className="font-mono text-white/55">{capability.budget.numCtx.toLocaleString()}</span>
              <span>Max reply</span>
              <span className="font-mono text-white/55">{capability.budget.numPredict.toLocaleString()} tokens</span>
              <span>Threads</span>
              <span className="font-mono text-white/55">{capability.budget.numThread}</span>
              <span>Keeps memory for</span>
              <span className="font-mono text-white/55">{capability.budget.keepAlive}</span>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-white/30">
              These come from the <span className="text-white/45">{capability.profile.tier}</span> tier for this
              machine. They are deliberately conservative: a slightly slow answer is fine, a computer that
              crawls while the model is loaded is not. Nothing is loaded into memory until you actually use
              a local model.
            </p>
          </div>
        </div>
      )}

      {/* Thinking toggle — the one place where local models are much slower */}
      <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
        <button
          onClick={() => void setThinking(!showLocalThinking)}
          className="flex w-full items-center gap-2 text-left"
        >
          {showLocalThinking ? (
            <Zap size={13} className="shrink-0 text-amber-400" />
          ) : (
            <ZapOff size={13} className="shrink-0 text-white/30" />
          )}
          <span className="text-[11px] font-medium text-white/70">
            Show the model&apos;s thinking for local models
          </span>
          <span className="ml-auto text-[10px] font-medium text-white/50">{showLocalThinking ? 'On' : 'Off'}</span>
        </button>
        <p className="mt-1.5 text-[11px] leading-relaxed text-white/40">
          {showLocalThinking
            ? 'The model works through its reasoning first, and you watch it as it goes. It then answers in a second pass, so you always get a real reply, never just thinking with no answer.'
            : 'Off is much faster. Turn it on when you want to see how it works through a problem; the reasoning appears above the answer, and you can collapse it.'}
        </p>
        {note && <p className="mt-1.5 text-[11px] text-white/50">{note}</p>}
      </div>

      {/* Installed models */}
      <div>
        <div className="mb-1.5 text-[11px] font-medium text-white/70">
          Installed {models.length > 0 && <span className="font-normal text-white/35">({models.length})</span>}
        </div>
        {models.length === 0 ? (
          <p className="text-[11px] leading-relaxed text-white/35">
            No local models installed. Pull one from a terminal with{' '}
            <code className="rounded bg-white/[0.06] px-1 font-mono text-[10px] text-white/55">ollama pull qwen3:1.7b</code>,
            or ask Infinite AI to do it. On a machine without a GPU, start with a small one — 1.7b is a good
            choice and 4b is the practical limit.
          </p>
        ) : (
          <div className="space-y-1">
            {models.map((model) => {
              const resident = loaded.find((l) => l.name === model.name);
              return (
                <div
                  key={model.name}
                  className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[11px] font-medium text-white/75">{model.name}</span>
                      {!model.comfortable && (
                        <span
                          className="shrink-0 rounded bg-amber-500/15 px-1 text-[9px] text-amber-300/90"
                          title="Large for this machine — expect it to be slow"
                        >
                          slow here
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[10px] text-white/35">
                      {model.sizeGb} GB{model.parameterSize ? ` · ${model.parameterSize}` : ''}
                      {model.supportsThinking ? ' · can think' : ''}
                      {model.supportsTools ? ' · tools' : ''}
                      {resident ? ` · using ${(resident.sizeBytes / 1024 ** 3).toFixed(1)} GB RAM` : ''}
                    </div>
                  </div>
                  {resident ? (
                    <button
                      onClick={() => void unload(model.name)}
                      disabled={busy === model.name}
                      className="shrink-0 rounded-md border border-white/10 px-2 py-1 text-[10px] text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
                      title="Free this model's memory immediately"
                    >
                      {busy === model.name ? '…' : 'Free memory'}
                    </button>
                  ) : (
                    <button
                      onClick={() => void preload(model.name)}
                      disabled={busy === model.name}
                      className="shrink-0 rounded-md border border-white/10 px-2 py-1 text-[10px] text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
                      title="Load it now so the next message is not slow to start"
                    >
                      {busy === model.name ? '…' : 'Preload'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* What is currently sitting in RAM — the honest answer to "why is it slow?" */}
      {loaded.length > 0 && (
        <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
          <div className="mb-1.5 text-[11px] font-medium text-white/70">Currently in memory</div>
          {loaded.map((l) => (
            <div key={l.name} className="flex items-center justify-between text-[11px] text-white/45">
              <span className="truncate">{l.name}</span>
              <span className="shrink-0 font-mono text-white/55">
                {(l.sizeBytes / 1024 ** 3).toFixed(1)} GB
                {l.sizeVramBytes === 0 && ' (system RAM)'}
              </span>
            </div>
          ))}
          <p className="mt-2 text-[10px] leading-relaxed text-white/30">
            Local models run on your RAM, and on a computer without a dedicated GPU they will use a lot of it
            while they answer. Infinite OS no longer loads any model at startup — this is memory in use only
            because a local model has actually been used recently.
          </p>
        </div>
      )}
    </div>
  );
}

export default LocalModelPanel;