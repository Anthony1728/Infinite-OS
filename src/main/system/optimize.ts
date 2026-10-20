// What is actually making this PC slow, and what is safe to do about it.
//
// WHY THIS IS BUILT AS ANALYSIS-FIRST
//
// "Make my PC fast" is easy to implement and easy to get catastrophically wrong.
// The failure mode is never slowness — it is killing something load-bearing:
// Defender, the licence service that keeps Office activated, the audio driver, the
// user's IDE, the backup tool, or the browser they are looking at. A tool that
// guesses "unnecessary" and acts on it is worse than no tool at all.
//
// So nothing here decides anything on a guess. Every finding is a measurement,
// every item is classified by what is KNOWN about it, and the classification
// decides who is allowed to act.
//
// THE THREE TIERS
//
//   safe   — reversed with one click and cannot lose data: a startup entry that
//            was re-enabled from a saved value, temp files inside an actual temp
//            directory, a known-junk background updater. Applied automatically.
//   ask    — real speed, real downside, needs a human: disabling a Windows
//            service, ending a process that is using a lot of memory. One click,
//            per item.
//   report — never acted on automatically: installed programs, large files,
//            anything we cannot positively identify. Informational only.
//
// THE INVENTORY RULE
//
// If we cannot name it, we do not touch it. Every entry carries the evidence that
// produced it, so a wrong verdict is visible and correctable rather than silent.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export type Tier = 'safe' | 'ask' | 'report';

export interface Finding {
  /** Stable id, so an undo can match it and a dismissal sticks. */
  id: string;
  title: string;
  detail: string;
  tier: Tier;
  /** What the user gives up by acting. Empty for `safe`. */
  tradeoff?: string;
  /** Measured cost, so the list is ordered by real impact rather than a guess. */
  impact: number;
  /** How the impact was measured, shown in the UI. Never invented. */
  evidence: string;
  action?: OptimizationAction;
}

export interface OptimizationAction {
  kind: 'disable-startup' | 'stop-task' | 'clean-temp' | 'set-service' | 'stop-process';
  /** Startup registry value, scheduled task name, service name, or process name. */
  target: string;
  /** Where it was, and how it was launched. */
  location?: string;
  command?: string;
  /** For services. */
  startupType?: 'disabled' | 'manual';
}

/** A startup item as Windows reports it. */
export interface StartupItem {
  source: 'HKCU' | 'HKLM' | 'HKLM32' | 'startup-folder' | 'task';
  name: string;
  command: string;
  location: string;
  enabled: boolean;
}

// ── Known-good / known-bad knowledge ────────────────────────────────────────

/**
 * Windows components that are almost always safe to stop at boot and are the
 * classic "why is my PC slow out of the box" wins.
 *
 * `costIfStopped` is stated honestly, including where stopping it is a bad trade.
 */
const OPTIONAL_SERVICES: Record<string, { label: string; tradeoff: string; impact: number }> = {
  SysMain: {
    label: 'SysMain (SysMain / Superfetch)',
    tradeoff: 'Prefetch is disabled, so large apps may take slightly longer to start the first time. On an SSD this is rarely noticeable; on a spinning disk it is worse.',
    impact: 35,
  },
  WSearch: {
    label: 'Windows Search indexing',
    tradeoff: 'File-name search in Start and Explorer gets slower or stops updating until re-enabled. Search inside apps that use it may not work.',
    impact: 30,
  },
  XboxNetApiSvc: {
    label: 'Xbox Live networking',
    tradeoff: 'Only matters if you use Xbox or Game Pass.',
    impact: 12,
  },
  Spooler: {
    label: 'Print Spooler',
    tradeoff: 'You will not be able to print until this is turned back on.',
    impact: 10,
  },
};

/**
 * Never touched. These are load-bearing in ways that are easy to get wrong, and
 * the cost of being wrong is a machine that does not boot properly or a security
 * system that silently stops protecting the user.
 */
const PROTECTED = [
  'WinDefend',
  'WdNisSvc',
  'SecurityHealthService',
  'wscsvc',
  'MpsSvc',
  'TrustedInstaller',
  'wuauserv',
  'CryptSvc',
  'DcomLaunch',
  'RpcSs',
  'EventLog',
  'PlugPlay',
  'Power',
  'ProfSvc',
  'LicenseManager',
  'sppsvc',
];
const PROTECTED_SERVICES = new Set(PROTECTED.map((name) => name.toLowerCase()));

