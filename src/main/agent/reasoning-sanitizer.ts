// Sanitizes final assistant text to remove leaked chain-of-thought / reasoning
// narration that small local models sometimes emit into the visible reply.
//
// Small models (and some instruct models) follow the system prompt literally
// and echo their internal "Step 1: ... Step 2: ..." decision process into the
// user-visible response. This module strips that leaked reasoning so the user
// only sees the final answer or the concrete action result.
//
// Design notes:
// - This is a conservative, pattern-based sanitizer. It only removes text that
//   clearly looks like leaked meta-reasoning. It never removes a short, direct
//   answer.
// - It is applied to the FINAL assistant text only (not streamed deltas), so
//   streaming UX is unaffected; we rewrite the finalized text block.
// - It preserves genuine content: if after stripping nothing meaningful
//   remains, the original text is returned unchanged (better to show a leaky
//   answer than no answer).

/**
 * A line is considered "leaked reasoning" if it matches one of these patterns.
 * Matches are case-insensitive and anchored to the start of the line (after
 * trimming list/number prefixes).
 */
const LEAKED_LINE_PATTERNS: RegExp[] = [
  // Numbered meta-steps: "Step 1: Assess user request", "Step 2: ..."
  /^\s*step\s*\d+\s*[:-]/i,
  // Bare numbered meta-commentary that references the decision loop vocabulary
  /^\s*\d+\.\s+(?:assess|classify|tool selection|research|action|observe|verify|finish|decide|plan)\b/i,
  // Explicit classification narration matching the system prompt vocabulary
  /\bclassify(?:\s+it)?\s+as\s+(?:answer|research|action)\b/i,
  // "Tool selection: ..." / "Tool choice: ..." meta lines
  /^\s*tool\s+(?:selection|choice|consideration)\s*[:-]/i,
  // "Assess user request" / "Assess the user request" headers
  /^\s*assess(?:\s+the)?\s+user\s+request\b/i,
  // Self-talk / hedging narration that small models produce
  /^\s*(?:wait|however|but|so|now|alright|okay|ok|hmm|let me think|let's see|let me check)\b[,:]?/i,
  // "I should ..." / "I'll use ..." / "I can ..." meta-commentary about tool choice
  /^\s*i\s+(?:should|will|can|could|need to|have to|must)\s+(?:use|call|invoke|choose|select|decide|determine|check|think|consider)\b/i,
  // "The instructions say ..." / "per the workflow ..." / "according to the system prompt"
  /^\s*(?:the\s+instructions|the\s+workflow|the\s+system\s+prompt|the\s+guidelines|per\s+the\s+(?:workflow|instructions|rules))\s+(?:say|state|require|expect|tell)\b/i,
  // "Since the user ... I'll ..." style bridging narration (two-clause meta)
  /^\s*since\s+the\s+user\s+\w+.*\bi\s+(?:will|'ll|can|should|'ll)\b/i,
  // "Given the brief nature ..." / "Given the ... context" preamble
  /^\s*given\s+(?:the\s+)?(?:brief|simple|short|nature|context|request)\b/i,
  // "No tool calls needed" / "No additional search/action needed" meta
  /^\s*no\s+(?:tool\s+calls?|additional\s+(?:search|action|research|tool))\s+(?:are\s+)?needed\b/i,
  // "I'll just respond" / "I'll respond directly" meta
  /^\s*i\s+'?ll\s+(?:just\s+)?respond\s+(?:directly|with|and)\b/i,
  // "I can simply respond" / "I can answer directly"
  /^\s*i\s+can\s+(?:simply\s+)?(?:respond|answer)\s+(?:directly|with)\b/i,
  // "I'll output a simple acknowledgment" / "I'll say hi and confirm"
  /^\s*i\s+'?ll\s+(?:output|say|provide|give)\s+(?:a\s+)?(?:simple\s+)?(?:acknowledgment|acknowledgement|confirmation|greeting)\b/i,
];

/**
 * Lines that are short, direct answers and must NEVER be stripped, even if they
 * happen to start with a keyword that a leaked-reasoning pattern would catch.
 * A line is protected if it is short and does not contain meta vocabulary.
 */
const META_VOCABULARY = [
  'classify', 'classification', 'tool selection', 'tool choice', 'assess user request',
  'assess the user request', 'role-stratified', 'the instructions say', 'the workflow',
  'system prompt', 'no tool calls', 'no additional search', 'tool calls needed',
  'i should use', "i'll use", 'i can use', 'i need to', 'i have to',
  'let me think', "let's see", 'let me check', 'step 1', 'step 2',
];

function lineContainsMetaVocabulary(line: string): boolean {
  const lower = line.toLowerCase();
  return META_VOCABULARY.some((term) => lower.includes(term));
}

/**
 * Strip list/number prefixes so patterns can match uniformly.
 * Returns the cleaned line plus the original prefix (for reconstruction if needed).
 */
function stripLinePrefix(line: string): string {
  return line.replace(/^\s*(?:\d+[.)]\s+|[-*•]\s+|>\s*)+/, '').trim();
}

