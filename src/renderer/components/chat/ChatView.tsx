import { useEffect, useRef, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message } from '../../../shared/types';
import { useChatStore } from '../../stores/chat';
import { useEditorStore } from '../../stores/editor';
import { useAuthStore } from '../../stores/auth';
import { InfiniteLogo } from '../brand/InfiniteLogo';

const SLASH_COMMANDS = [
  {
    id: 'build',
    label: 'Build',
    description: 'Generate or rebuild an application',
    icon: 'M11.42 15.17l-5.1-5.1m0 0L11.42 4.97m-5.1 5.1H21',
  },
  {
    id: 'deploy',
    label: 'Deploy',
    description: 'Deploy to GitHub or cloud',
    icon: 'M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.691 0a15.02 15.02 0 012.834 5.37',
  },
  {
    id: 'edit',
    label: 'Edit File',
    description: 'Open a file in the code editor',
    icon: 'M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5',
  },
  {
    id: 'video',
    label: 'Generate Video',
    description: 'Create video content with AI',
    icon: 'M15.75 10.5 20.47 5.78A.75.75 0 0121.75 6v12a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z',
  },
  {
    id: 'test',
    label: 'Run Tests',
    description: 'Generate and run tests',
    icon: 'M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8 1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5',
  },
  {
    id: 'browser',
    label: 'Browse Web',
    description: 'Navigate and scrape websites',
    icon: 'M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418',
  },
  {
    id: 'code',
    label: 'Open Code',
    description: 'Open code editor in right panel',
    icon: 'M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5',
  },
  {
    id: 'agent',
    label: 'Create Agent',
    description: 'Spawn a new AI agent',
    icon: 'M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z',
  },
  {
    id: 'research',
    label: 'Research',
    description: 'Deep research on a topic',
    icon: 'M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18',
  },
];

export function ChatView({ onViewChange }: { onViewChange: (view: string) => void }) {
  const messages = useChatStore((s) => s.messages);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const streaming = useChatStore((s) => s.streaming);
  const initStreamListener = useChatStore((s) => s.initStreamListener);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const openInEditor = useEditorStore((s) => s.openInEditor);
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);
  useEffect(() => {
    initStreamListener();
  }, [initStreamListener]);

  const handleSend = useCallback(
    (text: string) => {
      if (!text.trim()) return;

      // Handle slash commands
      if (text.startsWith('/')) {
        const [cmd, ...args] = text.slice(1).split(' ');
        const arg = args.join(' ');

        switch (cmd) {
          case 'build':
            sendMessage(`Build me a ${arg || 'modern web application'} with best practices and clean architecture`);
            break;
          case 'deploy':
            (async () => {
              try {
                const settings = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
                const cwd = settings.cwd ?? '.';
                const result = await window.api.deployQuickPush({
                  cwd,
                  message: `deploy ${arg || new Date().toISOString().slice(0, 19)}`,
                });
                const pipeline = result as any;
                if (pipeline?.status === 'success') {
                  sendMessage(
                    `Deployment complete! All steps succeeded:\n${pipeline.steps?.map((s: any) => `  - ${s.name}: ${s.status}`).join('\n')}`,
                  );
                } else {
                  const failed = pipeline?.steps?.find((s: any) => s.status === 'failed');
                  sendMessage(`Deployment failed at step "${failed?.name}": ${failed?.output || 'unknown error'}`);
                }
              } catch (e: any) {
                sendMessage(`Deployment error: ${e?.message || e}`);
              }
            })();
            break;
          case 'edit':
            if (arg) {
              openInEditor(arg, `// Editing ${arg}\n// Make your changes here\n`, 'typescript');
            } else {
              openInEditor('untitled.ts', '// New file\n', 'typescript');
            }
            break;
          case 'video':
            sendMessage(`Generate a video about: ${arg || 'a compelling product demo'}`);
            break;
          case 'test':
            (async () => {
              try {
                const settings = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
                const cwd = settings.cwd ?? '.';
                const detected = await window.api.deployDetectProject({ projectPath: cwd });
                const config = (await window.api.deployDefaultConfig({ type: detected || 'node' })) as any;
                const target = await window.api.deployCreateTarget({ name: 'test-run', type: 'local', config: {} });
                const pipeline = await window.api.deployCreatePipeline({
                  name: 'Run Tests',
                  projectId: 'default',
                  targetId: (target as any).id,
                  commands: [config.commands?.test || 'npx vitest run'],
                });
                const result = (await window.api.deployRunPipeline({ pipelineId: (pipeline as any).id, cwd })) as any;
                if (result?.status === 'success') {
                  sendMessage(`Tests passed!\n\n${result.steps?.map((s: any) => s.output).join('\n')}`);
                } else {
                  sendMessage(
                    `Tests failed.\n\n${
                      result?.steps
                        ?.filter((s: any) => s.status === 'failed')
                        .map((s: any) => s.output)
                        .join('\n') || 'Unknown error'
                    }`,
                  );
                }
              } catch (e: any) {
                sendMessage(`Test error: ${e?.message || e}`);
              }
            })();
            break;
          case 'browser':
            sendMessage(`Browse and analyze: ${arg || 'the current project documentation'}`);
            break;
          case 'code':
            sendMessage(`Show me the code for: ${arg || 'the main component'}`);
            break;
          case 'agent':
            sendMessage(`Create a new AI agent specialized in: ${arg || 'general tasks'}`);
            break;
          case 'research':
            sendMessage(`Research deeply: ${arg || 'best practices for this project'}`);
            break;
          default:
            sendMessage(text);
        }
      } else {
        sendMessage(text);
      }
      setInput('');
    },
    [sendMessage, openInEditor],
  );

  const openPrompt = (value: string) => {
    setInput(value);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <ChatWorkspaceHeader onViewChange={onViewChange} openPrompt={openPrompt} />
      <div className="flex-1 min-h-0">
        {!currentSessionId ? (
          <DemoChat input={input} setInput={setInput} inputRef={inputRef} onSend={handleSend} />
        ) : (
          <RealChat
            messages={messages}
            streaming={streaming}
            input={input}
            setInput={setInput}
            inputRef={inputRef}
            onSend={handleSend}
          />
        )}
      </div>
    </div>
  );
}

