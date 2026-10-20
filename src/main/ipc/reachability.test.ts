import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * "Finished but unreachable" — the bug class that kept producing real defects.
 *
 * `providers/freebuff.ts` was a complete adapter that nothing could select.
 * The self-evolution engine and the background-build feature were finished and
 * registered but had no preload exposure and no caller, so no user could reach
 * them. Each was found by asking a narrow question, not by reading code.
 *
 * This asks it continuously: an IPC handler that is registered in main but not
 * reachable from the renderer is a feature the app has and the user does not.
 * Push channels (webContents.send) are a separate shape and are not flagged.
 */

const root = process.cwd();
const ipcSource = readFileSync(join(root, 'src', 'shared', 'ipc.ts'), 'utf8');
const preloadSource = readFileSync(join(root, 'src', 'preload', 'index.ts'), 'utf8');

/** Channel constants: NAME: 'channel-string' */
const channelMap = new Map<string, string>();
for (const m of ipcSource.matchAll(/^\s{2}([A-Z0-9_]+):\s*'([^']+)'/gm)) {
  channelMap.set(m[1], m[2]);
}

/** Every handler registered anywhere under src/main/ipc, by channel name. */
function registeredHandlers(): string[] {
  const dir = join(root, 'src', 'main', 'ipc');
  const names: string[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
    const src = readFileSync(join(dir, file), 'utf8');
    // Both forms matter. An earlier version of this scan only matched
    // `IPC.CONSTANT`, which quietly skipped every handler registered on a raw
    // string channel — including the whole live computer-automation surface,
    // which is written that way. A scan with a blind spot is worse than none,
    // because it reports a clean result it cannot actually see behind.
    for (const m of src.matchAll(/ipcMain\.handle\(\s*IPC\.([A-Z0-9_]+)/g)) names.push(m[1]);
    for (const m of src.matchAll(/ipcMain\.handle\(\s*'([^']+)'/g)) names.push(m[1]);
  }
  return [...new Set(names)];
}

/** Channels the preload bridge references, by constant name and by raw string. */
function preloadChannels(): Set<string> {
  const out = new Set<string>(channelMap.values());
  for (const m of preloadSource.matchAll(/IPC\.([A-Z0-9_]+)/g)) {
    const channel = channelMap.get(m[1]);
    if (channel) out.add(channel);
  }
  for (const m of preloadSource.matchAll(/invoke\(\s*'([^']+)'/g)) out.add(m[1]);
  for (const m of preloadSource.matchAll(/\bon\(\s*'([^']+)'/g)) out.add(m[1]);
  return out;
}

describe('no unreachable IPC handlers', () => {
  it('finds handlers to check', () => {
    // Guard against the scan silently matching nothing, which would make every
    // assertion below pass for the wrong reason. The threshold is high because
    // both registration forms are counted: the app registers several hundred.
    expect(registeredHandlers().length).toBeGreaterThan(300);
  });

  it('exposes every registered handler on the preload bridge', () => {
    const exposed = preloadChannels();
    const unreachable = registeredHandlers().filter((name) => {
      const channel = channelMap.get(name) ?? name;
      return !exposed.has(channel);
    });
    expect(
      unreachable,
      'registered but unreachable from the renderer — either wire a UI or delete the handler',
    ).toEqual([]);
  });

  it('exposes the self-evolution engine, which had no UI at all', () => {
    // Named individually because it was the largest instance: finished backend,
    // seven registered handlers, zero renderer references.
    for (const name of [
      'SELF_EVOLVE_ANALYZE', 'SELF_EVOLVE_SUGGESTIONS', 'SELF_EVOLVE_ACCEPT',
      'SELF_EVOLVE_DISMISS', 'SELF_EVOLVE_STATUS', 'SELF_EVOLVE_PROMPT', 'SELF_EVOLVE_EVOLVE',
    ]) {
      expect(channelMap.has(name), `${name} is missing from the channel map`).toBe(true);
      expect(preloadSource, `${name} is registered but not exposed`).toContain(`IPC.${name}`);
    }
  });

  it('exposes the background-build feature', () => {
    for (const name of ['BUILD_START', 'BUILD_STATUS', 'BUILD_CANCEL', 'BUILD_HAS_UPDATE', 'BUILD_CLEAR_UPDATE']) {
      expect(preloadSource, `${name} is registered but not exposed`).toContain(`IPC.${name}`);
    }
  });

  it('does not re-introduce the duplicate COMPUTER_* constants', () => {
    // Computer control is still exposed over IPC, on the raw `computer:*`
    // channels in ipc/computer-automation.ts — that surface is live and the
    // renderer uses it. What was removed is the second `COMPUTER_*` constant
    // family: a duplicate implementation with no preload exposure and no
    // caller, so these constants should stay deleted.
    for (const name of ['COMPUTER_MOVE_MOUSE', 'COMPUTER_CLICK_MOUSE', 'COMPUTER_TYPE_TEXT', 'COMPUTER_PRESS_KEY']) {
      expect(channelMap.has(name), `${name} is a dead duplicate and should stay removed`).toBe(false);
    }
    expect(preloadSource).not.toContain('IPC.COMPUTER_');
  });

  it('exposes usage totals, which were computed and discarded', () => {
    for (const name of ['USAGE_GET', 'USAGE_RESET']) {
      expect(preloadSource, `${name} is registered but not exposed`).toContain(`IPC.${name}`);
    }
  });
});