/**
 * Startup entries that are recognisably pointless on THIS machine, or junk
 * regardless of machine.
 *
 * An AMD tuning utility on an Intel CPU is the clearest example of something
 * that cannot be doing anything useful: it is not a judgement call, it is a
 * factual mismatch.
 */
export function classifyStartup(item: StartupItem, cpuVendor: string): Tier {
  const name = item.name.toLowerCase();
  const command = item.command.toLowerCase();

  // Factually pointless: vendor tuning tool for the wrong CPU.
  const isAmdTool = /amd_dc_opt|amd.*dual-core|ryzen.*master/.test(name) || /amd.*(dual|overclock|tune)/.test(command);
  if (isAmdTool && !/amd/i.test(cpuVendor)) {
    return 'safe';
  }

  // A VPN client auto-launching is both a boot cost and a privacy question.
  //
  // This MUST come before the generic updater rule below. A VPN "updater"
  // matches both patterns, and when the updater rule won it was classified as
  // safe — meaning the app would have silently disabled somebody's VPN without
  // asking. A test covers the ordering.
  if (/vpn|proxifier|windscribe|nordvpn|urbanvpn/.test(name) || /\bvpn\b/.test(command)) {
    return 'ask';
  }

  // Updaters for tools the user did not ask to run constantly. These check for
  // new versions on every boot and then exit; harmless individually, but they
  // are pure boot-time delay.
  if (/\bupdatechecker\b|\bupdater\b|\bupdate\.exe\b/.test(command) && !/oneclick|ondedemand/i.test(name)) {
    return 'safe';
  }

  // Advertising / sale campaigns from cleanup utilities. Pure noise.
  if (/iobit.*(sale|promo)|summ?2026sale/.test(name)) {
    return 'safe';
  }

  // Background browser relaunchers are the textbook safe disable: the browser is
  // not open, nothing is lost, and it does not come back until the user opens it.
  if (/edgeautolaunch|edge.*background|browser.*background|chrome.*background/.test(name)) {
    return 'safe';
  }

  // Security and backup agents are the user's choice, never automatic.
  if (/backup|antivirus|security|defender|sophos|norton|mcafee|kaspersky|bitdefender/.test(name)) {
    return 'ask';
  }

  // Cloud sync: people rely on it. Ask, never automatic.
  if (/onedrive|dropbox|googledrive|icloud/.test(name)) {
    return 'ask';
  }

  // Game launchers are heavy and only needed when playing.
  if (/steam|epic|rockstar|battle\.net|ubisoft|origin|ea\b|riot/.test(name)) {
    return 'ask';
  }

  // Anything we cannot positively identify. This is the rule that matters most:
  // an unknown startup entry is not a licence to remove it.
  return 'report';
}

/**
 * Anything load-bearing in memory must not be reported as waste.
 *
 * Case-insensitive on purpose: Windows service and process names are, and a
 * case-sensitive comparison here is exactly how `WinDefend` stops matching and
 * Windows Defender quietly becomes a candidate for "unnecessary".
 */
export function isProtectedProcess(name: string): boolean {
  const lowered = name.toLowerCase();
  if (PROTECTED_SERVICES.has(lowered)) return true;
  return /^(system|registry|system idle|smss|csrss|wininit|winlogon|lsass|services|svchost|dwm|explorer|taskhostw|memory compression)$/i.test(name);
}

/**
 * A process is only a candidate if it is genuinely heavy AND not something the
 * user is looking at.
 */
export function classifyProcess(
  process: { name: string; cpuPercent: number; memoryMb: number },
  opts: { cpuThreshold?: number; memoryThresholdMb?: number; protected?: string[] } = {},
): Tier {
  if (isProtectedProcess(process.name)) return 'report';
  if ((opts.protected ?? []).some((p) => p.toLowerCase() === process.name.toLowerCase())) return 'report';

  const cpu = opts.cpuThreshold ?? 3;
  const mem = opts.memoryThresholdMb ?? 400;
  const heavy = process.cpuPercent >= cpu || process.memoryMb >= mem;
  if (!heavy) return 'report';

  // Ending a process loses whatever it was doing, so this is always a human
  // decision — no matter how heavy it is.
  return 'ask';
}

/**
 * Temp directories that are safe to clear because Windows recreates them.
 *
 * The list is deliberately narrow. Adding a path here is a decision to let the
 * app delete files in that location, so a wrong entry destroys user data.
 */
