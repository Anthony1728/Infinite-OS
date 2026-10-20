// What this machine can actually run.
//
// WHY THIS EXISTS
//
// Ollama's defaults are tuned for a machine with a discrete GPU and tens of
// gigabytes of RAM. On a low-end laptop they are catastrophic: a 4 GB model at
// 8k context on a CPU-only 1.7 GHz dual-core takes minutes per turn and pins
// gigabytes of RAM, which slows down everything else on the machine — including
// this app.
//
// So nothing in the Ollama path picks a number without asking this module first.
// The tiers below are deliberately conservative: being slightly too slow is
// recoverable, while thrashing the user's machine is not.

import { totalmem, cpus } from 'node:os';

export type PerfTier = 'low' | 'mid' | 'high';

export interface HardwareProfile {
  tier: PerfTier;
  totalRamGb: number;
  /** Logical CPU threads. Ollama's default thread count is usually too high here. */
  cpuThreads: number;
  cpuModel: string;
  /** Best-effort total VRAM across adapters, in GB. 0 means CPU-only. */
  vramGb: number;
  /** True when a CUDA NVIDIA GPU is present — Ollama will offload to it. */
  hasNvidiaGpu: boolean;
}

let cached: HardwareProfile | null = null;

/**
 * Detect VRAM.
 *
 * `os.totalmem()` knows nothing about the GPU, so this shells out to PowerShell
 * on Windows. It is cached for the process lifetime and failure is not fatal:
 * a wrong-but-safe answer (0 GB, CPU-only) just means more conservative
 * settings, which is the right way to be wrong.
 */
function detectVram(): { vramGb: number; hasNvidiaGpu: boolean } {
  if (process.platform !== 'win32') {
    return { vramGb: 0, hasNvidiaGpu: false };
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
    const script =
      'Get-CimInstance Win32_VideoController | ' +
      'Select-Object -Property Name,AdapterRAM,DriverVersion | ConvertTo-Json -Compress';
    const output = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', timeout: 5000, windowsHide: true },
    );
    const parsed: unknown = JSON.parse(output);
    const adapters = Array.isArray(parsed) ? parsed : [parsed];
    let vramBytes = 0;
    let hasNvidiaGpu = false;
    for (const adapter of adapters as Array<{ Name?: string; AdapterRAM?: number; DriverVersion?: string }>) {
      const name = adapter?.Name ?? '';
      if (/nvidia|geforce|quadro|rtx|gtx/i.test(name)) hasNvidiaGpu = true;
      // AdapterRAM is a uint32 and saturates at 4 GB for some adapters, so a
      // reported 4 GB means "4 GB or more" — treat it as such.
      const ram = Number(adapter?.AdapterRAM ?? 0);
      if (Number.isFinite(ram) && ram > 0) vramBytes += ram;
    }
    const vramGb = Math.round((vramBytes / 1024 ** 3) * 10) / 10;
    return { vramGb: vramGb >= 4 ? Math.max(vramGb, 8) : vramGb, hasNvidiaGpu };
  } catch {
    return { vramGb: 0, hasNvidiaGpu: false };
  }
}

export function getHardwareProfile(): HardwareProfile {
  if (cached) return cached;
  const totalRamGb = Math.round((totalmem() / 1024 ** 3) * 10) / 10;
  const cpuList = cpus();
  const { vramGb, hasNvidiaGpu } = detectVram();

  // Integrated graphics share system RAM, so a 1 GB "dedicated" figure means
  // offload will not actually happen. Only a real NVIDIA card earns 'high'.
  const tier: PerfTier = hasNvidiaGpu && vramGb >= 6
    ? 'high'
    : totalRamGb >= 24 && cpuList.length >= 8
      ? 'mid'
      : 'low';

  cached = {
    tier,
    totalRamGb,
    cpuThreads: cpuList.length || 4,
    cpuModel: cpuList[0]?.model?.trim() || 'unknown CPU',
    vramGb,
    hasNvidiaGpu,
  };
  return cached;
}

/** Clear the cache. Tests use this; production never needs it. */
export function resetHardwareCache(): void {
  cached = null;
}

// ── Per-tier defaults ──────────────────────────────────────────────────────

