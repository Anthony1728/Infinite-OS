import { useState, useCallback, useRef, useEffect } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { useEditorStore } from '../../stores/editor';

const DEFAULT_FILES: FileTab[] = [];

interface FileTab {
  name: string;
  language: string;
  content: string;
  originalContent: string;
  modified: boolean;
}

export function CodeEditor() {
  const [files, setFiles] = useState<FileTab[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [statusMessage, setStatusMessage] = useState('Ready');
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);

  const openFile = useEditorStore((s) => s.openFile);
  const openFileContent = useEditorStore((s) => s.openFileContent);
  const openFileLanguage = useEditorStore((s) => s.openFileLanguage);
  const showAnimation = useEditorStore((s) => s.showAnimation);

  // Handle external file open from chat
  useEffect(() => {
    if (openFile && openFileContent) {
      setFiles(prev => {
        const existing = prev.findIndex(f => f.name === openFile);
        if (existing >= 0) {
          const updated = [...prev];
          updated[existing] = { ...updated[existing], content: openFileContent, originalContent: openFileContent, modified: false };
          setActiveIndex(existing);
          return updated;
        }
        const lang = openFileLanguage ?? 'plaintext';
        const newFiles = [...prev, { name: openFile, language: lang, content: openFileContent, originalContent: openFileContent, modified: false }];
        setActiveIndex(newFiles.length - 1);
        return newFiles;
      });
      setStatusMessage(`Opened ${openFile}`);
      setTimeout(() => setStatusMessage('Ready'), 2000);
    }
  }, [openFile, openFileContent, openFileLanguage]);

  const inferLanguage = (name: string): string => {
    if (name.endsWith('.ts') || name.endsWith('.tsx')) return 'typescript';
    if (name.endsWith('.js') || name.endsWith('.jsx')) return 'javascript';
    if (name.endsWith('.json')) return 'json';
    if (name.endsWith('.sql')) return 'sql';
    if (name.endsWith('.css')) return 'css';
    if (name.endsWith('.html')) return 'html';
    if (name.endsWith('.md')) return 'markdown';
    if (name.endsWith('.py')) return 'python';
    return 'plaintext';
  };

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      handleSave();
    });
  };

  const handleContentChange = useCallback((value: string | undefined) => {
    if (value === undefined) return;
    setFiles(prev => {
      const updated = [...prev];
      updated[activeIndex] = {
        ...updated[activeIndex],
        content: value,
        modified: value !== updated[activeIndex].originalContent,
      };
      return updated;
    });
  }, [activeIndex]);

  const handleSave = useCallback(() => {
    const file = files[activeIndex];
    if (!file) return;

    setFiles(prev => {
      const updated = [...prev];
      updated[activeIndex] = { ...updated[activeIndex], originalContent: file.content, modified: false };
      return updated;
    });
    setStatusMessage(`Saved ${file.name}`);
    setTimeout(() => setStatusMessage('Ready'), 2000);
  }, [files, activeIndex]);

  const handleCloseTab = useCallback((index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
    setActiveIndex(prev => {
      if (index < prev) return prev - 1;
      if (index >= prev) return Math.min(prev, files.length - 2);
      return prev;
    });
  }, [files.length]);

  const handleNewFile = useCallback(() => {
    const name = prompt('File name:');
    if (!name) return;
    const lang = inferLanguage(name);
    setFiles(prev => {
      const newFiles = [...prev, { name, language: lang, content: '', originalContent: '', modified: true }];
      setActiveIndex(newFiles.length - 1);
      return newFiles;
    });
  }, []);

  const file = activeIndex >= 0 ? files[activeIndex] : null;
  const modifiedCount = files.filter(f => f.modified).length;

  return (
    <div className={`h-full flex flex-col bg-[#0d0d11] transition-all duration-500 ${showAnimation ? 'ring-2 ring-indigo-500/50 shadow-lg shadow-indigo-500/20' : ''}`}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-white/5 bg-white/[0.01] flex-shrink-0">
        <div className="flex items-center gap-1">
          <button
            onClick={handleNewFile}
            className="p-1.5 rounded hover:bg-white/5 text-gray-500 hover:text-white transition-colors"
            title="New File"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </button>
          <button
            onClick={handleSave}
            className="p-1.5 rounded hover:bg-white/5 text-gray-500 hover:text-white transition-colors"
            title="Save (Ctrl+S)"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
            </svg>
          </button>
        </div>
        <div className="text-[10px] text-gray-600">
          {modifiedCount > 0 && <span className="text-amber-400">{modifiedCount} unsaved</span>}
        </div>
      </div>

      {/* File tabs */}
      <div className="flex items-center gap-0 border-b border-white/5 bg-white/[0.02] flex-shrink-0 overflow-x-auto custom-scrollbar">
        {files.map((f, i) => (
          <div
            key={`${f.name}-${i}`}
            className={`group flex items-center gap-1.5 px-3 py-2 text-xs border-b-2 cursor-pointer transition-colors ${
              activeIndex === i
                ? 'border-indigo-500 text-white bg-white/[0.03]'
                : 'border-transparent text-gray-500 hover:text-white hover:bg-white/[0.02]'
            }`}
            onClick={() => setActiveIndex(i)}
          >
            {f.modified && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />}
            <span className="truncate max-w-[120px]">{f.name}</span>
            <button
              onClick={(e) => { e.stopPropagation(); handleCloseTab(i); }}
              className="opacity-0 group-hover:opacity-100 ml-1 text-gray-500 hover:text-red-400 transition-all"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {/* Editor */}
      <div className="flex-1 min-h-0">
        {file ? (
          <Editor
            language={file.language}
            theme="vs-dark"
            value={file.content}
            onChange={handleContentChange}
            onMount={handleEditorMount}
            options={{
              minimap: { enabled: true, scale: 1 },
              fontSize: 13,
              fontFamily: "'JetBrains Mono', Menlo, monospace",
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              padding: { top: 12, bottom: 12 },
              bracketPairColorization: { enabled: true },
              automaticLayout: true,
              formatOnPaste: true,
              formatOnType: true,
              tabSize: 2,
              renderWhitespace: 'selection',
              smoothScrolling: true,
              cursorBlinking: 'smooth',
              cursorSmoothCaretAnimation: 'on',
            }}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            No file open. Click + to create a new file.
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1 border-t border-white/5 bg-white/[0.01] flex-shrink-0 text-[10px] text-gray-600">
        <div className="flex items-center gap-3">
          <span>{file?.language ?? '—'}</span>
          <span>UTF-8</span>
        </div>
        <span>{statusMessage}</span>
      </div>
    </div>
  );
}
