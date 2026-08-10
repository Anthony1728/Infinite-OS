import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type MemoryKind = 'fact' | 'procedure' | 'preference' | 'episode';
export type MemoryIntent = 'coding' | 'debugging' | 'research' | 'planning' | 'conversation' | 'tool-use' | 'personalization' | 'general';
export type MemorySourceType = 'api_conversation' | 'web' | 'tool' | 'action_trace' | 'teaching';

export interface MemoryProvenance {
  type: MemorySourceType;
  timestamp: number;
  provider?: string;
  model?: string;
  tool?: string;
  url?: string;
  conversationId?: string;
}

export interface MemoryRecord {
  id: string;
  fingerprint: string;
  kind: MemoryKind;
  title: string;
  content: string;
  summary: string;
  tags: string[];
  entities: string[];
  intents: MemoryIntent[];
  confidence: number;
  evidenceCount: number;
  createdAt: number;
  updatedAt: number;
  lastVerifiedAt: number;
  expiresAt: number | null;
  provenance: MemoryProvenance[];
}

interface MemoryInputBase {
  timestamp?: number;
  kind?: MemoryKind;
  title?: string;
  tags?: string[];
  confidence?: number;
}

export interface ApiConversationMemoryInput extends MemoryInputBase {
  type: 'api_conversation';
  user: string;
  assistant: string;
  provider: string;
  model: string;
  conversationId?: string;
  success?: boolean;
}

export interface WebMemoryInput extends MemoryInputBase {
  type: 'web';
  query: string;
  result: string;
  url: string;
  sourceTitle?: string;
}

export interface ToolMemoryInput extends MemoryInputBase {
  type: 'tool';
  toolName: string;
  input?: string;
  result: string;
  success: boolean;
  url?: string;
}

export interface ActionTraceMemoryInput extends MemoryInputBase {
  type: 'action_trace';
  goal: string;
  steps: string[];
  outcome: string;
  success: boolean;
  tools?: string[];
}

export interface TeachingMemoryInput extends MemoryInputBase {
  type: 'teaching';
  question: string;
  answer: string;
  provider?: string;
  model?: string;
}

export type MemoryInput =
  | ApiConversationMemoryInput
  | WebMemoryInput
  | ToolMemoryInput
  | ActionTraceMemoryInput
  | TeachingMemoryInput;

export interface MemorySearchOptions {
  intent?: MemoryIntent;
  kinds?: MemoryKind[];
  limit?: number;
  includeStale?: boolean;
  minConfidence?: number;
}

export interface MemorySearchResult {
  record: MemoryRecord;
  score: number;
  freshness: number;
  stale: boolean;
}

export interface LearningMemoryConfig {
  dataDir?: string;
  maxRecords?: number;
  now?: () => number;
}

interface PersistedStore {
  version: 1;
  records: MemoryRecord[];
}

const DAY = 24 * 60 * 60_000;
const SOURCE_CONFIDENCE: Record<MemorySourceType, number> = {
  web: 0.82,
  tool: 0.86,
  action_trace: 0.9,
  api_conversation: 0.72,
  teaching: 0.78,
};
const TTL_BY_KIND: Record<MemoryKind, number | null> = {
  fact: 45 * DAY,
  procedure: 180 * DAY,
  preference: null,
  episode: 90 * DAY,
};
const STOP_WORDS = new Set(['the', 'and', 'for', 'that', 'with', 'this', 'from', 'into', 'your', 'you', 'are', 'was', 'were', 'have', 'has', 'how', 'what', 'when', 'then', 'than']);

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function text(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? redactSecrets(value.trim()).slice(0, maxLength) : '';
}

function redactSecrets(value: string): string {
  return value
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
    .replace(/\b(?:sk|rk|pk|api)[-_][A-Za-z0-9_-]{16,}\b/g, '[REDACTED TOKEN]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]{16,}\b/gi, '$1[REDACTED TOKEN]')
    .replace(/\b(api[_ -]?key|token|secret|password)\s*[:=]\s*[^\s,;]{8,}/gi, '$1=[REDACTED]');
}

function terms(value: string): string[] {
  return value.toLowerCase().replace(/[^a-z0-9+#.-]+/g, ' ').split(/\s+/)
    .filter((term) => term.length > 1 && !STOP_WORDS.has(term));
}

function unique(values: string[], limit: number): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))].slice(0, limit);
}

