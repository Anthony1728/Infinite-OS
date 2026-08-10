/* eslint-env node */
/* global document, getComputedStyle */
import { _electron as electron } from 'playwright-core';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let app;

try {
  app = await electron.launch({ args: ['.'], cwd: root, timeout: 30_000 });
  const window = await app.firstWindow({ timeout: 30_000 });
  await window.waitForLoadState('domcontentloaded');
  await window.locator('#root').waitFor({ state: 'visible', timeout: 30_000 });

  let startupAnimationObserved = false;
  const startupRunner = window.locator('.os-startup-loading .infinite-logo__spectrum-runner');
  if (await startupRunner.count()) {
    const startupStart = await startupRunner.evaluate((element) => Number(element.getAnimations()[0]?.currentTime ?? -1));
    await window.waitForTimeout(250);
    const startupEnd = await startupRunner.evaluate((element) => Number(element.getAnimations()[0]?.currentTime ?? -1));
    if (startupStart < 0 || startupEnd <= startupStart) {
      throw new Error(`Startup Infinite loop is not loading: ${JSON.stringify({ startupStart, startupEnd })}`);
    }
    startupAnimationObserved = true;
  }

  const composer = window.getByLabel('Message Infinite OS', { exact: true });
  if (await composer.count() === 0) {
    await window.getByRole('button', { name: 'Open AI Chat', exact: true }).click();
    await composer.waitFor({ state: 'visible', timeout: 10_000 });
  }

  const controls = await window.locator('.os-traffic-lights .os-window-control').evaluateAll((buttons) =>
    buttons.map((button) => ({
      label: button.getAttribute('aria-label'),
      iconOpacity: Number.parseFloat(getComputedStyle(button.querySelector('.os-window-icon')).opacity),
    })),
  );
  const expectedControls = process.platform === 'darwin'
    ? ['Close window', 'Minimize window', 'Maximize or restore window']
    : ['Minimize window', 'Maximize or restore window', 'Close window'];
  if (controls.map((control) => control.label).join('|') !== expectedControls.join('|')) {
    throw new Error(`Unexpected window-control order: ${JSON.stringify(controls)}`);
  }
  if (controls.some((control) => control.iconOpacity <= 0)) {
    throw new Error(`Window-control icons are hidden: ${JSON.stringify(controls)}`);
  }

  if (await window.locator('.os-right-panel').count() !== 0) {
    throw new Error('The right activity panel should be closed on first launch.');
  }
  await window.getByRole('button', { name: 'Open notifications and activity', exact: true }).click();
  await window.locator('.os-right-panel').waitFor({ state: 'visible', timeout: 5_000 });

  const layout = await window.evaluate(() => {
    const topbar = document.querySelector('.os-topbar');
    const rightPanel = document.querySelector('.os-right-panel');
    const topbarChildren = topbar ? Array.from(topbar.children).map((child) => child.getBoundingClientRect().toJSON()) : [];
    const logo = document.querySelector('.infinite-logo');
    const logoRect = logo?.getBoundingClientRect();
    const titlebar = document.querySelector('.os-window-titlebar');
    const titlebarLine = titlebar ? getComputedStyle(titlebar, '::after') : null;
    return {
      topbar: topbar?.getBoundingClientRect().toJSON(),
      rightPanel: rightPanel?.getBoundingClientRect().toJSON(),
      topbarChildren,
      logo: logoRect?.toJSON(),
      logoPaths: logo?.querySelectorAll('path').length || 0,
      logoFragmentStrokes: logo ? Array.from(logo.querySelectorAll('path')).filter((path) => (path.getAttribute('stroke') || '').includes('url(')).length : 0,
      logoBrokenFragmentStrokes: logo ? Array.from(logo.querySelectorAll('path')).filter((path) => {
        const match = (path.getAttribute('stroke') || '').match(/^url\(#(.+)\)$/);
        return match ? !logo.querySelector(`[id="${match[1]}"]`) : false;
      }).length : 0,
      logoStrokes: logo ? Array.from(logo.querySelectorAll('path')).map((path) => (path.getAttribute('stroke') || '').toLowerCase()) : [],
      logoStops: logo ? Array.from(logo.querySelectorAll('stop')).map((stop) => (stop.getAttribute('stop-color') || '').toLowerCase()) : [],
      logoFallbacks: document.querySelectorAll('.infinite-logo__fallback').length,
      logos: document.querySelectorAll('.infinite-logo').length,
      logoStyle: document.documentElement.dataset.logoStyle,
      titlebarLine: titlebarLine ? { width: Number.parseFloat(titlebarLine.width), opacity: Number.parseFloat(titlebarLine.opacity) } : null,
    };
  });
  const topbarRight = layout.topbar?.right || 0;
  if (layout.rightPanel && topbarRight > layout.rightPanel.left + 0.5) {
    throw new Error(`Top bar overlaps the right panel: ${JSON.stringify(layout)}`);
  }
  if (layout.topbarChildren.some((child) => child.right > topbarRight + 0.5)) {
    throw new Error(`Top bar controls overflow their container: ${JSON.stringify(layout)}`);
  }
  const expectedLogoPaths = layout.logoStyle === 'luminous' ? 7 : layout.logoStyle === 'ice' ? 5 : 6;
  if (!layout.logo || layout.logo.width <= 0 || layout.logo.height <= 0 || layout.logoPaths < expectedLogoPaths || layout.logoFallbacks !== layout.logos || layout.logoBrokenFragmentStrokes !== 0) {
    throw new Error(`Infinite logo did not render: ${JSON.stringify(layout)}`);
  }
  const expectedPalette = layout.logoStyle === 'luminous'
    ? ['#fff']
    : layout.logoStyle === 'ice'
      ? ['#38bdf8', '#e0f2fe', '#0ea5e9']
      : ['#8b5cf6', '#22d3ee', '#ec4899'];
  const renderedPalette = [...layout.logoStrokes, ...layout.logoStops];
  if (!expectedPalette.every((color) => renderedPalette.includes(color))) {
    throw new Error(`Infinite logo is not using its intended palette: ${JSON.stringify(layout)}`);
  }
  const loader = window.locator(layout.logoStyle === 'luminous' ? '.infinite-logo__luminous-runner--cyan' : layout.logoStyle === 'ice' ? '.infinite-logo__ice-runner--cyan' : '.infinite-logo__spectrum-runner').first();
  const animationStart = await loader.evaluate((element) => Number(element.getAnimations()[0]?.currentTime ?? -1));
  await window.waitForTimeout(250);
  const animationEnd = await loader.evaluate((element) => Number(element.getAnimations()[0]?.currentTime ?? -1));
  if (animationStart < 0 || animationEnd <= animationStart) {
    throw new Error(`Infinite logo loader is not advancing: ${JSON.stringify({ animationStart, animationEnd })}`);
  }
  if (!layout.titlebarLine || layout.titlebarLine.width < 800 || layout.titlebarLine.opacity < 0.5) {
    throw new Error(`Title-bar glow line is missing or too faint: ${JSON.stringify(layout)}`);
  }

  await window.getByRole('button', { name: 'Canvas', exact: true }).click();
  await window.getByRole('heading', { name: 'Nodes', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  await window.getByRole('button', { name: 'Run', exact: true }).waitFor({ state: 'visible' });
  await window.getByRole('button', { name: 'Save', exact: true }).waitFor({ state: 'visible' });

  await window.getByRole('button', { name: 'Chats', exact: true }).click();
  await composer.waitFor({ state: 'visible', timeout: 10_000 });
  if (await window.getByRole('button', { name: 'Research', exact: true }).count() !== 0) {
    throw new Error('Research is still visible in the primary Chat mode bar.');
  }

  await composer.fill('Keep this exact request');
  const currentMode = window.locator('button[aria-label^="Current mode:"]');
  await currentMode.click();
  await window.getByRole('button', { name: /Research Mode/ }).click();
  await window.getByLabel('Current mode: Research Mode', { exact: true }).waitFor({ state: 'visible', timeout: 5_000 });
  if (await composer.inputValue() !== 'Keep this exact request') {
    throw new Error('Selecting Research Mode changed the composer text instead of changing mode state.');
  }
  await window.getByLabel('Switch to Code Mode', { exact: true }).click();
  await window.getByLabel('Current mode: Code Mode', { exact: true }).waitFor({ state: 'visible', timeout: 5_000 });
  if (await composer.inputValue() !== 'Keep this exact request') {
    throw new Error('Selecting Code Mode changed the composer text instead of changing mode state.');
  }
  await composer.fill('');

  const initialLogoStyle = await window.evaluate(() => document.documentElement.dataset.logoStyle || 'spectrum');
  await window.getByRole('button', { name: 'Settings', exact: true }).click();
  await window.getByRole('heading', { name: 'Settings', exact: true }).waitFor({ state: 'visible', timeout: 5_000 });
  await window.getByRole('button', { name: 'Use White Infinite logo style', exact: true }).click();
  const luminousLogo = window.locator('.os-sidebar .infinite-logo--luminous').first();
  await luminousLogo.waitFor({ state: 'visible', timeout: 5_000 });
  const luminousStart = await luminousLogo.locator('.infinite-logo__luminous-head').evaluate((element) => Number(element.getAnimations()[0]?.currentTime ?? -1));
  await window.waitForTimeout(250);
  const luminousEnd = await luminousLogo.locator('.infinite-logo__luminous-head').evaluate((element) => Number(element.getAnimations()[0]?.currentTime ?? -1));
  if (luminousStart < 0 || luminousEnd <= luminousStart) {
    throw new Error(`The selectable Luminous Loader is not animating: ${JSON.stringify({ luminousStart, luminousEnd })}`);
  }
  await window.getByRole('button', {
    name: initialLogoStyle === 'luminous' ? 'Use White Infinite logo style' : 'Use Original Spectrum logo style',
    exact: true,
  }).click();
  await window.getByRole('button', { name: 'Chats', exact: true }).click();

  const backend = await window.evaluate(async () => {
    const suffix = Date.now();
    const project = await window.api.appCreateProject({
      name: `Smoke App ${suffix}`,
      description: 'App Builder integration smoke test',
      framework: 'react',
      language: 'typescript',
      templateId: 'react_app',
    });
    const workflow = await window.api.automationCreateWorkflow({
      name: `Smoke Workflow ${suffix}`,
      description: 'Automation integration smoke test',
      trigger: { type: 'manual', config: {} },
      actions: [{ id: `notify-${suffix}`, type: 'notify', config: { message: 'Smoke test complete' } }],
    });

    try {
      const projects = await window.api.appListProjects();
      const build = await window.api.appBuild({ projectId: project.id });
      const run = await window.api.automationRunWorkflow({ workflowId: workflow.id });
      const disabled = await window.api.automationDisableWorkflow({ workflowId: workflow.id });
      const enabled = await window.api.automationEnableWorkflow({ workflowId: workflow.id });
      return {
        projectListed: projects.some((item) => item.id === project.id),
        build,
        run,
        disabled,
        enabled,
        projectId: project.id,
        workflowId: workflow.id,
      };
    } finally {
      await window.api.appDelete({ projectId: project.id });
      await window.api.automationDeleteWorkflow({ workflowId: workflow.id });
    }
  });

  if (!backend.projectListed || !backend.build?.success || backend.run?.status !== 'completed' || !backend.disabled || !backend.enabled) {
    throw new Error(`Builder/Automation integration failed: ${JSON.stringify(backend)}`);
  }

  console.log(JSON.stringify({ ok: true, controls, canvas: true, realModeSelection: true, startupAnimationObserved, selectableLoadingLogo: true, researchRemovedFromModeBar: true, builder: true, automation: true }, null, 2));
} finally {
  if (app) await app.close();
}
