import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BusinessOS } from './crm.js';

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), 'business-emails-'));
}

describe('business emails', () => {
  it('round-trips sent emails across restarts', () => {
    const dir = freshDir();
    try {
      const first = new BusinessOS({ dataDir: dir });
      expect(first.listEmails()).toEqual([]);
      const saved = first.saveEmail({ from: 'me', to: 'client@example.com', subject: 'Quote', body: 'Here is your quote for tomorrow.' });
      expect(saved.id).toBeTruthy();
      expect(saved.preview).toBe('Here is your quote for tomorrow.');

      const second = new BusinessOS({ dataDir: dir });
      const listed = second.listEmails();
      expect(listed).toHaveLength(1);
      expect(listed[0].subject).toBe('Quote');

      // Read-state survives, delete works.
      second.saveEmail({ id: saved.id, from: 'me', to: 'client@example.com', subject: 'Quote', body: saved.body, read: true });
      expect(second.deleteEmail('missing')).toBe(false);
      expect(second.deleteEmail(saved.id)).toBe(true);
      expect(new BusinessOS({ dataDir: dir }).listEmails()).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not clobber contacts/deals files', () => {
    const dir = freshDir();
    try {
      const bos = new BusinessOS({ dataDir: dir });
      bos.createContact({ name: 'Zed', email: 'zed@example.com' });
      bos.saveEmail({ from: 'me', to: 'zed@example.com', subject: 'Hi', body: 'hello' });
      expect(existsSync(join(dir, 'contacts.json'))).toBe(true);
      expect(existsSync(join(dir, 'emails.json'))).toBe(true);
      const reloaded = new BusinessOS({ dataDir: dir });
      expect(reloaded.listContacts()).toHaveLength(1);
      expect(reloaded.listEmails()).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
