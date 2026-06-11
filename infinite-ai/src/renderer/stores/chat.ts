import { create } from 'zustand';
import type { ContentBlock, Message, Session } from '../../shared/types';

export type StreamEvent =
  | { type: 'message_start'; message_id: string }
  | { type: 'text_delta'; message_id: string; text: string }
  | { type: 'tool_use_start'; message_id: string; tool_use_id: string; name: string }
  | { type: 'tool_use_delta'; tool_use_id: string; partial_json: string }
  | { type: 'tool_use_end'; message_id: string; tool_use_id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content?: string | ContentBlock[]; is_error?: boolean; partial?: boolean }
  | { type: 'message_end'; message_id: string; stop_reason: string; usage?: { input: number; output: number } }
  | { type: 'error'; error: string }
  | { type: 'done' };

interface ChatState {
  sessions: Session[];
  currentSessionId: string | null;
  messages: Message[];
  streaming: boolean;
  pendingPermission: { id: string; tool: string; input: unknown } | null;

  initStreamListener: () => void;
  loadSessions: () => Promise<void>;
  createSession: (cwd: string, model: string, provider: string) => Promise<Session>;
  selectSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  abort: () => Promise<void>;
  respondPermission: (allowed: boolean) => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  messages: [],
  streaming: false,
  pendingPermission: null,

  initStreamListener: () => {
    window.api.onStreamEvent((payload: unknown) => {
      const ev = payload as { sessionId: string } & StreamEvent;
      if (ev.sessionId !== get().currentSessionId) return;
      handleStreamEvent(ev);
    });
    window.api.onPermissionRequest((req: { id: string; tool: string; input: unknown }) => set({ pendingPermission: req }));
  },

  loadSessions: async () => {
    const sessions = await window.api.listSessions();
    set({ sessions });
  },

  createSession: async (cwd, model, provider) => {
    const session = await window.api.createSession({ cwd, model, provider });
    set((s) => ({ sessions: [session, ...s.sessions], currentSessionId: session.id, messages: [] }));
    return session;
  },

  selectSession: async (id) => {
    const messages = await window.api.loadSession({ sessionId: id });
    set({ currentSessionId: id, messages });
  },

  deleteSession: async (id) => {
    await window.api.deleteSession({ sessionId: id });
    set((s) => ({
      sessions: s.sessions.filter((x) => x.id !== id),
      currentSessionId: s.currentSessionId === id ? null : s.currentSessionId,
      messages: s.currentSessionId === id ? [] : s.messages,
    }));
  },

  sendMessage: async (text) => {
    const { currentSessionId, messages } = get();
    if (!currentSessionId) return;
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: [{ type: 'text', text }],
      timestamp: Date.now(),
    };
    set({ messages: [...messages, userMessage], streaming: true });
    const settings = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
    await window.api.sendMessage({
      sessionId: currentSessionId,
      message: userMessage.content,
      provider: settings.provider ?? 'openrouter',
      model: settings.model ?? 'meta-llama/llama-3.3-70b-instruct:free',
      cwd: settings.cwd ?? '.',
    });
  },

  abort: async () => {
    const { currentSessionId } = get();
    if (currentSessionId) await window.api.abortMessage({ sessionId: currentSessionId });
    set({ streaming: false });
  },

  respondPermission: async (allowed) => {
    const { pendingPermission } = get();
    if (!pendingPermission) return;
    await window.api.respondPermission({ id: pendingPermission.id, allowed });
    set({ pendingPermission: null });
  },
}));

function handleStreamEvent(
  ev: { sessionId: string } & StreamEvent,
) {
  const { setState, getState } = useChatStore;
  switch (ev.type) {
    case 'message_start': {
      const assistant: Message = {
        id: ev.message_id,
        role: 'assistant',
        content: [],
        timestamp: Date.now(),
      };
      setState((s) => ({ messages: [...s.messages, assistant] }));
      break;
    }
    case 'text_delta': {
      setState((s) => ({
        messages: s.messages.map((m) => {
          if (m.id !== ev.message_id) return m;
          const last = m.content[m.content.length - 1];
          if (last && last.type === 'text') {
            return { ...m, content: [...m.content.slice(0, -1), { type: 'text', text: last.text + ev.text }] };
          }
          return { ...m, content: [...m.content, { type: 'text', text: ev.text }] };
        }),
      }));
      break;
    }
    case 'tool_use_end': {
      setState((s) => ({
        messages: s.messages.map((m) => {
          if (m.id !== ev.message_id) return m;
          return { ...m, content: [...m.content, { type: 'tool_use', id: ev.tool_use_id, name: ev.name, input: ev.input }] };
        }),
      }));
      break;
    }
    case 'tool_result': {
      const last = getState().messages[getState().messages.length - 1];
      if (!last || last.role !== 'user') {
        setState((s) => ({
          messages: [...s.messages, {
            id: crypto.randomUUID(),
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: ev.tool_use_id, content: ev.content as string, is_error: ev.is_error }],
            timestamp: Date.now(),
          }],
        }));
      }
      break;
    }
    case 'message_end':
      setState({ streaming: false });
      break;
    case 'done':
      setState({ streaming: false });
      break;
    case 'error':
      console.error('[stream]', ev.error);
      setState({ streaming: false });
      break;
  }
}
