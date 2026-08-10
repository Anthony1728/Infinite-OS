import { _electron as electron } from 'playwright-core';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const suffix = Date.now();
let app;
let window;
const workflowIds = [];

async function createWorkflow(name, actions) {
  const workflow = await window.evaluate(
    ({ name, actions }) => window.api.automationCreateWorkflow({
      name,
      description: 'Automation progress smoke test',
      trigger: { type: 'manual', config: {} },
      actions,
    }),
    { name, actions },
  );
  workflowIds.push(workflow.id);
  return workflow;
}

async function runFromCard(name) {
  const card = window.locator('.card-premium').filter({ hasText: name }).first();
  await card.waitFor({ state: 'visible', timeout: 10_000 });
  await card.getByRole('button', { name: 'Run', exact: true }).click();
}

try {
  app = await electron.launch({ args: ['.'], cwd: root, timeout: 30_000 });
  window = await app.firstWindow({ timeout: 30_000 });
  await window.locator('#root').waitFor({ state: 'visible', timeout: 30_000 });

  const successName = `Visible automation ${suffix}`;
  const success = await createWorkflow(successName, [
    { id: 'wait', type: 'delay', config: { ms: 1200 } },
    { id: 'notify', type: 'notify', config: { message: 'Visible result ready' } },
  ]);
  const failureName = `Failed automation ${suffix}`;
  const failure = await createWorkflow(failureName, [
    { id: 'missing', type: 'tool_call', config: { tool: 'DefinitelyMissingTool' }, onError: 'stop' },
  ]);

  await window.getByRole('button', { name: 'Automations', exact: true }).click();
  await runFromCard(successName);
  const panel = window.getByLabel('Automation execution progress', { exact: true });
  await panel.waitFor({ state: 'visible', timeout: 5_000 });
  await panel.getByText(/Running|Starting/).first().waitFor({ state: 'visible', timeout: 5_000 });
  await panel.getByText('completed', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  await panel.getByText(/2 of 2 actions completed successfully/).first().waitFor({ state: 'visible', timeout: 5_000 });
  const successRuns = await window.evaluate((workflowId) => window.api.automationGetRuns({ workflowId }), success.id);
  if (successRuns.at(-1)?.status !== 'completed' || successRuns.at(-1)?.actionResults?.length !== 2) {
    throw new Error(`Successful run result was incomplete: ${JSON.stringify(successRuns.at(-1))}`);
  }

  await panel.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await runFromCard(failureName);
  await panel.getByText('failed', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  await panel.getByText(/Tool not found: DefinitelyMissingTool/).first().waitFor({ state: 'visible', timeout: 5_000 });
  const failureRuns = await window.evaluate((workflowId) => window.api.automationGetRuns({ workflowId }), failure.id);
  if (failureRuns.at(-1)?.status !== 'failed') throw new Error(`Failed run was not reported: ${JSON.stringify(failureRuns.at(-1))}`);

  console.log(JSON.stringify({ ok: true, runningStateVisible: true, liveActionLogs: true, successResultVisible: true, failureResultVisible: true }, null, 2));
} finally {
  if (window) {
    for (const workflowId of workflowIds) {
      await window.evaluate((id) => window.api.automationDeleteWorkflow({ workflowId: id }), workflowId).catch(() => undefined);
    }
  }
  if (app) await app.close();
}
