import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message } from '../../../shared/types';
import { useChatStore } from '../../stores/chat';

const SUGGESTIONS = [
  'Add dark mode',
  'Add email notifications',
  'Integrate Stripe',
  'Add team settings',
];

export function ChatView() {
  const messages = useChatStore((s) => s.messages);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const streaming = useChatStore((s) => s.streaming);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const handleSend = (text: string) => {
    if (!text.trim()) return;
    sendMessage(text.trim());
    setInput('');
  };

  if (!currentSessionId) {
    return <DemoChat input={input} setInput={setInput} inputRef={inputRef} onSend={handleSend} />;
  }

  return <RealChat messages={messages} streaming={streaming} input={input} setInput={setInput} inputRef={inputRef} onSend={handleSend} />;
}

function InputBar({ input, setInput, inputRef, onSend, placeholder }: { input: string; setInput: (v: string) => void; inputRef: React.RefObject<HTMLTextAreaElement | null>; onSend: (text: string) => void; placeholder?: string }) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend(input);
    }
  };

  return (
    <div className="w-full">
      <div className="relative bg-bgCard border border-borderSubtle rounded-2xl overflow-hidden focus-within:border-indigo-500/40 transition-all duration-200 shadow-lg shadow-black/10">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || "Ask Infinity anything..."}
          rows={1}
          className="w-full bg-transparent text-textMain text-sm px-4 py-3 pr-14 outline-none resize-none placeholder:text-textMuted/50"
        />
        <div className="absolute right-2 bottom-2">
          <button
            onClick={() => onSend(input)}
            disabled={!input.trim()}
            className="w-9 h-9 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 disabled:cursor-not-allowed flex items-center justify-center transition-all duration-200 text-white shadow-md"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>
          </button>
        </div>
      </div>
      {/* Bottom icons */}
      <div className="flex items-center justify-between mt-2 px-1">
        <div className="flex items-center gap-1">
          <button className="w-7 h-7 rounded-lg hover:bg-white/5 flex items-center justify-center text-textMuted hover:text-textMain transition-all" title="Add">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
          </button>
          <button className="w-7 h-7 rounded-lg hover:bg-white/5 flex items-center justify-center text-textMuted hover:text-textMain transition-all" title="Browser">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582" /></svg>
          </button>
          <button className="w-7 h-7 rounded-lg hover:bg-white/5 flex items-center justify-center text-textMuted hover:text-textMain transition-all" title="Desktop">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" /></svg>
          </button>
          <button className="w-7 h-7 rounded-lg hover:bg-white/5 flex items-center justify-center text-textMuted hover:text-textMain transition-all" title="Voice">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" /></svg>
          </button>
        </div>
        <button className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/8 text-xs text-textMuted hover:text-textMain transition-all">
          <svg className="w-3.5 h-3.5 text-indigo-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" /></svg>
          Agent Mode
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
        </button>
      </div>
    </div>
  );
}