export const SAFE_TEMP_DIRS = [
  { path: '%TEMP%', label: 'Your temp folder' },
  { path: '%LOCALAPPDATA%\\Temp', label: 'Local temp' },
  { path: '%WINDIR%\\Temp', label: 'Windows temp' },
];

/** Never touched, whatever their size. */
const NEVER_CLEAN = [
  '\\Downloads',
  '\\Documents',
  '\\Desktop',
  '\\Pictures',
  '\\Videos',
  '\\Music',
  'OneDrive',
];

/**
 * Refuse any path that is not inside a known temp directory.
 *
 * This is a hard boundary rather than a check that reports "unsafe": the caller
 * gets `null` and deletes nothing. It is the last line of defence behind the
 * allow-list above.
 */
export function isSafeTempPath(candidate: string, roots: string[]): boolean {
  const lowered = candidate.toLowerCase();
  if (NEVER_CLEAN.some((fragment) => lowered.includes(fragment.toLowerCase()))) return false;
  return roots.some((root) => {
    const normalisedRoot = root.toLowerCase().replace(/[\\/]+$/, '');
    // Require a real path boundary so `C:\TempEvil` does not pass for `C:\Temp`.
    return lowered === normalisedRoot || lowered.startsWith(normalisedRoot + '\\') || lowered.startsWith(normalisedRoot + '/');
  });
}

// ── Measurement ─────────────────────────────────────────────────────────────

/** Run a PowerShell probe and return parsed JSON, or [] if anything goes wrong. */
async function probe<T>(script: string): Promise<T[]> {
  try {
    const { stdout } = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', timeout: 20_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
    );
    const text = stdout.trim();
    if (!text) return [];
    const parsed: unknown = JSON.parse(text);
    return (Array.isArray(parsed) ? parsed : [parsed]) as T[];
  } catch {
    // A probe that fails yields nothing to report, which is the safe outcome.
    return [];
  }
}

interface ProcessSample {
  Name: string;
  Id: number;
  CPUSeconds: number;
  WorkingSetMB: number;
  MainWindowTitle?: string;
}

/**
 * Sample CPU over a window.
 *
 * `Get-Process.CPU` is cumulative seconds since start, so a single read tells you
 * nothing about current usage — it mostly measures how long a process has
 * existed. Two reads with a gap between them is the only honest way, which is
 * why this takes `windowMs` and cannot be instant.
 */
export async function sampleProcesses(windowMs = 3000): Promise<
  Array<{ name: string; pid: number; cpuPercent: number; memoryMb: number; windowTitle?: string }>
> {
  const first = await probe<ProcessSample>(
    'Get-Process | Select-Object Name,Id,CPU,@{n="WorkingSetMB";e={[math]::Round($_.WorkingSet64/1MB)}},MainWindowTitle | ConvertTo-Json -Compress',
  );
  if (first.length === 0) return [];
  await new Promise((resolve) => setTimeout(resolve, windowMs));
  const second = await probe<ProcessSample>(
    'Get-Process | Select-Object Name,Id,CPU,@{n="WorkingSetMB";e={[math]::Round($_.WorkingSet64/1MB)}},MainWindowTitle | ConvertTo-Json -Compress',
  );

  const before = new Map(first.map((p) => [p.Id, p]));
  const cores = 1;
  const results: Array<{ name: string; pid: number; cpuPercent: number; memoryMb: number; windowTitle?: string }> = [];
  for (const p of second) {
    const b = before.get(p.Id);
    if (!b || b.CPUSeconds == null || p.CPUSeconds == null) continue;
    const delta = p.CPUSeconds - b.CPUSeconds;
    // delta is seconds of CPU across all cores; normalise to a percentage of one
    // core so the number reads like Task Manager.
    const cpuPercent = Math.max(0, (delta / (windowMs / 1000)) * 100);
    if (cpuPercent < 0.5 && p.WorkingSetMB < 250) continue;
    results.push({
      name: p.Name,
      pid: p.Id,
      cpuPercent: Math.round(cpuPercent * 10) / 10,
      memoryMb: p.WorkingSetMB,
      windowTitle: p.MainWindowTitle || undefined,
    });
  }
  void cores;
  return results.sort((a, b) => b.cpuPercent - a.cpuPercent || b.memoryMb - a.memoryMb);
}

