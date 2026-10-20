// Local voice server client: script discovery, the NDJSON pipe protocol
// (start/stop/warm/dispose), and event fan-out to subscribers. The Python
// child is replaced by a fake so these run without touching a microphone.

import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalVoiceService, isLocalVoiceScriptAvailable, localVoiceScript } from './local-voice.js';

interface FakeChild {
  stdout: EventEmitter & { setEncoding: (_enc: string) => void };
  stderr: EventEmitter & { setEncoding: (_enc: string) => void };
  stdin: { destroyed: boolean; written: string[]; write: (_s: string) => boolean; end: () => void };
  exitCode: number | null;
  killed: boolean;
  kill: () => void;
  emitLine: (event: Record<string, unknown>) => void;
}

vi.mock('node:child_process', async () => {
  const { EventEmitter: Emitter } = await vi.importActual<typeof import('node:events')>('node:events');
  const spawned: FakeChild[] = [];

  class FakeChildImpl extends Emitter {
    stdout = new Emitter() as FakeChild['stdout'];
    stderr = new Emitter() as FakeChild['stderr'];
    stdin: FakeChild['stdin'] = {
      destroyed: false,
      written: [],
      write: (line: string) => {
        this.stdin.written.push(line);
        return true;
      },
      end: () => {
        this.stdin.destroyed = true;
      },
    };
    exitCode: number | null = null;
    killed = false;
    kill = (): void => {
      this.killed = true;
      this.exitCode = 0;
      this.emit('exit', 0);
    };
    emitLine(event: Record<string, unknown>): void {
      this.stdout.emit('data', `${JSON.stringify(event)}\n`);
    }
    constructor() {
      super();
      this.stdout.setEncoding = () => undefined;
      this.stderr.setEncoding = () => undefined;
    }
  }

  return {
    spawn: (_cmd: string, _args: string[], _opts?: unknown) => {
      const child = new FakeChildImpl();
      spawned.push(child);
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
    __spawned: spawned,
  };
});

const childProcess = (await import('node:child_process')) as unknown as { __spawned: FakeChild[] };

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const lastChild = (): FakeChild => {
  const child = childProcess.__spawned[childProcess.__spawned.length - 1];
  if (!child) throw new Error('no child was spawned');
  return child;
};

const commands = (child: FakeChild): Array<{ cmd: string; id: number }> =>
  child.stdin.written.map((line) => JSON.parse(line) as { cmd: string; id: number });

const sent = (child: FakeChild, cmd: string): boolean => commands(child).some((c) => c.cmd === cmd);

afterEach(() => {
  for (const child of childProcess.__spawned) {
    if (child.exitCode === null) child.kill();
  }
  childProcess.__spawned.length = 0;
});

describe('local voice script discovery', () => {
  it('resolves the shipped server from the dev tree', () => {
    const script = localVoiceScript();
    expect(script).toBeTruthy();
    expect(existsSync(script as string)).toBe(true);
    expect(isLocalVoiceScriptAvailable()).toBe(true);
  });
});

describe('LocalVoiceService pipe protocol', () => {
  it('spawns exactly one child and reuses the pipe', async () => {
    const service = new LocalVoiceService();
    await expect(service.ensure()).resolves.toBe(true);
    await expect(service.ensure()).resolves.toBe(true);
    expect(childProcess.__spawned).toHaveLength(1);
    service.dispose();
  });

  it('resolves start() once the server reports start_result', async () => {
    const service = new LocalVoiceService();
    const pending = service.start({ model: 'base.en', language: 'en-US' });
    await tick();
    const child = lastChild();
    const start = commands(child).find((c) => c.cmd === 'start');
    expect(start).toBeTruthy();

    child.emitLine({ type: 'ready', engine: 'local-whisper', model: 'base.en' });
    child.emitLine({
      type: 'start_result',
      id: start?.id,
      ok: true,
      engine: 'local-whisper',
      model: 'base.en',
    });

    await expect(pending).resolves.toEqual({
      ok: true,
      engine: 'local-whisper',
      model: 'base.en',
    });
    expect(service.activeListening).toBe(true);
    service.dispose();
  });

  it('surfaces the server message when start() is refused', async () => {
    const service = new LocalVoiceService();
    const pending = service.start({ model: 'base.en' });
    await tick();
    const child = lastChild();
    const start = commands(child).find((c) => c.cmd === 'start');

    child.emitLine({
      type: 'start_result',
      id: start?.id,
      ok: false,
      error: 'No microphone is available (sounddevice/PortAudio).',
    });

    await expect(pending).resolves.toEqual({
      ok: false,
      engine: 'local-whisper',
      model: 'base.en',
      error: 'No microphone is available (sounddevice/PortAudio).',
    });
    expect(service.activeListening).toBe(false);
    service.dispose();
  });

  it('forwards events to subscribers until they unsubscribe', async () => {
    const service = new LocalVoiceService();
    await service.ensure();
    const child = lastChild();

    const seen: string[] = [];
    const stop = service.onEvent((event) => seen.push(event.type));

    child.emitLine({ type: 'ready' });
    child.emitLine({ type: 'result', transcript: 'hello world', final: true });
    expect(seen).toEqual(['ready', 'result']);

    stop();
    child.emitLine({ type: 'result', transcript: 'ignored' });
    expect(seen).toEqual(['ready', 'result']);
    service.dispose();
  });

  it('warms the model without opening the microphone', async () => {
    const service = new LocalVoiceService();
    await service.warm();
    const child = lastChild();
    expect(sent(child, 'boot')).toBe(true);
    expect(service.activeListening).toBe(false);
    service.dispose();
  });

  it('stop() is a no-op when nothing ever started', async () => {
    const service = new LocalVoiceService();
    await expect(service.stop()).resolves.toBeUndefined();
    expect(childProcess.__spawned).toHaveLength(0);
    expect(service.activeListening).toBe(false);
  });

  it('dispose() sends shutdown and closes stdin', async () => {
    const service = new LocalVoiceService();
    await service.ensure();
    const child = lastChild();

    service.dispose();

    expect(sent(child, 'shutdown')).toBe(true);
    expect(child.stdin.destroyed).toBe(true);
    expect(service.isRunning).toBe(false);
  });
});
