import { useState } from 'react';

interface DiffLine {
  type: 'add' | 'remove' | 'context' | 'header';
  oldLine?: number;
  newLine?: number;
  content: string;
}

interface FileDiff {
  path: string;
  additions: number;
  deletions: number;
  lines: DiffLine[];
}

interface Comment {
  id: string;
  lineIndex: number;
  author: string;
  text: string;
  timestamp: number;
}

interface DiffViewerProps {
  files: FileDiff[];
  onAccept?: (filePath: string) => void;
  onReject?: (filePath: string) => void;
  onAcceptAll?: () => void;
  onRejectAll?: () => void;
  onRequestReview?: () => void;
  isReviewing?: boolean;
}

export function DiffViewer({ files, onAccept, onReject, onAcceptAll, onRejectAll, onRequestReview, isReviewing }: DiffViewerProps) {
  const [selectedFile, setSelectedFile] = useState(0);
  const [comments, setComments] = useState<Record<string, Comment[]>>({});
  const [activeComment, setActiveComment] = useState<{ fileIdx: number; lineIdx: number } | null>(null);
  const [commentText, setCommentText] = useState('');
  const [acceptedFiles, setAcceptedFiles] = useState<Set<string>>(new Set());
  const [rejectedFiles, setRejectedFiles] = useState<Set<string>>(new Set());
  const [showResolved, setShowResolved] = useState(false);

  const file = files[selectedFile];
  const fileKey = file?.path || '';
  const fileComments = comments[fileKey] || [];

  const addComment = (lineIndex: number) => {
    if (!commentText.trim()) return;
    const newComment: Comment = {
      id: `c-${Date.now()}`,
      lineIndex,
      author: 'You',
      text: commentText,
      timestamp: Date.now(),
    };
    setComments((prev) => ({
      ...prev,
      [fileKey]: [...(prev[fileKey] || []), newComment],
    }));
    setCommentText('');
    setActiveComment(null);
  };

  const acceptFile = (path: string) => {
    setAcceptedFiles((prev) => new Set(prev).add(path));
    setRejectedFiles((prev) => { const n = new Set(prev); n.delete(path); return n; });
    onAccept?.(path);
  };

  const rejectFile = (path: string) => {
    setRejectedFiles((prev) => new Set(prev).add(path));
    setAcceptedFiles((prev) => { const n = new Set(prev); n.delete(path); return n; });
    onReject?.(path);
  };

  const totalAdditions = files.reduce((s, f) => s + f.additions, 0);
  const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);

  return (
    <div className="flex flex-col h-full bg-[#0c1018] border border-white/[0.06] rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06] bg-[#0e1219]">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shadow-lg shadow-emerald-500/25">
            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 16.875h3.375m0 0h3.375m-3.375 0V13.5m0 3.375v3.375M6 10.5h2.25a2.25 2.25 0 002.25-2.25V6a2.25 2.25 0 00-2.25-2.25H6A2.25 2.25 0 003.75 6v2.25A2.25 2.25 0 006 10.5zm0 9.75h2.25A2.25 2.25 0 0010.5 18v-2.25a2.25 2.25 0 00-2.25-2.25H6a2.25 2.25 0 00-2.25 2.25V18A2.25 2.25 0 006 20.25zm9.75-9.75H18a2.25 2.25 0 002.25-2.25V6A2.25 2.25 0 0018 3.75h-2.25A2.25 2.25 0 0013.5 6v2.25a2.25 2.25 0 002.25 2.25z" /></svg>
          </div>
          <div>
            <div className="text-sm font-semibold text-textMain">Review Changes</div>
            <div className="text-[10px] text-textMuted">
              {files.length} file{files.length !== 1 ? 's' : ''} changed
              <span className="text-emerald-400 ml-1.5">+{totalAdditions}</span>
              <span className="text-red-400 ml-1">-{totalDeletions}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onRequestReview && (
            <button
              onClick={onRequestReview}
              disabled={isReviewing}
              className="px-3 py-1.5 text-[10px] font-medium bg-gradient-to-r from-violet-500 to-purple-500 text-white rounded-lg hover:from-violet-600 hover:to-purple-600 disabled:opacity-40 transition-all shadow-md shadow-violet-500/20 flex items-center gap-1.5"
            >
              {isReviewing ? (
                <div className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin" />
              ) : (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              )}
              {isReviewing ? 'Reviewing...' : 'Review Code'}
            </button>
          )}
          {onAcceptAll && (
            <button
              onClick={onAcceptAll}
              className="px-3 py-1.5 text-[10px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 rounded-lg hover:bg-emerald-500/25 transition-all"
            >
              Accept All
            </button>
          )}
          {onRejectAll && (
            <button
              onClick={onRejectAll}
              className="px-3 py-1.5 text-[10px] font-medium bg-red-500/15 text-red-400 border border-red-500/20 rounded-lg hover:bg-red-500/25 transition-all"
            >
              Reject All
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* File list */}
        <div className="w-64 border-r border-white/[0.06] overflow-y-auto">
          {files.map((f, i) => {
            const isAccepted = acceptedFiles.has(f.path);
            const isRejected = rejectedFiles.has(f.path);
            return (
              <button
                key={f.path}
                onClick={() => setSelectedFile(i)}
                className={`w-full text-left px-3 py-2 border-b border-white/[0.04] transition-colors ${
                  i === selectedFile
                    ? 'bg-indigo-500/10 border-l-2 border-l-indigo-500'
                    : 'hover:bg-white/[0.02] border-l-2 border-l-transparent'
                }`}
              >
                <div className="text-xs font-mono text-textMain truncate">{f.path.split('/').pop()}</div>
                <div className="text-[10px] text-textMuted truncate mt-0.5">{f.path}</div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] text-emerald-400">+{f.additions}</span>
                  <span className="text-[10px] text-red-400">-{f.deletions}</span>
                  {isAccepted && <span className="text-[10px] text-emerald-400 font-medium">Accepted</span>}
                  {isRejected && <span className="text-[10px] text-red-400 font-medium">Rejected</span>}
                  {(comments[f.path] || []).length > 0 && (
                    <span className="text-[10px] text-amber-400">{(comments[f.path] || []).length} comment{(comments[f.path] || []).length !== 1 ? 's' : ''}</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Diff content */}
        <div className="flex-1 overflow-y-auto">
          {file && (
            <div className="font-mono text-xs">
              {/* File header */}
              <div className="px-4 py-2 bg-white/[0.02] border-b border-white/[0.06] sticky top-0 z-10">
                <div className="flex items-center justify-between">
                  <span className="text-textMain font-medium">{file.path}</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => acceptFile(file.path)}
                      disabled={isAccepted}
                      className="px-2 py-0.5 text-[10px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 rounded hover:bg-emerald-500/25 disabled:opacity-40 transition-all"
                    >
                      {isAccepted ? 'Accepted' : 'Accept'}
                    </button>
                    <button
                      onClick={() => rejectFile(file.path)}
                      disabled={isRejected}
                      className="px-2 py-0.5 text-[10px] font-medium bg-red-500/15 text-red-400 border border-red-500/20 rounded hover:bg-red-500/25 disabled:opacity-40 transition-all"
                    >
                      {isRejected ? 'Rejected' : 'Reject'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Lines */}
              {file.lines.map((line, lineIdx) => {
                const lineComments = fileComments.filter((c) => c.lineIndex === lineIdx);
                const isCommenting = activeComment?.fileIdx === selectedFile && activeComment?.lineIdx === lineIdx;

                return (
                  <div key={lineIdx}>
                    <div
                      className={`flex items-stretch border-b border-white/[0.03] group ${
                        line.type === 'add' ? 'bg-emerald-500/[0.07]' :
                        line.type === 'remove' ? 'bg-red-500/[0.07]' :
                        ''
                      }`}
                    >
                      {/* Line numbers */}
                      <div className="w-20 flex-shrink-0 text-right pr-2 py-0.5 text-[10px] select-none border-r border-white/[0.04]">
                        <span className="text-textMuted/50">{line.oldLine || ''}</span>
                      </div>
                      <div className="w-20 flex-shrink-0 text-right pr-2 py-0.5 text-[10px] select-none border-r border-white/[0.04]">
                        <span className="text-textMuted/50">{line.newLine || ''}</span>
                      </div>

                      {/* Prefix */}
                      <div className="w-5 flex-shrink-0 text-center py-0.5 text-[10px] select-none">
                        <span className={
                          line.type === 'add' ? 'text-emerald-400' :
                          line.type === 'remove' ? 'text-red-400' :
                          'text-textMuted/40'
                        }>
                          {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
                        </span>
                      </div>

                      {/* Content */}
                      <div className="flex-1 px-2 py-0.5 whitespace-pre overflow-x-auto text-textMain/90">
                        {line.content}
                      </div>

                      {/* Comment button */}
                      <button
                        onClick={() => setActiveComment(isCommenting ? null : { fileIdx: selectedFile, lineIdx })}
                        className="w-6 flex-shrink-0 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity hover:bg-white/[0.05]"
                      >
                        <svg className="w-3 h-3 text-textMuted" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                      </button>
                    </div>

                    {/* Inline comment box */}
                    {isCommenting && (
                      <div className="px-4 py-2 bg-indigo-500/[0.05] border-b border-indigo-500/20">
                        <textarea
                          autoFocus
                          value={commentText}
                          onChange={(e) => setCommentText(e.target.value)}
                          placeholder="Leave a comment..."
                          className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-xs text-textMain placeholder-textMuted resize-none h-16 focus:outline-none focus:border-indigo-500/50"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addComment(lineIdx);
                          }}
                        />
                        <div className="flex justify-end gap-2 mt-1.5">
                          <button onClick={() => setActiveComment(null)} className="px-2 py-1 text-[10px] text-textMuted hover:text-textMain rounded transition-colors">Cancel</button>
                          <button onClick={() => addComment(lineIdx)} className="px-2 py-1 text-[10px] bg-indigo-500/20 text-indigo-400 rounded hover:bg-indigo-500/30 transition-colors">Comment (Ctrl+Enter)</button>
                        </div>
                      </div>
                    )}

                    {/* Existing comments */}
                    {lineComments.map((c) => (
                      <div key={c.id} className="px-4 py-2 bg-amber-500/[0.04] border-b border-amber-500/10">
                        <div className="flex items-center gap-2 mb-1">
                          <div className="w-4 h-4 rounded-full bg-amber-500/20 flex items-center justify-center text-[8px] text-amber-400 font-bold">{c.author[0]}</div>
                          <span className="text-[10px] text-amber-400 font-medium">{c.author}</span>
                          <span className="text-[10px] text-textMuted">{new Date(c.timestamp).toLocaleTimeString()}</span>
                        </div>
                        <div className="text-xs text-textMain/80 pl-6">{c.text}</div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
