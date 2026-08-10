import { afterEach, describe, expect, it } from 'vitest';
import { dictationExitMessage, windowsDictation } from './windows-dictation';

describe('dictationExitMessage', () => {
  it('returns undefined for a clean exit', () => {
    expect(dictationExitMessage(0, '')).toBeUndefined();
    expect(dictationExitMessage(null, '')).toBeUndefined();
  });

  it('keeps the bare message when there is no diagnostic output', () => {
    expect(dictationExitMessage(2, '')).toBe('Windows dictation exited with code 2.');
  });

  it('appends the real stderr reason so failures are diagnosable', () => {
    const reason = dictationExitMessage(
      2,
      'No Windows speech recognition language is installed.',
    );
    expect(reason).toBe(
      'Windows dictation exited with code 2. No Windows speech recognition language is installed.',
    );
  });

  it('filters PowerShell CLIXML noise from the message', () => {
    const reason = dictationExitMessage(
      2,
      '#< CLIXML\n<Objs Version="1.1.0.1"><Obj>S</Obj></Objs>\nThe engine is not available.',
    );
    expect(reason).toContain('The engine is not available.');
    expect(reason).not.toContain('CLIXML');
    expect(reason).not.toContain('Objs');
  });
});

describe.skipIf(process.platform !== 'win32')('Windows standalone dictation', () => {
  afterEach(() => windowsDictation.stop());

  it('opens the installed Windows recognizer and default microphone without an AI provider', async () => {
    const events: string[] = [];
    const result = await windowsDictation.start((event) => events.push(event.type));

    expect(result).toEqual({ ok: true, engine: 'windows-local' });
    expect(events).toContain('ready');
    expect(windowsDictation.isListening()).toBe(true);
  }, 12_000);
});