function RealChat({ messages, streaming, input, setInput, inputRef, onSend }: { messages: Message[]; streaming: boolean; input: string; setInput: (v: string) => void; inputRef: React.RefObject<HTMLTextAreaElement | null>; onSend: (text: string) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streaming]);

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 custom-scrollbar">
        <div className="flex flex-col gap-5 w-full max-w-4xl mx-auto">
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          {streaming && <ThinkingBubble />}
        </div>
      </div>
      <div className="flex-shrink-0 px-5 py-3">
        <div className="max-w-4xl mx-auto">
          <InputBar input={input} setInput={setInput} inputRef={inputRef} onSend={onSend} placeholder="Continue the conversation..." />
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
        <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-600 via-purple-600 to-pink-500 flex items-center justify-center text-white flex-shrink-0 mt-0.5 shadow-md">
          <svg className="w-4 h-3" viewBox="0 0 32 18" fill="none"><path d="M9 14.5C13.1421 14.5 16.5 11.1421 16.5 7C16.5 2.85786 19.8579 -0.5 24 -0.5C28.1421 -0.5 31.5 2.85786 31.5 7C31.5 11.1421 28.1421 14.5 24 14.5C19.8579 14.5 16.5 11.1421 16.5 7C16.5 2.85786 13.1421 -0.5 9 -0.5C4.85786 -0.5 1.5 2.85786 1.5 7C1.5 11.1421 4.85786 14.5 9 14.5Z" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </div>
      ) : isUser ? (
        <div className="w-8 h-8 rounded-full bg-blue-500/15 border border-blue-500/25 flex items-center justify-center text-blue-400 flex-shrink-0 mt-0.5">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"/></svg>
        </div>
      ) : null}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-semibold text-textMain text-sm">{isUser ? 'You' : 'Infinity AI'}</span>
          <span className="text-[10px] text-textMuted">{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
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
                <div key={i} className="bg-bgCard border border-borderSubtle rounded-xl px-3 py-2 text-xs flex items-center gap-2">
                  <svg className="w-3.5 h-3.5 text-indigo-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17l-5.1-5.1m0 0L11.42 4.97m-5.1 5.1H21"/></svg>
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
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-600 via-purple-600 to-pink-500 flex items-center justify-center text-white flex-shrink-0 mt-0.5 shadow-md">
        <svg className="w-4 h-3" viewBox="0 0 32 18" fill="none"><path d="M9 14.5C13.1421 14.5 16.5 11.1421 16.5 7C16.5 2.85786 19.8579 -0.5 24 -0.5C28.1421 -0.5 31.5 2.85786 31.5 7C31.5 11.1421 28.1421 14.5 24 14.5C19.8579 14.5 16.5 11.1421 16.5 7C16.5 2.85786 13.1421 -0.5 9 -0.5C4.85786 -0.5 1.5 2.85786 1.5 7C1.5 11.1421 4.85786 14.5 9 14.5Z" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </div>
      <div className="bg-bgCard border border-borderSubtle rounded-2xl px-4 py-2.5 inline-flex items-center gap-2 shadow-sm">
        <span className="text-xs text-textMuted">Thinking</span>
        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
        <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" style={{ animationDelay: '200ms' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-pink-400 animate-pulse" style={{ animationDelay: '400ms' }} />
      </div>
    </div>
  );
}

