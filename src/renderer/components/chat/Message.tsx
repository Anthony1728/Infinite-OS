import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useState } from 'react';
import type { Message, ContentBlock } from '../../../shared/types';
import { ToolCallCard } from '../tools/ToolCallCard';

function InteractiveQuestion({ block, onAnswer }: { block: Extract<ContentBlock, { type: 'question' }>; onAnswer: (answer: string) => void }) {
  const [customInput, setCustomInput] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const handleSelect = (label: string) => {
    setSelected(label);
    onAnswer(label);
  };

  const handleCustomSubmit = () => {
    if (customInput.trim()) {
      onAnswer(customInput.trim());
    }
  };

  return (
    <div className="rounded-lg border border-border bg-bg-elevated p-4 space-y-3">
      <p className="text-sm font-medium text-text">{block.question}</p>
      <div className="space-y-2">
        {block.options.map((opt, i) => (
          <button
            key={i}
            onClick={() => handleSelect(opt.label)}
            className={`w-full text-left px-3 py-2 rounded-md border text-sm transition-colors ${
              selected === opt.label
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border hover:border-border-hover hover:bg-bg-hover text-text'
            }`}
          >
            <span className="font-medium">{opt.label}</span>
            {opt.description && <span className="text-text-muted ml-2">{opt.description}</span>}
          </button>
        ))}
      </div>
      {block.allowCustom !== false && (
        <div className="flex gap-2 pt-1">
          <input
            type="text"
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCustomSubmit()}
            placeholder="Type your own answer..."
            className="flex-1 px-3 py-2 rounded-md border border-border bg-bg text-text text-sm placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
          <button
            onClick={handleCustomSubmit}
            disabled={!customInput.trim()}
            className="px-3 py-2 rounded-md bg-accent text-accent-fg text-sm font-medium disabled:opacity-50"
          >
            Submit
          </button>
        </div>
      )}
    </div>
  );
}

export function Message({ message, onQuestionAnswer }: { message: Message; onQuestionAnswer?: (questionId: string, answer: string) => void }) {
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
          if (block.type === 'question') {
            return (
              <InteractiveQuestion
                key={i}
                block={block}
                onAnswer={(answer) => onQuestionAnswer?.(block.questionId, answer)}
              />
            );
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

