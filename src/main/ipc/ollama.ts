// Ollama IPC handlers — connects renderer to local Ollama brain

import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { getOllamaBrain } from '../ollama/brain.js';

export function registerOllamaIpc(): void {
  const brain = getOllamaBrain();

  ipcMain.handle(IPC.OLLAMA_CHAT, async (_e, { messages, options }: { messages: Array<{ role: string; content: string; images?: string[] }>; options?: { temperature?: number; maxTokens?: number } }) => {
    return brain.chat(messages, options);
  });

  ipcMain.handle(IPC.OLLAMA_ASK, async (_e, { prompt, systemPrompt, model }: { prompt: string; systemPrompt?: string; model?: string }) => {
    return brain.ask(prompt, systemPrompt, model);
  });

  ipcMain.handle(IPC.OLLAMA_ANALYZE_IMAGE, async (_e, { imageBase64, question }: { imageBase64: string; question: string }) => {
    return brain.analyzeImage(imageBase64, question);
  });

  ipcMain.handle(IPC.OLLAMA_TEACH, async () => {
    return brain.teachOllama();
  });

  ipcMain.handle(IPC.OLLAMA_STATUS, async () => {
    const available = await brain.isAvailable();
    const stats = brain.getStats();
    return { available, ...stats };
  });

  ipcMain.handle(IPC.OLLAMA_RECORD_API, async (_e, { input, response, model, provider }: { input: string; response: string; model: string; provider: string }) => {
    brain.recordApiLearning(input, response, model, provider);
    return true;
  });

  ipcMain.handle(IPC.OLLAMA_RECORD_CONVERSATION, async (_e, { input, output, source }: { input: string; output: string; source: 'brain' | 'api' | 'ollama' }) => {
    brain.recordConversation(input, output, source);
    return true;
  });

  ipcMain.handle(IPC.OLLAMA_SYSTEM_PROMPT, async () => {
    return brain.getSystemPrompt();
  });
}
