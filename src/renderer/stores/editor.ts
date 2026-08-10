import { create } from 'zustand';

export interface EditorFile {
  name: string;
  language: string;
  content: string;
  originalContent: string;
  modified: boolean;
}

interface EditorState {
  files: EditorFile[];
  activeIndex: number;
  openFile: string | null;
  openFileContent: string | null;
  openFileLanguage: string | null;
  launchFile: string | null;
  showAnimation: boolean;

  openInEditor: (name: string, content: string, language?: string, launch?: boolean) => void;
  clearLaunch: () => void;
  saveFile: (name: string, content: string) => void;
  clearAnimation: () => void;
}

const inferLanguage = (name: string): string => {
  if (name.endsWith('.ts') || name.endsWith('.tsx')) return 'typescript';
  if (name.endsWith('.js') || name.endsWith('.jsx')) return 'javascript';
  if (name.endsWith('.json')) return 'json';
  if (name.endsWith('.sql')) return 'sql';
  if (name.endsWith('.css')) return 'css';
  if (name.endsWith('.html')) return 'html';
  if (name.endsWith('.md')) return 'markdown';
  if (name.endsWith('.py')) return 'python';
  if (name.endsWith('.rs')) return 'rust';
  if (name.endsWith('.go')) return 'go';
  if (name.endsWith('.yaml') || name.endsWith('.yml')) return 'yaml';
  return 'plaintext';
};

export const useEditorStore = create<EditorState>((set) => ({
  files: [],
  activeIndex: 0,
  openFile: null,
  openFileContent: null,
  openFileLanguage: null,
  launchFile: null,
  showAnimation: false,

  openInEditor: (name: string, content: string, language?: string, launch = false) => {
    const lang = language ?? inferLanguage(name);
    set({
      openFile: name,
      openFileContent: content,
      openFileLanguage: lang,
      launchFile: launch ? name : null,
      showAnimation: true,
    });
    // Auto-clear animation after 1 second
    setTimeout(() => {
      set({ showAnimation: false });
    }, 1000);
  },

  clearLaunch: () => set({ launchFile: null }),

  saveFile: (name: string, content: string) => {
    set((state) => {
      const existing = state.files.findIndex(f => f.name === name);
      if (existing >= 0) {
        const updated = [...state.files];
        updated[existing] = { ...updated[existing], content, originalContent: content, modified: false };
        return { files: updated };
      }
      return {
        files: [...state.files, {
          name,
          language: inferLanguage(name),
          content,
          originalContent: content,
          modified: false,
        }],
      };
    });
  },

  clearAnimation: () => set({ showAnimation: false }),
}));