export interface LocalModelBudget {
  /** Context window. Bigger costs KV cache time AND memory on CPU. */
  numCtx: number;
  /** Hard ceiling on generated tokens, so a small model cannot ramble. */
  numPredict: number;
  /** Threads to use. Physical cores, not logical — SMT rarely helps a GEMM. */
  numThread: number;
  /**
   * How long to keep weights resident. Short on low-end so RAM is given back;
   * the next request reloads, which is a fair trade for a usable machine.
   */
  keepAlive: string;
  /** Cap on thinking tokens, as a fraction of the answer budget. */
  thinkingFraction: number;
}

/**
 * The generation budget for this machine.
 *
 * Model size deliberately does NOT appear here. It was tempting to scale these
 * by parameter count, but the only measurement we have is that a 1.7b model
 * spent its whole budget thinking and returned nothing — which says the budget
 * is too small for the model's habits, not that its habits vary predictably with
 * size. A model that is too big for the machine is surfaced as a warning
 * instead (`isModelComfortable`), where the user can make an informed choice.
 */
export function budgetForModel(tier?: PerfTier): LocalModelBudget {
  const hardware = tier ? { tier } : getHardwareProfile();
  const resolvedTier = hardware.tier;

  if (resolvedTier === 'high') {
    return {
      numCtx: 8_192,
      numPredict: 2_048,
      numThread: Math.max(4, getHardwareProfile().cpuThreads),
      keepAlive: '30m',
      thinkingFraction: 0.5,
    };
  }

  if (resolvedTier === 'mid') {
    return {
      // Enough for a real conversation with a handful of tool results.
      numCtx: 4_096,
      numPredict: 1_024,
      numThread: Math.max(2, getHardwareProfile().cpuThreads - 1),
      keepAlive: '10m',
      thinkingFraction: 0.4,
    };
  }

  // 'low' — a CPU-only budget box or an old ultrabook.
  //
  // Context is cut hard because KV cache on CPU is both the biggest memory
  // consumer and the biggest source of per-token latency. History that does not
  // fit is trimmed by the agent's own context builder before we ever get here.
  const physicalish = Math.max(1, Math.floor(getHardwareProfile().cpuThreads / 2));
  return {
    numCtx: 2_048,
    numPredict: 512,
    numThread: physicalish,
    // Short: give the RAM back quickly so the rest of the machine can use it.
    keepAlive: '5m',
    // A small slice of the budget, so the answer always has room. Measured: a
    // 1.7b model spent its entire 400-token budget reasoning about 17x23 and
    // returned nothing at all. Deliberately not scaled by model size — a small
    // model is not reliably more verbose than a large one, so pretending
    // otherwise would be a rule invented to look clever.
    //
    // The absolute numbers are the point: on a CPU-only i5-4210U, 96 tokens of
    // reasoning took 9 s and 153 tokens took 16 s. Reasoning is not free here,
    // so it stays opt-in and small.
    thinkingFraction: 0.2,
  };
}

/** Parse "qwen3:1.7b" / "llama3.2:3b" / "gemma2:27b" into a parameter count. */
export function parseParameterCount(modelName: string): number {
  const size = modelName.match(/(\d+(?:\.\d+)?)\s*b\b/i)?.[1];
  const value = size ? Number(size) : Number.NaN;
  // Unknown size: assume mid-size so we do not pick an aggressive budget.
  return Number.isFinite(value) && value > 0 ? value : 7;
}

/**
 * Is this model a reasonable size for this machine?
 *
 * Used to warn rather than block: the user may know something we do not, and a
 * 27B model on a GPU is fine even on a modest CPU.
 */
export function isModelComfortable(modelName: string, tier?: PerfTier): boolean {
  const resolved = tier ?? getHardwareProfile().tier;
  const params = parseParameterCount(modelName);
  if (resolved === 'high') return params <= 32;
  if (resolved === 'mid') return params <= 9;
  return params <= 4;
}

/** A one-line explanation of the tier, for the settings UI. */
export function describeHardware(): string {
  const hw = getHardwareProfile();
  const gpu = hw.hasNvidiaGpu ? `NVIDIA GPU, ${hw.vramGb} GB VRAM` : hw.vramGb > 0 ? `integrated graphics, ${hw.vramGb} GB shared` : 'no GPU (CPU only)';
  return `${hw.cpuModel} · ${hw.cpuThreads} threads · ${hw.totalRamGb} GB RAM · ${gpu} — ${hw.tier} tier`;
}