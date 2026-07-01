// IPC handlers for gap-closing features: OCR, Voice, Credentials, Persistent Memory

import { ipcMain } from 'electron';
import { getOCR } from '../ocr/index.js';
import { getVoice } from '../voice/index.js';
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
  ipcMain.handle('voice:stt', async (_e, { audioBuffer, format }: { audioBuffer: string; format: string }) => {
    const buffer = Buffer.from(audioBuffer, 'base64');
    return getVoice().speechToText(buffer, format);
  });

  ipcMain.handle('voice:tts', async (_e, { text, voice }: { text: string; voice?: string }) => {
    const buffer = await getVoice().textToSpeech(text, voice);
    return buffer.toString('base64');
  });

  ipcMain.handle('voice:status', async () => {
    return { available: getVoice().isAvailable(), voices: getVoice().getVoices() };
  });

  ipcMain.handle('voice:setKey', async (_e, { apiKey }: { apiKey: string }) => {
    getVoice().setApiKey(apiKey);
    return { ok: true };
  });

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
