import { useState, useRef, useEffect } from 'react';
import { useChatStore } from '../../stores/chat';

interface SideChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface SideChatProps {
  parentSessionId: string;
  parentContext: string;
  onClose: () => void;
}

export function SideChat({ parentSessionId, parentContext, onClose }: SideChatProps) {
  const [messages, setMessages] = useState<SideChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isResponding, setIsResponding] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sendMessage = useChatStore((state) => state.sendMessage);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isResponding) return;

    const userMsg: SideChatMessage = {
      id: `side-${Date.now()}`,
      role: 'user',
      content: input,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsResponding(true);

    // Build context-aware prompt
    const contextPrompt = `[Side question — context from session: ${parentContext.slice(0, 500)}...]\n\n${input}`;

    try {
      await sendMessage(contextPrompt);
      // The response will come through the chat store
      const assistantMsg: SideChatMessage = {
        id: `side-${Date.now()}-resp`,
        role: 'assistant',
        content: 'Response streamed via main session...',
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch {
      const errorMsg: SideChatMessage = {
        id: `side-${Date.now()}-err`,
        role: 'assistant',
        content: 'Failed to get response. The main session may be busy.',
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsResponding(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0c1018] border border-white/[0.06] rounded-xl overflow-hidden animate-slide-up">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06] bg-[#0e1219]">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center shadow-md shadow-cyan-500/25">
            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8.625 9.75a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" /></svg>
          </div>
          <div>
            <div className="text-xs font-semibold text-textMain">Side Chat</div>
            <div className="text-[9px] text-textMuted">Context-aware question</div>
          </div>
        </div>
        <button onClick={onClose} className="p-1 rounded-md hover:bg-white/[0.06] transition-colors">
          <svg className="w-3.5 h-3.5 text-textMuted" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center mx-auto mb-3">
              <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
            </div>
            <p className="text-xs text-textMuted">Ask a question without</p>
            <p className="text-xs text-textMuted">derailing the main session</p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-xl px-3 py-2 ${
              msg.role === 'user'
                ? 'bg-indigo-500/15 border border-indigo-500/20 text-textMain'
                : 'bg-white/[0.04] border border-white/[0.06] text-textMain/90'
            }`}>
              <div className="text-xs whitespace-pre-wrap">{msg.content}</div>
            </div>
          </div>
        ))}
        {isResponding && (
          <div className="flex justify-start">
            <div className="bg-white/[0.04] border border-white/[0.06] rounded-xl px-3 py-2">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-2 border-t border-white/[0.06]">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) handleSend(); }}
            placeholder="Ask a side question..."
            className="flex-1 bg-bgInput border border-borderSubtle rounded-lg px-3 py-1.5 text-xs text-textMain placeholder-textMuted focus:outline-none focus:border-cyan-500/50"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isResponding}
            className="px-2.5 py-1.5 bg-gradient-to-r from-cyan-500 to-blue-500 text-white rounded-lg text-xs font-medium hover:from-cyan-600 hover:to-blue-600 disabled:opacity-40 transition-all shadow-md shadow-cyan-500/20"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
}
