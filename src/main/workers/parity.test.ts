import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Workers are four surfaces that must agree channel by channel:
 *
 *   shared/ipc.ts  → the channel constants
 *   src/main/ipc/workers.ts → the handlers
 *   src/preload/index.ts    → the renderer API
 *   WorkersView + panels    → what the user can actually click
 *
 * Every gap this guards against has happened here before: a handler with no
 * preload method (renderer gets `undefined is not a function`), a preload
 * method nobody renders (the feature exists but is unreachable), and a tool
 * the agent can call that the UI cannot inspect. These are static checks, so
 * they hold without a browser and fail the moment one side moves.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(resolve(here, relative), 'utf8');

const sharedSource = read('../../shared/ipc.ts');
const ipcSource = read('../ipc/workers.ts');
const preloadSource = read('../../preload/index.ts');
const mainViewSource = read('../../renderer/components/layout/MainView.tsx');
const sidebarSource = read('../../renderer/components/layout/Sidebar.tsx');
// The app ships two sidebars; `uiTheme === 'classic'` renders this one instead.
const classicSidebarSource = read('../../renderer/components/layout/SidebarClassic.tsx');
const viewSource = read('../../renderer/components/views/WorkersView.tsx');
const registrySource = read('../tools/registry.ts');
const workerToolSource = read('../tools/worker.ts');
const vaultToolSource = read('../tools/worker-vault.ts');
const teachingToolSource = read('../tools/teaching.ts');
const baseSource = read('../tools/base.ts');
const storeSource = read('../../renderer/stores/workers.ts');
// Panels call window.api directly for the actions that belong to their own UI.
const rendererSource = [
  storeSource,
  read('../../renderer/components/workers/WorkersPanel.tsx'),
  read('../../renderer/components/workers/TeachingPanel.tsx'),
  read('../../renderer/components/workers/AppsPanel.tsx'),
  read('../../renderer/components/workers/VaultPanel.tsx'),
].join('\n');

/** Every channel this feature owns, in declaration order. */
const CHANNELS = Array.from(
  (sharedSource.match(/\b(WORKERS|TEACH|APPS|VAULT)_[A-Z0-9_]+(?=:)/g) ?? []),
);

describe('every worker channel has a handler and a renderer method', () => {
  it('declares the expected channel groups', () => {
    expect(CHANNELS.length).toBeGreaterThanOrEqual(30);
    for (const prefix of ['WORKERS_', 'TEACH_', 'APPS_', 'VAULT_']) {
      expect(CHANNELS.some((channel) => channel.startsWith(prefix))).toBe(true);
    }
  });

  for (const channel of new Set(CHANNELS)) {
    it(`${channel} is handled in main`, () => {
      expect(ipcSource).toContain(`IPC.${channel}`);
    });

    it(`${channel} is exposed through the preload`, () => {
      // Push channels (main → renderer) are subscribed, not invoked.
      const isPush = channel.endsWith('_EVENT');
      expect(preloadSource).toContain(`IPC.${channel}`);
      if (isPush) expect(preloadSource).toContain('ipcRenderer.on(IPC.');
    });
  }

  it('registers its handlers exactly once, from the IPC entry point', () => {
    expect(ipcSource).toContain('export function registerWorkersIpc');
    expect(read('../ipc/index.ts')).toContain('registerWorkersIpc(getMainWindow)');
  });
});

describe('the UI the user sees covers the same feature', () => {
  it('Workers is a routed top-level view', () => {
    expect(mainViewSource).toContain("case 'workers'");
    expect(mainViewSource).toContain('const WorkersView = lazy(');
    expect(sidebarSource).toContain("id: 'workers'");
    // The classic theme renders SidebarClassic instead — Workers was invisible
    // there until the packaged test caught it.
    expect(classicSidebarSource).toContain("id: 'workers'");
  });

  it('routes through all four panels', () => {
    for (const panel of ['WorkersPanel', 'TeachingPanel', 'AppsPanel', 'VaultPanel']) {
      expect(viewSource).toContain(panel);
    }
  });

  it('drives every panel through the preload API', () => {
    for (const method of [
      'workerList', 'workerGet', 'workerCreate', 'workerUpdate', 'workerRun', 'workerPause', 'workerResume',
      'workerCancel', 'workerInterject', 'workerHistory', 'workerDelete', 'workerOpenFolder', 'workerBackgroundSet',
      'teachStart', 'teachStop', 'teachNarrate', 'teachRename', 'teachList', 'teachGet', 'teachDelete',
      'teachCompile', 'teachFrame', 'teachUpdateSteps', 'teachCreateWorker',
      'appsList', 'appsInstall', 'appsLaunch',
      'vaultList', 'vaultAdd', 'vaultAuthorize', 'vaultDelete',
    ]) {
      expect(preloadSource).toContain(`${method}:`);
      expect(rendererSource).toContain(`.${method}(`);
    }
  });

  it('subscribes to both push streams so scheduled runs still update the UI', () => {
    expect(preloadSource).toContain('onWorkerEvent');
    expect(preloadSource).toContain('onTeachEvent');
    expect(storeSource).toContain('window.api.onWorkerEvent');
    expect(storeSource).toContain('window.api.onTeachEvent');
  });
});

describe('the agent-facing tools stay non-core and gated', () => {
  it('registers Worker, WorkerVault and Teaching', () => {
    for (const alias of ['workerTool', 'workerVaultTool', 'teachingTool']) {
      expect(registrySource).toContain(`import { ${alias} }`);
      expect(registrySource).toContain(`    ${alias},`);
    }
  });

  it('keeps them out of the core prompt budget', () => {
    for (const name of ['Worker', 'WorkerVault', 'Teaching']) {
      expect(baseSource).not.toContain(`'${name}'`);
    }
  });

  it('asks before mutating worker state, but allows the consent-gated vault', () => {
    expect(workerToolSource).toContain("permission: 'ask'");
    expect(teachingToolSource).toContain("permission: 'ask'");
    expect(vaultToolSource).toContain("permission: 'allow'");
    // The vault's real gate: only a session that is a running worker, and only
    // credentials the user authorized to that worker.
    expect(vaultToolSource).toContain('findByWorkflowId(ctx.sessionId)');
    expect(vaultToolSource).toContain('vault.list(worker.id)');
    expect(vaultToolSource).toContain('vault.resolveSecret(entry.id, worker.id)');
    expect(vaultToolSource).toContain('typeSecret');
  });
});
