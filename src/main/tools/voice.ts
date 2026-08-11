// Voice tool — text-to-speech and voice listing via the VoiceManager.
// Gives the agent direct speech output using Edge TTS or OpenAI TTS.

import type { Tool, ToolResult } from './base.js';
import { join } from 'node:path';
import { homedir } from 'node:os';

interface VoiceInput {
  action: string;
  text?: string;
  voice?: string;
  output_path?: string;
}

export const voiceTool: Tool = {
  name: 'Voice',
  description: 'Text-to-speech: speak text aloud using Edge TTS (free neural voices) or OpenAI TTS, list available voices, or save speech to an MP3 file. Use this when the user wants to hear something read aloud or needs audio output.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['speak', 'list_voices', 'save'] },
      text: { type: 'string', description: 'Text to speak or save as speech.' },
      voice: { type: 'string', description: 'Voice ID (e.g. "ava", "brian", "aria"). Defaults to best available.' },
      output_path: { type: 'string', description: 'File path to save the MP3 (for "save" action). Defaults to ~/.infinite-ai/voice/output.mp3.' },
    },
    required: ['action'],
  },
  permission: 'none',

  async execute(args, _ctx): Promise<ToolResult> {
    const input = args as VoiceInput;
    try {
      const { getVoice } = await import('../voice/index.js');
      const voice = getVoice();

      switch (input.action) {
        case 'speak': {
          if (!input.text) return { content: 'Error: text is required for speak', is_error: true };
          const buffer = await voice.textToSpeech(input.text, input.voice);
          const outputPath = input.output_path ?? join(homedir(), '.infinite-ai', 'voice', `speech-${Date.now()}.mp3`);
          const { writeFileSync, mkdirSync, existsSync } = await import('node:fs');
          const dir = join(homedir(), '.infinite-ai', 'voice');
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          writeFileSync(outputPath, buffer);
          return {
            content: JSON.stringify({
              ok: true,
              voice: voice.getDefaultVoice(),
              chars: input.text.length,
              file: outputPath,
              bytes: buffer.length,
            }),
          };
        }

        case 'list_voices': {
          const voices = voice.getAllVoices();
          return {
            content: JSON.stringify({
              default: voice.getDefaultVoice(),
              available: voices,
            }, null, 2),
          };
        }

        case 'save': {
          if (!input.text) return { content: 'Error: text is required for save', is_error: true };
          const outputPath = input.output_path ?? join(homedir(), '.infinite-ai', 'voice', `speech-${Date.now()}.mp3`);
          const result = await voice.textToSpeechFile(input.text, outputPath, input.voice);
          return {
            content: JSON.stringify({
              ok: true,
              file: result,
              voice: voice.getDefaultVoice(),
              chars: input.text.length,
            }),
          };
        }

        default:
          return { content: `Unknown action: "${input.action}". Use: speak, list_voices, save`, is_error: true };
      }
    } catch (e) {
      return { content: `Voice error: ${(e as Error).message}`, is_error: true };
    }
  },
};
