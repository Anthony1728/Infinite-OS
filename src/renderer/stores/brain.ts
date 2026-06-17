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
    const inputLower = input.toLowerCase();
    
    // Detect code generation requests
    const isCodeRequest = /\b(code|create|build|make|write|generate|game|website|app|script|function|component|page|form|button|api|database)\b/i.test(input);
    
    if (isCodeRequest) {
      // Generate actual code templates based on the request
      const templates: Record<string, string> = {
        game: `\`\`\`html
<!DOCTYPE html>
<html>
<head>
    <title>Game</title>
    <style>
        body { margin: 0; overflow: hidden; background: #1a1a2e; }
        canvas { display: block; margin: 0 auto; background: #16213e; }
        #ui { position: absolute; top: 20px; left: 20px; color: #e94560; font-family: Arial; font-size: 24px; }
    </style>
</head>
<body>
    <div id="ui">Score: <span id="score">0</span></div>
    <canvas id="game" width="800" height="600"></canvas>
    <script>
        const canvas = document.getElementById('game');
        const ctx = canvas.getContext('2d');
        let score = 0;
        let player = { x: 375, y: 500, w: 50, h: 50, speed: 6, color: '#e94560' };
        let objects = [];
        const keys = {};
        window.addEventListener('keydown', e => keys[e.code] = true);
        window.addEventListener('keyup', e => keys[e.code] = false);
        function spawn() { objects.push({ x: Math.random() * 750, y: -50, w: 30, h: 30, speed: 3 + Math.random() * 4, color: ['#0f3460','#533483','#e94560'][Math.floor(Math.random()*3)] }); }
        function update() {
            if (keys['ArrowLeft'] && player.x > 0) player.x -= player.speed;
            if (keys['ArrowRight'] && player.x < 750) player.x += player.speed;
            if (keys['ArrowUp'] && player.y > 0) player.y -= player.speed;
            if (keys['ArrowDown'] && player.y < 550) player.y += player.speed;
            if (Math.random() < 0.03) spawn();
            for (let i = objects.length - 1; i >= 0; i--) {
                objects[i].y += objects[i].speed;
                if (player.x < objects[i].x + objects[i].w && player.x + player.w > objects[i].x && player.y < objects[i].y + objects[i].h && player.y + player.h > objects[i].y) {
                    alert('Game Over! Score: ' + score); location.reload();
                }
                if (objects[i].y > 600) { objects.splice(i, 1); score++; document.getElementById('score').textContent = score; }
            }
        }
        function draw() {
            ctx.clearRect(0, 0, 800, 600);
            ctx.fillStyle = player.color; ctx.fillRect(player.x, player.y, player.w, player.h);
            objects.forEach(o => { ctx.fillStyle = o.color; ctx.fillRect(o.x, o.y, o.w, o.h); });
            requestAnimationFrame(update); draw = requestAnimationFrame(draw);
        }
        update(); draw();
    </script>
</body>
</html>\`\`\``,
        website: `\`\`\`html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>My Website</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0f; color: #e0e0e0; }
        .hero { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 2rem; }
        h1 { font-size: 3.5rem; background: linear-gradient(135deg, #a855f7, #06b6d4, #ec4899); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 1rem; }
        p { font-size: 1.2rem; color: #888; max-width: 600px; margin-bottom: 2rem; }
        .btn { padding: 12px 32px; background: linear-gradient(135deg, #a855f7, #06b6d4); border: none; border-radius: 8px; color: white; font-size: 1rem; cursor: pointer; transition: transform 0.2s; }
        .btn:hover { transform: scale(1.05); }
        .features { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 2rem; padding: 4rem 2rem; max-width: 1200px; margin: 0 auto; }
        .feature { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 16px; padding: 2rem; }
        .feature h3 { color: #a855f7; margin-bottom: 0.5rem; }
    </style>
</head>
<body>
    <section class="hero">
        <h1>Welcome</h1>
        <p>Build something amazing today.</p>
        <button class="btn">Get Started</button>
    </section>
    <section class="features">
        <div class="feature"><h3>Fast</h3><p>Lightning-fast performance.</p></div>
        <div class="feature"><h3>Secure</h3><p>Enterprise-grade security.</p></div>
        <div class="feature"><h3>Scalable</h3><p>Grows with your needs.</p></div>
    </section>
</body>
</html>\`\`\``,
        python: `\`\`\`python
# Python script generated by Infinite AI Brain
import sys

def main():
    print("Hello from Infinite AI!")
    # Add your code here
    result = compute(10, 20)
    print(f"Result: {result}")

def compute(a, b):
    return a + b

if __name__ == "__main__":
    main()
\`\`\``,
        javascript: `\`\`\`javascript
// JavaScript generated by Infinite AI Brain
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (req, res) => {
    res.json({ message: 'Hello from Infinite AI!', status: 'running' });
});

app.listen(PORT, () => {
    console.log(\`Server running on port \${PORT}\`);
});
\`\`\``,
      };

      // Pick template based on keywords
      let template = templates.javascript; // default
      if (inputLower.match(/\b(game|car|race|avoid|dodge)\b/)) template = templates.game;
      else if (inputLower.match(/\b(website|site|landing|page|web)\b/)) template = templates.website;
      else if (inputLower.match(/\b(python|py)\b/)) template = templates.python;
      
      return `**Infinite AI Brain (Offline Mode)**\n\nI'm generating code from my accumulated knowledge (${state.totalInteractions} interactions learned). Here's a starting template you can build on:\n\n${template}\n\n---\n*Tip: Connect an API in Settings for more advanced code generation.*`;
    }
    
    if (relevantKnowledge.length === 0) {
      return `I don't have enough knowledge yet to answer this question. I've learned ${state.totalInteractions} things so far. Try connecting an API in Settings to help me learn faster, or ask me something simpler.`;
    }
    
    // Build response from learned knowledge
    const responses = relevantKnowledge.map(k => {
      const outputSnippet = k.output.slice(0, 300);
      return outputSnippet;
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