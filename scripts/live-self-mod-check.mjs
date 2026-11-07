#!/usr/bin/env node
// Live self-modification proof: agent edit -> BuildFeature -> rebuild ->
// relaunch -> resume on the SAME session.
//
// This is the end-to-end check nothing else can fake. It drives the real
// Electron window (real composer, real approval dialog), waits for the app to
// rebuild itself and restart, then reads the session transcript and run markers
// from disk to prove the interrupted run continued in the new process.
//
// Requires:
//   - `npm run build` first (out/main/index.js must exist)
//   - a signed-in profile whose user is the owner (self-modification guard)
//   - a provider/model that can call tools (default: the active settings)
//
// Usage: node scripts/live-self-mod-check.mjs [--model opencode::glm-5.3-flash-free]

import { _electron as electron } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mainEntry = join(root, 'out', 'main', 'index.js');
const artifacts = join(root, 'test-results', 'live-self-mod');
const argValue = (flag) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
};
const provider = argValue('--provider') ?? process.env.INFINITE_LIVE_PROVIDER ?? 'openrouter';
const model = argValue('--model') ?? process.env.INFINITE_LIVE_MODEL ?? 'cohere/north-mini-code:free';
const TARGET = 'docs/LIVE-SELF-MODIFICATION.md';
const TARGET_CONTENT = [
  '# Live self-modification check',
  '',
  'Written by the Infinite OS agent during a live rebuild + relaunch + resume verification.',
  '',
].join('\n');

const startedAt = Date.now();
const report = {
  startedAt: new Date(startedAt).toISOString(),
  provider,
  model,
  phases: [],
  queue: null,
  relaunchedPid: null,
  resumed: false,
  completed: false,
  targetWritten: false,
  transcript: [],
};

function log(phase, detail) {
  const line = { at: new Date().toISOString(), phase, ...(detail ?? {}) };
  report.phases.push(line);
  console.log(`[live-self-mod] ${phase}${detail ? ' ' + JSON.stringify(detail) : ''}`);
}

function fail(message) {
  console.error(`[live-self-mod] FAILED: ${message}`);
  writeReport();
  process.exit(1);
}

function writeReport() {
  try {
    mkdirSync(artifacts, { recursive: true });
    report.finishedAt = new Date().toISOString();
    report.durationMs = Date.now() - startedAt;
    const path = join(artifacts, 'report.json');
    writeFileSync(path, JSON.stringify(report, null, 2));
    console.log(`[live-self-mod] report: ${path}`);
  } catch (error) {
    console.error('[live-self-mod] could not write report:', error.message);
  }
}

/** infiniteHome(), mirrored: active profile wins, else the legacy root. */
function activeHome() {
  const base = join(homedir(), '.infinite-ai');
  try {
    const active = JSON.parse(readFileSync(join(base, 'active-profile.json'), 'utf8'));
    if (typeof active.uid === 'string' && active.uid.trim()) {
      return join(base, 'profiles', active.uid.replace(/[^a-zA-Z0-9-_]/g, '').slice(0, 64));
    }
  } catch {
    /* no profile: legacy single-user path */
  }
  return base;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function sessionMessages(path) {
  let raw = '';
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  const messages = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      messages.push(JSON.parse(line));
    } catch {
      // Last line may be mid-append; skip it and read again next poll.
    }
  }
  return messages;
}

function textOf(message) {
  return (message?.content ?? [])
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

function toolNames(messages) {
  const names = [];
  for (const message of messages) {
    for (const block of message?.content ?? []) {
      if (block?.type === 'tool_use' && block.name) names.push(block.name);
    }
  }
  return names;
}

async function waitFor(label, predicate, timeoutMs, intervalMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((done) => setTimeout(done, intervalMs));
  }
  fail(`timed out waiting for ${label} (${timeoutMs}ms)`);
}

/** New Electron process (the relaunch) started after the original exited. */
function relaunchedElectronPid(afterMs) {
  try {
    const script =
      "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | " +
      'Select-Object ProcessId,CreationDate,CommandLine | ConvertTo-Json -Compress';
    const raw = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
      encoding: 'utf8',
      timeout: 20_000,
    }).trim();
    if (!raw) return null;
    const rows = JSON.parse(raw);
    const list = Array.isArray(rows) ? rows : [rows];
    const match = list.find((row) => {
      const created = Date.parse(String(row.CreationDate ?? ''));
      return Number.isFinite(created) && created >= afterMs - 5_000 && /out[\\/]main[\\/]index\.js/.test(String(row.CommandLine ?? ''));
    });
    return match ? Number(match.ProcessId) : null;
  } catch {
    return null;
  }
}

