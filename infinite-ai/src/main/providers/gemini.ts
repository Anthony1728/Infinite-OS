// Google Gemini adapter — uses @google/generative-ai.

import { GoogleGenerativeAI } from '@google/generative-ai';
import type { ProviderAdapter, ChatRequest, StreamChunk } from './base.js';
import type { ModelInfo } from '../../shared/types.js';

const FREE_MODELS: ModelInfo[] = [
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', provider: 'gemini', free: true, supports_tools: true, supports_vision: true },
  { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', provider: 'gemini', free: true, supports_tools: true, supports_vision: true },
  { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', provider: 'gemini', free: true, supports_tools: true, supports_vision: true },
];

export const gemini: ProviderAdapter = {
  id: 'gemini',
  label: 'Google Gemini',
  requiresApiKey: true,
  defaultModel: 'gemini-2.0-flash',
  freeModels: FREE_MODELS,
  homepage: 'https://aistudio.google.com/apikey',

  async testConnection(apiKey) {
    try {
      const genai = new GoogleGenerativeAI(apiKey);
      const model = genai.getGenerativeModel({ model: 'gemini-1.5-flash' });
      await model.generateContent('ping');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },

  async listModels() {
    return FREE_MODELS;
  },

  async *streamChat(req: ChatRequest, apiKey): AsyncIterable<StreamChunk> {
    const genai = new GoogleGenerativeAI(apiKey);
    const model = genai.getGenerativeModel({
      model: req.model,
      systemInstruction: req.system,
    });

    try {
      const result = await model.generateContentStream(
        req.messages.map((m) => m.content.map((b: { type: string; text?: string }) => (b.type === 'text' ? b.text ?? '' : '')).join('\n')).join('\n'),
      );
      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) yield { type: 'text_delta', text };
      }
      const final = await result.response;
      yield {
        type: 'message_end',
        stop_reason: 'end_turn',
        usage: {
          input: final.usageMetadata?.promptTokenCount ?? 0,
          output: final.usageMetadata?.candidatesTokenCount ?? 0,
        },
      };
    } catch (e) {
      yield { type: 'error', error: (e as Error).message };
    }
  },
};
