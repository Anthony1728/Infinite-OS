/**
 * Conservative HTML sanitizer for Studio documents.
 *
 * The document editor produces a small subset of HTML (bold/italic/lists/
 * headings/links), and documents can also be written by the agent or by an
 * AI action. Anything that reaches the renderer is therefore untrusted input,
 * even though it came from inside the app.
 *
 * This is deliberately allow-list based. Unknown tags are removed (their text
 * content is kept because the surrounding text nodes are untouched), event
 * handlers are dropped, and URLs are restricted to schemes that cannot execute
 * script. It is not a general-purpose sanitizer for arbitrary web HTML; it is
 * the exact, narrow surface the editor can create.
 */

const ALLOWED_TAGS = new Set([
  'p', 'br', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'mark', 'sub', 'sup',
  'a', 'hr', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
  'img', 'figure', 'figcaption',
]);

const VOID_TAGS = new Set(['br', 'hr', 'img']);

/** CSS properties the editor uses. Everything else is stripped. */
const ALLOWED_STYLE_PROPERTIES = new Set([
  'text-align', 'font-weight', 'font-style', 'text-decoration',
  'color', 'background-color', 'font-size', 'line-height', 'white-space',
]);

const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\)|[a-z]{3,24})$/i;
const SAFE_FONT_SIZE = /^(xx-small|x-small|small|medium|large|x-large|xx-large|smaller|larger|\d+(\.\d+)?(px|pt|em|rem|%))$/i;
const SAFE_ALIGN = /^(left|right|center|justify)$/i;
const SAFE_WEIGHT = /^(normal|bold|bolder|lighter|[1-9]00)$/i;

const BLOCK_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button',
  'textarea', 'select', 'link', 'meta', 'base', 'svg', 'math', 'template',
  'noscript', 'video', 'audio', 'source', 'canvas',
]);

/** Remove a blocked element and everything inside it. */
function stripElement(html: string, tag: string): string {
  const paired = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi');
  const unclosed = new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi');
  return html.replace(paired, '').replace(unclosed, '');
}

function safeStyle(value: string): string {
  const declarations: string[] = [];
  for (const part of value.split(';')) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    const property = part.slice(0, colon).trim().toLowerCase();
    const raw = part.slice(colon + 1).trim();
    if (!ALLOWED_STYLE_PROPERTIES.has(property) || !raw) continue;
    const lower = raw.toLowerCase();
    if (lower.includes('url(') || lower.includes('expression') || lower.includes('javascript:')) continue;
    let valid = false;
    if (property === 'text-align') valid = SAFE_ALIGN.test(raw);
    else if (property === 'font-weight') valid = SAFE_WEIGHT.test(raw);
    else if (property === 'font-style') valid = /^(normal|italic|oblique)$/i.test(raw);
    else if (property === 'text-decoration') valid = /^(none|underline|line-through|overline)(\s+(underline|line-through|overline))*$/i.test(raw);
    else if (property === 'color' || property === 'background-color') valid = SAFE_COLOR.test(raw);
    else if (property === 'font-size') valid = SAFE_FONT_SIZE.test(raw);
    else if (property === 'line-height') valid = /^(normal|\d+(\.\d+)?|\d+(\.\d+)?(px|em|rem|%))$/i.test(raw);
    else if (property === 'white-space') valid = /^(normal|pre|pre-wrap|pre-line|nowrap)$/i.test(raw);
    if (valid) declarations.push(`${property}: ${raw}`);
  }
  return declarations.join('; ');
}

function safeHref(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  // Relative links and fragments are harmless inside a document.
  if (value.startsWith('#') || value.startsWith('/')) return value;
  if (/^(https?:|mailto:|tel:)/i.test(value)) return value;
  return null;
}

function safeSrc(raw: string): string | null {
  const value = raw.trim();
  if (/^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(value)) return value;
  if (/^https:\/\//i.test(value)) return value;
  return null;
}

function sanitizeAttributes(tag: string, rawAttributes: string): string {
  const kept: string[] = [];
  const attrPattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = attrPattern.exec(rawAttributes))) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction') continue;
    if (name === 'style') {
      const style = safeStyle(value);
      if (style) kept.push(`style="${escapeAttribute(style)}"`);
      continue;
    }
    if (name === 'href' && tag === 'a') {
      const href = safeHref(value);
      if (href) kept.push(`href="${escapeAttribute(href)}"`);
      continue;
    }
    if (name === 'src' && tag === 'img') {
      const src = safeSrc(value);
      if (src) kept.push(`src="${escapeAttribute(src)}"`);
      continue;
    }
    if ((name === 'colspan' || name === 'rowspan') && (tag === 'td' || tag === 'th')) {
      if (/^\d{1,2}$/.test(value)) kept.push(`${name}="${value}"`);
      continue;
    }
    if (name === 'alt' && tag === 'img') {
      kept.push(`alt="${escapeAttribute(value.slice(0, 300))}"`);
    }
  }
  return kept.length ? ` ${kept.join(' ')}` : '';
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function sanitizeDocumentHtml(input: string, maxLength = 2_000_000): string {
  let html = String(input ?? '').slice(0, maxLength);
  if (!html) return '';

  html = html.replace(/<!--[\s\S]*?-->/g, '');
  for (const tag of BLOCK_TAGS) html = stripElement(html, tag);

  return html.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g, (_whole, closing: string, rawTag: string, rawAttributes: string) => {
    const tag = rawTag.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return '';
    if (closing) return VOID_TAGS.has(tag) ? '' : `</${tag}>`;
    if (VOID_TAGS.has(tag)) {
      const attrs = tag === 'img' ? sanitizeAttributes(tag, rawAttributes) : '';
      return `<${tag}${attrs}>`;
    }
    return `<${tag}${sanitizeAttributes(tag, rawAttributes)}>`;
  });
}
