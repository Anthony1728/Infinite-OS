import { _electron as electron } from 'playwright-core';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let app;
try {
  app = await electron.launch({ args: ['.'], cwd: root, timeout: 30_000 });
  const window = await app.firstWindow({ timeout: 30_000 });
  await window.locator('#root').waitFor({ state: 'visible', timeout: 30_000 });

  const navigation = {};
  for (const label of ['Chats', 'Agents', 'Projects', 'File Explorer', 'Automations', 'Memory', 'Workspace', 'Settings']) {
    const button = window.getByRole('button', { name: label, exact: true });
    await button.click();
    await window.waitForTimeout(250);
    navigation[label] = (await window.getByRole('main').innerText()).length > 30;
  }

  await window.getByRole('button', { name: 'Projects', exact: true }).click();
  await window.getByRole('heading', { name: 'App Builder', exact: true }).waitFor({ state: 'visible' });
  await window.getByRole('button', { name: 'New Project', exact: true }).click();
  await window.getByPlaceholder('Project name').fill(`UI Project ${Date.now()}`);
  if (!(await window.getByRole('button', { name: 'Create Project', exact: true }).isEnabled())) throw new Error('Create Project is disabled.');

  const builderAudit = await window.evaluate(async () => {
    const results = [];
    for (const item of [
      { framework: 'electron', templateId: 'electron_app' },
      { framework: 'express', templateId: 'express_api' },
    ]) {
      const project = await window.api.appCreateProject({ name: `Smoke ${item.framework} ${Date.now()}`, framework: item.framework, language: 'typescript', templateId: item.templateId });
      try {
        const renamed = await window.api.appRename({ projectId: project.id, name: `${project.name} Renamed` });
        const build = await window.api.appBuild({ projectId: project.id });
        results.push({ framework: item.framework, renamed: renamed?.name, build });
      } finally { await window.api.appDelete({ projectId: project.id }); }
    }
    return results;
  });

  const agentAudit = await window.evaluate(async ({ root }) => {
    const session = await window.api.createSession({ cwd: root, provider: 'opencode', model: 'opencode::mimo-v2.5-free', title: 'Agent execution smoke' });
    const events = [];
    const unsubscribe = window.api.onAgentEvent((event) => events.push(event));
    try {
      const run = await window.api.spawnAgent({
        agentId: 'code',
        task: 'Use the Read tool to inspect package.json in the current working directory, then report the package name. You must execute the tool.',
        sessionId: session.id,
        cwd: root,
        provider: 'opencode',
        model: 'opencode::mimo-v2.5-free',
      });
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline && !events.some((event) => event.runId === run.id && (event.type === 'complete' || event.type === 'fail'))) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      const final = events.find((event) => event.runId === run.id && (event.type === 'complete' || event.type === 'fail'));
      return {
        runId: run.id,
        final,
        eventTypes: events.filter((event) => event.runId === run.id || event.run?.id === run.id).map((event) => event.type),
        activities: events.filter((event) => event.runId === run.id && event.type === 'activity').map((event) => event.activity),
      };
    } finally {
      unsubscribe();
      await window.api.deleteSession({ sessionId: session.id });
    }
  }, { root });

  const progressPanel = window.locator('.os-right-panel');
  await progressPanel.waitFor({ state: 'visible', timeout: 5_000 });
  const progressText = await progressPanel.innerText();

  if (!Object.values(navigation).every(Boolean)) throw new Error(`Navigation audit failed: ${JSON.stringify(navigation)}`);
  if (builderAudit.some((item) => !item.renamed?.endsWith('Renamed') || !item.build?.success)) throw new Error(`Builder template audit failed: ${JSON.stringify(builderAudit)}`);
  if (agentAudit.final?.type !== 'complete') throw new Error(`Agent did not complete: ${JSON.stringify(agentAudit)}`);
  if (!agentAudit.eventTypes.includes('tool_call') || !agentAudit.activities.some((item) => item.kind === 'tool') || !agentAudit.activities.some((item) => item.kind === 'result')) {
    throw new Error(`Agent work was not visible: ${JSON.stringify(agentAudit)}`);
  }
  if (!/Code Agent|read|completed/i.test(progressText)) throw new Error(`Foreground progress panel did not show agent work: ${progressText}`);
  const startedAt = agentAudit.activities.find((item) => /started/i.test(item.label))?.timestamp;
  const connectedAt = agentAudit.activities.find((item) => /model connected/i.test(item.label))?.timestamp;
  const startupLatencyMs = startedAt && connectedAt ? connectedAt - startedAt : null;
  if (startupLatencyMs === null || startupLatencyMs > 2_000) throw new Error(`Agent startup was too slow: ${startupLatencyMs}ms`);
  console.log(JSON.stringify({ ok: true, navigation, projectCreateUsable: true, builderAudit, foregroundProgressVisible: true, startupLatencyMs, agentAudit }, null, 2));
} finally {
  if (app) await app.close();
}