/** Read every startup entry Windows knows about. */
export async function listStartupItems(): Promise<StartupItem[]> {
  const script = `
$items = @()
foreach ($p in @(
  @{n='HKCU'; k='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'},
  @{n='HKLM'; k='HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'},
  @{n='HKLM32'; k='HKLM:\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run'}
)) {
  if (Test-Path $p.k) {
    $o = Get-ItemProperty $p.k
    foreach ($prop in $o.PSObject.Properties) {
      if ($prop.Name -like 'PS*') { continue }
      $items += [pscustomobject]@{
        source = $p.n; name = $prop.Name; command = [string]$prop.Value; location = $p.k
      }
    }
  }
}
$sf = [Environment]::GetFolderPath('Startup')
Get-ChildItem $sf -ErrorAction SilentlyContinue | ForEach-Object {
  $items += [pscustomobject]@{
    source = 'startup-folder'; name = $_.BaseName; command = $_.FullName; location = $sf
  }
}
Get-ScheduledTask -ErrorAction SilentlyContinue |
  Where-Object { $_.State -ne 'Disabled' -and $_.TaskPath -notlike '\\Microsoft\\*' -and ($_.Triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger' }) } |
  ForEach-Object {
    $items += [pscustomobject]@{
      source = 'task'; name = $_.TaskName; command = ($_.Actions | Select-Object -First 1).Execute; location = $_.TaskPath
    }
  }
$items | ConvertTo-Json -Compress
`;
  const rows = await probe<StartupItem>(script);
  return rows.map((r) => ({ ...r, enabled: true }));
}

/** Running services with their start mode. */
export async function listServices(): Promise<Array<{ name: string; displayName: string; startMode: string; state: string }>> {
  return probe(
    'Get-CimInstance Win32_Service | Select-Object Name,DisplayName,StartMode,State | ConvertTo-Json -Compress',
  );
}

/** CPU vendor string, used to spot tools for the wrong processor. */
export async function cpuVendor(): Promise<string> {
  const rows = await probe<{ Name: string }>('Get-CimInstance Win32_Processor | Select-Object Name | ConvertTo-Json -Compress');
  return rows[0]?.Name ?? '';
}

