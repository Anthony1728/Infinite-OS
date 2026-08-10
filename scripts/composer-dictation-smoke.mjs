import { _electron as electron } from 'playwright-core';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const composerOutput = join(root, 'test-results', 'composer-native-dictation.png');
const spectrumLoaderOutput = join(root, 'test-results', 'spectrum-loader.png');
const whiteLoaderOutput = join(root, 'test-results', 'white-loader.png');
const iceLoaderOutput = join(root, 'test-results', 'ice-loader.png');
const searchHoverOutput = join(root, 'test-results', 'search-hover.png');
let app;
let window;
let originalAppearance;

async function setLogoStyle(style, motion = true) {
  await window.evaluate(({ nextStyle, motionEnabled }) => {
    const key = 'infinite:appearance-v2';
    const stored = JSON.parse(localStorage.getItem(key) || '{"state":{}}');
    stored.state = { ...stored.state, logoStyle: nextStyle, motion: motionEnabled, glow: 90 };
    localStorage.setItem(key, JSON.stringify(stored));
  }, { nextStyle: style, motionEnabled: motion });
}

async function waitForComposer() {
  await window.locator('.os-startup-loading').waitFor({ state: 'detached', timeout: 10_000 });
  const composer = window.getByLabel('Message Infinite OS', { exact: true });
  if (await composer.count() === 0) {
    const openChat = window.getByRole('button', { name: 'Open AI Chat', exact: true });
    if (await openChat.count()) await openChat.click();
    else await window.getByRole('button', { name: 'Chats', exact: true }).click();
  }
  await composer.waitFor({ state: 'visible', timeout: 15_000 });
  return composer;
}

