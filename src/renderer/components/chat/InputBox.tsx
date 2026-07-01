import { useState, useRef, KeyboardEvent } from 'react';
import { useChatStore } from '../../stores/chat';

export function InputBox({ disabled, streaming, onAbort }: { disabled: boolean; streaming: boolean; onAbort: () => void }) {
  const [text, setText] = useState('');
  const send = useChatStore((s) => s.sendMessage);
  const ref = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    if (!text.trim() || streaming) return;
    send(text);
    setText('');
    ref.current?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="max-w-3xl mx-auto flex gap-2 items-end">
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        rows={1}
        disabled={disabled}
        placeholder={disabled ? 'Create or select a session to start…' : 'Ask anything. Enter to send · Shift+Enter for newline'}
        className="flex-1 resize-none rounded-lg border border-border bg-bg-subtle px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent max-h-40"
        onInput={(e) => {
          const t = e.currentTarget;
          t.style.height = 'auto';
          t.style.height = `${t.scrollHeight}px`;
        }}
      />
      {streaming ? (
        <button onClick={onAbort} className="rounded-lg bg-danger text-white px-4 py-2 text-sm font-medium hover:opacity-90">
          Stop
        </button>
      ) : (
        <button onClick={submit} disabled={disabled || !text.trim()} className="rounded-lg bg-accent text-accent-fg px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50">
          Send
        </button>
      )}
    </div>
  );
}

