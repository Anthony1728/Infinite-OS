// Ollama IPC handlers — connects renderer to local Ollama brain

import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { getOllamaBrain } from '../ollama/brain.js';
import { getEngine } from '../engine/intelligence.js';
import {
  budgetForModel,
  describeHardware,
  getHardwareProfile,
  getInstalledModels,
  isModelComfortable,
  loadedModels,
  preloadModel,
  testOllamaConnection,
  unloadModel,
} from '../ollama/utils.js';

function detectTaskType(input: string): string {
  const lower = input.toLowerCase();
  if (/\b(code|debug|function|class|api|error)\b/.test(lower)) return 'coding';
  if (/\b(build|create|make|generate|website|app)\b/.test(lower)) return 'building';
  if (/\b(test|verify|check|validate)\b/.test(lower)) return 'testing';
  if (/\b(explain|what|how|why|question)\b/.test(lower)) return 'learning';
  return 'general';
}

export function registerOllamaIpc(): void {
  const brain = getOllamaBrain();

  ipcMain.handle(IPC.OLLAMA_CHAT, async (_e, { messages, options }: { messages: Array<{ role: string; content: string; images?: string[] }>; options?: { temperature?: number; maxTokens?: number } }) => {
    return brain.chat(messages, options);
  });

  ipcMain.handle(IPC.OLLAMA_ASK, async (_e, { prompt, systemPrompt, model }: { prompt: string; systemPrompt?: string; model?: string }) => {
    const started = Date.now();
    const output = await brain.ask(prompt, systemPrompt, model);
    const engine = getEngine();
    engine.updateOllamaStatus(Boolean(output));
    engine.tryBootstrap();
    if (output) {
      engine.recordInteraction({
        taskType: detectTaskType(prompt), input: prompt.slice(0, 500),
        modelUsed: model || (await brain.getStats()).model, provider: 'ollama',
        output: output.slice(0, 1000), success: output.length > 10,
        duration: Date.now() - started,
        tokens: { input: prompt.length, output: output.length },
      });
    }
    return output;
  });

  ipcMain.handle(IPC.OLLAMA_ANALYZE_IMAGE, async (_e, { imageBase64, question }: { imageBase64: string; question: string }) => {
    return brain.analyzeImage(imageBase64, question);
  });

  ipcMain.handle(IPC.OLLAMA_TEACH, async () => {
    return brain.teachOllama();
  });

  ipcMain.handle(IPC.OLLAMA_STATUS, async () => {
    const available = await brain.isAvailable();
    getEngine().updateOllamaStatus(available);
    const stats = await brain.getStats();
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

  // ── Local model performance controls ─────────────────────────────────────
  // The settings page needs to be able to answer "why is it slow?" and "give my
  // memory back" without the user leaving the app or guessing. Every number here
  // comes from the measured hardware profile.

  ipcMain.handle(IPC.OLLAMA_CAPABILITY, async () => {
    const profile = getHardwareProfile();
    const budget = budgetForModel();
    return {
      profile: {
        tier: profile.tier,
        totalRamGb: profile.totalRamGb,
        cpuThreads: profile.cpuThreads,
        cpuModel: profile.cpuModel,
        vramGb: profile.vramGb,
        hasNvidiaGpu: profile.hasNvidiaGpu,
      },
      budget,
      // One plain sentence, so the UI does not have to explain tiers itself.
      summary: describeHardware(),
    };
  });

  ipcMain.handle(IPC.OLLAMA_MODELS_LOCAL, async () => {
    const models = await getInstalledModels();
    return models.map((m) => ({
      ...m,
      comfortable: isModelComfortable(m.name),
      sizeGb: Math.round((m.sizeBytes / 1024 ** 3) * 10) / 10,
    }));
  });

  ipcMain.handle(IPC.OLLAMA_LOADED, async () => loadedModels());

  ipcMain.handle(IPC.OLLAMA_PRELOAD, async (_e, { model }: { model: string }) => preloadModel(model));

  ipcMain.handle(IPC.OLLAMA_UNLOAD, async (_e, { model }: { model: string }) => unloadModel(model));

  // Deliberately non-blocking and non-starting: pressing "Check" must not
  // launch a server, and must never hang the settings dialog.
  ipcMain.handle(IPC.OLLAMA_HEALTH, async () => testOllamaConnection({ startIfNeeded: false }));
}