try {
  app = await electron.launch({ args: ['.'], cwd: root, timeout: 30_000 });
  window = await app.firstWindow({ timeout: 30_000 });
  await window.locator('#root').waitFor({ state: 'visible', timeout: 30_000 });
  originalAppearance = await window.evaluate(() => localStorage.getItem('infinite:appearance-v2'));

  await window.emulateMedia({ reducedMotion: 'reduce' });
  await setLogoStyle('spectrum', false);
  await window.reload();
  const spectrumLoader = window.locator('.os-startup-loading .infinite-logo--spectrum.infinite-logo--loading');
  await spectrumLoader.waitFor({ state: 'visible', timeout: 5_000 });
  const spectrumRunners = spectrumLoader.locator('.infinite-logo__spectrum-runner');
  const spectrumStrokes = await spectrumRunners.evaluateAll((paths) => paths.map((path) => path.getAttribute('stroke')));
  if (spectrumStrokes.join(',') !== '#8b5cf6,#22d3ee,#ec4899') throw new Error(`Spectrum colors are not travelling separately: ${spectrumStrokes.join(', ')}`);
  const spectrumStart = await spectrumRunners.first().evaluate((path) => getComputedStyle(path).strokeDashoffset);
  await window.waitForTimeout(220);
  const spectrumEnd = await spectrumRunners.first().evaluate((path) => getComputedStyle(path).strokeDashoffset);
  if (spectrumStart === spectrumEnd) throw new Error('Spectrum colors stop moving when saved motion or Windows reduced motion is enabled.');
  await window.screenshot({ path: spectrumLoaderOutput });
  await waitForComposer();

  await setLogoStyle('luminous');
  await window.reload();
  const whiteLoader = window.locator('.os-startup-loading .infinite-logo--luminous.infinite-logo--loading');
  await whiteLoader.waitFor({ state: 'visible', timeout: 5_000 });
  const whiteStrokes = await whiteLoader.locator('.infinite-logo__luminous-runner').evaluateAll((paths) => paths.map((path) => path.getAttribute('stroke')));
  if (!whiteStrokes.length || whiteStrokes.some((stroke) => stroke !== '#fff')) throw new Error(`White loader has non-white runners: ${whiteStrokes.join(', ')}`);
  const whiteStart = await whiteLoader.locator('.infinite-logo__luminous-runner').first().evaluate((path) => getComputedStyle(path).strokeDashoffset);
  await window.waitForTimeout(220);
  const whiteEnd = await whiteLoader.locator('.infinite-logo__luminous-runner').first().evaluate((path) => getComputedStyle(path).strokeDashoffset);
  if (whiteStart === whiteEnd) throw new Error('White glow is present but not moving around the loop.');
  await window.screenshot({ path: whiteLoaderOutput });
  await waitForComposer();

  await setLogoStyle('ice');
  await window.reload();
  const iceLoader = window.locator('.os-startup-loading .infinite-logo--ice.infinite-logo--loading');
  await iceLoader.waitFor({ state: 'visible', timeout: 5_000 });
  const iceStrokes = await iceLoader.locator('.infinite-logo__ice-runner').evaluateAll((paths) => paths.map((path) => path.getAttribute('stroke')));
  if (iceStrokes.join(',') !== '#38bdf8,#e0f2fe,#0ea5e9') throw new Error(`Light Blue Infinite palette is incorrect: ${iceStrokes.join(', ')}`);
  const iceStart = await iceLoader.locator('.infinite-logo__ice-runner').first().evaluate((path) => getComputedStyle(path).strokeDashoffset);
  await window.waitForTimeout(220);
  const iceEnd = await iceLoader.locator('.infinite-logo__ice-runner').first().evaluate((path) => getComputedStyle(path).strokeDashoffset);
  if (iceStart === iceEnd) throw new Error('Blue-white glow is present but not moving around the loop.');
  await window.screenshot({ path: iceLoaderOutput });
  const composerAfterIce = await waitForComposer();

  const searchCommand = window.getByRole('button', { name: 'Search anything', exact: true });
  const restingIconFilter = await searchCommand.locator('.os-search-icon').evaluate((icon) => getComputedStyle(icon).filter);
  if (restingIconFilter === 'none') throw new Error('The Search anything icon does not glow at rest.');
  await searchCommand.hover();
  await window.waitForTimeout(120);
  const searchAnimations = await searchCommand.evaluate((element) => element.getAnimations({ subtree: true }).map((animation) => animation instanceof CSSAnimation ? animation.animationName : ''));
  for (const expected of ['osSearchTyping', 'osSearchCaret', 'osSearchLightSweep', 'osSearchIconGlow']) {
    if (!searchAnimations.includes(expected)) throw new Error(`Search hover is missing ${expected}: ${searchAnimations.join(', ')}`);
  }
  await window.screenshot({ path: searchHoverOutput });

  const mainInfiniteLogo = window.getByRole('img', { name: 'Infinite OS', exact: true }).first();
  const logoOverflow = await mainInfiniteLogo.evaluate((logo) => getComputedStyle(logo).overflow);
  if (logoOverflow !== 'visible') throw new Error(`Infinite glow is still clipped to a rectangular block: overflow=${logoOverflow}`);
  const sidebarRunner = window.locator('.os-sidebar .infinite-logo--active .infinite-logo__ice-runner').first();
  await sidebarRunner.waitFor({ state: 'visible', timeout: 5_000 });
  const sidebarStart = await sidebarRunner.evaluate((path) => getComputedStyle(path).strokeDashoffset);
  await window.waitForTimeout(220);
  const sidebarEnd = await sidebarRunner.evaluate((path) => getComputedStyle(path).strokeDashoffset);
  if (sidebarStart === sidebarEnd) throw new Error('The Infinite logo beside the INFINITE OS text is not loading.');

  const panelToggle = window.getByRole('button', { name: /notifications and activity/i }).first();
  if ((await panelToggle.getAttribute('aria-expanded')) === 'true') await panelToggle.click();
  await panelToggle.click();
  const activityPanel = window.locator('.os-activity-panel-shell');
  await activityPanel.waitFor({ state: 'visible', timeout: 5_000 });
  await activityPanel.locator('.os-right-panel').waitFor({ state: 'visible', timeout: 5_000 });
  const openAnimations = await activityPanel.evaluate((element) => element.getAnimations({ subtree: true }).map((animation) => animation instanceof CSSAnimation ? animation.animationName : ''));
  if (!openAnimations.includes('osActivityPanelSwirlIn') || !openAnimations.includes('osActivitySwirlSweep')) throw new Error(`Activity panel did not use its swirl opening: ${openAnimations.join(', ')}`);
  await panelToggle.click();
  const closeAnimations = await activityPanel.evaluate((element) => element.getAnimations({ subtree: true }).map((animation) => animation instanceof CSSAnimation ? animation.animationName : ''));
  if (!closeAnimations.includes('osActivityPanelSwirlOut')) throw new Error(`Activity panel did not animate closed: ${closeAnimations.join(', ')}`);

  for (const removedLabel of ['Attach file', 'Mention a file or agent', 'Switch to Code Mode', 'Open workspace tools', 'Voice input', 'Dictation language']) {
    if (await window.getByLabel(removedLabel, { exact: true }).count()) throw new Error(`${removedLabel} was not removed.`);
  }

  const agentButton = window.getByRole('button', { name: /Selected agent:/i }).first();
  if ((await agentButton.locator('.infinite-logo--luminous').count()) !== 1) throw new Error('The white Infinite loop is missing from the auto-agent control.');

  await composerAfterIce.fill('Keep this text.');
  await window.getByRole('button', { name: 'Start standalone dictation', exact: true }).click();
  await window.getByText('Listening — speak naturally', { exact: true }).waitFor({ state: 'visible', timeout: 8_000 });
  await window.getByRole('button', { name: 'Stop standalone dictation', exact: true }).waitFor({ state: 'visible', timeout: 8_000 });
  await window.getByRole('button', { name: 'Stop standalone dictation', exact: true }).click();
  if (!(await composerAfterIce.inputValue()).startsWith('Keep this text.')) throw new Error('Starting native dictation removed existing composer text.');

  await window.setViewportSize({ width: 1280, height: 800 });
  await window.screenshot({ path: composerOutput });
  console.log(JSON.stringify({
    ok: true,
    nativeWindowsDictationStarted: true,
    removedLanguageSelector: true,
    whiteComposerLoop: true,
    spectrumColorsMoveAndGlow: true,
    whiteLightMovesAndGlows: true,
    blueWhiteLightMovesAndGlows: true,
    worksWithSavedMotionOffAndReducedMotion: true,
    activityPanelSwirlsOpenAndClosed: true,
    unclippedLogoGlow: true,
    sidebarInfiniteLogoLoads: true,
    glowingSearchIcon: true,
    searchTypingHover: true,
    outputs: { composerOutput, spectrumLoaderOutput, whiteLoaderOutput, iceLoaderOutput, searchHoverOutput },
  }, null, 2));
} finally {
  if (window && originalAppearance !== undefined) {
    await window.evaluate((value) => {
      if (value === null) localStorage.removeItem('infinite:appearance-v2');
      else localStorage.setItem('infinite:appearance-v2', value);
    }, originalAppearance).catch(() => undefined);
    await window.evaluate(() => window.api.voiceStopListening()).catch(() => undefined);
  }
  if (app) await app.close();
}