/** Total bytes sitting in a directory, and the file count. */
export async function directorySize(path: string): Promise<{ bytes: number; files: number }> {
  const escaped = path.replace(/'/g, "''");
  const rows = await probe<{ Bytes: number; Files: number }>(
    `if (Test-Path '${escaped}') { $m = Get-ChildItem -LiteralPath '${escaped}' -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum; [pscustomobject]@{ Bytes = [int64]($m.Sum); Files = [int]$m.Count } | ConvertTo-Json -Compress }`,
  );
  return { bytes: Number(rows[0]?.Bytes ?? 0), files: Number(rows[0]?.Files ?? 0) };
}

/** Processes that currently have a visible window — i.e. what the user is using. */
export async function foregroundProcessNames(): Promise<string[]> {
  const rows = await probe<{ Name: string }>(
    'Get-Process | Where-Object { $_.MainWindowTitle -ne "" } | Select-Object -ExpandProperty Name -Unique | ConvertTo-Json -Compress',
  );
  return rows.map((r) => r.Name).filter(Boolean);
}

/**
 * Build the full picture.
 *
 * `busyNames` is what the user currently has open. Anything related is left
 * strictly alone — the whole point is to make the PC feel fast while they work,
 * not to close the thing they are working in. When the caller does not supply it,
 * the list is read from the running processes' window titles, because only the OS
 * knows which windows are real.
 */
export async function analyse(opts: { busyNames?: string[]; cpuVendor?: string } = {}): Promise<Finding[]> {
  const vendor = opts.cpuVendor ?? (await cpuVendor());
  const busy = (opts.busyNames ?? (await foregroundProcessNames())).map((n) => n.toLowerCase());
  const findings: Finding[] = [];

  // Startup entries.
  const startup = await listStartupItems();
  for (const item of startup) {
    let tier = classifyStartup(item, vendor);
    // Never touch anything that looks like what the user has open right now.
    if (busy.some((b) => item.name.toLowerCase().includes(b) || item.command.toLowerCase().includes(b))) {
      tier = 'report';
    }
    findings.push({
      id: `startup:${item.location}:${item.name}`,
      title: item.name,
      detail: item.command,
      tier,
      tradeoff:
        tier === 'safe'
          ? 'Runs in the background every time you log in. Turning it off means you start it yourself when you want it.'
          : tier === 'ask'
            ? 'Runs at every log in. Turning it off does not uninstall anything.'
            : undefined,
      // A startup entry's cost is real but unmeasurable without disabling it, so
      // this is honestly labelled as a judgement rather than a measurement.
      impact: tier === 'safe' ? 40 : tier === 'ask' ? 30 : 5,
      evidence: tier === 'report' ? 'Not recognised — left alone.' : 'Startup entry, runs at every log in.',
      action:
        tier === 'report'
          ? undefined
          : {
              kind: 'disable-startup',
              target: item.name,
              location: item.location,
              command: item.command,
            },
    });
  }

  // Optional Windows services.
  const services = await listServices();
  for (const [name, meta] of Object.entries(OPTIONAL_SERVICES)) {
    const service = services.find((s) => s.name === name);
    if (!service || service.state !== 'Running') continue;
    if (PROTECTED_SERVICES.has(name)) continue;
    findings.push({
      id: `service:${name}`,
      title: meta.label,
      detail: `Currently ${service.state}, starts ${service.startMode}.`,
      tier: 'ask',
      tradeoff: meta.tradeoff,
      impact: meta.impact,
      evidence: `Running service, start mode ${service.startMode}.`,
      action: { kind: 'set-service', target: name, startupType: 'disabled' },
    });
  }

  // Heavy background processes.
  const processes = await sampleProcesses();
  for (const p of processes) {
    const tier = classifyProcess(p, { protected: busy });
    if (tier !== 'ask') continue;
    findings.push({
      id: `process:${p.name}`,
      title: p.name,
      detail: `${p.cpuPercent}% CPU, ${p.memoryMb} MB memory${p.windowTitle ? ` — "${p.windowTitle}"` : ''}`,
      tier,
      tradeoff: p.windowTitle
        ? 'This has a window open, so it is probably something you are using. Closing it may lose unsaved work.'
        : 'Closing it ends whatever it is doing. If you start it again it will reopen.',
      impact: Math.round(p.cpuPercent * 2 + p.memoryMb / 50),
      evidence: `Measured over a ${3}s window: ${p.cpuPercent}% CPU, ${p.memoryMb} MB.`,
      action: { kind: 'stop-process', target: p.name },
    });
  }

  return findings.sort((a, b) => {
    const rank: Record<Tier, number> = { safe: 0, ask: 1, report: 2 };
    return rank[a.tier] - rank[b.tier] || b.impact - a.impact;
  });
}

/** Temporary files in the safe directories, with a real measured total. */
export async function tempFileFindings(): Promise<Finding[]> {
  const findings: Finding[] = [];

  // Resolve each allow-listed template to a concrete directory. A template that
  // does not resolve (missing env var) is skipped rather than guessed at.
  const resolvedDirs = SAFE_TEMP_DIRS.map((dir) => ({
    ...dir,
    path: dir.path
      .replace('%TEMP%', process.env.TEMP ?? '')
      .replace('%LOCALAPPDATA%', process.env.LOCALAPPDATA ?? '')
      .replace('%WINDIR%', process.env.SystemRoot ?? 'C:\\Windows'),
  })).filter((dir) => dir.path && !dir.path.includes('%'));

  // The allow-list above IS the boundary. Every candidate must be one of those
  // exact directories — not merely "something under" one of them, which is what
  // made an earlier version of this circular and meaningless.
  let totalBytes = 0;
  let totalFiles = 0;
  const measured: string[] = [];
  for (const dir of resolvedDirs) {
    const size = await directorySize(dir.path);
    if (size.bytes === 0) continue;
    totalBytes += size.bytes;
    totalFiles += size.files;
    measured.push(dir.path);
  }

  // Only worth mentioning if it is actually worth the click.
  if (totalBytes > 64 * 1024 * 1024) {
    findings.push({
      id: 'temp:clean',
      title: 'Temporary files',
      detail: `${(totalBytes / 1024 ** 3).toFixed(2)} GB in ${totalFiles.toLocaleString()} files, across ${measured.length} temp folder${measured.length === 1 ? '' : 's'}.`,
      tier: 'safe',
      tradeoff:
        'Only files inside your temp folders, which Windows and apps recreate. Downloads, Documents, Desktop, Pictures and OneDrive are excluded outright.',
      impact: 25,
      evidence: `Measured by summing file sizes in: ${measured.join(', ')}`,
      action: { kind: 'clean-temp', target: measured.join(';') },
    });
  }
  return findings;
}

export { OPTIONAL_SERVICES };