function inferIntent(value: string): MemoryIntent[] {
  const intents = new Set<MemoryIntent>();
  if (/\b(code|function|class|typescript|javascript|python|api|database|frontend|backend)\b/i.test(value)) intents.add('coding');
  if (/\b(debug|bug|error|fail|stack trace|regression|fix)\b/i.test(value)) intents.add('debugging');
  if (/\b(search|source|research|web|current|latest|verify|citation)\b/i.test(value)) intents.add('research');
  if (/\b(plan|steps|design|architecture|strategy|workflow)\b/i.test(value)) intents.add('planning');
  if (/\b(tool|terminal|browser|filesystem|command|fetch)\b/i.test(value)) intents.add('tool-use');
  if (/\b(prefer|preference|always|never|my |i like|i want)\b/i.test(value)) intents.add('personalization');
  if (/\b(hello|thanks|explain|conversation|respond|tone)\b/i.test(value)) intents.add('conversation');
  if (!intents.size) intents.add('general');
  return [...intents];
}

function inferKind(input: MemoryInput, combined: string): MemoryKind {
  if (input.kind) return input.kind;
  if (input.type === 'action_trace') return 'episode';
  if (input.type === 'web') return 'fact';
  if (input.type === 'tool') return /\b(list|version|status|result|found|current)\b/i.test(combined) ? 'fact' : 'procedure';
  if (input.type === 'api_conversation' && /\b(i prefer|i like|always use|never use|my preference|i want you to)\b/i.test(input.user)) return 'preference';
  if (/\b(steps?|procedure|workflow|first|then|finally|how to|run |use )\b/i.test(combined)) return 'procedure';
  return 'fact';
}

