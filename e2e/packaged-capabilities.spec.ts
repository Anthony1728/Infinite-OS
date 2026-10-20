import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';

/**
 * The capability layers, in the packaged build.
 *
 * `app-smoke.spec.ts` proves the app boots. `packaged-business.spec.ts` proves
 * the Business section works. Neither proves the agent can actually *reach* the
 * new capabilities.
 *
 * This matters because a tool that is compiled but not registered, or registered
 * but not attached to a turn, fails completely silently: the agent simply never
 * finds GIMP or the skill library and reports that it cannot do the thing. No
 * source-level test catches that, because at source level it is registered.
 *
 * Needs `npm run build:win` first; skips without it.
 */

const exe = resolve('dist/win-unpacked/Infinite OS.exe');
const hasPackagedBuild = existsSync(exe);

test.describe('packaged agent capabilities', () => {
  let app: ElectronApplication | null = null;

  test.afterEach(async () => {
    if (app) {
      await app.close().catch(() => {});
      app = null;
    }
  });

  async function launch(): Promise<ElectronApplication> {
    app = await electron.launch({
      executablePath: exe,
      args: [`--user-data-dir=${process.env.TEMP}\\infinite-os-capability-smoke`],
      env: { ...process.env, INFINITE_DISABLE_GPU: '1' },
      timeout: 90_000,
    });
    return app;
  }

  test('the agent can see both capability tools in the packaged build', async () => {
    test.skip(!hasPackagedBuild, 'run `npm run build:win` first');
    test.setTimeout(180_000);

    const running = await launch();
    const win = await running.firstWindow({ timeout: 60_000 });

    const tools = await win.evaluate(async () => {
      const api = (window as unknown as { api: { listTools: () => Promise<unknown> } }).api;
      return (await api.listTools()) as { name: string; description?: string; input_schema?: unknown }[];
    });

    const names = tools.map(t => t.name);
    expect(names.length).toBeGreaterThan(50);

    // CliHub: find, install and run agent-native CLIs.
    expect(names).toContain('CliHub');
    // Skills: the public skill library, reached through the existing tool.
    expect(names).toContain('Skills');

    // Both must ship a schema, or the model cannot call them at all. An empty
    // description is the same failure as a missing tool: the model has nothing
    // to go on.
    const cliHub = tools.find(t => t.name === 'CliHub');
    expect(cliHub?.description?.length ?? 0).toBeGreaterThan(80);
    expect(cliHub?.input_schema).toBeTruthy();

    const skills = tools.find(t => t.name === 'Skills');
    expect(skills?.description).toContain('hub_search');
    // The hub actions must be advertised in the enum, or the model will not
    // know they are callable.
    expect(JSON.stringify(skills?.input_schema)).toContain('hub_install');
  });

  test('the packaged build exposes the REA gateway', async () => {
    test.skip(!hasPackagedBuild, 'run `npm run build:win` first');
    test.setTimeout(180_000);

    const running = await launch();
    const win = await running.firstWindow({ timeout: 60_000 });

    const tools = await win.evaluate(async () => {
      const api = (window as unknown as { api: { listTools: () => Promise<unknown> } }).api;
      return (await api.listTools()) as { name: string; description?: string; input_schema?: unknown }[];
    });

    const rea = tools.find((tool) => tool.name === 'Rea');
    expect(rea).toBeDefined();
    // REA is stateful; the description must teach the open_binary-first
    // workflow or a model will call an inspection tool against nothing.
    expect(rea?.description).toContain('open_binary');
    expect(JSON.stringify(rea?.input_schema)).toContain('install');
  });

  test('the packaged build exposes graph memory, pentest, and OpenAPI', async () => {
    test.skip(!hasPackagedBuild, 'run `npm run build:win` first');
    test.setTimeout(180_000);

    const running = await launch();
    const win = await running.firstWindow({ timeout: 60_000 });

    const tools = await win.evaluate(async () => {
      const api = (window as unknown as { api: { listTools: () => Promise<unknown> } }).api;
      return (await api.listTools()) as { name: string; description?: string; input_schema?: unknown }[];
    });

    const knowledge = tools.find((tool) => tool.name === 'Knowledge');
    expect(knowledge).toBeDefined();
    expect(JSON.stringify(knowledge?.input_schema)).toContain('graph_recall');
    expect(JSON.stringify(knowledge?.input_schema)).toContain('dataset');

    const pentest = tools.find((tool) => tool.name === 'Pentest');
    expect(pentest).toBeDefined();
    expect(pentest?.description?.length ?? 0).toBeGreaterThan(60);
    expect(JSON.stringify(pentest?.input_schema)).toContain('authorization');

    const apiConnector = tools.find((tool) => tool.name === 'APIConnector');
    expect(apiConnector).toBeDefined();
    expect(JSON.stringify(apiConnector?.input_schema)).toContain('import_openapi');
    expect(JSON.stringify(apiConnector?.input_schema)).toContain('invoke');
  });

  test('the packaged build exposes Worker, WorkerVault and Teaching', async () => {
    test.skip(!hasPackagedBuild, 'run `npm run build:win` first');
    test.setTimeout(180_000);

    const running = await launch();
    const win = await running.firstWindow({ timeout: 60_000 });

    const tools = await win.evaluate(async () => {
      const api = (window as unknown as { api: { listTools: () => Promise<unknown> } }).api;
      return (await api.listTools()) as { name: string; description?: string; input_schema?: unknown }[];
    });

    const worker = tools.find((tool) => tool.name === 'Worker');
    expect(worker).toBeDefined();
    expect(worker?.description?.length ?? 0).toBeGreaterThan(80);
    expect(JSON.stringify(worker?.input_schema)).toContain('interject');
    expect(JSON.stringify(worker?.input_schema)).toContain('history');

    const vault = tools.find((tool) => tool.name === 'WorkerVault');
    expect(vault).toBeDefined();
    // The vault's only safe action is typing a secret the user authorized —
    // if `type` is missing from the schema, every scheduled sign-in dies here.
    expect(JSON.stringify(vault?.input_schema)).toContain('type');
    expect(JSON.stringify(vault?.input_schema)).toContain('list');

    const teaching = tools.find((tool) => tool.name === 'Teaching');
    expect(teaching).toBeDefined();
    expect(JSON.stringify(teaching?.input_schema)).toContain('narrate');
    expect(JSON.stringify(teaching?.input_schema)).toContain('create_worker');

    // The renderer side of the same feature: every entry point the panels call
    // must exist on `window.api`, or the UI throws the moment it is used.
    const missing = await win.evaluate(() => {
      const api = (window as unknown as { api: Record<string, unknown> }).api;
      return [
        'workerList', 'workerCreate', 'workerUpdate', 'workerRun', 'workerInterject',
        'workerOpenFolder', 'workerBackgroundSet',
        'teachStart', 'teachStop', 'teachNarrate', 'teachCompile', 'teachUpdateSteps', 'teachCreateWorker',
        'appsList', 'appsInstall', 'appsLaunch',
        'vaultList', 'vaultAdd', 'vaultAuthorize',
      ].filter((method) => typeof api[method] !== 'function');
    });
    expect(missing).toEqual([]);
  });

  test('the Workers section is reachable from the sidebar', async () => {
    test.skip(!hasPackagedBuild, 'run `npm run build:win` first');
    test.setTimeout(180_000);

    const running = await launch();
    const win = await running.firstWindow({ timeout: 60_000 });

    // Sidebar entry first — a view nobody can navigate to does not exist for
    // the person using the app, however well the store is tested.
    await win.getByRole('button', { name: 'Workers', exact: true }).first().click({ timeout: 30_000 });
    await expect(win.getByText('Keep running in background')).toBeVisible({ timeout: 30_000 });

    // Every tab of the section renders without a renderer crash.
    for (const tab of ['Teach', 'Apps', 'Vault']) {
      await win.getByRole('button', { name: new RegExp(`^${tab}`) }).first().click({ timeout: 15_000 });
    }
    await expect(win.getByText('Add credential')).toBeVisible({ timeout: 15_000 });
  });
});