/**
 * Determine whether a single line looks like leaked reasoning.
 */
function isLeakedReasoningLine(rawLine: string): boolean {
  const line = rawLine.trim();
  if (!line) return false;

  // Very short direct answers are never leaked reasoning.
  // (e.g. "Hi there!" or "Sure, what would you like to know?")
  if (line.length <= 60 && !lineContainsMetaVocabulary(line)) {
    // But still catch "Step 1:" style even if short.
    if (/^\s*step\s*\d+\s*[:-]/i.test(line)) return true;
    return false;
  }

  const cleaned = stripLinePrefix(line);

  for (const pattern of LEAKED_LINE_PATTERNS) {
    if (pattern.test(line) || pattern.test(cleaned)) return true;
  }

  return false;
}

/**
 * Heuristic: does the whole text look like it is *mostly* leaked reasoning
 * (i.e. a chain-of-thought dump) rather than a real answer with some preamble?
 * If more than ~60% of non-empty lines are leaked-reasoning lines AND there is
 * no substantial block of clean content, we treat the entire thing as a leak
 * and return a minimal fallback.
 */
function isMostlyLeakedReasoning(text: string): boolean {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 4) return false;
  let leaked = 0;
  for (const line of lines) if (isLeakedReasoningLine(line)) leaked++;
  const ratio = leaked / lines.length;
  return ratio >= 0.6;
}

/**
 * Sanitize a finalized assistant text block.
 *
 * Removes leaked chain-of-thought / meta-reasoning lines while preserving the
 * genuine answer. If the entire text appears to be a reasoning dump with no
 * real answer, the original text is returned unchanged (we prefer showing a
 * leaky answer over no answer, and let the strengthened prompt handle future
 * turns).
 *
 * @param text The finalized assistant text content.
 * @returns The sanitized text.
 */
export function sanitizeAssistantReasoning(text: string): string {
  if (!text || !text.trim()) return text;

  // If the whole thing is a reasoning dump, attempt to extract the final
  // non-meta sentence as the answer; if none exists, return original.
  if (isMostlyLeakedReasoning(text)) {
    const lines = text.split(/\r?\n/);
    // Find the last line that is NOT leaked reasoning and is non-trivial.
    for (let i = lines.length - 1; i >= 0; i--) {
      const candidate = lines[i].trim();
      if (candidate && !isLeakedReasoningLine(candidate) && candidate.length > 3) {
        return candidate;
      }
    }
    // Everything is leaked reasoning. Try to pull a trailing short answer
    // sentence after the last meta line.
    const tail = lines[lines.length - 1]?.trim() ?? '';
    if (tail && !isLeakedReasoningLine(tail)) return tail;
    // Last resort: return the original so the user at least sees something.
    return text;
  }

  // Normal path: drop individual leaked-reasoning lines, keep the rest.
  const outLines: string[] = [];
  let removedInARow = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    if (isLeakedReasoningLine(rawLine)) {
      removedInARow++;
      continue;
    }
    // Collapse multiple consecutive removed lines into a single blank line so
    // we don't leave gaps in the middle of a genuine answer.
    if (removedInARow > 0 && outLines.length > 0 && rawLine.trim() !== '') {
      outLines.push(''); // one blank line separator
    }
    removedInARow = 0;
    outLines.push(rawLine);
  }

  const result = outLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  // If we stripped everything meaningful, fall back to the original.
  if (!result) return text;
  return result;
}