function inferEntities(value: string): string[] {
  const matches = value.match(/\b(?:[A-Z][A-Za-z0-9.+#-]{2,}|[a-z]+(?:\.[a-z0-9]+){1,}|[A-Z]{2,})\b/g) ?? [];
  return unique(matches, 20);
}

function fingerprint(kind: MemoryKind, content: string): string {
  const signature = unique(terms(content), 80).sort().join(' ');
  return createHash('sha256').update(`${kind}\n${signature}`).digest('hex').slice(0, 24);
}

export class LearningMemoryStore {
  private readonly dataDir: string;
  private readonly storePath: string;
  private readonly maxRecords: number;
  private readonly now: () => number;
  private records: MemoryRecord[];

  constructor(config: LearningMemoryConfig = {}) {
    this.dataDir = config.dataDir ?? join(homedir(), '.infinite-ai', 'brain');
    this.storePath = join(this.dataDir, 'learning-memory.json');
    this.maxRecords = Math.max(100, config.maxRecords ?? 2_000);
    this.now = config.now ?? Date.now;
    this.records = this.load();
  }

  ingest(input: MemoryInput): MemoryRecord | null {
    const normalized = this.normalizeInput(input);
    if (!normalized) return null;
    const existing = this.records.find((record) => record.fingerprint === normalized.fingerprint);
    if (existing) {
      existing.updatedAt = this.now();
      existing.lastVerifiedAt = Math.max(existing.lastVerifiedAt, normalized.lastVerifiedAt);
      existing.evidenceCount++;
      existing.confidence = clamp(Math.max(existing.confidence, normalized.confidence) + Math.min(0.12, existing.evidenceCount * 0.01));
      existing.tags = unique([...existing.tags, ...normalized.tags], 20);
      existing.entities = unique([...existing.entities, ...normalized.entities], 24);
      existing.intents = unique([...existing.intents, ...normalized.intents], 8) as MemoryIntent[];
      existing.provenance = [...existing.provenance, ...normalized.provenance].slice(-12);
      if (existing.expiresAt !== null && normalized.expiresAt !== null) existing.expiresAt = Math.max(existing.expiresAt, normalized.expiresAt);
      this.save();
      return structuredClone(existing);
    }
    this.records.push(normalized);
    if (this.records.length > this.maxRecords) {
      this.records = this.records
        .sort((a, b) => this.retentionScore(b) - this.retentionScore(a))
        .slice(0, this.maxRecords);
    }
    this.save();
    return structuredClone(normalized);
  }

  ingestMany(inputs: MemoryInput[]): MemoryRecord[] {
    const learned: MemoryRecord[] = [];
    for (const input of inputs.slice(0, 100)) {
      const record = this.ingest(input);
      if (record) learned.push(record);
    }
    return learned;
  }

  search(query: string, options: MemorySearchOptions = {}): MemorySearchResult[] {
    const queryTerms = new Set(terms(query));
    const inferredIntent = options.intent ?? inferIntent(query)[0];
    const now = this.now();
    return this.records.map((record) => {
      const stale = record.expiresAt !== null && record.expiresAt <= now;
      const freshness = this.freshness(record, now);
      const titleTerms = terms(`${record.title} ${record.summary} ${record.tags.join(' ')} ${record.entities.join(' ')}`);
      const contentTerms = terms(record.content);
      const titleMatches = titleTerms.reduce((sum, term) => sum + (queryTerms.has(term) ? 1 : 0), 0);
      const contentMatches = contentTerms.reduce((sum, term) => sum + (queryTerms.has(term) ? 1 : 0), 0);
      const lexical = queryTerms.size ? (titleMatches * 4 + contentMatches) / Math.max(4, queryTerms.size * 4) : 0;
      const intent = record.intents.includes(inferredIntent) ? 0.22 : 0;
      const evidence = Math.min(0.08, (record.evidenceCount - 1) * 0.02);
      return { record, freshness, stale, score: lexical * 0.52 + record.confidence * 0.23 + freshness * 0.17 + intent + evidence };
    }).filter((result) => {
      if (!options.includeStale && result.stale) return false;
      if (options.kinds?.length && !options.kinds.includes(result.record.kind)) return false;
      if (result.record.confidence < (options.minConfidence ?? 0.35)) return false;
      return queryTerms.size === 0 || result.score >= 0.3;
    }).sort((a, b) => b.score - a.score || b.record.updatedAt - a.record.updatedAt)
      .slice(0, Math.max(0, Math.min(options.limit ?? 8, 30)))
      .map((result) => ({ ...result, record: structuredClone(result.record) }));
  }

  getById(id: string): MemoryRecord | null {
    const record = this.records.find((item) => item.id === id);
    return record ? structuredClone(record) : null;
  }

  getStats(): { total: number; byKind: Record<MemoryKind, number>; stale: number } {
    const byKind: Record<MemoryKind, number> = { fact: 0, procedure: 0, preference: 0, episode: 0 };
    let stale = 0;
    for (const record of this.records) {
      byKind[record.kind]++;
      if (record.expiresAt !== null && record.expiresAt <= this.now()) stale++;
    }
    return { total: this.records.length, byKind, stale };
  }

  formatForContext(query: string, options: MemorySearchOptions = {}): string {
    const results = this.search(query, { ...options, limit: options.limit ?? 5 });
    if (!results.length) return '';
    return results.map(({ record }) => {
      const provenance = record.provenance.at(-1);
      const source = provenance?.url || [provenance?.provider, provenance?.model].filter(Boolean).join('/') || provenance?.tool || provenance?.type;
      return `[${record.kind}; confidence ${record.confidence.toFixed(2)}; verified ${new Date(record.lastVerifiedAt).toISOString()}${source ? `; source ${source}` : ''}]\n${record.title}: ${record.content.slice(0, 1_200)}`;
    }).join('\n\n').slice(0, 5_000);
  }

  private normalizeInput(input: MemoryInput): MemoryRecord | null {
    const timestamp = Number.isFinite(input.timestamp) ? Math.min(input.timestamp!, this.now()) : this.now();
    let source: MemoryProvenance;
    let title = text(input.title, 160);
    let content = '';
    let summary = '';

    if (input.type === 'api_conversation') {
      if (input.success === false) return null;
      const user = text(input.user, 2_000);
      const assistant = text(input.assistant, 8_000);
      if (user.length < 3 || assistant.length < 20 || !input.provider || !input.model) return null;
      content = assistant;
      summary = user;
      title ||= user.slice(0, 120);
      source = { type: input.type, timestamp, provider: text(input.provider, 80), model: text(input.model, 160), conversationId: text(input.conversationId, 160) || undefined };
    } else if (input.type === 'web') {
      const query = text(input.query, 1_000);
      content = text(input.result, 8_000);
      if (query.length < 3 || content.length < 20 || !/^https?:\/\//i.test(input.url)) return null;
      summary = query;
      title ||= text(input.sourceTitle, 160) || query.slice(0, 120);
      source = { type: input.type, timestamp, url: input.url.slice(0, 2_000) };
    } else if (input.type === 'tool') {
      if (!input.success) return null;
      content = text(input.result, 8_000);
      const toolInput = text(input.input, 1_000);
      if (!input.toolName || content.length < 10) return null;
      summary = toolInput || `Result from ${input.toolName}`;
      title ||= `${input.toolName}: ${summary}`.slice(0, 120);
      source = { type: input.type, timestamp, tool: text(input.toolName, 100), url: input.url && /^https?:\/\//i.test(input.url) ? input.url.slice(0, 2_000) : undefined };
    } else if (input.type === 'action_trace') {
      if (!input.success || input.steps.length === 0) return null;
      const goal = text(input.goal, 1_000);
      const outcome = text(input.outcome, 3_000);
      const steps = input.steps.map((step) => text(step, 700)).filter(Boolean).slice(0, 30);
      if (goal.length < 3 || outcome.length < 8 || !steps.length) return null;
      content = `${steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}\nOutcome: ${outcome}`;
      summary = goal;
      title ||= goal.slice(0, 120);
      source = { type: input.type, timestamp, tool: unique(input.tools ?? [], 12).join(', ') || undefined };
    } else {
      const question = text(input.question, 1_000);
      content = text(input.answer, 8_000);
      if (question.length < 3 || content.length < 20) return null;
      summary = question;
      title ||= question.slice(0, 120);
      source = { type: input.type, timestamp, provider: text(input.provider, 80) || undefined, model: text(input.model, 160) || undefined };
    }

    const combined = `${title} ${summary} ${content}`;
    const kind = inferKind(input, combined);
    const baseConfidence = SOURCE_CONFIDENCE[input.type];
    const requestedConfidence = input.confidence === undefined ? baseConfidence : clamp(input.confidence);
    // A caller may lower confidence, but cannot inflate it far beyond the source prior.
    const confidence = clamp(Math.min(requestedConfidence, baseConfidence + 0.08));
    const ttl = TTL_BY_KIND[kind];
    return {
      id: randomUUID(),
      fingerprint: fingerprint(kind, content),
      kind,
      title,
      content,
      summary: summary.slice(0, 1_000),
      tags: unique([...(input.tags ?? []), ...terms(`${title} ${summary}`).slice(0, 12)], 20),
      entities: inferEntities(combined),
      intents: inferIntent(combined),
      confidence,
      evidenceCount: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastVerifiedAt: timestamp,
      expiresAt: ttl === null ? null : timestamp + ttl,
      provenance: [source],
    };
  }

  private freshness(record: MemoryRecord, now: number): number {
    if (record.expiresAt === null) return 1;
    const lifetime = Math.max(1, record.expiresAt - record.createdAt);
    return clamp((record.expiresAt - now) / lifetime);
  }

  private retentionScore(record: MemoryRecord): number {
    return record.confidence * 0.5 + this.freshness(record, this.now()) * 0.3 + Math.min(0.2, record.evidenceCount * 0.02);
  }

  private load(): MemoryRecord[] {
    try {
      if (!existsSync(this.storePath)) return [];
      const data = JSON.parse(readFileSync(this.storePath, 'utf8')) as PersistedStore;
      if (data.version !== 1 || !Array.isArray(data.records)) return [];
      return data.records.filter((record) => record?.id && record?.fingerprint && record?.provenance?.length).slice(-this.maxRecords);
    } catch {
      return [];
    }
  }

  private save(): void {
    try {
      mkdirSync(this.dataDir, { recursive: true });
      const temporaryPath = `${this.storePath}.tmp`;
      writeFileSync(temporaryPath, JSON.stringify({ version: 1, records: this.records } satisfies PersistedStore));
      renameSync(temporaryPath, this.storePath);
    } catch {
      // Memory remains available for the current process if disk persistence fails.
    }
  }
}

let instance: LearningMemoryStore | null = null;

export function getLearningMemoryStore(config?: LearningMemoryConfig): LearningMemoryStore {
  if (!instance) instance = new LearningMemoryStore(config);
  return instance;
}

export function createLearningMemoryStore(config?: LearningMemoryConfig): LearningMemoryStore {
  instance = new LearningMemoryStore(config);
  return instance;
}

export { redactSecrets as redactMemorySecrets };
