/**
 * useOS Hook
 * 
 * React hook for interacting with the Infinite AI orchestrator.
 * Provides a clean interface to send commands, stream responses,
 * and manage the agent state.
 */

import { useState, useCallback, useRef, useEffect } from 'react';

const ORCHESTRATOR_URL = (typeof window !== 'undefined' && (window as unknown as Record<string, string>).__ORCHESTRATOR_URL__) || 'http://127.0.0.1:3001';

export interface OSMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  toolCalls?: ToolCallInfo[];
}

export interface ToolCallInfo {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: string;
}

export interface UseOSOptions {
  provider?: string;
  model?: string;
  maxTurns?: number;
  systemPrompt?: string;
  autoConnect?: boolean;
}

export interface UseOSReturn {
  messages: OSMessage[];
  isThinking: boolean;
  isStreaming: boolean;
  error: string | null;
  connected: boolean;
  sendCommand: (prompt: string) => Promise<string>;
  sendCommandStream: (prompt: string) => AsyncGenerator<OSStreamChunk>;
  clearMessages: () => void;
  checkHealth: () => Promise<boolean>;
  getTools: () => Promise<ToolInfo[]>;
  getProviders: () => Promise<ProviderInfo[]>;
}

export interface OSStreamChunk {
  type: 'text' | 'tool_use' | 'tool_result' | 'error' | 'done';
  text?: string;
  toolCall?: ToolCallInfo;
  toolResult?: string;
  error?: string;
}

export interface ToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ProviderInfo {
  id: string;
  name: string;
  requiresApiKey: boolean;
}

export function useOS(options: UseOSOptions = {}): UseOSReturn {
  const [messages, setMessages] = useState<OSMessage[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const checkHealth = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch(`${ORCHESTRATOR_URL}/api/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }, []);

  // Check health on mount
  useEffect(() => {
    void checkHealth().then(setConnected);
  }, [checkHealth]);

  const getTools = useCallback(async (): Promise<ToolInfo[]> => {
    try {
      const response = await fetch(`${ORCHESTRATOR_URL}/api/tools`);
      const data = await response.json();
      return data.tools ?? [];
    } catch {
      return [];
    }
  }, []);

  const getProviders = useCallback(async (): Promise<ProviderInfo[]> => {
    try {
      const response = await fetch(`${ORCHESTRATOR_URL}/api/providers`);
      const data = await response.json();
      return data.providers ?? [];
    } catch {
      return [];
    }
  }, []);

  const sendCommand = useCallback(async (prompt: string): Promise<string> => {
    setIsThinking(true);
    setError(null);

    const userMessage: OSMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMessage]);

    try {
      const response = await fetch(`${ORCHESTRATOR_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          provider: options.provider,
          model: options.model,
          maxTurns: options.maxTurns,
          systemPrompt: options.systemPrompt,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error ?? `HTTP ${response.status}`);
      }

      const { data, taskId } = await response.json();

      const assistantMessage: OSMessage = {
        id: `assistant-${taskId ?? Date.now()}`,
        role: 'assistant',
        content: data,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMessage]);

      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setIsThinking(false);
    }
  }, [options.provider, options.model, options.maxTurns, options.systemPrompt]);

  const sendCommandStream = useCallback(async function* (prompt: string): AsyncGenerator<OSStreamChunk> {
    setIsStreaming(true);
    setError(null);

    const userMessage: OSMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMessage]);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    let assistantContent = '';
    const toolCalls: ToolCallInfo[] = [];

    try {
      const response = await fetch(`${ORCHESTRATOR_URL}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          provider: options.provider,
          model: options.model,
          maxTurns: options.maxTurns,
          systemPrompt: options.systemPrompt,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error ?? `HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') break;

            try {
              const chunk = JSON.parse(data) as OSStreamChunk;

              if (chunk.type === 'text' && chunk.text) {
                assistantContent += chunk.text;
                yield chunk;
              } else if (chunk.type === 'tool_use' && chunk.toolCall) {
                toolCalls.push(chunk.toolCall);
                yield chunk;
              } else if (chunk.type === 'tool_result') {
                yield chunk;
              } else if (chunk.type === 'error') {
                setError(chunk.error ?? 'Unknown error');
                yield chunk;
              } else if (chunk.type === 'done') {
                yield chunk;
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }

      // Add final assistant message
      if (assistantContent) {
        const assistantMessage: OSMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: assistantContent,
          timestamp: Date.now(),
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        };
        setMessages((prev) => [...prev, assistantMessage]);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // User cancelled
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      yield { type: 'error', error: msg };
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }, [options.provider, options.model, options.maxTurns, options.systemPrompt]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  return {
    messages,
    isThinking,
    isStreaming,
    error,
    connected,
    sendCommand,
    sendCommandStream,
    clearMessages,
    checkHealth,
    getTools,
    getProviders,
  };
}

export default useOS;

