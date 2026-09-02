import type { Tool, ToolContext, ToolResult } from './base.js';

/**
 * Regex Tool — test, generate, and explain regular expressions.
 * Deterministic, no model call. Use when the user asks to:
 * - test a regex against a string
 * - generate a regex for a pattern
 * - explain what a regex does
 * - find all matches in a string
 */
interface RegexArgs {
  action: 'test' | 'match' | 'explain' | 'generate';
  pattern?: string;
  flags?: string;
  text?: string;
  description?: string;
}

const COMMON_PATTERNS: Record<string, string> = {
  email: '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}',
  url: 'https?://[^\\s/$.?#].[^\\s]*',
  phone: '\\+?\\d{1,3}[-.\\s]?\\(?\\d{1,4}\\)?[-.\\s]?\\d{1,4}[-.\\s]?\\d{1,9}',
  ip: '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b',
  date: '\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}',
  time: '\\d{1,2}:\\d{2}(?::\\d{2})?(?:\\s?[AP]M)?',
  hex_color: '#(?:[0-9a-fA-F]{3}){1,2}\\b',
  uuid: '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
  zip_us: '\\d{5}(?:-\\d{4})?',
  username: '[a-zA-Z0-9_]{3,20}',
  strong_password: '(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]{8,}',
  html_tag: '<([a-z][a-z0-9]*)\\b[^>]*>(.*?)</\\1>',
  markdown_link: '\\[([^\\]]+)\\]\\(([^)]+)\\)',
  csv_field: '(?:^|,)(?:"([^"]*(?:""[^"]*)*)"|([^,]*))',
  xml_tag: '<([a-z][a-z0-9]*)\\b([^>]*)/>',
};

