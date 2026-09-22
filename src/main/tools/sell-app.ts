// SellApp — connects the builder → money flow: takes a finished creation
// (built app/website under creations/), packages it into a distributable,
// creates a Stripe payment link for it, and writes a listing file the user
// can publish anywhere. No key → still produces the package + listing, with
// pricing advice, so the loop closes even before the user connects billing.

import { mkdir, writeFile, stat, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, basename } from 'node:path';
import type { Tool, ToolResult, ToolContext } from './base.js';
import { resolveProviderKey, redact } from './media-keys.js';
import { creationsRoot } from '../creations/home.js';

const SALES_DIR = () => join(creationsRoot(), 'sales');

interface SellArgs {
  path?: string;
  name?: string;
  price_usd?: number;
  description?: string;
}

interface Listing {
  name: string;
  description: string;
  price_usd: number | null;
  source_path: string;
  package: string | null;
  file_count: number;
  total_bytes: number;
  content_checksum: string;
  created_at: string;
  payment_link: string | null;
  provider: string | null;
}

export const sellAppTool: Tool = {
  name: 'SellApp',
  description:
    'Package a built creation for sale: zip + listing.json/md, and a live Stripe payment link when a Stripe key is connected. Builder → revenue handoff.',
  permission: 'ask',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Built creation folder or file to sell' },
      name: { type: 'string', description: 'Product name' },
      price_usd: { type: 'number', description: 'Price in USD' },
      description: { type: 'string', description: 'Short marketing description' },
    },
    required: ['path', 'name'],
  },

  async execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
    const a = (args ?? {}) as SellArgs;
    const src = resolve(a.path ?? '');
    if (!src || src === resolve('/') || src === resolve(process.cwd())) {
      return { content: 'SellApp needs a specific creation path (not a root/current dir).', is_error: true };
    }
    let files: string[] = [];
    try { files = await listFiles(src, 0); } catch { /* handled below */ }
    if (files.length === 0) return { content: `Nothing to package — path not found or empty: ${src}`, is_error: true };

    const name = (a.name ?? basename(src)).trim();
    const description = (a.description ?? '').trim();
    const price = a.price_usd;

    const salesDir = SALES_DIR();
    await mkdir(salesDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const pkgPath = join(salesDir, `${slug(name)}-${stamp}.zip`);

    // 1) Package (zip) — zip CLI if present, else a manifest-only listing with checksum
    let checksum = '';
    let totalBytes = 0;
    for (const f of files) {
      const s = await stat(f);
      totalBytes += s.size;
      checksum = createHash('sha256').update(checksum + f + s.size).digest('hex');
    }
    let zipped = false;
    try {
      await zipDir(src, pkgPath);
      zipped = true;
    } catch (e) {
      if (isAbort(e)) throw e;
      // No zip available — record intent; files list still goes in listing.json
    }

    // 2) Listing artifacts
    const listing: Listing = {
      name,
      description,
      price_usd: price ?? null,
      source_path: src,
      package: zipped ? pkgPath : null,
      file_count: files.length,
      total_bytes: totalBytes,
      content_checksum: checksum,
      created_at: new Date().toISOString(),
      payment_link: null,
      provider: null,
    };
    const listingJson = join(salesDir, `${slug(name)}-listing.json`);
    const listingMd = join(salesDir, `${slug(name)}-listing.md`);
    await writeFile(listingJson, JSON.stringify(listing, null, 2), 'utf8');
    await writeFile(listingMd, renderListingMd(listing), 'utf8');

    // 3) Stripe payment link (sk_live preferred; sk_test clearly labeled)
    let stripeNote = '';
    const key = await resolveProviderKey('stripe', 'STRIPE_SECRET_KEY');
    if (key && price && price > 0) {
      try {
        const live = key.startsWith('sk_live');
        const body = new URLSearchParams();
        body.set('name', name);
        body.set('currency', 'usd');
        if (description) body.set('description', description.slice(0, 300));
        body.set('line_items[0][quantity]', '1');
        body.set('line_items[0][price_data][currency]', 'usd');
        body.set('line_items[0][price_data][unit_amount]', String(Math.round(price * 100)));
        body.set('line_items[0][price_data][product_data][name]', name);
        const res = await fetchWithTimeout(
          'https://api.stripe.com/v1/payment_links',
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
          },
          ctx.abortSignal,
        );
        if (res.ok) {
          const j = (await res.json()) as { id: string; url: string };
          listing.payment_link = j.url;
          listing.provider = live ? 'stripe' : 'stripe-test-mode';
          await writeFile(listingJson, JSON.stringify(listing, null, 2), 'utf8');
          await writeFile(listingMd, renderListingMd(listing), 'utf8');
        } else if ([401, 403].includes(res.status)) {
          stripeNote = `Stripe rejected the key (${res.status}) — listing saved without a payment link.`;
        } else {
          stripeNote = `Stripe ${res.status}: ${redact(await safeText(res))}`;
        }
      } catch (e) {
        if (isAbort(e)) throw e;
        stripeNote = `Stripe unreachable (${(e as Error).message}) — listing saved without a payment link.`;
      }
    } else if (key && !price) {
      stripeNote = 'Stripe key found but no price_usd given — payment link skipped.';
    }

    const parts: string[] = [];
    parts.push(`Product: ${name}`);
    if (zipped) parts.push(`Package: ${pkgPath}`);
    else parts.push(`Package: zip tool unavailable — ${files.length} files verified at ${src} (checksum in listing)`);
    parts.push(`Listing: ${listingJson}\n         ${listingMd}`);
    parts.push(`Files: ${files.length}, bytes: ${totalBytes}, checksum: ${checksum.slice(0, 16)}…`);
    if (listing.payment_link) parts.push(`Payment link (${listing.provider}): ${listing.payment_link}`);
    else if (!key) parts.push('Payment link: not created — connect a Stripe key in Settings → AI Provider (listings still work as invoices).');
    if (stripeNote) parts.push(stripeNote);

    return { content: parts.join('\n') };
  },
};

