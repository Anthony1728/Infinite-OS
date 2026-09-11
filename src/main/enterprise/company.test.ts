import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let home = '';
const savedHome = process.env.INFINITE_TEST_HOME;

beforeEach(() => {
  vi.resetModules();
  home = mkdtempSync(join(tmpdir(), 'company-'));
  process.env.INFINITE_TEST_HOME = home;
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.INFINITE_TEST_HOME;
  else process.env.INFINITE_TEST_HOME = savedHome;
  if (home) rmSync(home, { recursive: true, force: true });
  home = '';
});

describe('company board', () => {
  it('starts empty, updates profile, and round-trips notes', async () => {
    const c = await import('./company.js');
    expect(c.getCompany().name).toBe('');
    expect(c.getCompany().notes).toEqual([]);

    const updated = c.updateCompany({ name: 'Acme Plumbing', industry: 'Trades' });
    expect(updated.name).toBe('Acme Plumbing');
    expect(updated.industry).toBe('Trades');

    const note = c.addCompanyNote('Customer complained about late arrival', 'complaint', 'agent');
    expect(note.by).toBe('agent');
    expect(c.getCompany().notes).toHaveLength(1);

    expect(c.deleteCompanyNote('nope')).toBe(false);
    expect(c.deleteCompanyNote(note.id)).toBe(true);
    expect(c.getCompany().notes).toEqual([]);
    // Profile survives note deletion.
    expect(c.getCompany().name).toBe('Acme Plumbing');
  });

  it('tolerates corrupt files', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(join(home, 'enterprise'), { recursive: true });
    writeFileSync(join(home, 'enterprise', 'company.json'), '{broken', 'utf8');
    const c = await import('./company.js');
    expect(c.getCompany().name).toBe('');
  });
});
