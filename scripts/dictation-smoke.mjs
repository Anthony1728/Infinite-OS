import { _electron as electron } from 'playwright-core';
import { join } from 'node:path';

const root = 'C:\\Users\\user\\Desktop\\New folder (2)';
let app;
let window;

try {
  app = await electron.launch({ args: ['.'], cwd: root, timeout: 30_000 });
  window = await app.firstWindow({ timeout: 30_000 });
  await window.locator('#root').waitFor({ state: 'visible', timeout: 30_000 });
  await window.locator('.os-startup-loading').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {});

  let composer = window.getByLabel('Message Infinite OS', { exact: true });
  if (await composer.count() === 0) {
    const openChat = window.getByRole('button', { name: 'Open AI Chat', exact: true });
    if (await openChat.count()) await openChat.click();
    else await window.getByRole('button', { name: 'Chats', exact: true }).click();
  }
  await composer.waitFor({ state: 'visible', timeout: 15_000 });

  const startBtn = window.getByRole('button', { name: 'Start standalone dictation', exact: true });
  console.log('dictate button count:', await startBtn.count());
  const disabled = await startBtn.isDisabled().catch(() => 'n/a');
  console.log('dictate button disabled:', disabled);

  await startBtn.click();
  await window.waitForTimeout(2_500);

  const statusBox = window.locator('.os-dictation-status');
  const hasStatus = await statusBox.count();
  console.log('status box count:', hasStatus);
  if (hasStatus) {
    const text = await statusBox.innerText();
    console.log('status text:', JSON.stringify(text));
  }
  const stopBtn = window.getByRole('button', { name: 'Stop standalone dictation', exact: true });
  console.log('stop button count:', await stopBtn.count());

  const errors = [];
  window.on('console', (msg) => {
    const t = msg.text();
    if (/dictat|speech|voice|listening/i.test(t)) errors.push(t);
  });

  await window.waitForTimeout(1_000);
  console.log('console mentions:', JSON.stringify(errors, null, 2));

  if (await stopBtn.count()) await stopBtn.click();
  await window.waitForTimeout(1_000);
} finally {
  if (window) await window.evaluate(() => window.api.voiceStopListening()).catch(() => undefined);
  if (app) await app.close();
}
