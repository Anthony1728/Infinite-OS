import { create } from 'zustand';
import type { ContentBlock, Message, Session } from '../../shared/types';
import { useBrainStore } from './brain';
import { useEditorStore } from './editor';
import { useAgentsStore } from './agents';

// Module-level safety timer reference so handleStreamEvent can clear it
let pendingSafetyTimer: ReturnType<typeof setTimeout> | null = null;

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
  orchestratedTaskId: string | null;
  orchestratorEvents: unknown[];

  initStreamListener: () => void;
  loadSessions: () => Promise<void>;
  createSession: (cwd: string, model: string, provider: string) => Promise<Session>;
  selectSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  abort: () => Promise<void>;
  respondPermission: (allowed: boolean) => Promise<void>;
  interject: (message: string) => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  messages: [],
  streaming: false,
  pendingPermission: null,
  orchestratedTaskId: null,
  orchestratorEvents: [],

  initStreamListener: () => {
    if ((window as any).__streamListenerAttached) return;
    (window as any).__streamListenerAttached = true;

    window.api.onStreamEvent((payload: unknown) => {
      const ev = payload as { sessionId: string } & StreamEvent;
      if (ev.sessionId !== get().currentSessionId) return;
      handleStreamEvent(ev);
    });
    window.api.onPermissionRequest((req: { id: string; tool: string; input: unknown }) => set({ pendingPermission: req }));

    window.api.onOrchestratorEvent((payload: unknown) => {
      const ev = payload as { sessionId: string; type: string; data: unknown };
      if (ev.sessionId !== get().currentSessionId) return;

      if (ev.type === 'task_completed') {
        set({ streaming: false, orchestratedTaskId: null });
        const data = ev.data as { completed: number; failed: number; duration: number };
        const doneMsg: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: [{
            type: 'text',
            text: `All ${data.completed} sub-tasks completed successfully.${data.failed > 0 ? ` ${data.failed} failed.` : ''} Total time: ${(data.duration / 1000).toFixed(1)}s`,
          }],
          timestamp: Date.now(),
        };
        set((s) => ({ messages: [...s.messages, doneMsg] }));
      } else if (ev.type === 'task_failed') {
        set({ streaming: false, orchestratedTaskId: null });
      } else if (ev.type === 'subtask_completed') {
        const data = ev.data as { subTaskId: string; result: string };
        const resultMsg: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: [{ type: 'text', text: `[Sub-agent finished] ${data.result.slice(0, 500)}` }],
          timestamp: Date.now(),
        };
        set((s) => ({ messages: [...s.messages, resultMsg] }));
      }
    });
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
    const { currentSessionId } = get();
    const settings = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
    const provider = settings.provider ?? 'openrouter';
    const model = settings.model ?? 'meta-llama/llama-3.3-70b-instruct:free';
    
    console.log(`[chat] sendMessage: provider=${provider} model=${model}`);
    
    // Check if API is available (API key stored separately, not in infinite:current)
    let hasApiConfig = false;
    try {
      hasApiConfig = await window.api.hasProviderKey({ provider });
      console.log(`[chat] hasProviderKey(${provider}) = ${hasApiConfig}`);
    } catch (e) {
      console.error('[chat] hasProviderKey error:', e);
      hasApiConfig = false;
    }
    
    // If no API configured, use Infinite AI Brain offline mode
    if (!hasApiConfig) {
      console.log('[chat] No API key found, using Brain mode');
      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: [{ type: 'text', text }],
        timestamp: Date.now(),
      };
      set((s) => ({ messages: [...s.messages, userMessage], streaming: true }));

      // Create a chat task
      const taskTitle = text.length > 60 ? text.slice(0, 60) + '...' : text;
      const taskId = useAgentsStore.getState().addChatTask(taskTitle);
      
      // Generate brain response
      const brainStore = useBrainStore.getState();
      const brainResponse = brainStore.generateOfflineResponse(text);
      
      // Simulate thinking delay
      await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));
      
      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: [{ type: 'text', text: brainResponse }],
        timestamp: Date.now(),
      };
      
      set((s) => ({ messages: [...s.messages, assistantMessage], streaming: false }));

      // Auto-create files from brain response
      const files = extractAndCreateFiles(assistantMessage);
      useAgentsStore.getState().completeChatTask(taskId, files);
      
      // Learn from this interaction (user input + brain's response)
      brainStore.learnFromInteraction(text, brainResponse, 'user');
      
      return;
    }
    
    console.log('[chat] API key found, proceeding with API call');

    let sessionId = currentSessionId;

    // Auto-create session if none exists
    if (!sessionId) {
      try {
        const session = await window.api.createSession({
          cwd: settings.cwd ?? '.',
          model,
          provider,
          title: text.slice(0, 60),
        });
        sessionId = session.id;
        set((s) => ({
          sessions: [session, ...s.sessions],
          currentSessionId: session.id,
          messages: [],
        }));
      } catch (e) {
        console.error('[chat] Failed to create session:', e);
        return;
      }
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: [{ type: 'text', text }],
      timestamp: Date.now(),
    };
    set({ messages: [...get().messages, userMessage], streaming: true });

    // Create a chat task for the right panel
    const taskTitle = text.length > 60 ? text.slice(0, 60) + '...' : text;
    useAgentsStore.getState().addChatTask(taskTitle);

    // Safety timeout: if no response in 45s, fall back to Brain mode
    const safetyTimer = setTimeout(() => {
      const st = get();
      if (st.streaming) {
        console.error('[chat] Safety timeout — falling back to Brain mode');
        const brainStore = useBrainStore.getState();
        const brainResponse = brainStore.generateOfflineResponse(text);
        brainStore.learnFromInteraction(text, brainResponse, 'system');
        
        set({
          streaming: false,
          messages: [...st.messages, {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: [{ type: 'text', text: `**Infinite AI Brain (Fallback)**\n\nThe API request timed out. Here's what I can help with from my accumulated knowledge:\n\n${brainResponse}` }],
            timestamp: Date.now(),
          }],
        });
      }
    }, 45000);
    // Store timer ref so handleStreamEvent can clear it immediately
    pendingSafetyTimer = safetyTimer;

    // Detect complex tasks that need orchestration
    const isComplexTask = text.length > 200 ||
      (/\b(build|create|make|develop|deploy|full|complete|entire|whole)\b/i.test(text) &&
       /\b(website|app|application|dashboard|saas|project|system)\b/i.test(text));

    try {
      if (isComplexTask) {
        // Use orchestrator for complex tasks
        try {
          const result = await window.api.orchestratorStart({
            prompt: text,
            sessionId: sessionId!,
            cwd: settings.cwd ?? '.',
            provider,
            model,
          });
          set({ orchestratedTaskId: result.taskId });

          const systemMsg: Message = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: [{
              type: 'text',
              text: `I'm breaking this down into ${result.subTasks} specialized sub-tasks and deploying multiple agents to work on them in parallel. I'll keep going until everything is complete.\n\nYou can send me updates or suggestions at any time while I'm working — just type and send.`,
            }],
            timestamp: Date.now(),
          };
          set((s) => ({ messages: [...s.messages, systemMsg] }));
        } catch (e) {
          console.error('[chat] Orchestrator failed, falling back to direct:', e);
          await window.api.sendMessage({
            sessionId: sessionId!,
            message: userMessage.content,
            provider,
            model,
            cwd: settings.cwd ?? '.',
          });
        }
      } else {
        // Use direct agent for simple tasks
        await window.api.sendMessage({
          sessionId: sessionId!,
          message: userMessage.content,
          provider,
          model,
          cwd: settings.cwd ?? '.',
        });
      }
    } catch (e: any) {
      console.error('[chat] Send failed:', e);
      clearTimeout(safetyTimer);
      
      // If API fails, try to use brain as fallback
      const brainStore = useBrainStore.getState();
      const brainResponse = brainStore.generateOfflineResponse(text);
      brainStore.learnFromInteraction(text, brainResponse, 'system');
      
      set((s) => ({
        streaming: false,
        messages: [...s.messages, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: [{ type: 'text', text: `API Error: ${e?.message ?? e ?? 'Unknown error'}\n\n**Infinite AI Brain (Fallback Mode)**\n\nI'll try to help using my accumulated knowledge:\n\n${brainResponse}` }],
          timestamp: Date.now(),
        }],
      }));
      return;
    }
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

  interject: async (message) => {
    const { orchestratedTaskId, currentSessionId } = get();
    if (!orchestratedTaskId || !currentSessionId) return;

    // Add user message to chat
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: message }],
      timestamp: Date.now(),
    };
    set((s) => ({ messages: [...s.messages, userMessage] }));

    // Send interjection to orchestrator
    try {
      await window.api.orchestratorInterject({ taskId: orchestratedTaskId, message });
    } catch (e) {
      console.error('[chat] Interjection failed:', e);
    }
  },
}));

