// Shared types between main, preload, and renderer.
// Mirrors the shapes Claude Code uses internally (Message, ToolUse, ToolResult, etc.)

export type Role = 'user' | 'assistant' | 'system' | 'tool';

export type ContentBlock =
  | { type: 'text'; text: string }
  /**
   * The model's reasoning, kept separate from the answer.
   *
   * This is a distinct block rather than text inside the answer because the two
   * are different things: reasoning is shown to the user as "what I was
   * thinking", collapsible and dismissible, and it is NOT sent back to the model
   * on the next turn (its own transcript already carries it). Inlining it as
   * text meant providers that emit a reasoning channel had it silently deleted
   * by a stripper, so the user saw a long pause and then an answer with no
   * explanation of where the time went.
   */
  | { type: 'thinking'; text: string; signature?: string }
  | { type: 'image'; source: { type: 'base64'; mediaType: string; data: string } }
  | { type: 'file'; name: string; mimeType: string; data: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | {
      type: 'tool_result';
      tool_use_id: string;
      content: string | ContentBlock[];
      is_error?: boolean;
    }
  | {
      type: 'question';
      question: string;
      header?: string;
      multiple?: boolean;
      options: Array<{ label: string; description?: string }>;
      allowCustom?: boolean;
      questionId: string;
    }
  | {
      type: 'pair';
      memberId: string;
      role: string;
      provider: string;
      model: string;
      text: string;
      status: 'running' | 'done' | 'error';
    }
  | {
      type: 'quiz';
      quizId: string;
      title: string;
      description?: string;
      questions: Array<{
        id: string;
        question: string;
        options: Array<{ label: string; text: string; isCorrect: boolean }>;
        explanation?: string;
      }>;
    };

export interface Message {
  id: string;
  role: Role;
  content: ContentBlock[];
  timestamp: number;
  model?: string;
  provider?: string;
  requested_model?: string;
  requested_provider?: string;
  usage?: TokenUsage;
  stop_reason?: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
}

export interface TokenUsage {
  input: number;
  output: number;
  cache_read?: number;
  cache_write?: number;
}

export interface Session {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  cwd: string;
  model: string;
  provider: string;
  message_count: number;
  preview?: string;
  pinned?: boolean;
  folder?: string;
  /** Filed in the archive. The transcript is untouched; only this flag changes. */
  archived?: boolean;
  /** When it was filed, so the archive can be ordered by that rather than by last edit. */
  archived_at?: number;
  parent_session_id?: string;
  branch_message_id?: string;
  // OpenClaw session enhancements
  dmScope?: 'main' | 'per-peer' | 'per-channel-peer' | 'per-account-channel-peer';
  groupScope?: 'per-group' | 'main';
  resetMode?: 'none' | 'daily' | 'idle';
  resetAtHour?: number;
  resetIdleMinutes?: number;
  incognito?: boolean;
}

export interface ModelInfo {
  id: string;
  label: string;
  provider: string;
  free: boolean;
  context_window?: number;
  supports_tools?: boolean;
  supports_vision?: boolean;
}

export interface ProviderInfo {
  id: string;
  label: string;
  requiresApiKey: boolean;
  acceptsApiKey?: boolean;
  baseUrl?: string;
  freeModels: ModelInfo[];
  homepage?: string;
}

export type EnginePhase = 'dormant' | 'bootstrapping' | 'active';

export interface EngineStatus {
  phase: EnginePhase;
  totalInteractions: number;
  successfulInteractions: number;
  categoriesCovered: string[];
  modelsUsed: string[];
  bestModel: string | null;
  bestModelSuccessRate: number;
  progressPercent: number;
  thresholdMet: boolean;
  startedAt: number;
  lastInteractionAt: number;
}

// ============ OpenClaw Gateway/Node Types ============

export type NodePlatform = 'ios' | 'watchos' | 'android' | 'macos' | 'windows' | 'linux' | 'unknown';

export type NodeRole = 'node' | 'operator' | 'mixed';

export interface NodeCommand {
  name: string;
  description?: string;
  platform?: NodePlatform;
  dangerous?: boolean;
  privacyHeavy?: boolean;
}

export interface NodeInfo {
  id: string;
  name: string;
  platform: NodePlatform;
  role: NodeRole;
  displayName?: string;
  connected: boolean;
  lastSeen: number;
  commands: string[];
  capabilities: string[];
  clientInstanceId?: string;
  deviceId?: string;
  version?: string;
}

export interface DevicePairingRequest {
  requestId: string;
  deviceId: string;
  deviceName: string;
  role: NodeRole;
  requestedCommands: string[];
  requestedScopes: string[];
  createdAt: number;
  expiresAt: number;
  publicKey: string;
  platform: NodePlatform;
}

export interface DeviceIdentity {
  deviceId: string;
  publicKey: string;
  privateKey: string;
  createdAt: number;
  roles: NodeRole[];
  approvedCommands: string[];
}

// Media types
export type MediaKind = 'image' | 'audio' | 'video' | 'document';

export interface MediaAttachment {
  kind: MediaKind;
  path?: string;
  url?: string;
  contentType?: string;
  filename?: string;
  size?: number;
  caption?: string;
  // WhatsApp specific
  gifPlayback?: boolean;
  forceDocument?: boolean;
  // Voice note
  ptt?: boolean;
}

export interface MediaLimits {
  imageMaxMb: number;
  audioVideoMaxMb: number;
  documentMaxMb: number;
  // Understanding caps
  imageUnderstandingMaxMb: number;
  audioUnderstandingMaxMb: number;
  videoUnderstandingMaxMb: number;
}

export interface MediaUnderstandingResult {
  kind: MediaKind;
  description?: string;
  transcript?: string;
  ipaTags?: string[];
  error?: string;
}

// Session routing
export type DmScope = 'main' | 'per-peer' | 'per-channel-peer' | 'per-account-channel-peer';
export type GroupScope = 'per-group' | 'main';
export type ResetMode = 'none' | 'daily' | 'idle';

export interface SessionRoutingConfig {
  dmScope: DmScope;
  groupScope: GroupScope;
  identityLinks?: Record<string, string>;
  reset: {
    mode: ResetMode;
    atHour?: number;
    idleMinutes?: number;
    resetByType?: Record<string, { mode: ResetMode; atHour?: number; idleMinutes?: number }>;
    resetByChannel?: Record<string, { mode: ResetMode; atHour?: number; idleMinutes?: number }>;
  };
  maintenance: {
    mode: 'enforce' | 'warn';
    pruneAfter: string;
    archiveDashboardAfter: string;
    maxEntries: number;
    preserveRecent?: string;
  };
}

// Streaming
export type BlockStreamingBreak = 'text_end' | 'message_end';
export type BlockStreamingDefault = 'on' | 'off';
export type ChunkMode = 'length' | 'newline';
export type StreamingMode = 'off' | 'partial' | 'block' | 'progress';
export type HumanDelayMode = 'off' | 'natural' | 'custom';

export interface BlockStreamingConfig {
  default: BlockStreamingDefault;
  break: BlockStreamingBreak;
  chunk: { minChars: number; maxChars: number; breakPreference?: 'paragraph' | 'newline' | 'sentence' | 'whitespace' };
  coalesce?: { minChars?: number; maxChars?: number; idleMs?: number };
  humanDelay?: { mode: HumanDelayMode; minMs?: number; maxMs?: number };
}

export interface PreviewStreamingConfig {
  mode: StreamingMode;
  preview?: { chunk: { minChars: number; maxChars: number; breakPreference?: 'paragraph' | 'newline' | 'sentence' | 'whitespace' }; toolProgress?: boolean; commandText?: 'status' | 'raw' };
  progress?: { maxLines: number; maxLineChars: number; label: string | false; labels: string[]; commentary?: boolean; toolProgress?: boolean; commandText?: 'status' | 'raw' };
  block?: { enabled: boolean; coalesce?: { minChars?: number; maxChars?: number; idleMs?: number } };
  nativeTransport?: boolean;
}

export interface StreamingConfig {
  block: BlockStreamingConfig;
  preview: Record<string, PreviewStreamingConfig>;
}

// Queue
export type QueueMode = 'steer' | 'followup' | 'collect' | 'interrupt';
export type QueueDrop = 'summarize' | 'old' | 'new';

export interface QueueConfig {
  mode: QueueMode;
  cap: number;
  drop: QueueDrop;
  debounceMs: number;
  debounceMsByChannel?: Record<string, number>;
  byChannel?: Record<string, QueueMode>;
}

export interface QueueOptions {
  debounce?: string | number;
  cap?: number;
  drop?: QueueDrop;
}

export interface QueuedMessage {
  id: string;
  sessionId: string;
  content: string;
  timestamp: number;
  channel?: string;
  threadId?: string;
  runId?: string;
  steerable: boolean;
}

// Steering
export interface SteerConfig {
  drainMode: 'one-at-a-time' | 'all';
  quietWindowMs: number;
}

export interface SteerPayload {
  message: string;
  sessionId: string;
  timestamp: number;
}

// Node commands
export interface NodeInvokeRequest {
  nodeId: string;
  command: string;
  params: Record<string, unknown>;
  stream?: boolean;
}

export interface NodeInvokeProgress {
  invokeId: string;
  sequence: number;
  chunk: string;
}

export interface NodeInvokeResult {
  invokeId: string;
  success: boolean;
  result?: unknown;
  error?: string;
  progress?: NodeInvokeProgress[];
}

// Approvals
export interface ExecApproval {
  id: string;
  nodeId: string;
  command: string;
  args: string[];
  cwd: string;
  createdAt: number;
  approved?: boolean;
  approvedAt?: number;
  approvedBy?: string;
  expiresAt?: number;
}

export interface ExecAllowlistEntry {
  id: string;
  nodeId: string;
  command: string;
  args?: string[];
  createdAt: number;
}

// MCP on nodes
export interface NodeMcpServer {
  name: string;
  command?: string;
  args?: string[];
  url?: string;
  transport?: 'stdio' | 'streamable-http' | 'sse';
  headers?: Record<string, string>;
  toolFilter?: { include?: string[]; exclude?: string[] };
}

// Skills on nodes
export interface NodeSkill {
  name: string;
  description: string;
  category: string;
  instructions: string;
  triggers: string[];
  nodeId: string;
  nodePath: string;
}

// Codex/Claude sessions
export interface CodexSession {
  id: string;
  projectPath: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  nodeId?: string;
  turns: number;
}

export interface ClaudeSession {
  id: string;
  projectPath: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  source: 'cli' | 'desktop' | 'sdk-cli';
  nodeId?: string;
  turns: number;
}

// Terminal uploads
export interface TerminalUpload {
  id: string;
  nodeId: string;
  filename: string;
  size: number;
  path: string;
  uploadedAt: number;
}

// Experimental features
export interface ExperimentalFeatures {
  localModelLean?: boolean;
  codexSandboxExecServer?: boolean;
  codeMode?: boolean | 'auto';
  cloudWorkersDesktop?: boolean;
  swarm?: boolean;
}