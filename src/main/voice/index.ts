// Voice Module — Speech-to-Text and Text-to-Speech using OpenAI API

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export class VoiceManager {
  private apiKey: string | null = null;
  private dataDir: string;

  constructor() {
    this.dataDir = join(homedir(), '.infinite-ai', 'voice');
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
  }

  setApiKey(key: string): void {
    this.apiKey = key;
  }

  isAvailable(): boolean {
    return this.apiKey !== null && this.apiKey !== '';
  }

  async speechToText(audioBuffer: Buffer, format: string = 'mp3'): Promise<string> {
    if (!this.apiKey) {
      throw new Error('OpenAI API key required for speech-to-text');
    }

    // Save audio to temp file
    const tempPath = join(this.dataDir, `stt_temp.${format}`);
    writeFileSync(tempPath, audioBuffer);

    try {
      // Use OpenAI Whisper API
      const formData = new FormData();
      formData.append('file', new Blob([readFileSync(tempPath)]), `audio.${format}`);
      formData.append('model', 'whisper-1');
      formData.append('language', 'en');

      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: formData,
      });

      const data: any = await response.json();
      if (data.error) throw new Error(data.error.message);
      return data.text || '';
    } finally {
      try { writeFileSync(tempPath, Buffer.alloc(0)); } catch { /* ignore */ }
    }
  }

  async textToSpeech(text: string, voice: string = 'alloy'): Promise<Buffer> {
    if (!this.apiKey) {
      throw new Error('OpenAI API key required for text-to-speech');
    }

    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: 'tts-1',
        voice,
        input: text.slice(0, 4096), // TTS limit
      }),
    });

    if (!response.ok) {
      const err: any = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || 'TTS failed');
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async textToSpeechFile(text: string, outputPath: string, voice: string = 'alloy'): Promise<string> {
    const buffer = await this.textToSpeech(text, voice);
    writeFileSync(outputPath, buffer);
    return outputPath;
  }

  getVoices(): string[] {
    return ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
  }
}

let voiceInstance: VoiceManager | null = null;

export function getVoice(): VoiceManager {
  if (!voiceInstance) voiceInstance = new VoiceManager();
  return voiceInstance;
}