function generateFilename(lang: string): string {
  const map: Record<string, string> = {
    html: 'index.html',
    javascript: 'script.js',
    js: 'script.js',
    typescript: 'index.ts',
    ts: 'index.ts',
    css: 'styles.css',
    python: 'main.py',
    py: 'main.py',
    json: 'config.json',
    markdown: 'readme.md',
    md: 'readme.md',
    rust: 'main.rs',
    rs: 'main.rs',
    go: 'main.go',
    yaml: 'config.yaml',
    yml: 'config.yaml',
    sql: 'query.sql',
    sh: 'script.sh',
    bash: 'script.sh',
  };
  return map[lang.toLowerCase()] || `file.${lang || 'txt'}`;
}

function extractAndCreateFiles(message: Message): string[] {
  const createdFiles: string[] = [];
  const textBlocks = message.content.filter(c => c.type === 'text');

  for (const block of textBlocks) {
    if (block.type !== 'text') continue;
    const text = (block as { text: string }).text;

    // Match code blocks: ```lang\n code ``` or ```lang filename="file"\n code ```
    const regex = /```(\w+)?\s*(?:filename="([^"]+)")?\s*\n([\s\S]*?)```/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const lang = match[1] || 'txt';
      const filename = match[2] || generateFilename(lang);
      const content = match[3].trim();

      if (content.length > 10) {
        try {
          window.api.fileWrite({ path: filename, content });
          useEditorStore.getState().openInEditor(filename, content);
          createdFiles.push(filename);
          console.log(`[chat] Created file: ${filename} (${content.length} chars)`);
        } catch (e) {
          console.error('[chat] Failed to create file:', filename, e);
        }
      }
    }
  }

  return createdFiles;
}

