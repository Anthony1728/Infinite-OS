// Crypto tool — hashing, HMAC, random generation, password strength, and
// encoding. Uses only Node's built-in crypto module.

import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import type { Tool, ToolResult } from './base.js';

interface CryptoInput {
  action: string;
  // hash / hmac
  data?: string;
  algorithm?: string;
  secret?: string;
  // random
  bytes?: number;
  length?: number;
  count?: number;
  // password
  upper?: boolean;
  lower?: boolean;
  digits?: boolean;
  symbols?: boolean;
  ambiguous?: boolean;
  // encoding
  text?: string;
  urlSafe?: boolean;
  // jwt
  token?: string;
}

const HASH_ALGORITHMS = new Set(['sha1', 'sha256', 'sha512', 'md5']);
const ALLOWED_SYMBOLS = '!@#$%^&*()-_=+[]{};:,.<>?';
const AMBIGUOUS = 'Il1O0o';

export const cryptoTool: Tool = {
  name: 'Crypto',
  description: 'Cryptographic and encoding utilities: hashing (sha256/sha1/sha512/md5), HMAC, secure random bytes/UUIDs/passwords, password strength scoring, base64/hex/URL encoding, and JWT payload decoding. Use for secure generation and verification tasks.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['hash', 'hmac', 'random_hex', 'random_uuid', 'random_password', 'password_strength', 'base64_encode', 'base64_decode', 'hex_encode', 'hex_decode', 'url_encode', 'url_decode', 'jwt_decode'] },
      data: { type: 'string', description: 'Input data for hash/hmac.' },
      algorithm: { type: 'string', enum: ['sha1', 'sha256', 'sha512', 'md5'], description: 'Hash algorithm (default sha256).' },
      secret: { type: 'string', description: 'HMAC secret key.' },
      bytes: { type: 'number', description: 'Byte length for random_hex.' },
      length: { type: 'number', description: 'Password length (default 24).' },
      count: { type: 'number', description: 'Number of UUIDs to generate (default 1).' },
      upper: { type: 'boolean', description: 'Include uppercase (default true).' },
      lower: { type: 'boolean', description: 'Include lowercase (default true).' },
      digits: { type: 'boolean', description: 'Include digits (default true).' },
      symbols: { type: 'boolean', description: 'Include symbols (default false).' },
      ambiguous: { type: 'boolean', description: 'Include ambiguous chars like 0O1lI (default false).' },
      text: { type: 'string', description: 'Text to encode/decode.' },
      urlSafe: { type: 'boolean', description: 'URL-safe base64 (default false).' },
      token: { type: 'string', description: 'JWT to decode (payload only; never trusted for auth).' },
    },
    required: ['action'],
  },
  permission: 'none',

  async execute(args, _ctx): Promise<ToolResult> {
    const input = args as CryptoInput;
    try {
      switch (input.action) {
        case 'hash': {
          if (input.data === undefined) return bad('hash requires data.');
          const algorithm = HASH_ALGORITHMS.has(input.algorithm ?? '') ? input.algorithm! : 'sha256';
          const digest = createHash(algorithm).update(input.data, 'utf8').digest('hex');
          return json({ algorithm, digest, length: digest.length });
        }
        case 'hmac': {
          if (input.data === undefined || input.secret === undefined) return bad('hmac requires data and secret.');
          const algorithm = HASH_ALGORITHMS.has(input.algorithm ?? '') ? input.algorithm! : 'sha256';
          const mac = createHmac(algorithm, input.secret).update(input.data, 'utf8').digest('hex');
          return json({ algorithm, hmac: mac });
        }
        case 'random_hex': {
          const bytes = clampInt(input.bytes, 1, 1_000_000, 32);
          const hex = randomBytes(bytes).toString('hex');
          return json({ bytes, hex });
        }
        case 'random_uuid': {
          const count = clampInt(input.count, 1, 1000, 1);
          const uuids = Array.from({ length: count }, () => randomUUID());
          return json({ count, uuids });
        }
        case 'random_password': {
          return json(generatePassword(input));
        }
        case 'password_strength': {
          if (input.data === undefined) return bad('password_strength requires data.');
          return json(strengthScore(input.data));
        }
        case 'base64_encode': {
          if (input.text === undefined) return bad('base64_encode requires text.');
          return { content: toBase64(input.text, input.urlSafe ?? false) };
        }
        case 'base64_decode': {
          if (input.text === undefined) return bad('base64_decode requires text.');
          const decoded = Buffer.from(input.text, 'base64');
          return { content: decoded.toString('utf8') };
        }
        case 'hex_encode': {
          if (input.text === undefined) return bad('hex_encode requires text.');
          return { content: Buffer.from(input.text, 'utf8').toString('hex') };
        }
        case 'hex_decode': {
          if (input.text === undefined) return bad('hex_decode requires text.');
          const buffer = Buffer.from(input.text, 'hex');
          return json({ asUtf8: buffer.toString('utf8'), asBase64: buffer.toString('base64') });
        }
        case 'url_encode': {
          if (input.text === undefined) return bad('url_encode requires text.');
          return { content: encodeURIComponent(input.text) };
        }
        case 'url_decode': {
          if (input.text === undefined) return bad('url_decode requires text.');
          return { content: decodeURIComponent(input.text) };
        }
        case 'jwt_decode': {
          if (!input.token) return bad('jwt_decode requires token.');
          return json(decodeJwt(input.token));
        }
        default:
          return bad(`Unknown Crypto action: ${input.action}`);
      }
    } catch (error) {
      return bad((error as Error).message);
    }
  },
};

