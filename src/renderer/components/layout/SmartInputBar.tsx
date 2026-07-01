import { useState } from 'react';
import { useChatStore } from '../../stores/chat';

const ICONS = [
  { id: 'attach', icon: '+', label: 'Attach file' },
  { id: 'web', icon: 'W', label: 'Web search' },
  { id: 'chat', icon: 'C', label: 'Quick chat' },
  { id: 'mic', icon: 'M', label: 'Voice input' },
];

const SUGGESTIONS = [
  'Add dark mode',
  'Add email notifications',
  'Integrate Stripe',
  'Add team settings',
];

export function SmartInputBar() {
  const [text, setText] = useState('');
  const [mode] = useState('agent');
  const send = useChatStore((s) => s.sendMessage);
  const streaming = useChatStore((s) => s.streaming);
  const abort = useChatStore((s) => s.abort);

  const submit = () => {
    if (!text.trim() || streaming) return;
    send(text);
    setText('');
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap items-center">
        {SUGGESTIONS.map((s) => (
          <button key={s} onClick={() => setText(s)} className="chip">
            <span>{s}</span>
          </button>
        ))}
        <div className="flex-1" />
        <button className="w-7 h-7 rounded-full border border-white/[0.06] text-gray-600 hover:text-white flex items-center justify-center text-xs" title="Regenerate">
          R
        </button>
        <button className="w-7 h-7 rounded-full border border-white/[0.06] text-gray-600 hover:text-white flex items-center justify-center text-xs" title="Share">
          S
        </button>
      </div>

      <div className="gradient-border min-h-[120px] p-5">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Ask InfiniteAI OS anything..."
          rows={2}
          className="w-full bg-transparent text-sm placeholder:text-gray-600 focus:outline-none resize-none mb-3 min-h-[44px]"
        />
        <div className="flex items-center gap-1.5">
          {ICONS.map((i) => (
            <button
              key={i.id}
              title={i.label}
              className="w-9 h-9 rounded-lg text-gray-500 hover:text-white hover:bg-white/[0.04] flex items-center justify-center text-xs font-semibold transition-colors"
            >
              {i.icon}
            </button>
          ))}
          <div className="flex-1" />
          <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs text-gray-500 hover:text-white hover:bg-white/[0.04] transition-colors">
            <span className="text-violet-400">AI</span>
            <span>{mode === 'agent' ? 'Agent Mode' : 'Chat Mode'}</span>
            <span>v</span>
          </button>
          {streaming ? (
            <button onClick={abort} className="w-12 h-10 rounded-xl bg-red-500 text-white flex items-center justify-center text-xs transition-colors">
              Stop
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!text.trim()}
              className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 text-white flex items-center justify-center hover:opacity-90 disabled:opacity-30 transition-all text-xs font-medium"
            >
              Go
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

