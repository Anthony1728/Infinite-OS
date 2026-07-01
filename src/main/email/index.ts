// Email Engine — IMAP read + SMTP send via imapflow & nodemailer
// Runs in main process — uses file-based config storage

import { ImapFlow, type MailboxObject } from 'imapflow';
import nodemailer from 'nodemailer';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface EmailConfig {
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  user: string;
  password: string;
}

export interface EmailMessage {
  id: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  text: string;
  html?: string;
  isRead: boolean;
  hasAttachments: boolean;
}

import type { Transporter } from 'nodemailer';

let transporter: Transporter | null = null;
let lastConfigUser = '';

const CONFIG_DIR = join(homedir(), '.infinite-ai');
const CONFIG_FILE = join(CONFIG_DIR, 'email.json');

async function getConfig(): Promise<EmailConfig | null> {
  try {
    const raw = await readFile(CONFIG_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function getClient(config: EmailConfig): Promise<ImapFlow> {
  const client = new ImapFlow({
    host: config.imapHost,
    port: config.imapPort,
    secure: config.imapSecure,
    auth: { user: config.user, pass: config.password },
    logger: false,
  });
  await client.connect();
  return client;
}

function getTransporter(config: EmailConfig): Transporter {
  if (transporter && lastConfigUser === config.user) return transporter;
  transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: { user: config.user, pass: config.password },
  });
  lastConfigUser = config.user;
  return transporter;
}

interface EmailAddress {
  name?: string;
  mailbox?: string;
  host?: string;
}

function formatAddr(addr: EmailAddress[] | EmailAddress | undefined): string {
  if (!addr) return 'unknown';
  const addresses = Array.isArray(addr) ? addr : [addr];
  return addresses.map((f) => {
    const name = f.name || '';
    const mailbox = f.mailbox || '';
    const host = f.host || '';
    return name ? `${name} <${mailbox}@${host}>` : `${mailbox}@${host}`;
  }).join(', ');
}

export async function testConnection(config: EmailConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    const client = await getClient(config);
    await client.logout();
    return { ok: true };
  } catch (e: unknown) {
    const error = e instanceof Error ? e : new Error(String(e));
    return { ok: false, error: error.message || 'Connection failed' };
  }
}

export async function listEmails(folder = 'INBOX', limit = 20): Promise<EmailMessage[]> {
  const config = await getConfig();
  if (!config) throw new Error('Email not configured. Go to Settings → Email to set up.');

  const client = await getClient(config);
  const emails: EmailMessage[] = [];

  try {
    const lock = await client.getMailboxLock(folder);
    try {
      const mailbox: MailboxObject | false = client.mailbox;
      const total = mailbox ? (mailbox as { exists?: number }).exists ?? 0 : 0;
      if (total === 0) return [];

      const from = Math.max(1, total - limit + 1);
      for await (const message of client.fetch(`${from}:${total}`, {
        envelope: true,
        bodyStructure: true,
        uid: true,
        flags: true,
      })) {
        const isRead = message.flags?.has?.('\\Seen') ?? false;
        const bs = message.bodyStructure as { type?: string; child?: Array<{ disposition?: string }> } | undefined;
        const hasAttach = bs?.type === 'multipart/mixed' ||
          (Array.isArray(bs?.child) && bs.child.some((c) => c.disposition === 'attachment'));
        emails.push({
          id: String(message.uid ?? ''),
          from: formatAddr(message.envelope?.from),
          to: formatAddr(message.envelope?.to),
          subject: message.envelope?.subject || '(no subject)',
          date: message.envelope?.date?.toISOString?.() || '',
          text: '',
          html: '',
          isRead,
          hasAttachments: !!hasAttach,
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }

  return emails.reverse();
}

export async function readEmail(uid: string, folder = 'INBOX'): Promise<EmailMessage> {
  const config = await getConfig();
  if (!config) throw new Error('Email not configured.');

  const client = await getClient(config);
  try {
    const lock = await client.getMailboxLock(folder);
    try {
      const message = await client.fetchOne(uid, {
        source: true,
        bodyStructure: true,
        envelope: true,
        uid: true,
        flags: true,
      }, { uid: true });

      if (!message) throw new Error('Email not found');

      const body = message.source?.toString() || '';
      const text = body.replace(/Content-Type:.*?\r?\n\r?\n[\s\S]*?\r?\n--/g, '').trim().slice(0, 5000);
      const isRead = message.flags?.has?.('\\Seen') ?? false;

      return {
        id: String(message.uid ?? ''),
        from: formatAddr(message.envelope?.from),
        to: formatAddr(message.envelope?.to),
        subject: message.envelope?.subject || '(no subject)',
        date: message.envelope?.date?.toISOString?.() || '',
        text,
        isRead,
        hasAttachments: false,
      };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

export async function sendEmail(to: string, subject: string, text: string, inReplyTo?: string): Promise<{ ok: boolean; error?: string }> {
  const config = await getConfig();
  if (!config) throw new Error('Email not configured.');

  try {
    const transport = getTransporter(config);
    await transport.sendMail({
      from: config.user,
      to,
      subject,
      text,
      inReplyTo: inReplyTo || undefined,
    });
    return { ok: true };
  } catch (e: unknown) {
    const error = e instanceof Error ? e : new Error(String(e));
    return { ok: false, error: error.message || 'Send failed' };
  }
}

export async function saveEmailConfig(config: EmailConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  transporter = null; // reset cached transporter
}

export async function getEmailConfig(): Promise<EmailConfig | null> {
  return getConfig();
}

export async function hasEmailConfig(): Promise<boolean> {
  return (await getConfig()) !== null;
}

