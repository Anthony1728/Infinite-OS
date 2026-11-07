#!/usr/bin/env node
// Live first-run proof: a brand-new Windows home (USERPROFILE) starts with no
// account, registers through the real UI, completes onboarding, lands in the
// OS, and a second launch skips onboarding because completion persisted.
//
// Everything runs against a throwaway home directory, so the user's real
// account, profiles, and sessions are never touched.
//
// Usage: node scripts/live-onboarding-check.mjs

import { _electron as electron } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mainEntry = join(root, 'out', 'main', 'index.js');
const artifacts = join(root, 'test-results', 'live-onboarding');
const EMAIL = 'first.run@infinite-os.test';
const PASSWORD = 'Infinite-OS-check-1';
const NAME = 'First Run';

const startedAt = Date.now();
const report = {
  startedAt: new Date(startedAt).toISOString(),
  home: '',
  email: EMAIL,
  steps: [],
  registration: null,
  onboardingCompleted: false,
  persisted: false,
  secondLaunchSkipsOnboarding: false,
};

function log(step, detail) {
  report.steps.push({ at: new Date().toISOString(), step, ...(detail ?? {}) });
  console.log(`[live-onboarding] ${step}${detail ? ' ' + JSON.stringify(detail) : ''}`);
}

function fail(message) {
  console.error(`[live-onboarding] FAILED: ${message}`);
  writeReport();
  process.exit(1);
}

function writeReport() {
  try {
    mkdirSync(artifacts, { recursive: true });
    report.finishedAt = new Date().toISOString();
    report.durationMs = Date.now() - startedAt;
    const path = join(artifacts, 'report.json');
    writeFileSync(path, JSON.stringify(report, null, 2));
    console.log(`[live-onboarding] report: ${path}`);
  } catch (error) {
    console.error('[live-onboarding] could not write report:', error.message);
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

async function shot(page, name) {
  await page.screenshot({ path: join(artifacts, name) }).catch(() => {});
}

async function main() {
  if (!existsSync(mainEntry)) fail('out/main/index.js missing — run `npm run build` first');
  mkdirSync(artifacts, { recursive: true });

  const home = mkdtempSync(join(tmpdir(), 'infinite-onboarding-home-'));
  const userData = mkdtempSync(join(tmpdir(), 'infinite-onboarding-userdata-'));
  report.home = home;
  log('temp-home', { home, userData });

  // A brand-new Windows profile: no ~/.infinite-ai at all.
  const launch = () =>
    electron.launch({
      args: [mainEntry, `--user-data-dir=${userData}`],
      env: { ...process.env, USERPROFILE: home, INFINITE_DISABLE_GPU: '1' },
      timeout: 120_000,
    });

  let app = await launch();
  let page;
  try {
    page = await app.firstWindow({ timeout: 120_000 });
    await page.getByRole('button', { name: 'Create account' }).waitFor({ state: 'visible', timeout: 90_000 });
    await shot(page, '01-login.png');
    log('login-screen');

    await page.getByRole('button', { name: 'Create account' }).click();
    await page.getByText('Create your account').waitFor({ state: 'visible', timeout: 30_000 });

    await page.locator('input[type="text"]').first().fill(NAME);
    await page.locator('input[type="email"]').first().fill(EMAIL);
    const passwords = page.locator('input[type="password"]');
    await passwords.nth(0).fill(PASSWORD);
    await passwords.nth(1).fill(PASSWORD);
    await shot(page, '02-register-filled.png');
    await page.getByRole('button', { name: 'Create account' }).click();
    log('register-submitted');

    // The splash clears into onboarding: welcome step first.
    await page.getByRole('heading', { name: /Welcome to Infinite OS/i }).waitFor({ state: 'visible', timeout: 60_000 });
    await shot(page, '03-onboarding-welcome.png');
    log('onboarding-welcome');

    await page.getByRole('button', { name: 'Configure Your Workspace' }).click();
    await page.getByRole('heading', { name: /Setup Your Workspace/i }).waitFor({ state: 'visible', timeout: 30_000 });
    const nameInput = page.locator('input[placeholder="Enter your name"]');
    await nameInput.fill(NAME);
    await page.getByRole('button', { name: 'midnight' }).click();
    await shot(page, '04-onboarding-setup.png');
    await page.getByRole('button', { name: 'Continue' }).click();

    await page.getByRole('heading', { name: /Choose Your AI Engine/i }).waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByRole('button', { name: /Ollama \(local & free\)/ }).click();
    const initialize = page.getByRole('button', { name: 'Initialize Workspace' });
    await initialize.waitFor({ state: 'visible', timeout: 30_000 });
    if (await initialize.isDisabled()) fail('Initialize Workspace stayed disabled after picking Ollama');
    await shot(page, '05-onboarding-model.png');
    await initialize.click();
    log('initialize-clicked');

    await page.waitForFunction(() => Boolean(document.querySelector('[data-nav="studio"]')), undefined, {
      timeout: 60_000,
    });
    report.onboardingCompleted = true;
    await shot(page, '06-os-after-onboarding.png');
    log('os-entered');

    // Persistence evidence straight off disk.
    const auth = readJson(join(home, '.infinite-ai', 'auth.json'));
    const session = readJson(join(home, '.infinite-ai', 'auth-session.json'));
    const active = readJson(join(home, '.infinite-ai', 'active-profile.json'));
    const entry = auth?.[EMAIL];
    report.registration = {
      accountStored: Boolean(entry?.user),
      hasCompletedOnboarding: entry?.user?.hasCompletedOnboarding === true,
      sessionEmail: session?.user?.email ?? null,
      activeUid: active?.uid ?? null,
      profileDirs: existsSync(join(home, '.infinite-ai', 'profiles'))
        ? readdirSync(join(home, '.infinite-ai', 'profiles'))
        : [],
    };
    if (!report.registration.accountStored) fail('auth.json has no account record');
    if (!report.registration.hasCompletedOnboarding) fail('hasCompletedOnboarding was not persisted');
    if ((session?.user?.email ?? '').toLowerCase() !== EMAIL) fail('auth-session.json does not hold the new account');
    if (!report.registration.activeUid) fail('active-profile.json was not written');
    report.persisted = true;
    log('persisted', report.registration);

    // Second launch: onboarding must be skipped.
    await app.close().catch(() => {});
    app = await launch();
    page = await app.firstWindow({ timeout: 120_000 });
    await page.waitForFunction(() => Boolean(document.querySelector('[data-nav="studio"]')), undefined, {
      timeout: 120_000,
    });
    const stillOnboarding = await page.getByText('Choose Your AI Engine').isVisible().catch(() => false);
    if (stillOnboarding) fail('second launch showed onboarding again');
    report.secondLaunchSkipsOnboarding = true;
    await shot(page, '07-second-launch.png');
    log('second-launch', { onboardingSkipped: true });

    await app.close().catch(() => {});
    writeReport();
    console.log('[live-onboarding] PASS: register -> onboarding -> persisted -> second launch');
    process.exit(0);
  } catch (error) {
    writeReport();
    console.error('[live-onboarding] ERROR:', error);
    process.exit(1);
  } finally {
    await app.close().catch(() => {});
  }
}

main();
