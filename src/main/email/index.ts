// Email Engine — IMAP read + SMTP send via imapflow & nodemailer
// Runs in main process — uses file-based config storage

import { ImapFlow, type MailboxObject } from 'imapflow';
import nodemailer from 'nodemailer';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { infiniteHome } from '../profiles/home.js';
import { safeStorage } from 'electron';
import { getCredentials } from '../security/encryption.js';

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

const CONFIG_DIR = join(infiniteHome());
const CONFIG_FILE = join(CONFIG_DIR, 'email.json');

type StoredEmailConfig = Omit<EmailConfig, 'password'> & {
  passwordEncrypted?: string;
  credentialId?: string;
  password?: string;
};

async function readStoredConfig(): Promise<StoredEmailConfig | null> {
  try {
    return JSON.parse(await readFile(CONFIG_FILE, 'utf8')) as StoredEmailConfig;
  } catch {
    return null;
  }
}

async function getConfig(): Promise<EmailConfig | null> {
  const stored = await readStoredConfig();
  if (!stored) return null;
  let password = '';
  if (stored.passwordEncrypted && safeStorage.isEncryptionAvailable()) {
    password = safeStorage.decryptString(Buffer.from(stored.passwordEncrypted, 'base64'));
  } else if (stored.credentialId) {
    password = getCredentials().getCredential(stored.credentialId) ?? '';
  } else if (stored.password) {
    // One-time migration from the legacy plaintext format.
    password = stored.password;
    await saveEmailConfig({ ...stored, password } as EmailConfig);
  }
  if (!password) return null;
  return {
    imapHost: stored.imapHost,
    imapPort: stored.imapPort,
    imapSecure: stored.imapSecure,
    smtpHost: stored.smtpHost,
    smtpPort: stored.smtpPort,
    smtpSecure: stored.smtpSecure,
    user: stored.user,
    password,
  };
}

async function getClient(config: EmailConfig): Promise<ImapFlow> {
  const client = new ImapFlow({
    host: config.imapHost,
    port: config.imapPort,
    secure: config.imapSecure,
    auth: { user: config.user, pass: config.password },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  // ImapFlow can emit a late socket error after connect/logout. Always keep an
  // error listener attached so a mail outage is returned to the caller rather
  // than becoming an uncaught Electron main-process exception.
  client.on('error', (error: Error) => {
    console.warn(`[email] IMAP client error (${config.imapHost}): ${error.message}`);
  });
  try {
    await client.connect();
    return client;
  } catch (error) {
    await client.logout().catch(() => undefined);
    throw error;
  }
}

async function closeClient(client: ImapFlow): Promise<void> {
  await client.logout().catch((error: unknown) => {
    console.warn(`[email] IMAP logout failed: ${error instanceof Error ? error.message : String(error)}`);
  });
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

/**
 * Map raw IMAP/SMTP error messages to actionable, user-friendly guidance.
 * Preserves the original detail while adding provider-specific hints.
 */
function humanizeEmailError(raw: string, config: EmailConfig): string {
  const lower = raw.toLowerCase();
  const host = (config.smtpHost || config.imapHost || '').toLowerCase();

  // Authentication failures — most common for Gmail/Outlook/Yahoo with 2FA
  if (
    lower.includes('auth') ||
    lower.includes('invalid credentials') ||
    lower.includes('login') ||
    lower.includes('password') ||
    lower.includes('command failed')
  ) {
    if (host.includes('gmail') || host.includes('google')) {
      return `${raw}\n\nGmail requires an App Password when two-factor authentication is enabled. Generate one at https://myaccount.google.com/apppasswords and use the app password (not your regular Gmail password).`;
    }
    if (host.includes('outlook') || host.includes('office365') || host.includes('microsoft')) {
      return `${raw}\n\nOutlook/Microsoft 365 may require an App Password if two-factor authentication is enabled. Check your Microsoft account security settings.`;
    }
    if (host.includes('yahoo')) {
      return `${raw}\n\nYahoo requires an App Password for third-party apps. Generate one at https://login.yahoo.com/myaccount/security then App passwords.`;
    }
    return `${raw}\n\nThe username or password was rejected. If two-factor authentication is enabled, use an app-specific password instead of your regular password.`;
  }

  // Connection / network failures
  if (
    lower.includes('econnrefused') ||
    lower.includes('econnreset') ||
    lower.includes('timeout') ||
    lower.includes('enotfound') ||
    lower.includes('getaddrinfo')
  ) {
    return `${raw}\n\nCould not reach the mail server. Check your internet connection and verify the IMAP/SMTP host and port are correct.`;
  }

  // TLS / certificate issues
  if (
    lower.includes('certificate') ||
    lower.includes('ssl') ||
    lower.includes('tls') ||
    lower.includes('handshake')
  ) {
    return `${raw}\n\nTLS/SSL handshake failed. Verify the port and security settings match your provider (port 993/465 = SSL, port 587 = STARTTLS).`;
  }

  return raw;
}

export async function testConnection(config: EmailConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    const client = await getClient(config);
    await closeClient(client);
    const smtp = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      auth: { user: config.user, pass: config.password },
    });
    await smtp.verify();
    return { ok: true };
  } catch (e: unknown) {
    const error = e instanceof Error ? e : new Error(String(e));
    const raw = error.message || 'Connection failed';
    return { ok: false, error: humanizeEmailError(raw, config) };
  }
}

export async function listEmails(folder = 'INBOX', limit = 20): Promise<EmailMessage[]> {
  const config = await getConfig();
  if (!config) throw new Error('Email not configured. Go to Settings -> Email to set up.');

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
    await closeClient(client);
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
    await closeClient(client);
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
  const current = await readStoredConfig();
  const { password, ...metadata } = config;
  const stored: StoredEmailConfig = { ...metadata };
  if (password) {
    if (safeStorage.isEncryptionAvailable()) {
      stored.passwordEncrypted = safeStorage.encryptString(password).toString('base64');
    } else {
      const credentialId = 'email:primary-password';
      getCredentials().saveCredential(credentialId, 'email', password);
      stored.credentialId = credentialId;
    }
  } else if (current?.passwordEncrypted) {
    stored.passwordEncrypted = current.passwordEncrypted;
  } else if (current?.credentialId) {
    stored.credentialId = current.credentialId;
  } else {
    throw new Error('Email password is required.');
  }
  await writeFile(CONFIG_FILE, JSON.stringify(stored, null, 2), { encoding: 'utf8', mode: 0o600 });
  transporter = null; // reset cached transporter
  lastConfigUser = '';
}

export async function getEmailConfig(): Promise<EmailConfig | null> {
  const config = await getConfig();
  return config ? { ...config, password: '' } : null;
}

export async function hasEmailConfig(): Promise<boolean> {
  return (await getConfig()) !== null;
}
