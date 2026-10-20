// Live proof (NOT part of CI) that the real LocalVoiceService drives the real
// Python server over the real pipe: spawn -> warm -> start (microphone open)
// -> status -> synthesize -> stop -> dispose. Run with INFINITE_LIVE_VOICE=1.
//
//   npx vitest run src/main/voice/local-voice.live.test.ts
//
// Note it needs a working microphone; no speech is required (silence is a
// valid capture).

import { describe, expect, it } from 'vitest';
import {
  LocalVoiceService,
  isLocalVoiceScriptAvailable,
  localVoiceScript,
  type LocalVoiceEvent,
} from './local-voice.js';

const LIVE = process.env['INFINITE_LIVE_VOICE'] === '1';

describe.skipIf(!LIVE)('local voice live pipe', () => {
  it(
    'serves the full lifecycle against the real Python server',
    async () => {
      expect(isLocalVoiceScriptAvailable()).toBe(true);
      expect(localVoiceScript()).toMatch(/local_voice_server\.py$/);

      const service = new LocalVoiceService();

      // Attach before spawning: the server boots (and pre-warms) the moment it
      // starts reading stdin, so the warm `ready` can arrive at any point.
      const warmed = new Promise<LocalVoiceEvent>((resolve, reject) => {
        const timer = setTimeout(() => {
          off();
          reject(new Error('model never reported warm'));
        }, 90_000);
        const holder: { off?: () => void } = {};
        const off = (): void => {
          clearTimeout(timer);
          holder.off?.();
        };
        holder.off = service.onEvent((event) => {
          if (event.type === 'ready' && event.model) {
            off();
            resolve(event);
          }
        });
      });

      expect(await service.ensure()).toBe(true);
      await service.warm();
      const warmEvent = await warmed;
      expect(warmEvent.engine).toBe('local-whisper');

      const started = await service.start({ model: 'base.en', language: 'en-US' });
      expect(started.ok).toBe(true);
      expect(started.engine).toBe('local-whisper');
      expect(service.activeListening).toBe(true);

      const status = await service.status(15_000);
      expect(status).toBeTruthy();
      expect(status?.listening).toBe(true);
      expect(status?.model_loaded).toBe(true);
      expect(status?.model).toBe('base.en');

      const audio = await service.synthesize('Infinite OS is online.', { format: 'wav' });
      expect(audio.buffer.byteLength).toBeGreaterThan(1_000);
      expect(audio.buffer.subarray(0, 4).toString('ascii')).toBe('RIFF');
      expect(audio.duration).toBeGreaterThan(0);

      await service.stop();
      expect(service.activeListening).toBe(false);

      service.dispose();
      expect(service.isRunning).toBe(false);
    },
    180_000,
  );
});
