import { _electron as electron } from 'playwright-core';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packaged = process.argv.includes('--packaged');
const physical = process.argv.includes('--physical');
const liveModel = process.argv.includes('--live-model');
const localTools = process.argv.includes('--local-tools');
const notepad = process.argv.includes('--notepad');
const onlineLearning = process.argv.includes('--online-learning');
const errors = [];
let app;

try {
  app = await electron.launch(packaged
    ? { executablePath: join(root, 'dist', 'win-unpacked', 'Infinite OS.exe'), args: [], cwd: root, timeout: 30_000 }
    : { args: ['.'], cwd: root, timeout: 30_000 });
  const window = await app.firstWindow({ timeout: 30_000 });
  window.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  window.on('pageerror', (error) => errors.push(error.message));
  await window.waitForLoadState('domcontentloaded');
  await window.locator('#root').waitFor({ state: 'visible', timeout: 30_000 });
  await window.waitForTimeout(5_000);

  const result = await window.evaluate(() => ({
    title: document.title,
    rootChildren: document.querySelector('#root')?.childElementCount ?? 0,
    textLength: document.body.innerText.length,
    textPreview: document.body.innerText.slice(0, 240),
    buttons: Array.from(document.querySelectorAll('button')).slice(0, 40).map((button) => button.textContent?.trim()).filter(Boolean),
    apiMethods: typeof window.api === 'object' && window.api ? Object.keys(window.api).length : 0,
  }));

  if (result.title !== 'Infinite OS') throw new Error(`Unexpected window title: ${result.title}`);
  if (result.rootChildren === 0 || result.textLength < 40) throw new Error(`Renderer did not reach an interactive screen: ${result.textPreview}`);
  if (result.apiMethods < 20) throw new Error(`Preload bridge is incomplete (${result.apiMethods} methods).`);
  if (errors.length) throw new Error(`Renderer errors: ${errors.join(' | ')}`);

  const composer = window.getByLabel('Message Infinite OS', { exact: true });
  if (await composer.count() === 0) {
    const openChat = window.getByRole('button', { name: 'Open AI Chat', exact: true });
    if (await openChat.count() !== 1) throw new Error('Landing page did not expose its AI Chat destination.');
    await openChat.click();
    await composer.waitFor({ state: 'visible', timeout: 10_000 });
  }
  const composerCount = await composer.count();
  if (composerCount !== 1) throw new Error(`Expected one primary composer, found ${composerCount}.`);
  await composer.fill('smoke-test-input');
  if (await composer.inputValue() !== 'smoke-test-input') throw new Error('Primary composer did not accept input.');
  await composer.fill('');

  let physicalControl = false;
  if (physical) {
    await app.evaluate(({ BrowserWindow }) => {
      const target = BrowserWindow.getAllWindows()[0];
      target?.restore();
      target?.show();
      target?.setAlwaysOnTop(true, 'screen-saver');
      target?.focus();
    });
    await window.bringToFront();
    await window.waitForTimeout(500);
    await composer.click();
    const control = await window.evaluate(async () => {
      const cursor = await window.api.computerGetCursorPosition();
      const move = await window.api.computerMoveMouse({ x: cursor.x, y: cursor.y, smooth: true });
      const typed = await window.api.computerTypeText({ text: 'physical-input-smoke', delay: 1 });
      const frame = await window.api.computerLiveFrame();
      return { cursor, move, typed, frame };
    });
    if (!control.frame?.ok || !control.frame.width || !control.frame.height) throw new Error(`Live screen capture failed: ${JSON.stringify(control.frame)}`);
    await window.waitForTimeout(250);
    if (await composer.inputValue() !== 'physical-input-smoke') throw new Error(`Physical keyboard typing failed: ${JSON.stringify(control)}`);
    await window.evaluate(async () => {
      await window.api.computerHotkey({ keys: ['ctrl', 'a'] });
      await window.api.computerPressKey({ key: 'backspace' });
    });
    await window.waitForTimeout(250);
    if (await composer.inputValue() !== '') throw new Error('Physical keyboard cleanup failed.');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setAlwaysOnTop(false));
    physicalControl = true;
  }

  let notepadControl = false;
  if (notepad) {
    const result = await window.evaluate(async () => {
      const opened = await window.api.computerOpenApp({ name: 'notepad' });
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      const focused = await window.api.computerFocusWindow({ title: 'Notepad' });
      const typed = await window.api.computerTypeText({ text: 'Infinite OS compound action verified.', delay: 2 });
      const state = await window.api.computerGetDesktopState();
      const frame = await window.api.computerLiveFrame();
      await window.api.computerCloseApp({ name: 'notepad' });
      return { opened, focused, typed, state, frame };
    });
    const title = result.state?.state?.activeWindow?.title || result.state?.activeWindow?.title || '';
    if (result.opened?.ok === false || result.focused?.ok === false || result.typed?.ok === false ||
        !/notepad/i.test(title) || !result.frame?.ok) {
      throw new Error(`Notepad physical-control audit failed: ${JSON.stringify(result)}`);
    }
    notepadControl = true;
  }

  let onlineLearningAudit = null;
  if (onlineLearning) {
    onlineLearningAudit = await window.evaluate(async () => {
      const events = [];
      const unsubscribe = window.api.onBrainTeachEvent((event) => events.push(event));
      const current = JSON.parse(localStorage.getItem('infinite:current') || '{}');
      try {
        const started = await window.api.brainTeachStart({
          durationMinutes: 10,
          source: 'online',
          provider: current.provider === 'local' ? 'ollama' : current.provider,
          model: current.model,
        });
        if (!started.active) return { started, events, stopped: null };
        const deadline = Date.now() + 120_000;
        while (Date.now() < deadline && !events.some((event) => event.type === 'lesson')) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        const stopped = await window.api.brainTeachStop();
        return { started, events, stopped };
      } finally {
        unsubscribe();
      }
    });
    if (!onlineLearningAudit.started?.active ||
        !onlineLearningAudit.events.some((event) => event.type === 'progress') ||
        !onlineLearningAudit.events.some((event) => event.type === 'lesson') ||
        (onlineLearningAudit.stopped?.lessonsCompleted ?? 0) < 1) {
      throw new Error(`Online learning audit failed: ${JSON.stringify(onlineLearningAudit)}`);
    }
  }

  const settings = window.getByRole('button', { name: 'Settings', exact: true });
  const settingsCount = await settings.count();
  if (settingsCount !== 1) throw new Error(`Expected one Settings button, found ${settingsCount}.`);
  await settings.click();
  const settingsHeading = window.getByRole('heading', { name: 'Settings', exact: true });
  await settingsHeading.waitFor({ state: 'visible', timeout: 10_000 });
  const providerHeading = window.getByRole('heading', { name: 'AI Provider', exact: true });
  if (await providerHeading.count() !== 1) throw new Error('Settings provider configuration did not render.');

  const providerAudit = await window.evaluate(async () => {
    const connection = await window.api.testProvider({ provider: 'opencode', apiKey: '' });
    const models = await window.api.listProviderModels({ provider: 'opencode', apiKey: '' });
    return {
      connection,
      count: models.length,
      invalidChatModels: models
        .map((model) => `${model.id} ${model.label}`)
        .filter((identity) => /(^|[\s/_-])(embed(ding)?|bge|rerank|whisper|tts|speech|moderation)([\s/_-]|$)/i.test(identity))
        .slice(0, 10),
    };
  });
  const rejectedSavedOpenCodeCredential =
    !providerAudit.connection.ok && /rejected this API key|current key/i.test(providerAudit.connection.error || '');
  if (!providerAudit.connection.ok && !rejectedSavedOpenCodeCredential) {
    throw new Error(`OpenCode connection failed: ${providerAudit.connection.error}`);
  }
  if (providerAudit.count === 0) throw new Error('OpenCode returned no free chat models.');
  if (providerAudit.invalidChatModels.length) throw new Error(`Non-chat models leaked into the catalog: ${providerAudit.invalidChatModels.join(', ')}`);

  const backendAudit = await window.evaluate(async () => {
    const auditCwd = JSON.parse(localStorage.getItem('infinite:current') || '{}').cwd || '.';
    const session = await window.api.createSession({ cwd: '.', model: 'smoke-test', provider: 'ollama', title: 'Infinite OS smoke audit' });
    try {
      await window.api.appendSessionMessage({
        sessionId: session.id,
        message: { id: crypto.randomUUID(), role: 'user', content: [{ type: 'text', text: 'persistence verification' }], timestamp: Date.now() },
      });
      const messages = await window.api.loadSession({ sessionId: session.id });
      const renamed = await window.api.renameSession({ sessionId: session.id, title: 'Infinite OS smoke audit renamed' });
      const pinned = await window.api.pinSession({ sessionId: session.id, pinned: true });
      const search = await window.api.searchSessions({ query: 'smoke audit renamed' });
      const tools = await window.api.listTools();
      const [gitStatus, gitLog, gitBranch, gitDiff] = await Promise.all([
        window.api.gitStatus({ cwd: auditCwd }),
        window.api.gitLog({ cwd: auditCwd, count: 1 }),
        window.api.gitBranch({ cwd: auditCwd }),
        window.api.gitDiff({ cwd: auditCwd }),
      ]);
      await Promise.all([
        window.api.emailHasConfig(),
        window.api.automationListWorkflows(),
        window.api.automationStats(),
        window.api.trackerStatus(),
        window.api.trackerRecent({ count: 5 }),
        window.api.replayList(),
        window.api.ytListTasks(),
        window.api.browserStats(),
      ]);
      return {
        messageCount: messages.length,
        renamed: renamed.title,
        pinned: pinned.pinned,
        searchable: search.some((item) => item.id === session.id),
        toolCount: tools.length,
        gitReadOnly: [gitStatus, gitLog, gitBranch, gitDiff].every((result) => !result.is_error),
        serviceReadOnly: true,
      };
    } finally {
      await window.api.deleteSession({ sessionId: session.id });
    }
  });
  if (backendAudit.messageCount !== 1 || backendAudit.renamed !== 'Infinite OS smoke audit renamed' || !backendAudit.pinned || !backendAudit.searchable) {
    throw new Error(`Session persistence audit failed: ${JSON.stringify(backendAudit)}`);
  }
  if (backendAudit.toolCount !== 58) throw new Error(`Expected 58 registered tools through IPC, found ${backendAudit.toolCount}.`);
  if (!backendAudit.gitReadOnly) throw new Error('Read-only Git IPC audit failed.');

  let localToolAudit = null;
  if (localTools) {
    localToolAudit = await window.evaluate(async () => {
      const model = 'minicpm-v4.6:latest';
      const installed = await window.api.listProviderModels({ provider: 'ollama' });
      if (!installed.some((item) => item.id === model)) throw new Error(`${model} is not installed.`);
      const cwd = JSON.parse(localStorage.getItem('infinite:current') || '{}').cwd || '.';
      const runProbe = async (title, prompt, expectedTool, expectedActions = []) => {
        const session = await window.api.createSession({ cwd, model, provider: 'ollama', title });
        const events = [];
        const unsubscribe = window.api.onStreamEvent((event) => {
          if (event?.sessionId === session.id) events.push(event);
        });
        try {
          await window.api.sendMessage({
            sessionId: session.id,
            message: [{ type: 'text', text: prompt }],
            provider: 'ollama',
            model,
            cwd,
          });
          const toolNames = events.filter((event) => event.type === 'tool_use_start').map((event) => event.name);
          const toolActions = events
            .filter((event) => event.type === 'tool_use_end' && event.name === expectedTool)
            .map((event) => event.input?.action)
            .filter(Boolean);
          return {
            expectedTool,
            expectedActions,
            toolNames,
            toolActions,
            toolResult: events.some((event) => event.type === 'tool_result' && event.name === expectedTool && !event.is_error),
            done: events.some((event) => event.type === 'done' && event.success === true),
            errors: events.filter((event) => event.type === 'error').map((event) => event.error),
          };
        } finally {
          unsubscribe();
          await window.api.deleteSession({ sessionId: session.id });
        }
      };
      return [
        await runProbe(
          'MiniCPM research tool audit',
          'Use WebSearch to research the latest stable Node.js release. You must use the tool instead of memory, then briefly report what the search returned.',
          'WebSearch',
        ),
        await runProbe(
          'MiniCPM computer tool audit',
          'Use Computer with action visual_observe to inspect the live Windows screen. Report only the active-window information returned by the tool.',
          'Computer',
        ),
        await runProbe(
          'Compound Notepad execution audit',
          'Open Notepad and write exactly this sentence inside it: Infinite OS compound action verified. Use Computer launch_app, then Computer visual_type with the sentence, and verify the result before finishing.',
          'Computer',
          ['launch_app', 'visual_type'],
        ),
      ];
    });
    for (const probe of localToolAudit) {
      const missingActions = probe.expectedActions.filter((action) => !probe.toolActions.includes(action));
      if (!probe.toolNames.includes(probe.expectedTool) || missingActions.length || !probe.toolResult || !probe.done || probe.errors.length) {
        throw new Error(`Local tool round-trip failed: ${JSON.stringify(probe)}`);
      }
    }
    await window.evaluate(() => window.api.computerCloseApp({ name: 'notepad' })).catch(() => undefined);
  }

  let liveModelAudit = null;
  if (liveModel) {
    liveModelAudit = await window.evaluate(async () => {
      const current = JSON.parse(localStorage.getItem('infinite:current') || '{}');
      const provider = current.provider || 'nvidia';
      const model = current.model || 'meta/llama-3.3-70b-instruct';
      const session = await window.api.createSession({ cwd: current.cwd || '.', model, provider, title: 'Infinite OS live model audit' });
      const events = [];
      const unsubscribe = window.api.onStreamEvent((event) => {
        if (event?.sessionId === session.id) events.push(event);
      });
      try {
        await window.api.sendMessage({
          sessionId: session.id,
          message: [{ type: 'text', text: 'Reply briefly with INFINITE_OS_LIVE_OK. Do not call tools.' }],
          provider,
          model,
          cwd: current.cwd || '.',
        });
        const messages = await window.api.loadSession({ sessionId: session.id });
        const text = messages
          .filter((message) => message.role === 'assistant')
          .flatMap((message) => message.content)
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join('\n');
        return { provider, model, textLength: text.length, eventTypes: events.map((event) => event.type), errors: events.filter((event) => event.type === 'error').map((event) => event.error) };
      } finally {
        unsubscribe();
        await window.api.deleteSession({ sessionId: session.id });
      }
    });
    if (!liveModelAudit.textLength || !liveModelAudit.eventTypes.includes('done')) throw new Error(`Live model round-trip failed: ${JSON.stringify(liveModelAudit)}`);
  }

  console.log(JSON.stringify({ ok: true, ...result, composer: true, physicalControl, notepadControl, onlineLearningAudit, settingsView: true, providerAudit, backendAudit, localToolAudit, liveModelAudit, rendererErrors: errors }, null, 2));
} finally {
  if (app) await app.close();
}
