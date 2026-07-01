import { useEffect, useRef } from 'react';
import type { Message } from '../../../shared/types';
import { Message as MessageView } from './Message';

export function MessageList({ messages }: { messages: Message[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  return (
    <div ref={ref} className="max-w-3xl mx-auto p-6 space-y-6">
      {messages.map((m) => <MessageView key={m.id} message={m} />)}
    </div>
  );
}

