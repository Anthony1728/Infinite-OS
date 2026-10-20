import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const savedHome = process.env.INFINITE_TEST_HOME;
const testHome = mkdtempSync(join(tmpdir(), 'voice-assistant-'));
process.env.INFINITE_TEST_HOME = testHome;

const assistant = await import('./assistant.js');
const {
  addCustomCommand,
  clearHistory,
  getVoiceConfig,
  listCustomCommands,
  listHistory,
  processTranscript,
  removeCustomCommand,
  resetVoiceAssistantForTests,
  setVoiceConfig,
} = assistant;

beforeEach(() => {
  rmSync(join(testHome, 'voice'), { recursive: true, force: true });
  resetVoiceAssistantForTests();
});

afterAll(() => {
  rmSync(testHome, { recursive: true, force: true });
  if (savedHome === undefined) delete process.env.INFINITE_TEST_HOME;
  else process.env.INFINITE_TEST_HOME = savedHome;
});

describe('voice assistant settings', () => {
  it('returns defaults on a fresh install', () => {
    expect(getVoiceConfig().wakeWord).toBe('hey infinite');
    expect(getVoiceConfig().autoSpeak).toBe(true);
    expect(listCustomCommands()).toEqual([]);
    expect(listHistory()).toEqual([]);
  });

  it('persists config patches across reloads', () => {
    setVoiceConfig({ language: 'es-ES', rate: 1.5, autoSpeak: false });
    expect(getVoiceConfig().language).toBe('es-ES');
    expect(getVoiceConfig().autoSpeak).toBe(false);

    resetVoiceAssistantForTests();
    expect(getVoiceConfig().language).toBe('es-ES');
    expect(getVoiceConfig().rate).toBe(1.5);
    expect(getVoiceConfig().autoSpeak).toBe(false);
  });

  it('clamps out-of-range values', () => {
    setVoiceConfig({ rate: 99, pitch: -3, volume: 10 });
    expect(getVoiceConfig().rate).toBe(2);
    expect(getVoiceConfig().pitch).toBe(0.5);
    expect(getVoiceConfig().volume).toBe(1);
  });

  it('defaults the offline speech model to base.en', () => {
    expect(getVoiceConfig().sttModel).toBe('base.en');
    expect(assistant.KNOWN_STT_MODELS).toContain('base.en');
  });

  it('keeps a known speech model and rejects an unknown one', () => {
    setVoiceConfig({ sttModel: 'small.en' });
    expect(getVoiceConfig().sttModel).toBe('small.en');

    // Anything Faster-Whisper would refuse at load time must never be
    // persisted — the engine would then fail on every single utterance.
    setVoiceConfig({ sttModel: '../../etc/passwd' });
    expect(getVoiceConfig().sttModel).toBe('small.en');

    setVoiceConfig({ sttModel: '   ' });
    expect(getVoiceConfig().sttModel).toBe('small.en');
  });

  it('repairs a stale speech model read back from disk', () => {
    setVoiceConfig({ sttModel: 'medium' });
    const stateFile = join(testHome, 'voice', 'assistant.json');
    const raw = JSON.parse(readFileSync(stateFile, 'utf8')) as { config: Record<string, unknown> };
    raw.config.sttModel = 'no-such-model';
    writeFileSync(stateFile, JSON.stringify(raw), 'utf8');

    resetVoiceAssistantForTests();
    expect(getVoiceConfig().sttModel).toBe('base.en');
  });

  it('adds, replaces, and removes custom commands', () => {
    addCustomCommand('open email', 'Open my inbox and summarize new messages');
    addCustomCommand('OPEN EMAIL', 'Replaced action');
    expect(listCustomCommands()).toHaveLength(1);
    expect(listCustomCommands()[0].action).toBe('Replaced action');

    addCustomCommand('start focus', 'Start a 25 minute focus timer');
    expect(listCustomCommands()).toHaveLength(2);

    removeCustomCommand('Open Email');
    expect(listCustomCommands()).toHaveLength(1);
    expect(listCustomCommands()[0].trigger).toBe('start focus');
  });

  it('ignores empty custom commands', () => {
    addCustomCommand('   ', 'action');
    addCustomCommand('trigger', '  ');
    expect(listCustomCommands()).toEqual([]);
  });
});

describe('processTranscript', () => {
  it('detects the wake word alone', () => {
    const result = processTranscript('Hey Infinite');
    expect(result.intent).toBe('wake_word_detected');
    expect(result.response).toBeTruthy();
  });

  it('strips the wake word and returns chat text', () => {
    const result = processTranscript('hey infinite, what is the weather tomorrow?');
    expect(result.intent).toBe('chat');
    expect(result.text).toBe('what is the weather tomorrow?');
  });

  it('matches custom commands after the wake word', () => {
    addCustomCommand('open email', 'Check my inbox');
    const result = processTranscript('hey infinite open email please');
    expect(result.intent).toBe('custom_command');
    expect(result.trigger).toBe('open email');
    expect(result.response).toBe('Check my inbox');
  });

  it('matches custom commands without the wake word', () => {
    addCustomCommand('focus mode', 'Start focus mode');
    const result = processTranscript('start focus mode now');
    expect(result.intent).toBe('custom_command');
    expect(result.response).toBe('Start focus mode');
  });

  it('stops listening on exact stop phrases', () => {
    expect(processTranscript('stop listening').intent).toBe('stop_listening');
    expect(processTranscript('hey infinite stop').intent).toBe('stop_listening');
    expect(processTranscript('mute').intent).toBe('stop_listening');
  });

  it('does not stop on longer sentences that merely mention stopping', () => {
    expect(processTranscript('how do I stop listening to music on my phone').intent).toBe('chat');
  });

  it('records history and clears it', () => {
    processTranscript('hey infinite');
    processTranscript('tell me a joke');
    const history = listHistory();
    expect(history).toHaveLength(2);
    expect(history[0].intent).toBe('wake_word_detected');
    expect(history[1].intent).toBe('chat');
    clearHistory();
    expect(listHistory()).toEqual([]);
  });

  it('falls back to chat for empty input', () => {
    expect(processTranscript('   ').intent).toBe('chat');
  });
});
