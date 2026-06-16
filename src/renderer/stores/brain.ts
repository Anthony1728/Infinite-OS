import { create } from 'zustand';

interface KnowledgeEntry {
  id: string;
  timestamp: number;
  category: 'code' | 'conversation' | 'task' | 'learning' | 'pattern';
  input: string;
  output: string;
  source: 'api' | 'user' | 'system';
  confidence: number;
  tags: string[];
}

interface BrainState {
  knowledge: KnowledgeEntry[];
  isLearning: boolean;
  totalInteractions: number;
  lastLearned: number;
  
  learnFromInteraction: (input: string, output: string, source: 'api' | 'user' | 'system') => void;
  searchKnowledge: (query: string) => KnowledgeEntry[];
  generateOfflineResponse: (input: string) => string;
  getKnowledgeStats: () => { total: number; categories: Record<string, number>; recentActivity: number };
  exportKnowledge: () => string;
  importKnowledge: (data: string) => void;
}

// Helper to extract tags from input/output
function extractTags(input: string, output: string): string[] {
  const text = `${input} ${output}`.toLowerCase();
  const tags: string[] = [];
  
  // Code-related tags
  if (text.includes('function') || text.includes('const') || text.includes('let ') || text.includes('var ')) tags.push('javascript');
  if (text.includes('import') || text.includes('export')) tags.push('module');
  if (text.includes('react') || text.includes('component') || text.includes('jsx') || text.includes('tsx')) tags.push('react');
  if (text.includes('css') || text.includes('style') || text.includes('tailwind')) tags.push('styling');
  if (text.includes('api') || text.includes('fetch') || text.includes('axios')) tags.push('api');
  if (text.includes('database') || text.includes('sql') || text.includes('mongo')) tags.push('database');
  if (text.includes('html') || text.includes('div') || text.includes('span')) tags.push('html');
  if (text.includes('electron') || text.includes('ipc') || text.includes('preload')) tags.push('electron');
  if (text.includes('typescript') || text.includes('type ') || text.includes('interface ')) tags.push('typescript');
  if (text.includes('deploy') || text.includes('github') || text.includes('git ')) tags.push('deployment');
  if (text.includes('test') || text.includes('spec') || text.includes('jest') || text.includes('vitest')) tags.push('testing');
  if (text.includes('error') || text.includes('bug') || text.includes('fix')) tags.push('debugging');
  if (text.includes('design') || text.includes('ui') || text.includes('ux')) tags.push('design');
  if (text.includes('auth') || text.includes('login') || text.includes('password')) tags.push('authentication');
  if (text.includes('state') || text.includes('store') || text.includes('zustand') || text.includes('redux')) tags.push('state-management');
  if (text.includes('node') || text.includes('npm') || text.includes('package')) tags.push('nodejs');
  if (text.includes('python') || text.includes('pip') || text.includes('django') || text.includes('flask')) tags.push('python');
  if (text.includes('ai') || text.includes('machine learning') || text.includes('model')) tags.push('ai');
  if (text.includes('video') || text.includes('audio') || text.includes('media')) tags.push('media');
  if (text.includes('animation') || text.includes('motion') || text.includes('transition')) tags.push('animation');
  if (text.includes('responsive') || text.includes('mobile') || text.includes('desktop')) tags.push('responsive');
  if (text.includes('performance') || text.includes('optimize') || text.includes('speed')) tags.push('performance');
  if (text.includes('security') || text.includes('encrypt') || text.includes('hash')) tags.push('security');
  
  return tags.length > 0 ? tags : ['general'];
}

// Helper to categorize knowledge
function categorizeKnowledge(input: string, output: string): KnowledgeEntry['category'] {
  const text = `${input} ${output}`.toLowerCase();
  
  if (text.includes('function') || text.includes('const') || text.includes('import') || text.includes('class') || text.includes('component')) {
    return 'code';
  }
  if (text.includes('how to') || text.includes('what is') || text.includes('explain') || text.includes('why')) {
    return 'learning';
  }
  if (text.includes('build') || text.includes('create') || text.includes('deploy') || text.includes('fix')) {
    return 'task';
  }
  if (text.includes('pattern') || text.includes('best practice') || text.includes('convention')) {
    return 'pattern';
  }
  return 'conversation';
}

