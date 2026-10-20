// Pure speakable-text helpers shared by the main-process voice session and the
// renderer voice view. Kept free of DOM APIs so typecheck:node can use it.

/**
 * Markdown → speakable text: code fences are dropped (a voice should never
 * read source aloud), links collapse to their label, and emphasis markers
 * are stripped so TTS doesn't spell them out.
 */
export function spokenReplyText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__|\*|_)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Streaming speech: carve complete, speakable sentences off the front of the
 * raw streamed buffer. Returns the sanitized chunks plus how many RAW chars
 * were consumed, so the caller keeps byte-exact offsets into the growing
 * transcript (sanitizing changes lengths — never diff sanitized text).
 *
 * Rules: a sentence ends at terminal punctuation followed by whitespace and
 * a capital/digit/quote/paren (decimals like 3.5 and abbreviations like
 * "e.g." never split); a sentence at the very end of the buffer counts as
 * complete when it ends in terminal punctuation. Everything before an
 * UNCLOSED code fence is speakable, everything from it on is held — the AI
 * must never read source code aloud mid-stream. The held tail (fence text,
 * half sentences) flushes at turn end through the normal full-reply path.
 */
const SENTENCE_RE = /(.+?[.!?…]+["'”’)\]]*)(?=\s+(?=[A-ZÀ-ÞĀ-ž0-9"“'({])|\s*$)/gs;
const FENCE_SPAN_RE = /```[\s\S]*?```/g;

/** Prose segments of the head with buffer offsets — complete fence spans excluded. */
function splitProseParts(head: string): Array<{ text: string; base: number }> {
  const parts: Array<{ text: string; base: number }> = [];
  let cursor = 0;
  FENCE_SPAN_RE.lastIndex = 0;
  let span: RegExpExecArray | null;
  while ((span = FENCE_SPAN_RE.exec(head)) !== null) {
    if (span.index > cursor) parts.push({ text: head.slice(cursor, span.index), base: cursor });
    cursor = span.index + span[0].length;
    if (span[0].length === 0) break;
  }
  if (cursor < head.length) parts.push({ text: head.slice(cursor), base: cursor });
  return parts;
}

export function extractSpeakableSentences(buffer: string): { chunks: string[]; consumed: number } {
  if (!buffer.trim()) return { chunks: [], consumed: 0 };
  // Fence parity on the raw buffer: an odd count means a code block is still
  // open — only the text before it may speak.
  const fenceMarks = buffer.match(/```/g) ?? [];
  let head = buffer;
  if (fenceMarks.length % 2 === 1) {
    head = buffer.slice(0, buffer.lastIndexOf('```'));
  }
  // Consumed stays a buffer PREFIX: stop at the first prose part whose tail
  // is an incomplete sentence, so later parts can never overtake it. A
  // whitespace-only tail counts as complete (it lets the cursor jump the
  // fence span to the next part).
  const chunks: string[] = [];
  let consumed = 0;
  const parts = splitProseParts(head);
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (part.base !== consumed) break;
    SENTENCE_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    let advanced = false;
    while ((match = SENTENCE_RE.exec(part.text)) !== null) {
      if (match[0].length === 0) break;
      const sentence = match[1].trim();
      consumed = part.base + match.index + match[0].length;
      advanced = true;
      if (!sentence) continue;
      // Strip markdown voice-noise per chunk; drop lone backticks an unclosed
      // inline-code span would otherwise leave behind for TTS to read out.
      const speakable = spokenReplyText(sentence).replace(/`/g, '').replace(/\s+/g, ' ').trim();
      if (speakable) chunks.push(speakable);
    }
    if (!advanced) break;
    if (part.text.slice(consumed - part.base).trim() !== '') break;
    // Fully consumed through whitespace: jump the fence span to the next
    // prose part (or the buffer end for the last part).
    consumed = parts[i + 1]?.base ?? part.base + part.text.length;
  }
  return { chunks, consumed };
}
