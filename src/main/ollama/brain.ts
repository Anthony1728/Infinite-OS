// Ollama integration — local AI brain powered by rafw007/gemma4-e4b-claude-coder
// Handles: chat completions, knowledge distillation, image analysis, teaching

import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

const OLLAMA_BASE = 'http://localhost:11434';
const MODEL = 'rafw007/gemma4-e4b-claude-coder:latest';

interface ConversationEntry {
  id: string;
  timestamp: number;
  role: 'user' | 'assistant';
  input: string;
  output: string;
  source: 'brain' | 'api' | 'ollama';
  model?: string;
  provider?: string;
  success: boolean;
  tags: string[];
}

interface TeachingEntry {
  id: string;
  timestamp: number;
  category: string;
  question: string;
  answer: string;
  source: 'api-learning' | 'brain-learning' | 'user-correction';
  taught: boolean;
}

export class OllamaBrain {
  private dataDir: string;
  private conversations: ConversationEntry[] = [];
  private teachingData: TeachingEntry[] = [];
  private teachInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.dataDir = join(homedir(), '.infinite-ai', 'ollama-brain');
    this.ensureDir();
    this.loadData();
    // Auto-teach every 5 minutes when there's new knowledge
    this.teachInterval = setInterval(() => this.autoTeach(), 5 * 60 * 1000);
  }

  private ensureDir(): void {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
  }

  private loadData(): void {
    try {
      const convPath = join(this.dataDir, 'conversations.json');
      if (existsSync(convPath)) {
        this.conversations = JSON.parse(readFileSync(convPath, 'utf-8'));
      }
      const teachPath = join(this.dataDir, 'teaching.json');
      if (existsSync(teachPath)) {
        this.teachingData = JSON.parse(readFileSync(teachPath, 'utf-8'));
      }
    } catch { /* silent */ }
  }

  private saveData(): void {
    try {
      writeFileSync(join(this.dataDir, 'conversations.json'), JSON.stringify(this.conversations, null, 2));
      writeFileSync(join(this.dataDir, 'teaching.json'), JSON.stringify(this.teachingData, null, 2));
    } catch { /* silent */ }
  }

  // ── Chat with Ollama ──
  async chat(messages: Array<{ role: string; content: string; images?: string[] }>, options?: {
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
  }, model?: string): Promise<string> {
    // Check if Ollama is reachable first
    const reachable = await this.isAvailable();
    if (!reachable) return '';

    try {
      const response = await fetch(`${OLLAMA_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model || MODEL,
          messages,
          stream: false,
          options: {
            temperature: options?.temperature ?? 0.7,
            num_predict: options?.maxTokens ?? 2048,
          },
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) throw new Error(`Ollama API error: ${response.status}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (await response.json()) as any;
      return data.message?.content || '';
    } catch (e) {
      console.error('[ollama] chat error:', (e as Error).message);
      return '';
    }
  }

  // ── Single prompt ──
  async ask(prompt: string, systemPrompt?: string, model?: string): Promise<string> {
    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    // Add recent conversation context
    const recent = this.conversations.slice(-10);
    for (const entry of recent) {
      messages.push({ role: entry.role, content: entry.input || entry.output });
    }
    messages.push({ role: 'user', content: prompt });

    const result = await this.chat(messages, undefined, model);
    if (result) {
      this.recordConversation(prompt, result, 'ollama');
    }
    return result;
  }

  // ── Analyze image ──
  async analyzeImage(imageBase64: string, question: string): Promise<string> {
    const messages = [
      { role: 'user', content: question, images: [imageBase64] },
    ];
    return this.chat(messages);
  }

  // ── Record conversation for learning ──
  recordConversation(input: string, output: string, source: 'brain' | 'api' | 'ollama', model?: string, provider?: string): void {
    const entry: ConversationEntry = {
      id: `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      role: 'user',
      input,
      output,
      source,
      model,
      provider,
      success: output.length > 10,
      tags: this.extractTags(input),
    };
    this.conversations.push(entry);
    if (this.conversations.length > 5000) this.conversations = this.conversations.slice(-5000);
    this.saveData();
  }

  // ── Record API learning (teach Ollama from API responses) ──
  recordApiLearning(input: string, apiResponse: string, _model: string, _provider: string): void {
    // Extract knowledge from the API response
    const teaching: TeachingEntry = {
      id: `teach_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      category: this.categorizeContent(input),
      question: input,
      answer: apiResponse,
      source: 'api-learning',
      taught: false,
    };
    this.teachingData.push(teaching);
    if (this.teachingData.length > 2000) this.teachingData = this.teachingData.slice(-2000);
    this.saveData();
  }

  // ── Teach Ollama from collected knowledge ──
  async teachOllama(): Promise<{ taught: number; errors: number }> {
    let taught = 0;
    let errors = 0;
    const untaught = this.teachingData.filter(t => !t.taught).slice(0, 20);

    for (const entry of untaught) {
      try {
        // Create a teaching prompt
        const teachPrompt = `Learn this knowledge and confirm you understand. Respond with "UNDERSTOOD" if you can use this information.\n\nTopic: ${entry.category}\nQuestion: ${entry.question}\nAnswer: ${entry.answer}`;
        const result = await this.ask(teachPrompt, 'You are a learning AI. Absorb the provided knowledge and confirm understanding concisely.');
        if (result.includes('UNDERSTOOD') || result.length > 5) {
          entry.taught = true;
          taught++;
        }
      } catch {
        errors++;
      }
      // Small delay between teaches
      await new Promise(r => setTimeout(r, 200));
    }

    this.saveData();
    return { taught, errors };
  }

  // ── Auto-teach on interval ──
  private async autoTeach(): Promise<void> {
    const untaught = this.teachingData.filter(t => !t.taught);
    if (untaught.length > 5) {
      console.log(`[ollama-brain] Auto-teaching ${untaught.length} entries...`);
      await this.teachOllama();
    }
  }

  // ── Get system prompt with learned knowledge ──
  getSystemPrompt(): string {
    const recentKnowledge = this.teachingData
      .filter(t => t.taught)
      .slice(-50)
      .map(t => `${t.question}: ${t.answer}`)
      .join('\n');

    return [
      'You are the Infinite AI Brain — a local AI assistant running on Ollama.',
      'You can control the computer (mouse, keyboard, open apps), browse the web, manage files, and send emails.',
      'You have been taught knowledge from the user\'s API conversations and previous interactions.',
      'Be direct, concise, and actionable. Give specific steps, not general advice.',
      'If you can do something with computer control, do it — don\'t just describe how.',
      '',
      'Learned knowledge:',
      recentKnowledge || '(No additional knowledge learned yet)',
    ].join('\n');
  }

  // ── Helpers ──
  private extractTags(input: string): string[] {
    const tags: string[] = [];
    const lower = input.toLowerCase();
    if (/\b(code|program|function|class|api|debug|error)\b/.test(lower)) tags.push('coding');
    if (/\b(file|folder|create|delete|move|rename|read|write)\b/.test(lower)) tags.push('files');
    if (/\b(email|send|inbox|mail|message)\b/.test(lower)) tags.push('email');
    if (/\b(search|browse|web|google|youtube|amazon)\b/.test(lower)) tags.push('web');
    if (/\b(mouse|click|keyboard|type|scroll|open|app)\b/.test(lower)) tags.push('computer');
    if (/\b(build|deploy|project|app|website)\b/.test(lower)) tags.push('building');
    if (/\b(download|install|update|setup)\b/.test(lower)) tags.push('system');
    return tags;
  }

  private categorizeContent(input: string): string {
    const lower = input.toLowerCase();
    if (/\b(code|program|function|class|api|debug|error)\b/.test(lower)) return 'coding';
    if (/\b(file|folder|create|delete|move|rename)\b/.test(lower)) return 'files';
    if (/\b(email|send|inbox|mail)\b/.test(lower)) return 'email';
    if (/\b(search|browse|web|google|youtube)\b/.test(lower)) return 'web';
    if (/\b(mouse|click|keyboard|type|scroll)\b/.test(lower)) return 'computer-control';
    if (/\b(build|deploy|project|app|website)\b/.test(lower)) return 'building';
    return 'general';
  }

  // ── Status ──
  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  getStats() {
    return {
      totalConversations: this.conversations.length,
      totalTeachingEntries: this.teachingData.length,
      untaughtEntries: this.teachingData.filter(t => !t.taught).length,
      taughtEntries: this.teachingData.filter(t => t.taught).length,
      model: MODEL,
    };
  }

  destroy(): void {
    if (this.teachInterval) clearInterval(this.teachInterval);
  }
}

// Singleton
let instance: OllamaBrain | null = null;
export function getOllamaBrain(): OllamaBrain {
  if (!instance) instance = new OllamaBrain();
  return instance;
}