function DemoChat({ input, setInput, inputRef, onSend }: { input: string; setInput: (v: string) => void; inputRef: React.RefObject<HTMLTextAreaElement | null>; onSend: (text: string) => void }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="max-w-4xl mx-auto px-5 py-5 space-y-5">
          {/* User message */}
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-500/15 border border-blue-500/25 flex items-center justify-center text-blue-400 flex-shrink-0 mt-0.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"/></svg>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold text-textMain text-sm">You</span>
                <span className="text-[10px] text-textMuted">10:42 AM</span>
              </div>
              <p className="text-sm text-zinc-300">Build me a modern SaaS dashboard with analytics, user management and billing.</p>
            </div>
          </div>

          {/* AI message */}
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-600 via-purple-600 to-pink-500 flex items-center justify-center text-white flex-shrink-0 mt-0.5 shadow-md">
              <svg className="w-4 h-3" viewBox="0 0 32 18" fill="none"><path d="M9 14.5C13.1421 14.5 16.5 11.1421 16.5 7C16.5 2.85786 19.8579 -0.5 24 -0.5C28.1421 -0.5 31.5 2.85786 31.5 7C31.5 11.1421 28.1421 14.5 24 14.5C19.8579 14.5 16.5 11.1421 16.5 7C16.5 2.85786 13.1421 -0.5 9 -0.5C4.85786 -0.5 1.5 2.85786 1.5 7C1.5 11.1421 4.85786 14.5 9 14.5Z" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold text-textMain text-sm">Infinity AI</span>
                <span className="text-[10px] text-textMuted">10:43 AM</span>
                <button className="ml-auto text-textMuted hover:text-textMain transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM18.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" /></svg>
                </button>
              </div>
              <p className="text-sm text-zinc-300 mb-4">I'll build a complete SaaS dashboard for you.</p>

              {/* Checklist card */}
              <div className="bg-bgCard border border-borderSubtle rounded-xl p-4 mb-4">
                <div className="flex gap-4">
                  {/* Checklist */}
                  <div className="flex-1 space-y-3">
                    <h4 className="text-sm font-semibold text-textMain flex items-center gap-2">
                      <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
                      SaaS Dashboard Generated Successfully
                    </h4>
                    {[
                      { title: 'Frontend', sub: 'Next.js + Tailwind', desc: 'Modern responsive dashboard UI' },
                      { title: 'Backend API', sub: 'Node.js + Express', desc: 'RESTful API with authentication' },
                      { title: 'Database', sub: 'PostgreSQL', desc: 'Users, teams, billing, analytics schema' },
                      { title: 'Authentication', sub: 'JWT', desc: 'JWT auth with role-based access' },
                      { title: 'Charts & Analytics', sub: '', desc: 'Real-time analytics and reporting' },
                    ].map((item, i) => (
                      <div key={i} className="flex gap-2.5">
                        <svg className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
                        <div>
                          <span className="text-sm font-medium text-zinc-200">{item.title}</span>
                          {item.sub && <span className="text-xs text-textMuted ml-1">({item.sub})</span>}
                          <p className="text-xs text-textMuted mt-0.5">{item.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Dashboard preview */}
                  <div className="w-72 bg-bgMain rounded-lg border border-borderSubtle p-3 flex flex-col relative overflow-hidden">
                    <div className="text-[10px] text-textMuted mb-2 font-medium">Dashboard</div>
                    {/* Mini dashboard mockup */}
                    <div className="grid grid-cols-3 gap-1.5 mb-2">
                      <div className="bg-bgPanel rounded p-1.5">
                        <div className="text-[7px] text-textMuted uppercase">Revenue</div>
                        <div className="text-[10px] font-bold text-textMain">$24,450</div>
                      </div>
                      <div className="bg-bgPanel rounded p-1.5">
                        <div className="text-[7px] text-textMuted uppercase">Users</div>
                        <div className="text-[10px] font-bold text-textMain">1,245</div>
                      </div>
                      <div className="bg-bgPanel rounded p-1.5">
                        <div className="text-[7px] text-textMuted uppercase">Conv.</div>
                        <div className="text-[10px] font-bold text-textMain">3.42%</div>
                      </div>
                    </div>
                    <div className="bg-bgPanel rounded p-2 flex-1 relative min-h-[50px]">
                      <svg className="w-full h-full text-indigo-500/60" viewBox="0 0 100 30" preserveAspectRatio="none">
                        <path d="M0,25 L10,20 L20,22 L30,15 L40,18 L50,12 L60,16 L70,10 L80,14 L90,8 L100,12" fill="none" stroke="currentColor" strokeWidth="1.5"/>
                        <path d="M0,25 L10,20 L20,22 L30,15 L40,18 L50,12 L60,16 L70,10 L80,14 L90,8 L100,12 L100,30 L0,30 Z" fill="currentColor" opacity="0.1"/>
                      </svg>
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-bgCard to-transparent pointer-events-none" />
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 mb-4">
                {[
                  { label: 'Preview', icon: 'M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178zM15 12a3 3 0 11-6 0 3 3 0 016 0z' },
                  { label: 'Edit Code', icon: 'M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5' },
                  { label: 'Deploy', icon: 'M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.691 0a15.02 15.02 0 012.834 5.37' },
                  { label: 'Add to Project', icon: 'M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z' },
                ].map((btn) => (
                  <button key={btn.label} className="px-3 py-1.5 bg-bgPanel hover:bg-bgCard text-textMain rounded-lg border border-borderSubtle flex items-center gap-1.5 transition-colors text-xs">
                    <svg className="w-3.5 h-3.5 text-textMuted" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d={btn.icon}/></svg>
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Suggestion chips */}
          <div className="flex items-center gap-2 pt-2">
            {SUGGESTIONS.map((s, i) => (
              <button
                key={i}
                onClick={() => { setInput(s); inputRef.current?.focus(); }}
                className="px-3 py-1.5 rounded-lg bg-white/[0.03] border border-borderSubtle hover:border-indigo-500/30 hover:bg-white/[0.05] text-xs text-textMuted hover:text-textMain transition-all duration-200"
              >
                {s}
              </button>
            ))}
            <button className="w-7 h-7 rounded-lg bg-white/[0.03] border border-borderSubtle hover:border-indigo-500/30 flex items-center justify-center text-textMuted hover:text-textMain transition-all ml-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" /></svg>
            </button>
            <button className="w-7 h-7 rounded-lg bg-white/[0.03] border border-borderSubtle hover:border-indigo-500/30 flex items-center justify-center text-textMuted hover:text-textMain transition-all">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" /></svg>
            </button>
          </div>
        </div>
      </div>

      {/* Input bar */}
      <div className="flex-shrink-0 px-5 py-3 border-t border-borderSubtle/40">
        <div className="max-w-4xl mx-auto">
          <InputBar input={input} setInput={setInput} inputRef={inputRef} onSend={onSend} />
        </div>
      </div>
    </div>
  );
}