export const regexTool: Tool = {
  name: 'Regex',
  description:
    'Test, match, explain, or generate regular expressions. Deterministic — no model call. Actions: test (check if pattern matches text), match (find all matches with positions), explain (describe what a regex does in plain English), generate (create regex from natural language description using common patterns).',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['test', 'match', 'explain', 'generate'], description: 'What to do with the regex' },
      pattern: { type: 'string', description: 'The regex pattern (without slashes)' },
      flags: { type: 'string', description: 'Regex flags: g, i, m, s (default: g)' },
      text: { type: 'string', description: 'Text to test/match against' },
      description: { type: 'string', description: 'Natural language description for generate action' },
    },
    required: ['action'],
  },
  permission: 'allow',
  async execute(args: unknown, _ctx: ToolContext): Promise<ToolResult> {
    const a = args as RegexArgs;

    if (a.action === 'generate') {
      if (!a.description) return { content: 'Regex generate requires a description.', is_error: true };
      const desc = a.description.toLowerCase();
      const matches: Array<{ name: string; pattern: string }> = [];
      for (const [name, pattern] of Object.entries(COMMON_PATTERNS)) {
        if (desc.includes(name.replace(/_/g, ' ')) || desc.includes(name.replace(/_/g, ''))) {
          matches.push({ name, pattern });
        }
      }
      // Fuzzy match keywords
      if (matches.length === 0) {
        if (/\bemail\b/i.test(desc)) matches.push({ name: 'email', pattern: COMMON_PATTERNS.email });
        if (/\burl\b/i.test(desc) || /\blink\b/i.test(desc)) matches.push({ name: 'url', pattern: COMMON_PATTERNS.url });
        if (/\bphone\b/i.test(desc)) matches.push({ name: 'phone', pattern: COMMON_PATTERNS.phone });
        if (/\bip\b/i.test(desc) || /\baddress\b/i.test(desc)) matches.push({ name: 'ip', pattern: COMMON_PATTERNS.ip });
        if (/\bdate\b/i.test(desc)) matches.push({ name: 'date', pattern: COMMON_PATTERNS.date });
        if (/\btime\b/i.test(desc)) matches.push({ name: 'time', pattern: COMMON_PATTERNS.time });
        if (/\bcolor\b/i.test(desc) || /\bhex\b/i.test(desc)) matches.push({ name: 'hex_color', pattern: COMMON_PATTERNS.hex_color });
        if (/\buuid\b/i.test(desc)) matches.push({ name: 'uuid', pattern: COMMON_PATTERNS.uuid });
        if (/\bzip\b/i.test(desc) || /\bpostal\b/i.test(desc)) matches.push({ name: 'zip_us', pattern: COMMON_PATTERNS.zip_us });
        if (/\busername\b/i.test(desc) || /\buser\b/i.test(desc)) matches.push({ name: 'username', pattern: COMMON_PATTERNS.username });
        if (/\bpassword\b/i.test(desc)) matches.push({ name: 'strong_password', pattern: COMMON_PATTERNS.strong_password });
        if (/\bhtml\b/i.test(desc) || /\btag\b/i.test(desc)) matches.push({ name: 'html_tag', pattern: COMMON_PATTERNS.html_tag });
        if (/\bmarkdown\b/i.test(desc) || /\blink\b/i.test(desc)) matches.push({ name: 'markdown_link', pattern: COMMON_PATTERNS.markdown_link });
        if (/\bcsv\b/i.test(desc) || /\bcomma\b/i.test(desc)) matches.push({ name: 'csv_field', pattern: COMMON_PATTERNS.csv_field });
      }
      if (matches.length === 0) {
        return { content: `No common pattern found for "${a.description}". Try: email, url, phone, ip, date, time, hex color, uuid, zip code, username, password, html tag, markdown link, csv field.`, is_error: true };
      }
      const best = matches[0];
      const output = [
        `**Generated regex for "${a.description}":**`,
        ``,
        `\`${best.pattern}\``,
        ``,
        `**Flags:** g (global)`,
        `**Example:** Test it with the test action.`,
        matches.length > 1 ? `\nOther matches: ${matches.slice(1).map(m => m.name).join(', ')}` : '',
      ].filter(Boolean).join('\n');
      return { content: output };
    }

    if (!a.pattern) return { content: `Regex ${a.action} requires a pattern.`, is_error: true };
    const flags = a.flags || 'g';

    let regex: RegExp;
    try {
      regex = new RegExp(a.pattern, flags);
    } catch (e) {
      return { content: `Invalid regex: ${(e as Error).message}`, is_error: true };
    }

    if (a.action === 'test') {
      if (!a.text) return { content: 'Regex test requires text.', is_error: true };
      const match = regex.test(a.text);
      return { content: `Pattern ${match ? 'MATCHES' : 'does NOT match'} the text.\n\nPattern: \`${a.pattern}\` (${flags})\nText: "${a.text.slice(0, 200)}"` };
    }

    if (a.action === 'match') {
      if (!a.text) return { content: 'Regex match requires text.', is_error: true };
      const matches: Array<{ match: string; index: number; groups?: string[] }> = [];
      let m: RegExpExecArray | null;
      const globalRegex = new RegExp(a.pattern, flags.includes('g') ? flags : flags + 'g');
      while ((m = globalRegex.exec(a.text)) !== null) {
        matches.push({ match: m[0], index: m.index, groups: m.slice(1) });
        if (matches.length > 100) break;
      }
      if (matches.length === 0) return { content: `No matches found.\n\nPattern: \`${a.pattern}\` (${flags})` };
      const output = [
        `**${matches.length} match(es) found:**`,
        ``,
        ...matches.slice(0, 20).map((m, i) => `${i + 1}. "${m.match}" at index ${m.index}${m.groups?.length ? ` (groups: ${m.groups.join(', ')})` : ''}`),
        matches.length > 20 ? `\n... and ${matches.length - 20} more.` : '',
      ].join('\n');
      return { content: output };
    }

    if (a.action === 'explain') {
      const explanations: string[] = [];
      const p = a.pattern;
      if (p.startsWith('^')) explanations.push('^ — starts at beginning of string');
      if (p.endsWith('$')) explanations.push('$ — ends at end of string');
      if (/\(\?:</.test(p)) explanations.push('(?:...) — non-capturing group');
      if (/\(\?</.test(p)) explanations.push('(?...) — named/capturing group');
      if (/\[.*?\]/.test(p)) {
        const charClasses = p.match(/\[.*?\]/g) || [];
        for (const c of charClasses) explanations.push(`${c} — character class: match one of ${c.slice(1, -1)}`);
      }
      if (/\.\*/.test(p)) explanations.push('.* — match any character (except newline), zero or more times');
      if (/\.\+/.test(p)) explanations.push('.+ — match any character (except newline), one or more times');
      if (/\.\?/.test(p)) explanations.push('.? — match any character (except newline), zero or one time');
      if (/\{[\d,]+\}/.test(p)) {
        const quantifiers = p.match(/\{[\d,]+\}/g) || [];
        for (const q of quantifiers) explanations.push(`${q} — quantifier: repeat ${q.slice(1, -1)} times`);
      }
      if (/\\d/.test(p)) explanations.push('\\d — match any digit (0-9)');
      if (/\\w/.test(p)) explanations.push('\\w — match word character (letter, digit, underscore)');
      if (/\\s/.test(p)) explanations.push('\\s — match whitespace character');
      if (/\\b/.test(p)) explanations.push('\\b — word boundary');
      if (/\|/.test(p)) explanations.push('| — OR: match either side');
      if (/\(/.test(p) && !/\?:/.test(p)) explanations.push('(...) — capturing group');

      if (explanations.length === 0) {
        explanations.push('This is a simple literal pattern with no special regex constructs.');
      }

      return { content: `**Explanation of** \`${a.pattern}\`:\n\n${explanations.map(e => `- ${e}`).join('\n')}` };
    }

    return { content: `Unknown regex action: ${a.action}`, is_error: true };
  },
};
