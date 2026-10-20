// IPC handlers for gap-closing features: OCR, Voice, Credentials, Persistent Memory

import { ipcMain } from 'electron';
import { getOCR } from '../ocr/index.js';
import { getVoiceAsync, type TtsSource } from '../voice/index.js';
import { getCredentials } from '../security/encryption.js';
import { getPersistentMemory } from '../memory/persistent.js';

export function registerGapIpc(): void {
  // ── OCR ──
  ipcMain.handle('ocr:recognize', async (_e, { imagePath }: { imagePath: string }) => {
    return getOCR().recognizeText(imagePath);
  });

  ipcMain.handle('ocr:analyze', async (_e, { imagePath, prompt }: { imagePath: string; prompt: string }) => {
    return getOCR().analyzeImage(imagePath, prompt);
  });

  ipcMain.handle('ocr:status', async () => {
    return { available: getOCR().isAvailable() };
  });

  // ── Voice ──
  ipcMain.handle(
    'voice:stt',
    async (_e, { audioBuffer, format, local, language }: { audioBuffer: string; format: string; local?: boolean; language?: string }) => {
      const voice = await getVoiceAsync();
      const buffer = Buffer.from(audioBuffer, 'base64');
      return voice.speechToText(buffer, format, { local, language });
    },
  );

  ipcMain.handle(
    'voice:tts',
    async (
      _e,
      { text, voice: voiceName, source, model }: {
        text: string;
        voice?: string;
        source?: TtsSource;
        model?: string;
      },
    ) => {
      const voice = await getVoiceAsync();
      const { buffer, provider } = await voice.synthesizeWithProvider(text, voiceName, { source, model });
      return { audio: buffer.toString('base64'), provider };
    },
  );

  ipcMain.handle('voice:status', async () => {
    // Status must never fail: a secrets-store hiccup during key sync used to
    // reject the whole call, leaving the renderer with whisper=false and
    // silently demoting accurate Whisper transcription to Windows dictation.
    try {
      const voice = await getVoiceAsync();
      return { available: voice.isAvailable(), voices: voice.getVoices(), whisper: voice.hasLocalStt(), kokoro: voice.hasLocalKokoro() };
    } catch {
      const { getVoice } = await import('../voice/index.js');
      const voice = getVoice();
      return { available: voice.isAvailable(), voices: voice.getVoices(), whisper: voice.hasLocalStt(), kokoro: voice.hasLocalKokoro() };
    }
  });

  // Pre-warm local engines without doing work: the STT worker loads while
  // the user is still speaking, the TTS worker while the cloud model thinks.
  // Idempotent, never throws — a cold path simply pays the load on first use.
  ipcMain.handle('voice:warmup', async (_e, { which }: { which?: 'stt' | 'tts' | 'both' }) => {
    const voice = await getVoiceAsync();
    const out = { stt: false, tts: false };
    try {
      if (!which || which === 'stt' || which === 'both') out.stt = await voice.warmupLocalStt();
      if (!which || which === 'tts' || which === 'both') out.tts = await voice.warmupLocalTts();
    } catch { /* warmup is best-effort */ }
    return out;
  });

  ipcMain.handle('voice:setKey', async (_e, { apiKey }: { apiKey: string }) => {
    const voice = await getVoiceAsync();
    voice.setApiKey(apiKey);
    // Persist to secrets store so key survives restarts.
    try {
      const { setApiKey } = await import('../settings/secrets.js');
      await setApiKey('openai-tts', apiKey);
    } catch { /* ignore */ }
    return { ok: true };
  });

  // Independent speech-to-text / text-to-speech keys (voice conversation tab).
  // Never returns the secrets themselves — only whether each side has one and
  // where it comes from ('provider' = the OpenAI chat key saved in Settings →
  // Providers; 'openrouter' = the OpenRouter key, which rides into TTS with
  // no separate voice key either).
  ipcMain.handle('voice:keys:get', async () => {
    try {
      const { getApiKey } = await import('../settings/secrets.js');
      const firstId = async (...ids: string[]): Promise<string | null> => {
        for (const id of ids) {
          if (await getApiKey(id).catch(() => '')) return id;
        }
        return null;
      };
      const sourceOf = (id: string | null): 'dedicated' | 'provider' | 'openrouter' | null =>
        id === 'voice-stt' || id === 'voice-tts'
          ? 'dedicated'
          : id === 'openrouter'
            ? 'openrouter'
            : id
              ? 'provider'
              : null;
      const sttId = await firstId('voice-stt', 'openai', 'openai-tts');
      // TTS also rides the OpenRouter provider key — openrouter last so an
      // OpenAI-family key still reports as the source it actually is.
      const ttsId = await firstId('voice-tts', 'openai-tts', 'openai', 'openrouter');
      return {
        stt: Boolean(sttId),
        tts: Boolean(ttsId),
        // sttSource never reads 'openrouter' — that chain excludes it, so
        // the OpenRouter key stays TTS-only for now (STT deferred).
        sttSource: sourceOf(sttId),
        ttsSource: sourceOf(ttsId),
      };
    } catch {
      return { stt: false, tts: false, sttSource: null, ttsSource: null };
    }
  });

  ipcMain.handle(
    'voice:keys:set',
    async (
      _e,
      args: { sttKey?: string; ttsKey?: string; clearStt?: boolean; clearTts?: boolean },
    ) => {
      const voice = await getVoiceAsync();
      const sttKey = args.sttKey?.trim();
      const ttsKey = args.ttsKey?.trim();
      // Apply to the live process first — persistence is best-effort.
      if (args.clearStt) voice.setSttKey('');
      else if (sttKey) voice.setSttKey(sttKey);
      if (args.clearTts) voice.setTtsKey('');
      else if (ttsKey) voice.setTtsKey(ttsKey);
      try {
        const { setApiKey, deleteApiKey } = await import('../settings/secrets.js');
        if (args.clearStt) await deleteApiKey('voice-stt').catch(() => undefined);
        else if (sttKey) await setApiKey('voice-stt', sttKey);
        if (args.clearTts) await deleteApiKey('voice-tts').catch(() => undefined);
        else if (ttsKey) await setApiKey('voice-tts', ttsKey);
      } catch { /* secrets store unavailable — live keys still work this session */ }
      return { ok: true };
    },
  );

  // ── Credentials ──
  ipcMain.handle('cred:save', async (_e, { id, service, apiKey }: { id: string; service: string; apiKey: string }) => {
    getCredentials().saveCredential(id, service, apiKey);
    return { ok: true };
  });

  ipcMain.handle('cred:get', async (_e, { id }: { id: string }) => {
    return getCredentials().getCredential(id);
  });

  ipcMain.handle('cred:list', async () => {
    return getCredentials().listCredentials();
  });

  ipcMain.handle('cred:delete', async (_e, { id }: { id: string }) => {
    return getCredentials().deleteCredential(id);
  });

  ipcMain.handle('cred:has', async (_e, { id }: { id: string }) => {
    return getCredentials().hasCredential(id);
  });

  ipcMain.handle('cred:detect', async (_e, { text }: { text: string }) => {
    return getCredentials().detectSecrets(text);
  });

  // ── Persistent Memory ──
  ipcMain.handle('pmem:save', async (_e, { category, key, value }: { category: string; key: string; value: string }) => {
    getPersistentMemory().saveMemory(category, key, value);
    return { ok: true };
  });

  ipcMain.handle('pmem:get', async (_e, { category }: { category: string }) => {
    return getPersistentMemory().getMemory(category);
  });

  ipcMain.handle('pmem:getValue', async (_e, { category, key }: { category: string; key: string }) => {
    return getPersistentMemory().getMemoryValue(category, key);
  });

  ipcMain.handle('pmem:delete', async (_e, { category, key }: { category: string; key: string }) => {
    getPersistentMemory().deleteMemory(category, key);
    return { ok: true };
  });

  ipcMain.handle('pmem:saveSession', async (_e, { sessionId, history, title }: { sessionId: string; history: unknown[]; title?: string }) => {
    getPersistentMemory().saveSession(sessionId, history, title);
    return { ok: true };
  });

  ipcMain.handle('pmem:loadSession', async (_e, { sessionId }: { sessionId: string }) => {
    return getPersistentMemory().loadSession(sessionId);
  });

  ipcMain.handle('pmem:listSessions', async () => {
    return getPersistentMemory().listSessions();
  });

  ipcMain.handle('pmem:deleteSession', async (_e, { sessionId }: { sessionId: string }) => {
    getPersistentMemory().deleteSession(sessionId);
    return { ok: true };
  });

  ipcMain.handle('pmem:logAudit', async (_e, { action, details, source }: { action: string; details?: string; source?: string }) => {
    getPersistentMemory().logAudit(action, details, source);
    return { ok: true };
  });

  ipcMain.handle('pmem:auditLogs', async (_e, { limit }: { limit?: number }) => {
    return getPersistentMemory().getAuditLogs(limit);
  });

  ipcMain.handle('pmem:saveKnowledge', async (_e, { input, output, source, tags }: { input: string; output: string; source?: string; tags?: string[] }) => {
    getPersistentMemory().saveKnowledge(input, output, source, tags);
    return { ok: true };
  });

  ipcMain.handle('pmem:searchKnowledge', async (_e, { query, limit }: { query: string; limit?: number }) => {
    return getPersistentMemory().searchKnowledge(query, limit);
  });

  ipcMain.handle('pmem:stats', async () => {
    return getPersistentMemory().getStats();
  });

  ipcMain.handle('pmem:knowledgeStats', async () => {
    return getPersistentMemory().getKnowledgeStats();
  });
}