function handleStreamEvent(
  ev: { sessionId: string } & StreamEvent,
) {
  console.log(`[chat] handleStreamEvent type=${ev.type} sessionId=${ev.sessionId}`);
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
    case 'message_end': {
      // Clear safety timer immediately — API responded successfully
      if (pendingSafetyTimer) {
        clearTimeout(pendingSafetyTimer);
        pendingSafetyTimer = null;
        console.log('[chat] Cleared safety timer (message_end)');
      }
      setState({ streaming: false });

      // Auto-create files from code blocks in the AI response
      const messages = getState().messages;
      const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
      if (lastAssistant) {
        const files = extractAndCreateFiles(lastAssistant);
        if (files.length > 0) {
          console.log(`[chat] Auto-created ${files.length} files:`, files);
          // Complete the active chat task
          const activeTask = useAgentsStore.getState().chatTasks.find(t => t.status === 'working');
          if (activeTask) {
            useAgentsStore.getState().completeChatTask(activeTask.id, files);
          }
        } else {
          // No files created, just complete the task
          const activeTask = useAgentsStore.getState().chatTasks.find(t => t.status === 'working');
          if (activeTask) {
            useAgentsStore.getState().completeChatTask(activeTask.id);
          }
        }
      }

      // Learn from the completed conversation
      const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
      const lastAssistantMsg = messages[messages.length - 1];
      
      if (lastUserMsg && lastAssistantMsg && lastAssistantMsg.role === 'assistant') {
        const userInput = lastUserMsg.content
          .filter(c => c.type === 'text')
          .map(c => c.text)
          .join(' ');
        const assistantOutput = lastAssistantMsg.content
          .filter(c => c.type === 'text')
          .map(c => c.text)
          .join(' ');
        
        if (userInput && assistantOutput) {
          const brainStore = useBrainStore.getState();
          brainStore.learnFromInteraction(userInput, assistantOutput, 'api');
        }
      }
      break;
    }
    case 'done':
      // Clear safety timer immediately
      if (pendingSafetyTimer) {
        clearTimeout(pendingSafetyTimer);
        pendingSafetyTimer = null;
        console.log('[chat] Cleared safety timer (done)');
      }
      setState({ streaming: false });
      // Complete any active chat task
      {
        const activeTask = useAgentsStore.getState().chatTasks.find(t => t.status === 'working');
        if (activeTask) {
          useAgentsStore.getState().completeChatTask(activeTask.id);
        }
      }
      break;
    case 'error':
      // Clear safety timer immediately
      if (pendingSafetyTimer) {
        clearTimeout(pendingSafetyTimer);
        pendingSafetyTimer = null;
        console.log('[chat] Cleared safety timer (error)');
      }
      console.error('[stream]', ev.error);
      // Fail the active chat task
      {
        const activeTask = useAgentsStore.getState().chatTasks.find(t => t.status === 'working');
        if (activeTask) {
          useAgentsStore.getState().failChatTask(activeTask.id);
        }
      }
      // Fall back to Brain mode on API error
      {
        const brainStore = useBrainStore.getState();
        const lastUserMsg = [...getState().messages].reverse().find(m => m.role === 'user');
        const userText = lastUserMsg?.content?.filter(c => c.type === 'text')?.map(c => c.text)?.join(' ') ?? '';
        const brainResponse = brainStore.generateOfflineResponse(userText);
        brainStore.learnFromInteraction(userText, brainResponse, 'system');
        
        setState((s) => ({
          streaming: false,
          messages: [...s.messages, {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: [{ type: 'text', text: `**Infinite AI Brain (Offline)**\n\nThe API is temporarily unavailable (${ev.error.includes('429') ? 'rate limited' : 'connection error'}). Here's what I can help with from my knowledge:\n\n${brainResponse}` }],
            timestamp: Date.now(),
          }],
        }));
      }
      break;
  }
}