// ---------------------------------------------------------------------------

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function toBase64(text: string, urlSafe: boolean): string {
  const b64 = Buffer.from(text, 'utf8').toString('base64');
  return urlSafe ? b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : b64;
}

interface PasswordSpec {
  length?: number;
  upper?: boolean;
  lower?: boolean;
  digits?: boolean;
  symbols?: boolean;
  ambiguous?: boolean;
}

function generatePassword(input: PasswordSpec): { password: string; length: number; strength: { score: number; label: string; entropyBits: number } } {
  const length = clampInt(input.length, 8, 512, 24);
  let pool = '';
  const needs: string[] = [];
  if (input.upper !== false) { pool += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'; needs.push('upper'); }
  if (input.lower !== false) { pool += 'abcdefghijklmnopqrstuvwxyz'; needs.push('lower'); }
  if (input.digits !== false) { pool += '0123456789'; needs.push('digit'); }
  if (input.symbols === true) { pool += ALLOWED_SYMBOLS; needs.push('symbol'); }
  if (input.ambiguous === false) {
    for (const c of AMBIGUOUS) pool = pool.replace(c, '');
  }
  if (!pool) return badPasswordResult(length, 'No character classes selected.');
  const picks: string[] = [];
  const classes: Record<string, string> = {
    upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    lower: 'abcdefghijklmnopqrstuvwxyz',
    digit: '0123456789',
    symbol: ALLOWED_SYMBOLS,
  };
  // Guarantee at least one char per selected class. Class picks must respect
  // the ambiguous-char exclusion too, or I/l/1/O/0/o leak back in.
  for (const kind of needs) {
    let cls = classes[kind];
    if (input.ambiguous === false && cls) {
      for (const c of AMBIGUOUS) cls = cls.replace(c, '');
    }
    if (cls) picks.push(cls[randomInt(cls.length)]);
  }
  while (picks.length < length) picks.push(pool[randomInt(pool.length)]);
  // Fisher-Yates shuffle.
  for (let i = picks.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [picks[i], picks[j]] = [picks[j], picks[i]];
  }
  const password = picks.join('');
  return { password, length, strength: strengthScore(password) };
}

function badPasswordResult(length: number, reason: string): { password: string; length: number; strength: { score: number; label: string; entropyBits: number }; error?: string } {
  return { password: '', length, strength: { score: 0, label: 'invalid', entropyBits: 0 }, error: reason };
}

interface StrengthResult {
  score: number; // 0-4
  label: string;
  entropyBits: number;
  length: number;
  charClasses: number;
  verdict: string;
  matchedBreachList: boolean;
}

function strengthScore(password: string): StrengthResult {
  const length = password.length;
  let pool = 0;
  let classes = 0;
  if (/[a-z]/.test(password)) { pool += 26; classes++; }
  if (/[A-Z]/.test(password)) { pool += 26; classes++; }
  if (/\d/.test(password)) { pool += 10; classes++; }
  if (/[^A-Za-z0-9]/.test(password)) { pool += 33; classes++; }
  const entropy = length > 0 ? Math.round(length * Math.log2(Math.max(pool, 2))) : 0;
  const score = length === 0 ? 0
    : length < 8 ? 1
    : entropy < 40 ? 1
    : entropy < 60 ? 2
    : entropy < 80 ? 3
    : 4;
  const labels = ['very weak', 'weak', 'fair', 'strong', 'very strong'];
  const verdicts = [
    'Rejected: too short or too predictable.',
    'Too weak for anything sensitive.',
    'Acceptable for low-risk accounts.',
    'Strong enough for most services.',
    'Excellent: recommended for sensitive accounts.',
  ];
  return {
    score,
    label: labels[score],
    entropyBits: entropy,
    length,
    charClasses: classes,
    verdict: verdicts[score],
    matchedBreachList: false,
  };
}

function decodeJwt(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Not a valid JWT (expected 3 dot-separated segments).');
  }
  const decodeSegment = (seg: string): string => {
    const padded = seg.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(padded, 'base64url').toString('utf8');
  };
  let header: unknown;
  let payload: unknown;
  try {
    header = JSON.parse(decodeSegment(parts[0]));
    payload = JSON.parse(decodeSegment(parts[1]));
  } catch {
    throw new Error('JWT segments are not valid base64url JSON.');
  }
  const claims = payload as Record<string, unknown>;
  const now = Math.floor(Date.now() / 1000);
  const notBefore = typeof claims.nbf === 'number' ? claims.nbf : null;
  const expires = typeof claims.exp === 'number' ? claims.exp : null;
  return {
    header,
    payload,
    timing: {
      now,
      valid: true,
      expired: expires !== null ? now >= expires : null,
      notYetValid: notBefore !== null ? now < notBefore : null,
      expiresAtIso: expires !== null ? new Date(expires * 1000).toISOString() : null,
    },
    note: 'Payload decoded without signature verification. Never trust a JWT for authorization based on decoding alone.',
  };
}

// Export for potential use in tests / other modules.
export function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function json(value: unknown): ToolResult { return { content: JSON.stringify(value, null, 2) }; }
function bad(content: string): ToolResult { return { content, is_error: true }; }
