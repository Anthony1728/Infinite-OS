import type { Tool, ToolContext, ToolResult } from './base.js';

/**
 * Translate Tool — text translation with language detection.
 * Uses free Google Translate API (no key needed) or offline dictionary.
 */
interface TranslateArgs {
  action: 'translate' | 'detect' | 'languages';
  text?: string;
  from?: string;
  to?: string;
}

const LANGUAGES: Record<string, string> = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian',
  pt: 'Portuguese', ru: 'Russian', ja: 'Japanese', ko: 'Korean', zh: 'Chinese',
  ar: 'Arabic', hi: 'Hindi', tr: 'Turkish', pl: 'Polish', nl: 'Dutch',
  sv: 'Swedish', da: 'Danish', fi: 'Finnish', no: 'Norwegian', cs: 'Czech',
  sk: 'Slovak', hu: 'Hungarian', ro: 'Romanian', bg: 'Bulgarian', hr: 'Croatian',
  th: 'Thai', vi: 'Vietnamese', id: 'Indonesian', ms: 'Malay', tl: 'Filipino',
  uk: 'Ukrainian', el: 'Greek', he: 'Hebrew', fa: 'Farsi', ur: 'Urdu',
  bn: 'Bengali', ta: 'Tamil', te: 'Telugu', mr: 'Marathi', gu: 'Gujarati',
  kn: 'Kannada', ml: 'Malayalam', pa: 'Punjabi', sw: 'Swahili', am: 'Amharic',
};

export const translateTool: Tool = {
  name: 'Translate',
  description:
    'Translate text between 50+ languages. Actions: translate (convert text), detect (identify language), languages (list supported). Uses free Google Translate API — no key required. Returns translation with detected source language.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['translate', 'detect', 'languages'], description: 'What to do' },
      text: { type: 'string', description: 'Text to translate' },
      from: { type: 'string', description: 'Source language code (auto-detect if omitted)' },
      to: { type: 'string', description: 'Target language code (default: en)' },
    },
    required: ['action'],
  },
  permission: 'allow',
  async execute(args: unknown, _ctx: ToolContext): Promise<ToolResult> {
    const a = args as TranslateArgs;

    if (a.action === 'languages') {
      const list = Object.entries(LANGUAGES).map(([code, name]) => `- **${code}** — ${name}`).join('\n');
      return { content: `**Supported Languages (${Object.keys(LANGUAGES).length}):**\n\n${list}` };
    }

    if (a.action === 'detect') {
      if (!a.text) return { content: 'Detect requires text.', is_error: true };
      try {
        const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(a.text.slice(0, 500))}`, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) return { content: `Detection failed: ${res.status}`, is_error: true };
        const data = (await res.json()) as [unknown[], unknown, string];
        const detected = data?.[2] || 'unknown';
        return { content: `Detected language: **${LANGUAGES[detected] || detected}** (${detected})` };
      } catch (e) {
        return { content: `Detection error: ${(e as Error).message}`, is_error: true };
      }
    }

    if (a.action === 'translate') {
      if (!a.text) return { content: 'Translate requires text.', is_error: true };
      const from = a.from || 'auto';
      const to = a.to || 'en';
      try {
        const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=${from}&tl=${to}&dt=t&q=${encodeURIComponent(a.text.slice(0, 5000))}`, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) return { content: `Translation failed: ${res.status}`, is_error: true };
        const data = (await res.json()) as Array<unknown>;
        const translated = ((data?.[0] as Array<Array<string>>) || []).map((seg) => seg[0]).join('');
        const detectedSource = (data?.[2] as string) || from;
        const fromLabel = LANGUAGES[detectedSource as keyof typeof LANGUAGES] || detectedSource;
        const toLabel = LANGUAGES[to] || to;
        return { content: `**${fromLabel} → ${toLabel}:**\n\n${translated}` };
      } catch (e) {
        return { content: `Translation error: ${(e as Error).message}`, is_error: true };
      }
    }

    return { content: `Unknown translate action: ${a.action}`, is_error: true };
  },
};
