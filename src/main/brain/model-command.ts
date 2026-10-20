// Model-command parser — lets the user steer the Brain's model choice in plain
// language, from WhatsApp/Telegram/desktop, WITHOUT needing a working model to
// understand the request. That is the whole point: when the active model is
// dead, the agent can't answer "switch models", so the command is intercepted
// before any model is invoked.
//
// Parsing is deliberately conservative — short, model-focused messages only —
// so a normal coding request that merely mentions the word "model" still goes
// to the agent.

export type ModelCommand =
  /** "model status", "which model are you on" — report active model + health. */
  | { kind: 'status' }
  /** "switch to a working model", "model is broken, fix it" — auto-pick a healthy one. */
  | { kind: 'switch_working' }
  /** "switch to groq", "use llama 3.3", "change model to gpt-4o" — target given. */
  | { kind: 'switch_target'; target: string };

/** Longest message still considered a model command (real tasks are longer). */
const MAX_COMMAND_LENGTH = 140;

const STATUS_PATTERNS: RegExp[] = [
  /^(?:what|which)\s+(?:model|provider)(?:\s+are\s+you\s+(?:on|using))?\s*\??$/,
  /^(?:model|provider)\s+(?:status|health|info)\s*\??$/,
  /^(?:status|health)\s*\??$/,
  /^(?:what|which)\s+(?:model|provider)\s+(?:are\s+you\s+using|is\s+(?:active|in\s+use))\s*\??$/,
  /^(?:show|check)\s+(?:the\s+)?(?:current\s+)?(?:model|provider)\s*\??$/,
];

/** Explicit "leave this model" intents with no target — pick a healthy one. */
const SWITCH_WORKING_PATTERNS: RegExp[] = [
  /^(?:please\s+)?(?:switch|change|move|fallback|fall\s+back|swap)\s+(?:me\s+)?(?:back\s+)?(?:to\s+)?(?:a\s+)?(?:working|healthy|another|different|other|backup|fallback|better)\s*(?:model|provider)?(?:\s+(?:model|provider))?\s*\??$/i,
  /^(?:please\s+)?(?:switch|change|swap)\s+(?:the\s+)?(?:model|provider)\s*\??$/i,
  /^(?:(?:my|the|this)\s+)?(?:model|provider)\s+(?:is\s+)?(?:broken|dead|down|failing|failed|not\s+working|unavailable|stuck|erroring|out)\s*\??$/i,
  /^(?:my\s+)?(?:model|provider)\s+(?:keeps\s+)?(?:failing|crashing|timing\s+out)\s*\??$/i,
  /^(?:fix|repair|reset|recover)\s+(?:the\s+)?(?:model|provider|connection)\s*\??$/i,
  /^(?:use|try|find)\s+(?:a\s+)?(?:working|healthy|free)\s+(?:model|provider)\s*\??$/i,
  /^(?:switch|change)\s+(?:me\s+)?(?:to\s+)?(?:something\s+)?(?:that\s+)?works\s*\??$/i,
  /^(?:switch|change)\s+to\s+(?:infinite\s+(?:ai\s+)?brain|the\s+brain|brain|local)\s*(?:model|provider)?\s*\??$/i,
];

/** "switch/use/change/set to X" — X is resolved against the provider registry. */
const SWITCH_TARGET_PATTERNS: RegExp[] = [
  /^(?:please\s+)?(?:switch|change|move|swap|set)\s+(?:me\s+)?(?:back\s+)?to\s+(.+)$/i,
  /^(?:please\s+)?(?:use|try|run\s+(?:on|with))\s+(?:the\s+)?(.+?)(?:\s+(?:model|provider|instead))?$/i,
  /^(?:please\s+)?(?:change|switch)\s+(?:the\s+)?(?:model|provider)\s+(?:to|towards|onto)\s+(.+)$/i,
];

/** Strip polite filler so matching focuses on the intent. */
function normalize(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^(?:hey\s+|hi\s+|ok\s+|please\s+|pls\s+)/i, '')
    .replace(/[.!?]+$/, (m) => m) // trailing punctuation kept for anchors
    .trim();
}

/**
 * Parse a message into a model command, or null when it is an ordinary
 * request that should go to the agent unchanged.
 */
export function parseModelCommand(raw: string): ModelCommand | null {
  const text = normalize(raw ?? '');
  if (!text || text.length > MAX_COMMAND_LENGTH) return null;

  // A message with several sentences is conversation, not a command.
  if ((text.match(/[.!?]/g) ?? []).length > 1) return null;

  const lower = text.toLowerCase();

  for (const pattern of STATUS_PATTERNS) {
    if (pattern.test(lower)) return { kind: 'status' };
  }
  for (const pattern of SWITCH_WORKING_PATTERNS) {
    if (pattern.test(lower)) return { kind: 'switch_working' };
  }
  for (const pattern of SWITCH_TARGET_PATTERNS) {
    const match = lower.match(pattern);
    if (match?.[1]) {
      const target = match[1]
        .replace(/[.!?]+$/, '')
        .replace(/^(?:the\s+)?(?:model|provider)\s+/, '')
        .trim();
      if (target && target.length <= 80 && !looksLikeTask(target)) {
        return { kind: 'switch_target', target };
      }
    }
  }
  return null;
}

/**
 * A captured "to X" that is clearly a task rather than a provider/model name
 * ("switch to building the app" must reach the agent). Heuristics: verb-y
 * phrases with articles/prepositions or file-ish tokens are tasks.
 */
function looksLikeTask(target: string): boolean {
  if (/\b(?:the|a|an|my|our|building|writing|creating|making|next|working|it|this|that)\b/.test(target)) return true;
  if (/\s+(?:and|then|while|before|after|for|with)\s+/.test(target)) return true;
  if (/[\\/]|\.tsx?$|\.json$|\.py$/.test(target)) return true;
  return false;
}
