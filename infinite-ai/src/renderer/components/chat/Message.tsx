import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message } from '../../../shared/types';
import { ToolCallCard } from '../tools/ToolCallCard';

export function Message({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex gap-4 ${isUser ? 'justify-end' : ''}`}>
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-accent text-accent-fg flex items-center justify-center text-xs font-semibold flex-shrink-0">
          IA
        </div>
      )}
      <div className={`flex-1 min-w-0 ${isUser ? 'max-w-2xl' : ''}`}>
        {message.content.map((block, i) => {
          if (block.type === 'text') {
            return (
              <div key={i} className="prose prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.text}</ReactMarkdown>
              </div>
            );
          }
          if (block.type === 'image') {
            return <img key={i} src={`data:${block.source.mediaType};base64,${block.source.data}`} className="rounded-lg max-w-full" alt="" />;
          }
          if (block.type === 'tool_use') {
            return <ToolCallCard key={i} name={block.name} input={block.input} status="done" />;
          }
          if (block.type === 'tool_result') {
            return null; // tool results are shown inside ToolCallCard
          }
          return null;
        })}
      </div>
      {isUser && (
        <div className="w-8 h-8 rounded-full bg-bg-elevated flex items-center justify-center text-xs font-semibold flex-shrink-0">
          You
        </div>
      )}
    </div>
  );
}
