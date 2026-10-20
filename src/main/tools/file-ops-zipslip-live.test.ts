import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileOpsTool } from './file-ops.js';
import type { ToolContext } from './base.js';

/**
 * End-to-end proof that a real "zip slip" archive is refused.
 *
 * The unit tests cover the containment rule; this builds an actual archive
 * with a traversal entry and runs it through the tool, because the failure
 * this guards against is only real if the archive is real. The archive is made
 * with .NET's ZipArchive, the same library the tool reads entries with.
 */

let base = '';
let zipPath = '';

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'infinite-zipslip-'));
  zipPath = join(base, 'evil.zip');

  // Build the archive from a script file: inline -Command quoting does not
  // survive the trip through a test runner reliably.
  const script = join(base, 'make.ps1');
  writeFileSync(
    script,
    [
      'param([string]$ZipPath)',
      'Add-Type -AssemblyName System.IO.Compression.FileSystem',
      'if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }',
      '$zip = [System.IO.Compression.ZipFile]::Open($ZipPath, "Create")',
      'try {',
      '  foreach ($p in @(@("../escaped.txt","pwned"), @("ok.txt","fine"), @("nested/deep.txt","there"))) {',
      '    $e = $zip.CreateEntry($p[0]); $s = $e.Open()',
      '    $b = [System.Text.Encoding]::UTF8.GetBytes($p[1]); $s.Write($b,0,$b.Length); $s.Close()',
      '  }',
      '} finally { $zip.Dispose() }',
    ].join('\n'),
    'utf8',
  );
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-ZipPath', zipPath], {
    stdio: 'ignore',
    timeout: 60_000,
  });
}, 120_000);

afterAll(() => {
  if (base) { try { rmSync(base, { recursive: true, force: true }); } catch { /* best-effort */ } }
});

function ctx(cwd: string): ToolContext {
  return {
    cwd,
    abortSignal: new AbortController().signal,
    sessionId: 'test',
    onUpdate: () => undefined,
  } as unknown as ToolContext;
}

describe('FileOps extract refuses a zip-slip archive', () => {
  it('refuses an archive whose entry escapes the destination', async () => {
    const dest = join(base, 'out');

    const result = await fileOpsTool.execute(
      { action: 'extract', path: zipPath, destination: dest },
      ctx(base),
    );

    expect(result.is_error, 'the malicious archive was accepted').toBe(true);
    expect(result.content).toMatch(/outside/i);
    // This wording comes from the pre-extraction check, not from PowerShell:
    // reaching Expand-Archive would surface a "File operation failed" wrapper.
    expect(result.content).toMatch(/Nothing was extracted/i);
    // Nothing written — not the escaping file, and not even the folder.
    expect(existsSync(join(base, 'escaped.txt')), 'the escaping entry was written').toBe(false);
    expect(existsSync(dest), 'destination was created despite the refusal').toBe(false);
  }, 90_000);

  it('refuses an archive that would overwrite a protected file', async () => {
    // The traversal test above proves the tool's own refusal: the error text
    // comes from `resolveExtractTarget`, and the destination is never created,
    // so `Expand-Archive` was not given the archive. PowerShell 5.1 would also
    // reject `../` on its own, but that behaviour is not what this test relies
    // on — and it cannot help here. This entry stays entirely inside the
    // destination and lands on src/main/audit/, the append-only record of what
    // the agent did. PowerShell has no concept of a protected path.
    //
    // Verified directly on this machine — raw `Expand-Archive` planted a file
    // in the audit directory with no traversal at all, because PowerShell has
    // no concept of a protected path. Only the tool's own guard stops it.
    const repoRoot = process.cwd();
    const planted = join(repoRoot, 'src', 'main', 'audit', 'planted-by-extract.ts');
    const script = join(base, 'make-protected.ps1');
    const protZip = join(base, 'protected.zip');
    writeFileSync(
      script,
      [
        'param([string]$ZipPath)',
        'Add-Type -AssemblyName System.IO.Compression.FileSystem',
        'if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }',
        '$zip = [System.IO.Compression.ZipFile]::Open($ZipPath, "Create")',
        'try {',
        '  $e = $zip.CreateEntry("src/main/audit/planted-by-extract.ts"); $s = $e.Open()',
        '  $b = [System.Text.Encoding]::UTF8.GetBytes("// planted"); $s.Write($b,0,$b.Length); $s.Close()',
        '} finally { $zip.Dispose() }',
      ].join('\n'),
      'utf8',
    );
    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-ZipPath', protZip], {
      stdio: 'ignore',
      timeout: 60_000,
    });

    const result = await fileOpsTool.execute(
      { action: 'extract', path: protZip, destination: repoRoot },
      ctx(repoRoot),
    );

    expect(result.is_error, 'the archive was allowed to overwrite a protected file').toBe(true);
    expect(existsSync(planted), 'a file was planted inside the protected audit directory').toBe(false);
  }, 90_000);
});

describe('FileOps extract still works normally', () => {
  it('extracts an ordinary archive', async () => {
    const script = join(base, 'make-good.ps1');
    const goodZip = join(base, 'good.zip');
    writeFileSync(
      script,
      [
        'param([string]$ZipPath)',
        'Add-Type -AssemblyName System.IO.Compression.FileSystem',
        '$zip = [System.IO.Compression.ZipFile]::Open($ZipPath, "Create")',
        'try {',
        '  foreach ($p in @(@("hello.txt","hi"), @("nested/deep.txt","there"))) {',
        '    $e = $zip.CreateEntry($p[0]); $s = $e.Open()',
        '    $b = [System.Text.Encoding]::UTF8.GetBytes($p[1]); $s.Write($b,0,$b.Length); $s.Close()',
        '  }',
        '} finally { $zip.Dispose() }',
      ].join('\n'),
      'utf8',
    );
    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-ZipPath', goodZip], {
      stdio: 'ignore',
      timeout: 60_000,
    });

    const dest = join(base, 'good-out');
    const result = await fileOpsTool.execute(
      { action: 'extract', path: goodZip, destination: dest },
      ctx(base),
    );

    expect(result.is_error, String(result.content)).toBeFalsy();
    expect(readFileSync(join(dest, 'hello.txt'), 'utf8')).toBe('hi');
    expect(readFileSync(join(dest, 'nested', 'deep.txt'), 'utf8')).toBe('there');
  }, 90_000);
});