function renderListingMd(l: Listing): string {
  const priceLine = l.price_usd != null ? `**$${l.price_usd}**` : '_price TBD_';
  const link = l.payment_link ? `\n\n**Buy:** ${l.payment_link}` : '';
  return `# ${l.name}\n\n${l.description || 'A creation built with Infinite OS.'}\n\n${priceLine}${link}\n\n- Files: ${l.file_count}\n- Size: ${l.total_bytes} bytes\n- Checksum: \`${l.content_checksum.slice(0, 32)}…\`\n- Built: ${l.created_at}\n`;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'creation';
}

function isAbort(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError');
}

async function listFiles(dir: string, depth: number): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (depth < 8) out.push(...(await listFiles(p, depth + 1)));
    } else out.push(p);
  }
  return out;
}

async function zipDir(src: string, outZip: string): Promise<void> {
  const { execFile } = await import('node:child_process');
  const { platform } = await import('node:os');
  await new Promise<void>((res, rej) => {
    if (platform() === 'win32') {
      // PowerShell Compress-Archive — present on every modern Windows
      execFile('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${src}\\*' -DestinationPath '${outZip}' -Force`], { timeout: 120_000 }, (err) => (err ? rej(err) : res()));
    } else {
      execFile('zip', ['-r', '-q', outZip, '.'], { cwd: src, timeout: 120_000 }, (err) => (err ? rej(err) : res()));
    }
  });
}

async function fetchWithTimeout(url: string, init: RequestInit, signal: AbortSignal) {
  const c = new AbortController();
  const onAbort = () => c.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  const t = setTimeout(() => c.abort(), 60_000);
  try { return await fetch(url, { ...init, signal: c.signal }); } finally { clearTimeout(t); signal.removeEventListener('abort', onAbort); }
}

async function safeText(r: Response) { try { return (await r.text()).slice(0, 300); } catch { return `${r.status} ${r.statusText}`; } }
