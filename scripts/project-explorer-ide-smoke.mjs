import { _electron as electron } from 'playwright-core';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const projectName = `Business Smoke ${Date.now()}`;
const projectPath = join(root, projectName);
let app;

try {
  app = await electron.launch({ args: ['.'], cwd: root, timeout: 30_000 });
  const window = await app.firstWindow({ timeout: 30_000 });
  await window.locator('#root').waitFor({ state: 'visible', timeout: 30_000 });
  await window.evaluate((cwd) => {
    const current = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
    localStorage.setItem('infinite:current', JSON.stringify({ ...current, cwd }));
  }, root);

  await window.getByRole('button', { name: 'Projects', exact: true }).click();
  await window.getByRole('heading', { name: 'Projects', exact: true }).waitFor({ state: 'visible' });
  if (await window.getByRole('heading', { name: 'App Builder', exact: true }).count()) {
    throw new Error('Projects still embeds App Builder.');
  }

  await window.getByRole('button', { name: 'New Project', exact: true }).click();
  await window.getByPlaceholder('Project name').fill(projectName);
  await window.getByPlaceholder('What is this project for?').fill('A real business planning project');
  await window.getByRole('button', { name: 'Create Project', exact: true }).click();
  const card = window.locator('article').filter({ hasText: projectName });
  await card.waitFor({ state: 'visible', timeout: 10_000 });
  await card.getByRole('button', { name: 'Open in Workspace', exact: true }).click();

  await window.getByText('README.md', { exact: true }).first().waitFor({ state: 'visible', timeout: 10_000 });
  await window.getByText('README.md', { exact: true }).first().click();
  const monacoEditor = window.locator('.monaco-editor').first();
  await monacoEditor.waitFor({ state: 'visible', timeout: 30_000 });
  await monacoEditor.click();
  await window.keyboard.press('Control+End');
  await window.keyboard.insertText('\nIDE save verified.');
  await window.getByRole('button', { name: 'Save', exact: true }).click();
  const ideRead = await window.evaluate(async (path) => window.api.fileRead({ path }), join(projectPath, 'README.md'));
  if (ideRead.type !== 'file' || !ideRead.content.includes('IDE save verified.')) throw new Error(`Workspace did not save: ${JSON.stringify(ideRead)}`);

  await window.getByRole('button', { name: 'File Explorer', exact: true }).click();
  await window.getByRole('heading', { name: 'Infinite OS Explorer', exact: true }).waitFor({ state: 'visible' });
  await window.getByText('README.md', { exact: true }).first().click();
  const explorerEditor = window.locator('textarea:not(.inputarea)').first();
  await explorerEditor.waitFor({ state: 'visible', timeout: 10_000 });
  await explorerEditor.fill('# Explorer edit\n\nExplorer save verified.');
  await window.getByRole('button', { name: 'Save', exact: true }).click();
  const explorerRead = await window.evaluate(async (path) => window.api.fileRead({ path }), join(projectPath, 'README.md'));
  if (explorerRead.type !== 'file' || !explorerRead.content.includes('Explorer save verified.')) throw new Error(`Explorer did not save: ${JSON.stringify(explorerRead)}`);

  console.log(JSON.stringify({ ok: true, projectsSeparated: true, businessProjectCreated: true, workspaceSaved: true, explorerSaved: true }, null, 2));
} finally {
  if (app) {
    await app.firstWindow().then((window) => window.evaluate(async ({ projectPath, projectName, root }) => {
      await window.api.fileDelete({ path: projectPath });
      const projects = JSON.parse(localStorage.getItem('infinite:managed-projects') ?? '[]');
      localStorage.setItem('infinite:managed-projects', JSON.stringify(projects.filter((project) => project.name !== projectName)));
      const current = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
      localStorage.setItem('infinite:current', JSON.stringify({ ...current, cwd: root }));
    }, { projectPath, projectName, root })).catch(() => undefined);
    await app.close();
  }
}
