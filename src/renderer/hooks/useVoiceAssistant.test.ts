import { describe, expect, it } from 'vitest';
import { transcriptFromResults } from './useVoiceAssistant';

function speechResult(text: string, isFinal: boolean, alternatives: Array<[string, number]> = []) {
  const choices = [[text, 0.7] as [string, number], ...alternatives].map(([transcript, confidence]) => ({
    transcript,
    confidence,
  }));
  return Object.assign(choices, { isFinal });
}

describe('standalone speech transcription', () => {
  it('keeps completed phrases and appends the current interim phrase', () => {
    const results = [
      speechResult('build a project dashboard', true),
      speechResult('with visible progress', false),
    ];

    expect(transcriptFromResults(results)).toEqual({
      finalTranscript: 'build a project dashboard',
      interimTranscript: 'with visible progress',
      transcript: 'build a project dashboard with visible progress',
    });
  });

  it('uses the highest-confidence alternative supplied by the speech engine', () => {
    const results = [speechResult('open male', true, [['open mail', 0.96]])];

    expect(transcriptFromResults(results).transcript).toBe('open mail');
  });
});
