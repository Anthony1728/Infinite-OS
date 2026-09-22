import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';

const dataDir = mkdtempSync(join(tmpdir(), 'infinite-cp-'));
const workDir = mkdtempSync(join(tmpdir(), 'infinite-cp-work-'));
vi.mock('../profiles/home.js', () => ({ infiniteHome: () => dataDir }));

import { recordFileMutation, snapshotRunCheckpoint, rewindToCheckpoint, listRunCheckpoints } from './edit-checkpoint.js';

const fileA = join(workDir, 'a.ts');
const fileB = join(workDir, 'b.ts');

describe('checkpoint-on-edit', () => {
  beforeEach(() => {
    writeFileSync(fileA, 'original A', 'utf8');
    writeFileSync(fileB, 'original B', 'utf8');
  });

  it('snapshots mutations and rewinds file state', async () => {
    recordFileMutation({ sessionId: 's1', path: fileA, operation: 'modify', originalContent: 'original A', newContent: 'edited A v1' });
    recordFileMutation({ sessionId: 's1', path: fileA, operation: 'modify', newContent: 'edited A v2' });
    recordFileMutation({ sessionId: 's1', path: fileB, operation: 'create', newContent: 'brand new B' });
    const cpId = snapshotRunCheckpoint('s1', 'test checkpoint');
    expect(cpId).toBeTruthy();
    expect(listRunCheckpoints('s1').length).toBe(1);

    // Apply the "current" state on disk…
    writeFileSync(fileA, 'edited A v2', 'utf8');
    writeFileSync(fileB, 'brand new B', 'utf8');
    // …then rewind to the checkpoint (restores originals, removes creations).
    const result = rewindToCheckpoint(cpId!);
    expect(result.success).toBe(true);
    expect(readFileSync(fileA, 'utf8')).toBe('original A');
    expect(existsSync(fileB)).toBe(false);
    expect(result.actions.join('\n')).toContain(fileB);
  });

  it('keeps sessions isolated', () => {
    recordFileMutation({ sessionId: 's2', path: fileA, operation: 'modify', originalContent: 'original A', newContent: 's2 edit' });
    const cpS2 = snapshotRunCheckpoint('s2');
    expect(cpS2).toBeTruthy();
    // A fresh session's mutation list is its own; s1 only sees its own files.
    recordFileMutation({ sessionId: 's1', path: fileB, operation: 'modify', originalContent: 'original B', newContent: 's1 edit' });
    const s1CpId = snapshotRunCheckpoint('s1');
    expect(s1CpId).toBeTruthy();
    expect(s1CpId).not.toBe(cpS2);
  });

  it('returns null when nothing was mutated', () => {
    expect(snapshotRunCheckpoint('no-mutations')).toBeNull();
  });

  afterAll(() => {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  });
});
