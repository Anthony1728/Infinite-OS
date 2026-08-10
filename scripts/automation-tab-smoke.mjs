import { _electron as electron } from 'playwright-core';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
let app;

try {
  app = await electron.launch({ args: ['.'], cwd: root, timeout: 30_000 });
  const window = await app.firstWindow({ timeout: 30_000 });
  window.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  window.on('pageerror', (error) => errors.push(error.message));
  await window.waitForLoadState('domcontentloaded');
  await window.locator('#root').waitFor({ state: 'visible', timeout: 30_000 });
  await window.waitForTimeout(4_000);

  const automationButton = window.getByRole('button', { name: 'Automations', exact: true });
  if (await automationButton.count() !== 1) {
    throw new Error(`Sidebar Automations button not found.`);
  }
  await automationButton.click();
  await window.waitForTimeout(800);

  const heading = window.getByRole('heading', { name: 'Automations', exact: true });
  await heading.waitFor({ state: 'visible', timeout: 10_000 });

  const templateCount = await window.locator('.card-premium', { has: window.locator('text=Templates') }).count().catch(() => 0);
  const visible = await window.evaluate(() => ({
    heading: Array.from(document.querySelectorAll('h1')).map((h) => h.textContent).filter(Boolean),
    hasWorkflowsSection: Array.from(document.querySelectorAll('h2')).some((h) => h.textContent?.includes('Your Workflows')),
    hasTemplatesSection: Array.from(document.querySelectorAll('h2')).some((h) => h.textContent?.includes('Templates')),
    statCards: Array.from(document.querySelectorAll('.grid-cols-4 > div')).length,
  }));

  if (!visible.hasWorkflowsSection || !visible.hasTemplatesSection || visible.statCards < 4) {
    throw new Error(`Automation view did not render expected sections: ${JSON.stringify(visible)}`);
  }

  const apiAudit = await window.evaluate(async () => {
    const api = window.api;
    const payload = {
      name: 'Smoke Test Workflow',
      description: 'Created by automation tab smoke test',
      trigger: { type: 'manual', config: {} },
      actions: [
        { id: crypto.randomUUID(), type: 'delay', config: { ms: 10 } },
        { id: crypto.randomUUID(), type: 'notify', config: { message: 'smoke done' } },
      ],
    };
    const created = await api.automationCreateWorkflow(payload);
    const listed = await api.automationListWorkflows();
    const stats = await api.automationStats();
    const run = await api.automationRunWorkflow({ workflowId: created.id });
    const disabled = await api.automationDisableWorkflow({ workflowId: created.id });
    const reEnabled = await api.automationEnableWorkflow({ workflowId: created.id });
    const templates = await api.automationGetTemplates();
    const deleted = await api.automationDeleteWorkflow({ workflowId: created.id });
    return {
      created: Boolean(created?.id),
      listed: listed.some((w) => w.id === created.id),
      runStatus: run?.status,
      disabled: disabled === true,
      reEnabled: reEnabled === true,
      templateCount: templates.length,
      deleted: deleted === true,
    };
  });

  if (!apiAudit.created || !apiAudit.listed || apiAudit.runStatus !== 'completed' ||
      !apiAudit.disabled || !apiAudit.reEnabled || apiAudit.templateCount === 0 || !apiAudit.deleted) {
    throw new Error(`Automation workflow CRUD audit failed: ${JSON.stringify(apiAudit)}`);
  }

  if (errors.length) throw new Error(`Renderer errors: ${errors.join(' | ')}`);

  console.log(JSON.stringify({ ok: true, tabNavigates: true, viewSections: visible, apiAudit }, null, 2));
} finally {
  if (app) await app.close();
}
