// Inline media rendering for tool-generated images, videos, and audio.
//
// Media tools (ImageGenerator / VideoGen / MusicGen) save real files and tag
// their results with an INFINITE_MEDIA envelope; the chat store turns that
// into `file` ContentBlocks carrying a mediaPath. This component lazily loads
// the bytes over IPC (files can be tens of MB — never embed them in the
// message), renders a preview right in the conversation, and offers a
// fullscreen lightbox ("open in Infinite OS") plus external open.

import { useEffect, useState } from 'react';
import { FileAudio, FileQuestion, Film, ImageIcon, Maximize2, ExternalLink, X } from 'lucide-react';

type MediaBlock = {
  type: 'file';
  name: string;
  mimeType: string;
  data: string;
  mediaPath: string;
  mediaKind: 'image' | 'video' | 'audio';
};

/** Read one media file over IPC and return a data: URL (null on failure). */
async function loadMediaDataUrl(path: string): Promise<string | null> {
  try {
    const result = (await window.api.fileRead({ path })) as {
      type?: string;
      content?: string;
      isBinary?: boolean;
      mimeType?: string;
      tooLarge?: boolean;
      error?: string;
    } | null;
    if (!result || result.error || result.tooLarge || !result.isBinary || !result.content) return null;
    return `data:${result.mimeType ?? 'application/octet-stream'};base64,${result.content}`;
  } catch {
    return null;
  }
}

function MediaLightbox({ src, name, path, onClose }: { src: string; name: string; path: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/90 backdrop-blur-sm flex flex-col items-center justify-center p-6 animate-fade-in"
      onClick={onClose}
    >
      <div className="absolute top-4 right-4 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => void window.api.fileOpen({ path })}
          className="h-8 px-3 rounded-lg border border-white/[0.12] bg-white/[0.06] text-[11px] text-zinc-200 hover:bg-white/[0.12] transition-colors flex items-center gap-1.5"
          title="Open with the default Windows app"
        >
          <ExternalLink size={13} />
          Open externally
        </button>
        <button
          onClick={onClose}
          className="h-8 w-8 rounded-lg border border-white/[0.12] bg-white/[0.06] text-zinc-300 hover:bg-white/[0.12] transition-colors flex items-center justify-center"
          aria-label="Close viewer"
        >
          <X size={15} />
        </button>
      </div>
      <div className="max-w-[92vw] max-h-[86vh] flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
        <img src={src} alt={name} className="max-w-[92vw] max-h-[80vh] object-contain rounded-xl shadow-2xl" />
        <span className="text-[11px] text-zinc-500 font-mono truncate max-w-[80vw]">{path}</span>
      </div>
    </div>
  );
}

function MediaTile({ block }: { block: MediaBlock }) {
  const [src, setSrc] = useState<string | null>(block.data ? `data:${block.mimeType};base64,${block.data}` : null);
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    if (src || failed) return;
    let cancelled = false;
    void loadMediaDataUrl(block.mediaPath).then((url) => {
      if (cancelled) return;
      if (url) setSrc(url);
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [src, failed, block.mediaPath]);

  if (failed) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
        <FileQuestion size={15} className="text-zinc-500 shrink-0" />
        <div className="min-w-0">
          <p className="text-[11px] text-zinc-400 truncate max-w-[260px]">{block.name}</p>
          <p className="text-[10px] text-zinc-600 truncate max-w-[260px]">{block.mediaPath}</p>
        </div>
        <button
          onClick={() => void window.api.fileOpen({ path: block.mediaPath })}
          className="ml-auto h-7 px-2.5 rounded-lg border border-white/[0.1] text-[10px] text-zinc-300 hover:bg-white/[0.08] transition-colors shrink-0"
        >
          Open
        </button>
      </div>
    );
  }

  if (!src) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-4">
        <span className="w-3 h-3 rounded-full bg-indigo-400 animate-pulse" />
        <span className="text-[11px] text-zinc-500">Loading {block.mediaKind}…</span>
      </div>
    );
  }

  if (block.mediaKind === 'image') {
    return (
      <>
        <div className="group relative inline-block max-w-[340px]">
          <img
            src={src}
            alt={block.name}
            className="max-h-64 rounded-xl border border-white/10 cursor-zoom-in"
            onClick={() => setZoomed(true)}
          />
          <button
            onClick={() => setZoomed(true)}
            title="View full size in Infinite OS"
            aria-label="View full size"
            className="absolute top-2 right-2 h-7 w-7 rounded-lg bg-black/60 border border-white/[0.14] text-zinc-200 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
          >
            <Maximize2 size={13} />
          </button>
        </div>
        {zoomed && <MediaLightbox src={src} name={block.name} path={block.mediaPath} onClose={() => setZoomed(false)} />}
      </>
    );
  }

  if (block.mediaKind === 'video') {
    return (
      <video src={src} controls className="max-w-[380px] rounded-xl border border-white/10" preload="metadata">
        <track kind="captions" />
      </video>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 min-w-[280px]">
      <FileAudio size={18} className="text-indigo-300 shrink-0" />
      <audio src={src} controls className="h-8 w-full max-w-[280px]" preload="metadata" />
    </div>
  );
}

export function MediaBlocks({ blocks }: { blocks: MediaBlock[] }) {
  if (blocks.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2.5 items-start">
      {blocks.map((block, i) => (
        <MediaTile key={`${block.mediaPath}-${i}`} block={block} />
      ))}
    </div>
  );
}

/** Icon used by the gallery header (kept local so the view stays self-contained). */
export const MediaIcons = { ImageIcon, Film };
