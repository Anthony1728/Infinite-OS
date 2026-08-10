import { useState, useRef, KeyboardEvent, useCallback } from 'react';
import { useChatStore } from '../../stores/chat';
import { ImageIcon, X } from 'lucide-react';
import type { ContentBlock } from '../../../shared/types';

interface ImagePreview {
  id: string;
  data: string;
  mediaType: string;
  name: string;
}

export function InputBox({ disabled, streaming, onAbort }: { disabled: boolean; streaming: boolean; onAbort: () => void }) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<ImagePreview[]>([]);
  const send = useChatStore((s) => s.sendMessage);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      const base64 = result.split(',')[1];
      const newImage: ImagePreview = {
        id: crypto.randomUUID(),
        data: base64,
        mediaType: file.type,
        name: file.name,
      };
      setImages((prev) => [...prev, newImage]);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach(processFile);
    e.target.value = '';
  }, [processFile]);

  const removeImage = useCallback((id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  const submit = () => {
    if ((!text.trim() && images.length === 0) || streaming) return;
    const imageBlocks: ContentBlock[] | undefined = images.length > 0
      ? images.map((img) => ({
          type: 'image' as const,
          source: { type: 'base64' as const, mediaType: img.mediaType, data: img.data },
        }))
      : undefined;
    send(text, imageBlocks);
    setText('');
    setImages([]);
    ref.current?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-2 items-end">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2 w-full">
          {images.map((img) => (
            <div key={img.id} className="relative group">
              <img
                src={`data:${img.mediaType};base64,${img.data}`}
                alt={img.name}
                className="w-16 h-16 object-cover rounded-lg border border-border"
              />
              <button
                type="button"
                onClick={() => removeImage(img.id)}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-danger text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2 items-end w-full">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileChange}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || streaming}
          className="rounded-lg border border-border bg-bg-subtle p-2 text-zinc-400 hover:text-zinc-200 hover:border-border transition-colors disabled:opacity-50"
          title="Attach image"
        >
          <ImageIcon size={18} />
        </button>
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
          <button onClick={submit} disabled={disabled || (!text.trim() && images.length === 0)} className="rounded-lg bg-accent text-accent-fg px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50">
            Send
          </button>
        )}
      </div>
    </div>
  );
}
