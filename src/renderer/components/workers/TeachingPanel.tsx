import { useEffect, useRef, useState } from 'react';
import { useWorkersStore, type TeachingView } from '../../stores/workers';
import { useNotificationStore } from '../../stores/notifications';

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

interface SpeechResultItem {
  0?: { transcript?: string };
  isFinal?: boolean;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: { results: ArrayLike<SpeechResultItem> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  const scope = window as unknown as Record<string, unknown>;
  const ctor = (scope.SpeechRecognition ?? scope.webkitSpeechRecognition) as (new () => SpeechRecognitionLike) | undefined;
  return typeof ctor === 'function' ? ctor : null;
}

export function TeachingPanel({ onCreated }: { onCreated: () => void }) {
  const { recordings, activeRecording, refreshTeach } = useWorkersStore();
  const addToast = useNotificationStore((s) => s.addToast);
  const [name, setName] = useState('');
  const [narration, setNarration] = useState('');
  const [review, setReview] = useState<TeachingView | null>(null);
  // Bumped when the step list must be rebuilt from the recording (recompile).
  const [reviewRevision, setReviewRevision] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [dictating, setDictating] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [workerName, setWorkerName] = useState('');
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const processedResultsRef = useRef(0);

  // Tick while recording so the elapsed clock stays honest.
  useEffect(() => {
    if (!activeRecording) return;
    const timer = window.setInterval(() => setElapsed(Date.now() - activeRecording.startedAt), 1000);
    setElapsed(Date.now() - activeRecording.startedAt);
    return () => window.clearInterval(timer);
  }, [activeRecording]);

  const guard = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    try {
      await action();
    } catch (error) {
      addToast({ type: 'error', title: 'Teaching mode', message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  };

  const startRecording = () =>
    guard('start', async () => {
      const view = await window.api.teachStart({ name: name.trim() || undefined }) as TeachingView;
      setReview(null);
      setNarration('');
      setDictating(false);
      await refreshTeach();
      addToast({
        type: 'success',
        title: 'Recording started',
        message: `Demonstrate the task in another window, narrating as you go (${view.id.slice(0, 8)}).`,
      });
    });

  const stopRecording = () =>
    guard('stop', async () => {
      if (!activeRecording) return;
      stopDictation();
      const view = await window.api.teachStop({ recordingId: activeRecording.id }) as TeachingView;
      await refreshTeach();
      setReview(view);
      setWorkerName(view.name);
      addToast({ type: 'success', title: 'Demo compiled', message: `${view.compiledSteps.length} editable steps generated.` });
    });

  const sendNarration = () =>
    guard('narrate', async () => {
      if (!activeRecording || !narration.trim()) return;
      await window.api.teachNarrate({ recordingId: activeRecording.id, text: narration.trim() });
      setNarration('');
      await refreshTeach();
    });

  const startDictation = () => {
    const Ctor = getSpeechRecognition();
    if (!Ctor || !activeRecording) {
      addToast({ type: 'warning', title: 'Dictation unavailable', message: 'This system has no Web Speech API — type your narration instead.' });
      return;
    }
    try {
      const recognition = new Ctor();
      recognition.lang = navigator.language || 'en-US';
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.onresult = (event) => {
        // Continuous recognition returns the cumulative list each event — only
        // narrate entries we have not already sent.
        for (let i = processedResultsRef.current; i < event.results.length; i++) {
          const result = event.results[i];
          const text = result[0]?.transcript ?? '';
          if (result.isFinal !== false && text.trim()) {
            void window.api.teachNarrate({ recordingId: activeRecording.id, text: text.trim() }).catch(() => { /* keep dictating */ });
          }
        }
        processedResultsRef.current = event.results.length;
      };
      recognition.onerror = () => { /* fall back to typed narration */ };
      recognition.onend = () => { setDictating(false); };
      recognition.start();
      recognitionRef.current = recognition;
      processedResultsRef.current = 0;
      setDictating(true);
    } catch {
      addToast({ type: 'warning', title: 'Dictation could not start' });
    }
  };

  const stopDictation = () => {
    try { recognitionRef.current?.stop(); } catch { /* already stopped */ }
    recognitionRef.current = null;
    setDictating(false);
  };

  const saveSteps = (view: TeachingView, steps: { title: string; instruction: string; referenceFrame?: string }[]) =>
    guard('save-steps', async () => {
      const updated = await window.api.teachUpdateSteps({ recordingId: view.id, steps }) as TeachingView;
      setReview(updated);
      await refreshTeach();
      addToast({ type: 'success', title: 'Steps saved' });
    });

  const createWorker = (view: TeachingView) =>
    guard('create-worker', async () => {
      const worker = await window.api.teachCreateWorker({
        recordingId: view.id,
        name: workerName.trim() || view.name,
      }) as { id: string; name: string };
      addToast({ type: 'success', title: 'Worker created', message: `“${worker.name}” is ready to run.` });
      onCreated();
    });

  /** Open a saved demo's review, refreshing from main so the copy is current. */
  const openRecording = (recording: TeachingView) => {
    setReview(recording);
    setWorkerName(recording.name);
    void window.api.teachGet({ recordingId: recording.id })
      .then((fresh: unknown) => {
        const view = fresh as TeachingView | null;
        if (view && view.id === recording.id) setReview(view);
      })
      .catch(() => { /* the list copy is good enough */ });
  };

  const renameRecording = (view: TeachingView, name: string) =>
    guard('rename', async () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error('A demo needs a name.');
      const updated = await window.api.teachRename({ recordingId: view.id, name: trimmed }) as TeachingView;
      setReview(updated);
      await refreshTeach();
      addToast({ type: 'success', title: 'Demo renamed', message: `Now called “${trimmed}”.` });
    });

  /** Throw away manual edits and rebuild the step list from the recording. */
  const recompile = (view: TeachingView) =>
    guard('recompile', async () => {
      const updated = await window.api.teachCompile({ recordingId: view.id }) as TeachingView;
      setReview(updated);
      setReviewRevision((value) => value + 1);
      await refreshTeach();
      addToast({
        type: 'success',
        title: 'Steps regenerated',
        message: `${updated.compiledSteps.length} step(s) compiled from the demo.`,
      });
    });

  const deleteRecording = (id: string) =>
    guard('delete-recording', async () => {
      await window.api.teachDelete({ recordingId: id });
      if (review?.id === id) setReview(null);
      await refreshTeach();
      addToast({ type: 'success', title: 'Recording deleted' });
    });

  const reviewed = review ?? (activeRecording && activeRecording.status === 'stopped' ? activeRecording : null);

  return (
    <div className="flex flex-col gap-4 min-h-0 flex-1 overflow-y-auto pr-1">
      <div>
        <h2 className="text-xl font-semibold text-white">Teaching mode</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Show it how you do the task. Window focus, clicks, screenshots, and your narration are recorded locally and
          compiled into editable steps — the same steps every time.
        </p>
      </div>

      {/* Recorder */}
      {!activeRecording ? (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-5 space-y-3">
          <div className="flex gap-3 items-end flex-wrap">
            <label className="block flex-1 min-w-[220px]">
              <span className="text-xs text-gray-400">Name this demonstration</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Weekly expense report"
                className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/25"
              />
            </label>
            <button
              onClick={() => void startRecording()}
              disabled={busy === 'start'}
              className="px-4 py-2 rounded-lg bg-rose-500 hover:bg-rose-400 text-white text-sm font-medium disabled:opacity-50"
            >
              ● {busy === 'start' ? 'Starting…' : 'Start recording'}
            </button>
          </div>
          <p className="text-xs text-gray-500">
            Records only while you record: focused window titles, mouse clicks, periodic screenshots, and anything you
            narrate. Nothing leaves this machine. Auto-stops after 30 minutes or 120 screenshots.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-rose-400/30 bg-rose-500/[0.06] p-5 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-400 animate-pulse" />
            <span className="text-sm font-medium text-white">Recording {activeRecording.name}</span>
            <span className="text-xs text-gray-400 font-mono">{formatDuration(elapsed)}</span>
            <span className="text-xs text-gray-400">{activeRecording.eventCount} events · {activeRecording.frameCount} screenshots</span>
            <div className="ml-auto flex gap-2">
              <button
                onClick={() => (dictating ? stopDictation() : startDictation())}
                className={`text-xs px-3 py-1.5 rounded-lg border ${dictating ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300' : 'bg-white/[0.06] border-white/10 text-gray-300'}`}
              >
                {dictating ? '● Dictating' : '🎙 Dictate'}
              </button>
              <button
                onClick={() => void stopRecording()}
                disabled={busy === 'stop'}
                className="text-xs px-3 py-1.5 rounded-lg bg-white/15 text-white border border-white/20 hover:bg-white/20 disabled:opacity-50"
              >
                ■ Stop & compile
              </button>
            </div>
          </div>

          <div className="flex gap-2 items-end">
            <label className="flex-1 block">
              <span className="text-xs text-gray-400">Narration — say what you&apos;re doing and why</span>
              <textarea
                value={narration}
                onChange={(e) => setNarration(e.target.value)}
                rows={2}
                placeholder="Open the expense portal, filter to last month, then export the CSV…"
                className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/25"
              />
            </label>
            <button
              onClick={() => void sendNarration()}
              disabled={!narration.trim() || busy === 'narrate'}
              className="px-3 py-2 rounded-lg bg-white/[0.08] text-gray-200 text-xs hover:bg-white/[0.12] disabled:opacity-40 mb-1"
            >
              Add
            </button>
          </div>
          {activeRecording.captureWarning && (
            <div className="text-xs text-amber-300/90">{activeRecording.captureWarning}</div>
          )}
        </div>
      )}

      {/* Recordings list */}
      {recordings.length > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-2">Recordings</div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {recordings.map((recording) => (
              <div
                key={recording.id}
                className={`rounded-xl border p-3 cursor-pointer transition-colors ${
                  reviewed?.id === recording.id ? 'border-indigo-400/40 bg-indigo-500/[0.08]' : 'border-white/[0.07] bg-white/[0.03] hover:bg-white/[0.05]'
                }`}
                onClick={() => openRecording(recording)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-white truncate">{recording.name}</span>
                  <span className={`text-[10px] uppercase ${recording.status === 'recording' ? 'text-rose-300' : 'text-gray-500'}`}>
                    {recording.status}
                  </span>
                </div>
                <div className="text-[11px] text-gray-500 mt-1">
                  {recording.stepCount} steps · {recording.frameCount} frames · {formatDuration(recording.durationMs)}
                </div>
                <div className="text-[11px] text-gray-600 mt-0.5">{new Date(recording.startedAt).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Review + compile */}
      {reviewed && (
        <CompiledReview
          key={`${reviewed.id}:${reviewRevision}`}
          recording={reviewed}
          busy={busy}
          workerName={workerName}
          setWorkerName={setWorkerName}
          onSaveSteps={(steps) => void saveSteps(reviewed, steps)}
          onCreate={() => void createWorker(reviewed)}
          onRename={(name) => void renameRecording(reviewed, name)}
          onRecompile={() => void recompile(reviewed)}
          onDelete={() => void deleteRecording(reviewed.id)}
        />
      )}
    </div>
  );
}

function CompiledReview(props: {
  recording: TeachingView;
  busy: string | null;
  workerName: string;
  setWorkerName: (value: string) => void;
  onSaveSteps: (steps: { title: string; instruction: string; referenceFrame?: string }[]) => void;
  onCreate: () => void;
  onRename: (name: string) => void;
  onRecompile: () => void;
  onDelete: () => void;
}) {
  const { recording, busy, workerName, setWorkerName } = props;
  const [steps, setSteps] = useState(recording.compiledSteps.map((step) => ({ ...step })));
  const [dirty, setDirty] = useState(false);
  const [renameValue, setRenameValue] = useState(recording.name);
  const [openStep, setOpenStep] = useState<string | null>(null);
  const [frame, setFrame] = useState<string | null>(null);

  useEffect(() => {
    setSteps(recording.compiledSteps.map((step) => ({ ...step })));
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-reading compiledSteps here would wipe unsaved edits
  }, [recording.id, recording.status]);

  useEffect(() => {
    let cancelled = false;
    setFrame(null);
    const target = steps.find((step) => step.id === openStep);
    if (!target?.referenceFrame) return;
    void window.api.teachFrame({ recordingId: recording.id, path: target.referenceFrame })
      .then((dataUrl: unknown) => { if (!cancelled && typeof dataUrl === 'string') setFrame(dataUrl); })
      .catch(() => { /* frame unavailable */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openStep, recording.id]);

  const update = (index: number, patch: Partial<(typeof steps)[number]>) => {
    setSteps((current) => current.map((step, i) => (i === index ? { ...step, ...patch } : step)));
    setDirty(true);
  };

  // Once the stored copy matches what is on screen (after a save), the edits
  // are no longer pending — live teaching events replace the recording object
  // constantly, so compare content rather than identity.
  useEffect(() => {
    const stored = recording.compiledSteps;
    const same = stored.length === steps.length
      && stored.every((step, index) => {
        const local = steps[index];
        return local
          && step.title === local.title
          && step.instruction === local.instruction
          && (step.referenceFrame ?? undefined) === (local.referenceFrame ?? undefined);
      });
    if (same) setDirty(false);
  }, [recording, steps]);

  return (
    <div className="rounded-xl border border-indigo-400/25 bg-indigo-500/[0.05] p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-gray-500">Review &amp; edit generated task</div>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              aria-label="Demo name"
              className="bg-transparent border-b border-white/10 focus:border-indigo-400 outline-none text-base text-white font-medium px-1 py-0.5 w-56"
            />
            {renameValue.trim() !== recording.name && (
              <button
                onClick={() => props.onRename(renameValue)}
                disabled={busy === 'rename' || !renameValue.trim()}
                className="text-xs px-2 py-1 rounded-lg border border-white/10 text-gray-300 hover:bg-white/10 disabled:opacity-50"
              >
                {busy === 'rename' ? 'Renaming…' : 'Rename demo'}
              </button>
            )}
          </div>
          <div className="text-xs text-gray-500">
            {steps.length} steps · recorded {new Date(recording.startedAt).toLocaleString()}
            {recording.captureWarning ? ` · ${recording.captureWarning}` : ''}
          </div>
        </div>
        <div className="flex gap-2 items-center">
          <button
            onClick={() => {
              if (dirty && !window.confirm('Discard your step edits and recompile from the demo?')) return;
              props.onRecompile();
            }}
            disabled={busy === 'recompile'}
            title="Rebuild the step list from the recorded clicks, windows and narration"
            className="text-xs px-3 py-1.5 rounded-lg bg-white/[0.06] text-gray-300 border border-white/10 hover:bg-white/10 disabled:opacity-50"
          >
            {busy === 'recompile' ? 'Recompiling…' : 'Reset to demo'}
          </button>
          <button onClick={props.onDelete} className="text-xs px-3 py-1.5 rounded-lg text-gray-500 hover:text-rose-300 hover:bg-rose-500/10">
            Delete
          </button>
          {dirty && (
            <button
              onClick={() => props.onSaveSteps(steps)}
              disabled={busy === 'save-steps'}
              className="text-xs px-3 py-1.5 rounded-lg bg-white/[0.08] text-gray-200 hover:bg-white/[0.12] disabled:opacity-50"
            >
              Save edits
            </button>
          )}
        </div>
      </div>

      <ol className="space-y-2">
        {steps.map((step, index) => {
          const open = openStep === step.id;
          return (
            <li key={step.id} className="rounded-lg border border-white/[0.07] bg-black/25">
              <button
                onClick={() => { setOpenStep(open ? null : step.id); if (open) setFrame(null); }}
                className="w-full text-left px-3 py-2 flex items-center gap-2"
              >
                <span className="text-[11px] text-gray-500 w-5">{index + 1}.</span>
                <span className="text-sm text-gray-200 flex-1 truncate">{step.title}</span>
                {step.referenceFrame && <span className="text-[10px] text-gray-500">📷</span>}
              </button>
              {open && (
                <div className="px-3 pb-3 space-y-2">
                  <input
                    value={step.title}
                    onChange={(e) => update(index, { title: e.target.value })}
                    className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white"
                  />
                  <textarea
                    value={step.instruction}
                    onChange={(e) => update(index, { instruction: e.target.value })}
                    rows={3}
                    className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-gray-300"
                  />
                  {step.referenceFrame && (
                    frame
                      ? <img src={frame} alt="Reference screenshot" className="rounded-lg border border-white/10 max-h-48 w-auto" />
                      : <div className="text-[11px] text-gray-600">Reference frame saved — loading preview…</div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <div className="flex items-center gap-2 flex-wrap border-t border-white/[0.07] pt-3">
        <label className="block flex-1 min-w-[200px]">
          <span className="text-xs text-gray-400">Worker name</span>
          <input
            value={workerName}
            onChange={(e) => setWorkerName(e.target.value)}
            className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
          />
        </label>
        <button
          onClick={props.onCreate}
          disabled={busy === 'create-worker' || !steps.length}
          className="px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-medium disabled:opacity-50"
        >
          {busy === 'create-worker' ? 'Creating…' : 'Create worker from this demo'}
        </button>
      </div>
      <p className="text-[11px] text-gray-500">
        The worker runs with a manual schedule by default — flip it to a schedule on the Workers tab once you&apos;re happy
        with the steps.
      </p>
    </div>
  );
}