function ChatWorkspaceHeader({
  onViewChange,
  openPrompt,
}: {
  onViewChange: (view: string) => void;
  openPrompt: (value: string) => void;
}) {
  const firstName = useAuthStore((state) => state.user?.name?.split(' ')[0] || 'there');
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const modes = [
    {
      label: 'AI Chat',
      action: () => openPrompt(''),
      path: 'M7.5 8.25h9m-9 3H12m-8.25 7.5 3.6-3.6c.42-.42.99-.66 1.59-.66h8.31A2.25 2.25 0 0 0 19.5 15V6A2.25 2.25 0 0 0 17.25 3.75H6A2.25 2.25 0 0 0 3.75 6v12.75Z',
    },
    {
      label: 'Infinite Canvas',
      action: () => onViewChange('workspace'),
      path: 'M3.75 3.75h6.5v6.5h-6.5v-6.5Zm10 0h6.5v6.5h-6.5v-6.5Zm-10 10h6.5v6.5h-6.5v-6.5Zm10 0h6.5v6.5h-6.5v-6.5Z',
    },
    {
      label: 'Code',
      action: () => onViewChange('workspace'),
      path: 'm8.25 6.75-5.25 5.25 5.25 5.25m7.5-10.5L21 12l-5.25 5.25M14.25 3.75l-4.5 16.5',
    },
    { label: 'Analyze', action: () => openPrompt('Analyze '), path: 'M3.75 19.5h16.5M6 16.5v-6m6 6V4.5m6 12v-9' },
    {
      label: 'Automate',
      action: () => onViewChange('automations'),
      path: 'M13 2.75 4.75 13h6.5L11 21.25 19.25 11h-6.5L13 2.75Z',
    },
    {
      label: 'Research',
      action: () => openPrompt('/research '),
      path: 'm21 21-4.35-4.35m1.35-5.4a6.75 6.75 0 1 1-13.5 0 6.75 6.75 0 0 1 13.5 0Z',
    },
    {
      label: 'Design',
      action: () => openPrompt('Design '),
      path: 'M12 21s7.5-4.35 7.5-10.5A4.5 4.5 0 0 0 12 7.14a4.5 4.5 0 0 0-7.5 3.36C4.5 16.65 12 21 12 21Z',
    },
  ];
  return (
    <div className="flex-shrink-0 px-5 pt-5">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-xl font-semibold tracking-[-0.02em] text-zinc-100">
          {greeting}, {firstName}
        </h1>
        <p className="text-[12px] text-textMuted mt-1">InfiniteAI is ready to build, analyze, and automate with you.</p>
        <div className="mt-4 flex items-center gap-1 overflow-x-auto rounded-xl border border-white/[0.07] bg-[#0c0f17]/70 p-1 custom-scrollbar">
          {modes.map((mode, index) => (
            <button
              key={mode.label}
              onClick={mode.action}
              aria-current={index === 0 ? 'page' : undefined}
              className={`flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-[11px] transition-all ${index === 0 ? 'border border-cyan-400/30 bg-cyan-400/[0.07] text-zinc-100 shadow-sm' : 'border border-transparent text-textMuted hover:bg-white/[0.035] hover:text-zinc-200'}`}
            >
              <svg
                className={`h-4 w-4 ${index === 0 ? 'text-cyan-400' : 'text-indigo-400'}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d={mode.path} />
              </svg>
              {mode.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function InputBar({
  input,
  setInput,
  inputRef,
  onSend,
  placeholder,
  isOnline = false,
}: {
  input: string;
  setInput: (v: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onSend: (text: string) => void;
  placeholder?: string;
  isOnline?: boolean;
}) {
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);
  const slashMenuRef = useRef<HTMLDivElement>(null);

  const isSlashCommand = input.startsWith('/');
  const slashQuery = isSlashCommand ? input.slice(1).toLowerCase() : '';
  const filteredCommands = SLASH_COMMANDS.filter(
    (cmd) => cmd.label.toLowerCase().includes(slashQuery) || cmd.description.toLowerCase().includes(slashQuery),
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showSlashMenu && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedSlashIndex((prev) => (prev + 1) % filteredCommands.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedSlashIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        const cmd = filteredCommands[selectedSlashIndex];
        onSend(`/${cmd.id}`);
        setInput('');
        setShowSlashMenu(false);
        return;
      }
      if (e.key === 'Escape') {
        setShowSlashMenu(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend(input);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);
    setShowSlashMenu(value.startsWith('/'));
    setSelectedSlashIndex(0);
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (slashMenuRef.current && !slashMenuRef.current.contains(e.target as Node)) {
        setShowSlashMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="w-full relative">
      {/* Slash command menu */}
      {showSlashMenu && filteredCommands.length > 0 && (
        <div
          ref={slashMenuRef}
          className="absolute bottom-full left-0 right-0 mb-2 bg-[#0d0d11] border border-white/[0.08] rounded-xl shadow-2xl overflow-hidden z-50"
        >
          <div className="px-3 py-2 text-[10px] text-textMuted uppercase tracking-wider border-b border-white/5">
            Commands
          </div>
          {filteredCommands.map((cmd, i) => (
            <button
              key={cmd.id}
              onClick={() => {
                onSend(`/${cmd.id}`);
                setInput('');
                setShowSlashMenu(false);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                i === selectedSlashIndex
                  ? 'bg-indigo-500/15 text-white'
                  : 'text-zinc-400 hover:bg-white/[0.04] hover:text-white'
              }`}
            >
              <svg
                className="w-4 h-4 flex-shrink-0 text-indigo-400"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d={cmd.icon} />
              </svg>
              <div>
                <div className="text-sm font-medium">{cmd.label}</div>
                <div className="text-[10px] text-textMuted">{cmd.description}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Brain mode indicator */}
      {!isOnline && (
        <div className="mb-2 px-3 py-2 bg-gradient-to-r from-purple-500/10 via-cyan-500/10 to-pink-500/10 border border-purple-500/20 rounded-xl flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-gradient-to-r from-purple-400 via-cyan-400 to-pink-400 animate-pulse" />
          <span className="text-[11px] text-purple-300">Infinite AI Brain Active</span>
          <span className="text-[10px] text-textMuted ml-auto">Offline mode — Learning from interactions</span>
        </div>
      )}

      {/* Input container with glow effect when online */}
      <div
        className={`relative bg-bgCard border rounded-2xl overflow-hidden transition-all duration-300 shadow-lg ${
          isOnline
            ? 'border-cyan-500/50 shadow-[0_0_20px_rgba(34,211,238,0.15),0_0_40px_rgba(34,211,238,0.05)] focus-within:border-cyan-400/60 focus-within:shadow-[0_0_25px_rgba(34,211,238,0.2),0_0_50px_rgba(34,211,238,0.1)]'
            : 'border-borderSubtle focus-within:border-indigo-500/40 shadow-black/10'
        }`}
      >
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          value={input}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || (isOnline ? 'Ask Infinity anything...' : 'Ask the Infinite AI Brain anything...')}
          rows={1}
          aria-label="Message InfiniteAI"
          className="w-full bg-transparent text-textMain text-sm px-4 py-3 pr-14 outline-none resize-none placeholder:text-textMuted/50"
        />
        <div className="absolute right-2 bottom-2">
          <button
            onClick={() => onSend(input)}
            disabled={!input.trim()}
            aria-label="Send message"
            className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200 text-white shadow-md ${
              isOnline
                ? 'bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 disabled:from-zinc-600 disabled:to-zinc-700'
                : 'bg-gradient-to-r from-purple-500 to-cyan-500 hover:from-purple-400 hover:to-cyan-400 disabled:from-zinc-600 disabled:to-zinc-700'
            } disabled:cursor-not-allowed`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
              />
            </svg>
          </button>
        </div>
      </div>
      {/* Composer controls */}
      <div className="flex items-center justify-between mt-2 px-1">
        <span className="text-[9px] text-textMuted">Enter to send · Shift+Enter for a new line</span>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-textMuted">Type / for commands</span>
          <button
            onClick={() => {
              setInput('/agent ');
              inputRef.current?.focus();
            }}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/[0.08] text-xs text-textMuted hover:text-textMain transition-all"
          >
            <svg
              className="w-3.5 h-3.5 text-indigo-400"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
              />
            </svg>
            Agent
          </button>
        </div>
      </div>
    </div>
  );
}

function RealChat({
  messages,
  streaming,
  input,
  setInput,
  inputRef,
  onSend,
}: {
  messages: Message[];
  streaming: boolean;
  input: string;
  setInput: (v: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onSend: (text: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const orchestratedTaskId = useChatStore((s) => s.orchestratedTaskId);
  const interject = useChatStore((s) => s.interject);
  const [isOnline, setIsOnline] = useState(false);

  // Check if AI model is online
  useEffect(() => {
    const checkOnlineStatus = async () => {
      try {
        const settings = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
        const provider = settings.provider ?? 'openrouter';
        const hasKey = await window.api.hasProviderKey({ provider });
        setIsOnline(Boolean(hasKey));
      } catch {
        setIsOnline(false);
      }
    };
    checkOnlineStatus();
    window.addEventListener('storage', checkOnlineStatus);
    return () => window.removeEventListener('storage', checkOnlineStatus);
  }, []);

  // Determine if we should show thinking bubble:
  // Show it only when streaming is active AND the last assistant message has no text yet
  const lastMsg = messages[messages.length - 1];
  const isStreamingText =
    lastMsg?.role === 'assistant' &&
    lastMsg.content.some((b) => b.type === 'text' && 'text' in b && (b as { text: string }).text.trim());
  const showThinking = streaming && !isStreamingText;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streaming]);

  // Handle sending during streaming (interjection)
  const handleSendDuringStream = (text: string) => {
    if (!text.trim()) return;
    if (orchestratedTaskId) {
      interject(text.trim());
    }
    setInput('');
  };

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 custom-scrollbar">
        <div className="flex flex-col gap-5 w-full max-w-4xl mx-auto">
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          {showThinking && <ThinkingBubble />}
          {orchestratedTaskId && streaming && (
            <div className="flex items-center gap-2 text-xs text-indigo-400 animate-pulse">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Multiple agents working in parallel — type to send updates
            </div>
          )}
        </div>
      </div>
      <div className="flex-shrink-0 px-5 py-3">
        <div className="max-w-4xl mx-auto">
          <InputBar
            input={input}
            setInput={setInput}
            inputRef={inputRef}
            onSend={streaming ? handleSendDuringStream : onSend}
            placeholder={streaming ? 'Send a suggestion or update...' : 'Continue the conversation...'}
            isOnline={isOnline}
          />
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const isToolResult = message.role === 'tool';

  if (isToolResult) return null;

  const textBlocks = message.content.filter((b) => b.type === 'text');
  const toolUseBlocks = message.content.filter((b) => b.type === 'tool_use');
  const hasText = textBlocks.some((b) => b.type === 'text' && (b as { text: string }).text.trim());

  if (!hasText && toolUseBlocks.length === 0) return null;

  return (
    <div className="flex gap-3">
      {isAssistant ? (
        <div className="brand-avatar w-8 h-8 flex-shrink-0 mt-0.5">
          <InfiniteLogo className="w-5 h-3" />
        </div>
      ) : isUser ? (
        <div className="w-8 h-8 rounded-full bg-blue-500/15 border border-blue-500/25 flex items-center justify-center text-blue-400 flex-shrink-0 mt-0.5">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
            />
          </svg>
        </div>
      ) : null}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-semibold text-textMain text-sm">{isUser ? 'You' : 'InfiniteAI OS'}</span>
          <span className="text-[10px] text-textMuted">
            {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        {textBlocks.map((block, i) => {
          if (block.type !== 'text') return null;
          const text = (block as { text: string }).text;
          if (!text.trim()) return null;
          return (
            <div key={i} className="text-sm text-zinc-300 leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
            </div>
          );
        })}
        {toolUseBlocks.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {toolUseBlocks.map((block, i) => {
              if (block.type !== 'tool_use') return null;
              const tu = block as { id: string; name: string; input: unknown };
              return (
                <div
                  key={i}
                  className="bg-bgCard border border-borderSubtle rounded-xl px-3 py-2 text-xs flex items-center gap-2"
                >
                  <svg
                    className="w-3.5 h-3.5 text-indigo-400"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M11.42 15.17l-5.1-5.1m0 0L11.42 4.97m-5.1 5.1H21"
                    />
                  </svg>
                  <span className="font-medium text-textMain">{tu.name}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div className="flex gap-3 items-center" role="status" aria-live="polite">
      <div className="brand-avatar w-12 h-10 flex-shrink-0">
        <InfiniteLogo className="w-9 h-6" animated />
      </div>
      <div className="bg-bgCard/80 border border-borderSubtle rounded-xl px-4 py-2.5 shadow-sm">
        <div className="text-xs font-medium text-zinc-300">Preparing response</div>
        <div className="text-[10px] text-textMuted mt-0.5">Thinking through your request…</div>
      </div>
    </div>
  );
}

function DemoChat({
  input,
  setInput,
  inputRef,
  onSend,
}: {
  input: string;
  setInput: (v: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onSend: (text: string) => void;
}) {
  const [isOnline, setIsOnline] = useState(false);

  // Check if AI model is online (has API key configured)
  useEffect(() => {
    const checkOnlineStatus = async () => {
      try {
        const settings = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
        const provider = settings.provider ?? 'openrouter';
        const hasKey = await window.api.hasProviderKey({ provider });
        setIsOnline(!!hasKey);
      } catch {
        setIsOnline(false);
      }
    };
    checkOnlineStatus();
    window.addEventListener('storage', checkOnlineStatus);
    return () => window.removeEventListener('storage', checkOnlineStatus);
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="max-w-4xl mx-auto px-5 py-12 flex flex-col items-center justify-center min-h-[60vh]">
          {/* Canonical brand mark */}
          <div className="w-36 h-24 mb-7 flex items-center justify-center relative">
            <div className="absolute inset-5 bg-indigo-500/10 rounded-full blur-2xl" />
            <InfiniteLogo className="relative w-32 h-20" animated labelled />
          </div>

          <h2 className="text-lg font-semibold text-textMain mb-2">What are we working on?</h2>
          <p className="text-sm text-textMuted mb-8">Start with a prompt or choose a workspace mode above.</p>

          {/* Minimal quick actions */}
          <div className="flex gap-3 mb-8">
            <button
              onClick={() => {
                setInput('/build ');
                inputRef.current?.focus();
              }}
              className="px-4 py-2 rounded-xl bg-white/[0.03] border border-borderSubtle hover:border-indigo-500/30 hover:bg-white/[0.05] text-sm text-textMuted hover:text-textMain transition-all duration-200 flex items-center gap-2"
            >
              <svg
                className="w-4 h-4 text-indigo-400"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M11.42 15.17l-5.1-5.1m0 0L11.42 4.97m-5.1 5.1H21"
                />
              </svg>
              Build something
            </button>
            <button
              onClick={() => {
                setInput('/research ');
                inputRef.current?.focus();
              }}
              className="px-4 py-2 rounded-xl bg-white/[0.03] border border-borderSubtle hover:border-indigo-500/30 hover:bg-white/[0.05] text-sm text-textMuted hover:text-textMain transition-all duration-200 flex items-center gap-2"
            >
              <svg
                className="w-4 h-4 text-cyan-400"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"
                />
              </svg>
              Research
            </button>
          </div>
        </div>
      </div>

      {/* Input bar */}
      <div className="flex-shrink-0 px-5 py-3 border-t border-borderSubtle/40">
        <div className="max-w-4xl mx-auto">
          <InputBar input={input} setInput={setInput} inputRef={inputRef} onSend={onSend} isOnline={isOnline} />
        </div>
      </div>
    </div>
  );
}
