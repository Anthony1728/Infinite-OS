/**
 * Pushes the user's provider/model/cwd selection into the main-process
 * settings store so background consumers (WhatsApp and Telegram turns,
 * scheduled agent runs) answer on the SELECTED model instead of a silent
 * local fallback that hogs the machine.
 *
 * Fire-and-forget by design: sync must never break the Settings UI, so every
 * failure is swallowed. Call it from every place that persists a provider or
 * model choice (Settings test-and-save, model pick, use-free flows) plus once
 * at app startup to backfill selections saved before this sync existed.
 */
export function syncActiveModelToMain(selection: {
  provider?: unknown;
  model?: unknown;
  cwd?: unknown;
}): void {
  try {
    const api = (
      window as unknown as {
        api?: {
          setSetting?: (args: { scope: 'user' | 'project' | 'local'; key: string; value: unknown; cwd: string }) => Promise<unknown>;
        };
      }
    ).api;
    if (typeof api?.setSetting !== 'function') return;
    const cwd = typeof selection.cwd === 'string' && selection.cwd ? selection.cwd : '.';
    const jobs: Promise<unknown>[] = [];
    if (typeof selection.provider === 'string' && selection.provider) {
      jobs.push(api.setSetting({ scope: 'user', key: 'provider', value: selection.provider, cwd }));
    }
    if (typeof selection.model === 'string' && selection.model) {
      jobs.push(api.setSetting({ scope: 'user', key: 'model', value: selection.model, cwd }));
    }
    if (typeof selection.cwd === 'string' && selection.cwd) {
      jobs.push(api.setSetting({ scope: 'user', key: 'cwd', value: selection.cwd, cwd }));
    }
    if (jobs.length > 0) void Promise.all(jobs).catch(() => undefined);
  } catch {
    /* sync must never break the UI */
  }
}
