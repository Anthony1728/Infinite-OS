// Google Gemini adapter — uses @google/generative-ai.

import { GoogleGenerativeAI } from '@google/generative-ai';
import type { ProviderAdapter, ChatRequest, StreamChunk } from './base.js';
import type { ModelInfo, Message } from '../../shared/types.js';

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
      const contents = toGeminiContents(req.messages);
      const result = await model.generateContentStream({ contents });
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

import type { Content, Part } from '@google/generative-ai';

function toGeminiContents(messages: Message[]): Content[] {
  const contents: Content[] = [];
  const toolIdToName = new Map<string, string>();
  
  for (const m of messages) {
    const parts: Part[] = [];
    if (m.role === 'assistant') {
      for (const b of m.content) {
        if (b.type === 'text' && b.text) parts.push({ text: b.text });
        else if (b.type === 'tool_use') {
          toolIdToName.set(b.id, b.name);
          parts.push({ functionCall: { name: b.name, args: typeof b.input === 'string' ? JSON.parse(b.input) : (b.input as Record<string, unknown>) } });
        }
      }
      if (parts.length > 0) contents.push({ role: 'model', parts });
    } else if (m.role === 'user') {
      for (const b of m.content) {
        if (b.type === 'text' && b.text) parts.push({ text: b.text });
        else if (b.type === 'tool_result') {
          const name = toolIdToName.get(b.tool_use_id) || b.tool_use_id;
          parts.push({
            functionResponse: {
              name,
              response: { result: typeof b.content === 'string' ? b.content : JSON.stringify(b.content) },
            }
          });
        }
      }
      if (parts.length > 0) contents.push({ role: 'user', parts });
    }
  }
  return contents;
}

