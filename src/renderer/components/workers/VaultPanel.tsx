import { useEffect, useState } from 'react';
import { useWorkersStore, type VaultEntry } from '../../stores/workers';
import { useNotificationStore } from '../../stores/notifications';

interface VaultForm {
  label: string;
  username: string;
  secret: string;
}

const EMPTY_FORM: VaultForm = { label: '', username: '', secret: '' };

export function VaultPanel() {
  const { workers, vaultAvailable, vaultCipher, vaultEntries, refreshVault } = useWorkersStore();
  const addToast = useNotificationStore((s) => s.addToast);
  const [form, setForm] = useState<VaultForm>(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);

  useEffect(() => { void refreshVault(); }, [refreshVault]);

  const guard = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    try {
      await action();
    } catch (error) {
      addToast({ type: 'error', title: 'Vault action failed', message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  };

  const addEntry = () =>
    guard('add', async () => {
      if (!form.label.trim() || !form.secret) {
        addToast({ type: 'error', title: 'Label and password are required' });
        return;
      }
      await window.api.vaultAdd({
        label: form.label.trim(),
        username: form.username.trim(),
        secret: form.secret,
        workerIds: [],
      });
      setForm(EMPTY_FORM);
      setShowForm(false);
      await refreshVault();
      addToast({ type: 'success', title: 'Credential saved', message: 'Now authorize the workers that may use it.' });
    });

  const setWorkers = (entry: VaultEntry, workerIds: string[]) =>
    guard(`auth:${entry.id}`, async () => {
      await window.api.vaultAuthorize({ entryId: entry.id, workerIds });
      await refreshVault();
      addToast({
        type: 'success',
        title: workerIds.length ? `“${entry.label}” authorized to ${workerIds.length} worker(s)` : `“${entry.label}” authorization cleared`,
      });
    });

  const removeEntry = (entry: VaultEntry) =>
    guard(`del:${entry.id}`, async () => {
      await window.api.vaultDelete({ entryId: entry.id });
      await refreshVault();
      addToast({ type: 'success', title: `“${entry.label}” deleted` });
    });

  return (
    <div className="flex flex-col gap-4 min-h-0 flex-1 overflow-y-auto pr-1">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-white">Vault</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Saved passwords live encrypted on this PC ({vaultCipher}). Each credential is unlocked per worker — a worker
            can only type the passwords you authorize to it, and the secret is never shown in chat or logs.
          </p>
        </div>
        <button
          onClick={() => setShowForm((value) => !value)}
          className="text-sm px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white font-medium transition-colors"
        >
          {showForm ? 'Close' : 'Add credential'}
        </button>
      </div>

      {!vaultAvailable && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-500/[0.07] px-4 py-3 text-sm text-amber-200">
          The OS keystore is unavailable in this build — credentials can&apos;t be stored safely, so the vault is closed.
        </div>
      )}

      {showForm && (
        <div className="rounded-xl border border-indigo-400/30 bg-indigo-500/[0.06] p-4 grid md:grid-cols-3 gap-3">
          <label className="block">
            <span className="text-xs text-gray-400">Label (site or app)</span>
            <input
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="Acme portal"
              className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/25"
            />
          </label>
          <label className="block">
            <span className="text-xs text-gray-400">Username</span>
            <input
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder="you@example.com"
              className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/25"
            />
          </label>
          <label className="block">
            <span className="text-xs text-gray-400">Password</span>
            <input
              type="password"
              value={form.secret}
              onChange={(e) => setForm({ ...form, secret: e.target.value })}
              placeholder="••••••••"
              className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/25"
            />
          </label>
          <div className="md:col-span-3 flex justify-end">
            <button
              onClick={() => void addEntry()}
              disabled={busy === 'add' || !vaultAvailable}
              className="text-sm px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white font-medium disabled:opacity-50"
            >
              {busy === 'add' ? 'Saving…' : 'Save credential'}
            </button>
          </div>
        </div>
      )}

      {!vaultEntries.length ? (
        <div className="rounded-xl border border-dashed border-white/15 p-8 text-center">
          <div className="text-3xl mb-2">🔐</div>
          <div className="text-white font-medium">No credentials saved yet</div>
          <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">
            Add the passwords workers need to sign in, then tick which workers may use each one. Workers type the
            password into the login field on your behalf — they never read it back.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {vaultEntries.map((entry) => (
            <div key={entry.id} className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-sm font-medium text-white">{entry.label}</div>
                  <div className="text-xs text-gray-500 flex items-center gap-2 mt-0.5">
                    <span>{entry.username || '— no username —'}</span>
                    <button
                      onClick={() => setRevealed(revealed === entry.id ? null : entry.id)}
                      className="text-[11px] px-1.5 py-0.5 rounded border border-white/10 text-gray-400 hover:bg-white/10"
                    >
                      {revealed === entry.id ? 'Hide' : 'Status'}
                    </button>
                    <span className="text-gray-600">{revealed === entry.id ? `encrypted · ${entry.cipher}` : ''}</span>
                  </div>
                </div>
                <button
                  onClick={() => void removeEntry(entry)}
                  disabled={busy === `del:${entry.id}`}
                  className="text-xs px-3 py-1.5 rounded-lg text-gray-500 hover:text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"
                >
                  Delete
                </button>
              </div>

              <div className="mt-3">
                <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1.5">Workers allowed to use it</div>
                {workers.length === 0 && (
                  <div className="text-xs text-gray-600">Create a worker first — authorization is per worker.</div>
                )}
                <div className="flex flex-wrap gap-2">
                  {workers.map((worker) => {
                    const allowed = entry.workerIds.includes(worker.id);
                    return (
                      <label
                        key={worker.id}
                        className={`text-xs px-2.5 py-1.5 rounded-lg border cursor-pointer flex items-center gap-1.5 transition-colors ${
                          allowed
                            ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200'
                            : 'border-white/10 bg-white/[0.03] text-gray-400 hover:bg-white/[0.06]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={allowed}
                          disabled={busy === `auth:${entry.id}`}
                          onChange={(event) => {
                            const next = event.target.checked
                              ? [...entry.workerIds, worker.id]
                              : entry.workerIds.filter((id) => id !== worker.id);
                            void setWorkers(entry, next);
                          }}
                          className="accent-emerald-500"
                        />
                        {worker.name}
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-[11px] text-gray-500 space-y-1">
        <div>• Stored with the OS keystore (DPAPI) — not readable by other apps or users.</div>
        <div>• A worker&apos;s run only sees credentials you ticked for it, via the WorkerVault tool.</div>
        <div>• Passwords are typed as keystrokes; they never appear in transcripts, results, or the action log.</div>
      </div>
    </div>
  );
}
