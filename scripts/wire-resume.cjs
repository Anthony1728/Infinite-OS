// One-shot wiring script: patches src/main/ipc/index.ts with the
// survive-the-reload resume system. Run: node scripts/wire-resume.cjs
const fs = require('fs');
const p = 'src/main/ipc/index.ts';
let s = fs.readFileSync(p, 'utf8');
const NL = '\r\n';
let failures = [];

function mustInclude(needle, label) {
  if (!s.includes(needle)) failures.push(label);
}

// 1. Import the queue module.
const impAnchor = "import { markRunStarted, clearRunMarker, findInterruptedRuns } from '../agent/resume.js';";
mustInclude(impAnchor, 'import anchor');
s = s.replace(impAnchor, impAnchor + NL +
  "import { writeResumeQueue, consumeResumeQueue, type ResumeEntry } from '../agent/resume-queue.js';");

// 2. runMeta map next to activeRuns.
const arAnchor = 'const activeRuns = new Map<string, AbortController>();';
mustInclude(arAnchor, 'activeRuns anchor');
s = s.replace(arAnchor, arAnchor + NL +
  '// Live-run identity for survive-the-reload: snapshotted to a queue file' + NL +
  '// before any relaunch so interrupted runs can be auto-continued.' + NL +
  'const runMeta = new Map<string, { provider: string; model: string; cwd: string; request: string; background: boolean }>();');

// 3. Set runMeta in CHAT_SEND (anchor on the single set line — line endings vary).
const setAnchor = '    activeRuns.set(sessionId, controller);';
mustInclude(setAnchor, 'set anchor');
s = s.replace(setAnchor, setAnchor + NL +
  '    runMeta.set(sessionId, { provider, model, cwd, request: messageTextOf(message), background: Boolean(background) });');

// 4. Clear runMeta wherever the controller is dropped.
s = s.split('if (activeRuns.get(sessionId) === controller) activeRuns.delete(sessionId);').join(
  'if (activeRuns.get(sessionId) === controller) activeRuns.delete(sessionId);' + NL + '    runMeta.delete(sessionId);'
);
// SESSION_DELETE path deletes without the guard:
s = s.split('    activeRuns.get(sessionId)?.abort();' + NL + '    activeRuns.delete(sessionId);').join(
  '    activeRuns.get(sessionId)?.abort();' + NL + '    runMeta.delete(sessionId);' + NL + '    activeRuns.delete(sessionId);'
);