async function main() {
  if (!existsSync(mainEntry)) fail('out/main/index.js missing — run `npm run build` first');
  mkdirSync(artifacts, { recursive: true });

  const home = activeHome();
  const sessionsDir = join(home, 'sessions');
  const resumeDir = join(home, 'resume');
  const queuePath = join(home, 'resume-queue.json');
  const queueBackupPath = `${queuePath}.bak`;
  mkdirSync(sessionsDir, { recursive: true });
  log('home', { home, provider, model, target: TARGET });

  // Preserve (do not delete) any pre-existing queue: this check must not throw
  // away a real interrupted run from an earlier session.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  for (const path of [queuePath, queueBackupPath]) {
    try {
      if (existsSync(path)) renameSync(path, `${path}.pre-live-check-${stamp}`);
    } catch {
      /* a live app may hold it; the relaunch will overwrite it */
    }
  }

  const sessionsBefore = new Set(readdirSync(sessionsDir).filter((name) => name.endsWith('.jsonl')));
  const userData = mkdtempSync(join(tmpdir(), 'infinite-live-selfmod-'));

  const app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${userData}`],
    env: { ...process.env, INFINITE_DISABLE_GPU: '1' },
    timeout: 120_000,
  });
  log('launched', { pid: app.process()?.pid ?? null });

  let page;
  try {
    page = await app.firstWindow({ timeout: 120_000 });
    await page.waitForFunction(() => Boolean(document.querySelector('[data-nav="studio"]')), undefined, {
      timeout: 120_000,
    });

    // Point the run at the requested model through the same localStorage +
    // settings contract the composer uses.
    await page.evaluate(async ({ selectedProvider, selectedModel }) => {
      const current = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
      current.provider = selectedProvider;
      current.model = selectedModel;
      localStorage.setItem('infinite:current', JSON.stringify(current));
      window.dispatchEvent(new Event('storage'));
      const api = window.api;
      await api?.setSetting?.({ scope: 'user', key: 'provider', value: selectedProvider, cwd: current.cwd ?? '.' });
      await api?.setSetting?.({ scope: 'user', key: 'model', value: selectedModel, cwd: current.cwd ?? '.' });
    }, { selectedProvider: provider, selectedModel: model });

    const newChat = page.getByRole('button', { name: /New Chat/i }).first();
    if (await newChat.isVisible().catch(() => false)) await newChat.click();
    const composer = page.locator('textarea[aria-label="Message Infinite OS"]');
    await composer.waitFor({ state: 'visible', timeout: 90_000 });

    const prompt = [
      'Modify Infinite OS itself now. Call the BuildFeature tool exactly once, immediately — do not use Write or Edit, do not run npm commands yourself, and do not inspect the repo first.',
      'BuildFeature arguments:',
      '  name: "Live self-modification check"',
      '  description: "Prove agent edit -> rebuild -> relaunch -> resume"',
      `  changes: [{ "path": "${TARGET}", "content": ${JSON.stringify(TARGET_CONTENT)} }]`,
      '  validation: "typecheck"',
      'The app will rebuild and restart while BuildFeature runs. If it restarts, do not repeat the build: verify the file exists and finish.',
    ].join('\n');

    await composer.fill(prompt);
    log('sending');
    await composer.press('Enter');

    // Watch for the approval dialog, the build, and the persisted queue that is
    // written immediately before the app exits.
    let allowClicks = 0;
    let screenshotTaken = false;
    let queue = null;
    const queueDeadline = Date.now() + 20 * 60_000;
    while (Date.now() < queueDeadline) {
      const allow = page.getByRole('button', { name: 'Allow once' });
      if (await allow.isVisible().catch(() => false)) {
        if (!screenshotTaken) {
          await page.screenshot({ path: join(artifacts, '01-approval.png') }).catch(() => {});
          screenshotTaken = true;
        }
        await allow.click().catch(() => {});
        allowClicks += 1;
        log('approved-once', { allowClicks });
      }

      queue = readJson(queuePath);
      if (queue && Array.isArray(queue.entries) && queue.entries.length > 0) break;

      // The window can disappear the moment the rebuild finishes.
      if ((app.process()?.exitCode ?? null) !== null) break;
      await page.waitForTimeout(500).catch(() => {});
    }
    report.queue = queue;
    if (!queue || !Array.isArray(queue.entries) || queue.entries.length === 0) {
      await page.screenshot({ path: join(artifacts, 'failed-no-queue.png') }).catch(() => {});
      fail('the resume queue was never written — BuildFeature did not reach the relaunch');
    }
    log('resume-queue-written', {
      entries: queue.entries.length,
      sessionId: queue.entries[0].sessionId,
      request: String(queue.entries[0].request ?? '').slice(0, 120),
    });
    await page.screenshot({ path: join(artifacts, '02-rebuild.png') }).catch(() => {});

    const sessionId = queue.entries[0].sessionId;
    const sessionPath = join(sessionsDir, `${sessionId}.jsonl`);
    const markerPath = join(resumeDir, `${sessionId}.json`);

    // Wait for the original process to exit (app.exit(0) after app.relaunch).
    const child = app.process();
    if (child && child.exitCode === null) {
      await Promise.race([
        new Promise((done) => child.once('exit', done)),
        new Promise((done) => setTimeout(done, 60_000)),
      ]);
    }
    const exitAt = Date.now();
    log('original-exited', { exitCode: child?.exitCode ?? null });

    // The relaunched process is spawned by Electron, not Playwright. Prove it
    // exists, then prove the queue was consumed and the transcript continued.
    const pid = await waitFor('relaunched electron process', async () => relaunchedElectronPid(exitAt), 90_000, 1500);
    report.relaunchedPid = pid;
    log('relaunched-process', { pid });

    await waitFor('resume queue consumption', async () => !existsSync(queuePath) && existsSync(queueBackupPath), 90_000, 1000);
    log('resume-queue-consumed', { backup: queueBackupPath });

    const completed = await waitFor('resumed run completion', async () => {
      const messages = sessionMessages(sessionPath);
      const resumeIndex = messages.findIndex(
        (message) => message.role === 'user' && textOf(message).includes('[Resumed after restart]'),
      );
      if (resumeIndex < 0) return null;
      const after = messages.slice(resumeIndex + 1);
      const assistant = [...after].reverse().find((message) => message.role === 'assistant' && textOf(message).trim());
      // clearRunMarker runs only when the continuation returned normally, so
      // a missing marker plus a post-resume assistant message is completion.
      if (!assistant) return null;
      if (existsSync(markerPath)) return null;
      return { messages, resumeIndex, assistant };
    }, 20 * 60_000, 1500);

    report.resumed = true;
    report.completed = true;
    report.transcript = {
      totalMessages: completed.messages.length,
      resumeIndex: completed.resumeIndex,
      tools: toolNames(completed.messages),
      finalAssistant: textOf(completed.assistant).slice(0, 4000),
    };
    log('resumed-run-complete', {
      totalMessages: completed.messages.length,
      tools: [...new Set(report.transcript.tools)].join(','),
    });

    report.targetWritten = existsSync(join(root, TARGET)) && readFileSync(join(root, TARGET), 'utf8').trim() === TARGET_CONTENT.trim();
    if (!report.targetWritten) fail(`${TARGET} is missing or has unexpected content`);

    // The transcript must show BuildFeature started before the restart, and the
    // resumed turn must NOT have run another build.
    const tools = report.transcript.tools;
    if (!tools.includes('BuildFeature')) fail('the transcript has no BuildFeature call');
    const afterResume = completed.messages.slice(completed.resumeIndex);
    const buildCallsAfterResume = toolNames(afterResume).filter((name) => name === 'BuildFeature').length;
    if (buildCallsAfterResume > 0) fail('the resumed run called BuildFeature again instead of verifying');

    const queueBackup = readJson(queueBackupPath);
    log('proof', {
      buildCallsBeforeResume: toolNames(completed.messages.slice(0, completed.resumeIndex)).filter((n) => n === 'BuildFeature').length,
      buildCallsAfterResume,
      queueEntries: queueBackup?.entries?.length ?? null,
      targetWritten: report.targetWritten,
      relaunchedPid: pid,
    });

    await page.close().catch(() => {});
    writeReport();
    console.log('[live-self-mod] PASS: rebuild -> relaunch -> resume verified');
    process.exit(0);
  } catch (error) {
    writeReport();
    console.error('[live-self-mod] ERROR:', error);
    process.exit(1);
  } finally {
    await app.close().catch(() => {});
  }
}

main();
