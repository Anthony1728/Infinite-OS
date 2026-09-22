/**
 * Active-model resolution — the single source of truth for "which provider /
 * model should answer right now" for every background consumer (WhatsApp and
 * Telegram turns, scheduled agent_run steps).
 *
 * The desktop chat passes provider+model explicitly with each turn, but
 * background paths have no renderer in the loop — they must read the user's
 * saved selection from the main settings store (synced there by the Settings
 * UI; see renderer/utils/active-model-sync.ts). There is deliberately NO
 * silent fallback to a local model: spinning up Ollama unasked slows the
 * user's machine and answers on a model they never picked. When nothing is
 * selected, callers fail fast with an actionable message instead.
 */

export type SettingsGetter = <T = unknown>(key: string) => T | undefined;

export interface ActiveModel {
  provider: string;
  model: string;
  cwd: string;
}

/**
 * Injectable agent runner (real runAgent by default; stubbed in tests).
 * `never[]` keeps the seam free of the agent graph's Message types.
 */
export type AgentRunner = (
  history: never[],
  userMessage: never,
  opts: {
    sessionId: string;
    cwd: string;
    provider: string;
    model: string;
    signal: AbortSignal;
    onEvent: (e: unknown) => Promise<void>;
  },
) => Promise<never[]>;

export class NoActiveModelError extends Error {
  constructor() {
    super(
      'No AI provider selected in Infinite OS. Pick one in Settings → AI Provider ' +
        '(a free option like OpenCode Free or NVIDIA works), then send your message again.',
    );
    this.name = 'NoActiveModelError';
  }
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Resolve the saved selection. Throws NoActiveModelError when provider or
 * model is missing so background runs never silently fall back to Ollama.
 */
export function resolveActiveModel(get: SettingsGetter): ActiveModel {
  const provider = clean(get<string>('provider'));
  const model = clean(get<string>('model'));
  if (!provider || !model) throw new NoActiveModelError();
  const cwd = clean(get<string>('cwd')) || process.cwd();
  return { provider, model, cwd };
}
