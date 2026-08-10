import { _electron as electron } from 'playwright-core';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let app;
let window;
let temporarySessionId;

try {
  app = await electron.launch({ args: ['.'], cwd: root, timeout: 30_000 });
  window = await app.firstWindow({ timeout: 30_000 });
  await window.locator('#root').waitFor({ state: 'visible', timeout: 30_000 });

  const composer = window.getByLabel('Message Infinite OS', { exact: true });
  if (await composer.count() === 0) {
    const openChat = window.getByRole('button', { name: 'Open AI Chat', exact: true });
    if (await openChat.count() === 1) await openChat.click();
    else await window.getByRole('button', { name: 'Chats', exact: true }).click();
    await composer.waitFor({ state: 'visible', timeout: 15_000 });
  }

  const sessionsBefore = await window.evaluate(() => window.api.listSessions());
  const newChat = window.getByRole('button', { name: /New Chat/i }).first();
  await newChat.click();
  await window.waitForTimeout(350);
  const sessionsAfter = await window.evaluate(() => window.api.listSessions());
  temporarySessionId = sessionsAfter.find((session) => !sessionsBefore.some((previous) => previous.id === session.id))?.id;
  if (!temporarySessionId) throw new Error('Could not create an isolated chat for the activation notice test.');

  const before = await window.evaluate(() => window.api.getSetting({ key: 'uncensoredMode' }));
  const toggle = window.getByRole('button', { name: /Uncensored mode (on|off)/i }).first();
  await toggle.waitFor({ state: 'visible', timeout: 30_000 });
  if (before === true) {
    await toggle.click();
    await window.waitForTimeout(250);
  }

  await toggle.click();
  const confirmation = window.getByText('Enable Uncensored mode?', { exact: true });
  await confirmation.waitFor({ state: 'visible', timeout: 5_000 });
  const beforeConfirmation = await window.evaluate(() => window.api.getSetting({ key: 'uncensoredMode' }));
  if (beforeConfirmation === true) throw new Error('Mode enabled before explicit confirmation.');
  await window.getByRole('button', { name: 'Enable Uncensored', exact: true }).click();
  await window.waitForTimeout(250);

  const stored = await window.evaluate(() => window.api.getSetting({ key: 'uncensoredMode' }));
  const pressed = await toggle.getAttribute('aria-pressed');
  if (stored !== true || pressed !== 'true') {
    throw new Error(`Toggle did not persist: ${JSON.stringify({ before, stored, pressed })}`);
  }
  await window.getByText('Uncensored mode is now on.', { exact: true }).waitFor({ state: 'visible', timeout: 5_000 });

  if (before !== true) await toggle.click();
  await window.waitForTimeout(250);
  const restored = await window.evaluate(() => window.api.getSetting({ key: 'uncensoredMode' }));
  if (restored !== (before === true)) {
    throw new Error(`Original setting was not restored: ${JSON.stringify({ before, restored })}`);
  }

  console.log(JSON.stringify({ ok: true, visibleToggle: true, explicitConfirmation: true, capabilityNotice: true, persisted: true, restored: true }, null, 2));
} finally {
  if (window && temporarySessionId) {
    await window.evaluate((sessionId) => window.api.deleteSession({ sessionId }), temporarySessionId).catch(() => undefined);
  }
  if (app) await app.close();
}