export const useBrainStore = create<BrainState>((set, get) => ({
  knowledge: [],
  isLearning: false,
  totalInteractions: 0,
  lastLearned: 0,

  learnFromInteraction: (input, output, source) => {
    const state = get();
    if (state.totalInteractions > 10000) return; // Prevent memory overflow
    
    const entry: KnowledgeEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      category: categorizeKnowledge(input, output),
      input: input.slice(0, 500), // Limit input size
      output: output.slice(0, 1000), // Limit output size
      source,
      confidence: source === 'api' ? 0.9 : source === 'user' ? 0.8 : 0.7,
      tags: extractTags(input, output),
    };

    set((s) => ({
      knowledge: [...s.knowledge, entry].slice(-5000), // Keep last 5000 entries
      totalInteractions: s.totalInteractions + 1,
      lastLearned: Date.now(),
    }));
  },

  searchKnowledge: (query) => {
    const state = get();
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
    
    return state.knowledge
      .map(entry => {
        let score = 0;
        const entryText = `${entry.input} ${entry.output} ${entry.tags.join(' ')}`.toLowerCase();
        
        // Exact match bonus
        if (entryText.includes(queryLower)) score += 10;
        
        // Word match scoring
        queryWords.forEach(word => {
          if (entryText.includes(word)) score += 2;
          entry.tags.forEach(tag => {
            if (tag.includes(word)) score += 3;
          });
        });
        
        // Recency bonus
        const age = Date.now() - entry.timestamp;
        const recencyBonus = Math.max(0, 1 - age / (30 * 24 * 60 * 60 * 1000)); // 30 day decay
        score += recencyBonus;
        
        // Confidence bonus
        score += entry.confidence;
        
        return { entry, score };
      })
      .filter(item => item.score > 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(item => item.entry);
  },

  generateOfflineResponse: (input) => {
    const state = get();
    const relevantKnowledge = state.searchKnowledge(input);
    
    if (relevantKnowledge.length === 0) {
      return `I don't have enough knowledge yet to answer this question. I'm still learning! I've learned ${state.totalInteractions} things so far. Try connecting an API in Settings to help me learn faster, or ask me something simpler.`;
    }
    
    // Build response from learned knowledge
    const responses = relevantKnowledge.map(k => {
      const inputSnippet = k.input.slice(0, 100);
      const outputSnippet = k.output.slice(0, 200);
      return `Based on my learning: ${outputSnippet}`;
    });
    
    const combinedResponse = responses.slice(0, 3).join('\n\n');
    
    return `**Infinite AI Brain (Offline Mode)**\n\nI'm answering from my accumulated knowledge (${state.totalInteractions} interactions learned).\n\n${combinedResponse}\n\n---\n*Tip: Connect an API in Settings to help me learn more and provide better answers.*`;
  },

  getKnowledgeStats: () => {
    const state = get();
    const categories: Record<string, number> = {};
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    let recentActivity = 0;
    
    state.knowledge.forEach(entry => {
      categories[entry.category] = (categories[entry.category] || 0) + 1;
      if (entry.timestamp > oneDayAgo) recentActivity++;
    });
    
    return {
      total: state.totalInteractions,
      categories,
      recentActivity,
    };
  },

  exportKnowledge: () => {
    const state = get();
    return JSON.stringify({
      knowledge: state.knowledge,
      totalInteractions: state.totalInteractions,
      exportedAt: Date.now(),
    }, null, 2);
  },

  importKnowledge: (data) => {
    try {
      const parsed = JSON.parse(data);
      if (parsed.knowledge && Array.isArray(parsed.knowledge)) {
        set((s) => ({
          knowledge: [...s.knowledge, ...parsed.knowledge].slice(-5000),
          totalInteractions: s.totalInteractions + (parsed.totalInteractions || 0),
        }));
      }
    } catch (e) {
      console.error('[brain] Failed to import knowledge:', e);
    }
  },
}));