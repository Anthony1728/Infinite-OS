import { create } from 'zustand';

export type AiTabKind =
  | 'quiz' | 'summary' | 'business' | 'feature' | 'code' | 'research' | 'lesson' | 'workspace'
  | 'chart' | 'document' | 'video' | 'invoice' | 'data' | 'dashboard' | 'financial' | 'custom';

export interface TabSection {
  title: string;
  content: string;
  type: 'text' | 'chart' | 'table' | 'list' | 'code' | 'metrics' | 'image' | 'embed';
  data?: Record<string, unknown>;
}

export interface TabChartData {
  labels: string[];
  datasets: { label: string; data: number[]; color?: string }[];
  chartType?: 'bar' | 'line' | 'pie' | 'doughnut';
}

export interface TabMetric {
  label: string;
  value: string | number;
  change?: string;
  color?: string;
}

export interface TabTableData {
  columns: { header: string; key: string }[];
  rows: Record<string, unknown>[];
}

export interface AiWorkspaceTab {
  id: string;
  title: string;
  kind: AiTabKind;
  prompt: string;
  content: string;
  createdAt: number;
  icon?: string;
  color?: string;
  sections?: TabSection[];
  metrics?: TabMetric[];
  chartData?: TabChartData;
  tableData?: TabTableData;
  htmlContent?: string;
  filePath?: string;
  metadata?: Record<string, unknown>;
}

interface AiTabsState {
  tabs: AiWorkspaceTab[];
  hydrate: () => void;
  createTab: (input: {
    title: string;
    kind: AiTabKind;
    prompt: string;
    content?: string;
    icon?: string;
    color?: string;
    sections?: TabSection[];
    metrics?: TabMetric[];
    chartData?: TabChartData;
    tableData?: TabTableData;
    htmlContent?: string;
    filePath?: string;
    metadata?: Record<string, unknown>;
  }) => AiWorkspaceTab;
  updateTab: (id: string, patch: Partial<AiWorkspaceTab>) => void;
  closeTab: (id: string) => void;
  clearTabs: () => void;
}

const STORAGE_KEY = 'infinite:ai-workspace-tabs';
const MAX_TABS = 20;

function saveTabs(tabs: AiWorkspaceTab[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
}

function defaultContent(kind: AiTabKind, prompt: string): string {
  const templates: Record<string, string> = {
    quiz: `Quiz workspace\n\nSource: ${prompt}\n\n- 5-20 questions with answers\n- Explanations\n- Weak-area tracking`,
    summary: `Smart summary\n\nSource: ${prompt}\n\n- Main idea\n- Key points\n- Actions`,
    business: `Business analysis\n\n${prompt}\n\n- Opportunity\n- Customer\n- Offer\n- Risks\n- Next actions`,
    feature: `Feature build\n\n${prompt}\n\nInspect, edit, validate, report.`,
    code: `Code workspace\n\n${prompt}\n\nWrite, test, and validate code.`,
    research: `Research\n\n${prompt}\n\n- Sources\n- Comparison\n- Recommendation`,
    lesson: `Learning\n\n${prompt}\n\n- Explanation\n- Example\n- Quiz`,
    chart: `Chart: ${prompt}`,
    document: `Document: ${prompt}`,
    video: `Video: ${prompt}`,
    invoice: `Invoice: ${prompt}`,
    data: `Data analysis: ${prompt}`,
    dashboard: `Dashboard: ${prompt}`,
    financial: `Financial analysis: ${prompt}`,
    custom: `Custom workspace: ${prompt}`,
    workspace: `Workspace: ${prompt}`,
  };
  return templates[kind] || `Generated: ${prompt}`;
}

const KIND_META: Record<string, { icon: string; color: string }> = {
  chart: { icon: '📊', color: '#22d3ee' },
  document: { icon: '📄', color: '#8b5cf6' },
  video: { icon: '🎬', color: '#ec4899' },
  invoice: { icon: '💰', color: '#4ade80' },
  data: { icon: '📈', color: '#f59e0b' },
  dashboard: { icon: '🖥️', color: '#38bdf8' },
  financial: { icon: '💹', color: '#10b981' },
  business: { icon: '🏢', color: '#6366f1' },
  quiz: { icon: '🧠', color: '#a78bfa' },
  summary: { icon: '📋', color: '#94a3b8' },
  research: { icon: '🔬', color: '#22d3ee' },
  lesson: { icon: '📚', color: '#fbbf24' },
  code: { icon: '💻', color: '#34d399' },
  feature: { icon: '⚡', color: '#f97316' },
  custom: { icon: '✨', color: '#c084fc' },
  workspace: { icon: '🛠️', color: '#64748b' },
};

export const useAiTabsStore = create<AiTabsState>((set, get) => ({
  tabs: [],

  hydrate: () => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as AiWorkspaceTab[];
      if (Array.isArray(stored)) set({ tabs: stored.slice(0, MAX_TABS) });
    } catch {
      set({ tabs: [] });
    }
  },

  createTab: (input) => {
    const meta = KIND_META[input.kind] || KIND_META.custom;
    const tab: AiWorkspaceTab = {
      id: `ai-tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: input.title.slice(0, 40),
      kind: input.kind,
      prompt: input.prompt,
      content: input.content || defaultContent(input.kind, input.prompt),
      createdAt: Date.now(),
      icon: input.icon || meta.icon,
      color: input.color || meta.color,
      sections: input.sections,
      metrics: input.metrics,
      chartData: input.chartData,
      tableData: input.tableData,
      htmlContent: input.htmlContent,
      filePath: input.filePath,
      metadata: input.metadata,
    };
    const tabs = [tab, ...get().tabs.filter((item) => item.id !== tab.id)].slice(0, MAX_TABS);
    set({ tabs });
    saveTabs(tabs);
    return tab;
  },

  updateTab: (id, patch) => {
    const tabs = get().tabs.map((t) => (t.id === id ? { ...t, ...patch } : t));
    set({ tabs });
    saveTabs(tabs);
  },

  closeTab: (id) => {
    const tabs = get().tabs.filter((tab) => tab.id !== id);
    set({ tabs });
    saveTabs(tabs);
  },

  clearTabs: () => {
    set({ tabs: [] });
    saveTabs([]);
  },
}));
