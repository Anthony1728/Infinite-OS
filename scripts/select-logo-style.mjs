import { _electron as electron } from 'playwright-core';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const style = process.argv[2];
if (!['spectrum', 'luminous', 'ice'].includes(style)) throw new Error('Use spectrum, luminous, or ice.');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = await electron.launch({ args: ['.'], cwd: root, timeout: 30_000 });
try {
  const window = await app.firstWindow({ timeout: 30_000 });
  await window.locator('#root').waitFor({ state: 'visible', timeout: 30_000 });
  await window.evaluate((logoStyle) => {
    const key = 'infinite:appearance-v2';
    const stored = JSON.parse(localStorage.getItem(key) || '{"state":{}}');
    stored.state = { ...stored.state, logoStyle };
    localStorage.setItem(key, JSON.stringify(stored));
  }, style);
  console.log(`Selected logo style: ${style}`);
} finally {
  await app.close();
}
