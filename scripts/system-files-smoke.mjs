import { _electron as electron } from 'playwright-core';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const testName = `infinite-os-system-file-${Date.now()}.txt`;
let app;
let window;
let testPath;

try {
  app = await electron.launch({ args: ['.'], cwd: root, timeout: 30_000 });
  window = await app.firstWindow({ timeout: 30_000 });
  await window.locator('#root').waitFor({ state: 'visible', timeout: 30_000 });

  const roots = await window.evaluate(() => window.api.fileSystemRoots());
  const desktop = roots.common.find((location) => location.name === 'Desktop')?.path ?? roots.home;
  if (!desktop || roots.drives.length === 0) throw new Error(`System roots are incomplete: ${JSON.stringify(roots)}`);
  testPath = `${desktop.replace(/[\\/]+$/, '')}\\${testName}`;
  await window.evaluate(({ path }) => window.api.fileWrite({ path, content: 'outside-workspace-before' }), { path: testPath });

  await window.getByRole('button', { name: 'File Explorer', exact: true }).click();
  const explorerPath = window.getByLabel('System file path', { exact: true });
  await explorerPath.waitFor({ state: 'visible', timeout: 10_000 });
  await explorerPath.fill(desktop);
  await explorerPath.press('Enter');
  const explorerFile = window.getByText(testName, { exact: true }).first();
  await explorerFile.waitFor({ state: 'visible', timeout: 10_000 });
  await explorerFile.click();
  const editor = window.locator('textarea').first();
  if (await editor.inputValue() !== 'outside-workspace-before') throw new Error('External text file did not open in the explorer editor.');
  await editor.fill('outside-workspace-after');
  await window.getByRole('button', { name: 'Save', exact: true }).click();
  const saved = await window.evaluate(({ path }) => window.api.fileRead({ path }), { path: testPath });
  if (saved.content !== 'outside-workspace-after') throw new Error(`External file save failed: ${JSON.stringify(saved)}`);

  await window.getByRole('button', { name: 'Workspace', exact: true }).click();
  const workspacePath = window.getByLabel('Workspace system path', { exact: true });
  await workspacePath.waitFor({ state: 'visible', timeout: 10_000 });
  await workspacePath.fill(desktop);
  await workspacePath.press('Enter');
  await window.getByText(testName, { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  await window.getByText(testName, { exact: true }).click();
  await window.getByText(testName, { exact: true }).last().waitFor({ state: 'visible', timeout: 10_000 });

  console.log(JSON.stringify({ ok: true, drives: roots.drives.length, commonLocations: roots.common.map((item) => item.name), explorerExternalEdit: true, workspaceExternalOpen: true }, null, 2));
} finally {
  if (window && testPath) await window.evaluate(({ path }) => window.api.fileDelete({ path }), { path: testPath }).catch(() => undefined);
  if (app) await app.close();
}