// 5. Snapshot + resume functions before registerIpc.
const regAnchor = 'export function registerIpc(getMainWindow: () => BrowserWindow | null): void {';
mustInclude(regAnchor, 'registerIpc anchor');
const fns = [
  '/** Snapshot every live run so a relaunch can continue them (survive-reload). */',
  'export function snapshotActiveRunsForResume(): void {',
  '  const entries: ResumeEntry[] = [];',
  '  for (const [sessionId, meta] of runMeta) {',
  '    entries.push({ sessionId, request: meta.request, provider: meta.provider, model: meta.model, cwd: meta.cwd, background: meta.background, savedAt: Date.now() });',
  '  }',
  '  writeResumeQueue(entries);',
  '}',
  '',
  '/** Broadcast a chat-stream event to every open window. */',
  'function broadcastChatEvent(payload: Record<string, unknown>): void {',
  '  try {',
  "    const { BrowserWindow } = require('electron') as typeof import('electron');",
  '    for (const win of BrowserWindow.getAllWindows()) {',
  '      try { win.webContents.send(IPC.CHAT_STREAM_EVENT, payload); } catch { /* window dying */ }',
  '    }',
  '  } catch {',
  '    /* headless/tests — events dropped, messages still persist */',
  '  }',
  '}',
  '',
  '/**',
  ' * Continue every run the last relaunch cut off.',
  ' *',
  ' * Each queued entry re-runs the agent on its ORIGINAL session with a',
  ' * continuation directive: the transcript (persisted per-message) is already',
  ' * in the conversation, so the agent verifies current state and finishes the',
  ' * task instead of the work dying with the process.',
  ' */',
  'async function resumeInterruptedRuns(): Promise<void> {',
  '  const entries = consumeResumeQueue((sessionId) => Boolean(sessionStore.loadSessionMeta(sessionId).catch(() => null)));',
  '  if (entries.length === 0) return;',
  "  console.log('[resume] continuing ' + entries.length + ' interrupted run(s) after restart');",
  '  for (const entry of entries) {',
  '    void (async () => {',
  '      const controller = new AbortController();',
  '      activeRuns.set(entry.sessionId, controller);',
  '      runMeta.set(entry.sessionId, { provider: entry.provider, model: entry.model, cwd: entry.cwd, request: entry.request, background: entry.background });',
  '      markRunStarted(entry.sessionId, entry.request);',
  '      try {',
  '        const note: Message = {',
  '          id: uuid(),',
  "          role: 'user',",
  "          content: [{ type: 'text', text: '[Resumed after restart] The app restarted while this task was running. The transcript above is the work already completed - verify current state (files may already exist), then continue and finish: ' + entry.request }],",
  '          timestamp: Date.now(),',
  '        };',
  '        await sessionStore.appendMessage(entry.sessionId, note);',
  "        broadcastChatEvent({ sessionId: entry.sessionId, type: 'provider_status', status: 'resuming', detail: 'Resuming interrupted task after restart...' });",
  '        const history = await sessionStore.loadMessages(entry.sessionId);',
  '        const historyBefore = history.slice(0, -1);',
  '        if (entry.background) startBackgroundTask(entry.sessionId, entry.request.slice(0, 80));',
  '        const completed = await runAgent(historyBefore, note, {',
  '          sessionId: entry.sessionId,',
  '          cwd: entry.cwd,',
  '          provider: entry.provider,',
  '          model: entry.model,',
  '          signal: controller.signal,',
  '          onEvent: (ev) => broadcastChatEvent({ sessionId: entry.sessionId, ...ev }),',
  '          onMessage: async (produced) => {',
  '            if (discardedRuns.has(entry.sessionId)) return;',
  '            await sessionStore.appendMessage(entry.sessionId, produced);',
  '            markRunStarted(entry.sessionId, entry.request);',
  '          },',
  '        });',
  '        clearRunMarker(entry.sessionId);',
  '        if (entry.background) {',
  "          const lastAssistant = [...completed].reverse().find((m) => m.role === 'assistant');",
  "          const summary = lastAssistant ? lastAssistant.content.filter((c) => c.type === 'text').map((c) => (c as { text?: string }).text ?? '').join(' ') : '';",
  "          finishBackgroundTask(entry.sessionId, 'completed', summary);",
  '        }',
  '      } catch (err) {',
  '        clearRunMarker(entry.sessionId);',
  "        console.warn('[resume] continuation failed:', (err as Error).message);",
  "        finishBackgroundTask(entry.sessionId, 'failed', (err as Error).message);",
  '      } finally {',
  '        if (activeRuns.get(entry.sessionId) === controller) activeRuns.delete(entry.sessionId);',
  '        runMeta.delete(entry.sessionId);',
  '      }',
  '    })();',
  '  }',
  '}',
].join(NL);
s = s.replace(regAnchor, fns + NL + NL + regAnchor);

// 6. Kick resume once IPC is registered.
const authRegAnchor = '  registerAuthIpc();';
mustInclude(authRegAnchor, 'registerAuthIpc anchor');
s = s.replace(authRegAnchor, authRegAnchor + NL +
  '  // Survive-the-reload: continue runs the last relaunch interrupted.' + NL +
  "  setTimeout(() => { void resumeInterruptedRuns().catch((e) => console.warn('[resume] failed:', (e as Error).message)); }, 5_000);");

// 7. SELF_APPLY_RUN: snapshot before relaunch (anchor on the single inner line — line endings vary).
const relaunchOld = '        app.relaunch();';
mustInclude(relaunchOld, 'relaunch anchor');
s = s.replace(relaunchOld, '        snapshotActiveRunsForResume();' + NL + '        app.relaunch();');

if (failures.length) {
  console.error('FAILED ANCHORS: ' + failures.join(' | '));
  process.exit(1);
}
fs.writeFileSync(p, s);
console.log('RESUME WIRED OK');
