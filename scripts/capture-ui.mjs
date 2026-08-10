import { _electron as electron } from 'playwright-core';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'test-results', 'highlighted-ui.png');
const logoSettingsOutput = join(root, 'test-results', 'logo-style-settings.png');
let app;

try {
  app = await electron.launch({ args: ['.'], cwd: root, timeout: 30_000 });
  const window = await app.firstWindow({ timeout: 30_000 });
  await window.waitForLoadState('domcontentloaded');
  await window.locator('#root').waitFor({ state: 'visible', timeout: 30_000 });

  const composer = window.getByLabel('Message Infinite OS', { exact: true });
  if (await composer.count() === 0) {
    await window.getByRole('button', { name: 'Open AI Chat', exact: true }).click();
    await composer.waitFor({ state: 'visible', timeout: 10_000 });
  }

  await window.setViewportSize({ width: 1280, height: 800 });
  await window.waitForTimeout(750);
  await window.screenshot({ path: output, fullPage: false });

  for (const removedLabel of ['Attach file', 'Mention a file or agent', 'Switch to Code Mode', 'Open workspace tools', 'Voice input']) {
    if (await window.getByLabel(removedLabel, { exact: true }).count()) throw new Error(`${removedLabel} is still visible.`);
  }
  if (await window.getByLabel('Dictation language', { exact: true }).count()) throw new Error('The unnecessary dictation language selector is still visible.');

  const currentMode = window.locator('button[aria-label^="Current mode:"]');
  await currentMode.click();
  await window.getByRole('button', { name: /Research Mode/ }).click();
  await window.getByLabel('Current mode: Research Mode', { exact: true }).waitFor({ state: 'visible', timeout: 5_000 });
  if (await composer.inputValue() !== '') throw new Error('Research mode wrote a slash command into the composer.');
  await window.getByLabel('Current mode: Research Mode', { exact: true }).click();
  await window.getByRole('button', { name: /Chat Mode/ }).click();

  await window.getByRole('button', { name: 'Settings', exact: true }).click();
  await window.getByRole('heading', { name: 'Settings', exact: true }).waitFor({ state: 'visible', timeout: 5_000 });
  await window.getByRole('button', { name: 'Use White Infinite logo style', exact: true }).click();
  await window.screenshot({ path: logoSettingsOutput, fullPage: false });
  await window.getByRole('button', { name: 'Use Original Spectrum logo style', exact: true }).click();
  await window.getByRole('button', { name: 'Chats', exact: true }).click();

  const profile = window.getByLabel('Open profile menu', { exact: true });
  await profile.click();
  await window.locator('[aria-label="Open profile menu"] + div').getByRole('button', { name: 'Sign out', exact: true }).waitFor({ state: 'visible', timeout: 5_000 });
  await profile.click();

  console.log(JSON.stringify({ ok: true, output, logoSettingsOutput, controls: true }, null, 2));
} finally {
  if (app) await app.close();
}
