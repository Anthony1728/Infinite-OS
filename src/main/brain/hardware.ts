import { cpus, totalmem, freemem, platform, arch } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type LocalBrainTier = 'minimal' | 'balanced' | 'performance';

export interface LocalHardwareProfile {
  platform: string;
  architecture: string;
  cpuModel: string;
  logicalCores: number;
  totalRamGb: number;
  freeRamGb: number;
  gpuNames: string[];
  integratedGraphics: boolean;
  tier: LocalBrainTier;
  contextSize: number;
  threads: number;
  gpuLayers: number;
  preferredModelSizes: string[];
}

function roundGb(bytes: number): number {
  return Math.round((bytes / 1024 ** 3) * 10) / 10;
}

async function detectWindowsGpus(): Promise<string[]> {
  if (platform() !== 'win32') return [];
  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-Command',
      'Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }',
    ], { windowsHide: true, timeout: 5000 });
    return stdout.split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export async function detectLocalHardware(): Promise<LocalHardwareProfile> {
  const cpuList = cpus();
  const logicalCores = Math.max(1, cpuList.length);
  const totalRamGb = roundGb(totalmem());
  const gpuNames = await detectWindowsGpus();
  const integratedGraphics = gpuNames.some((name) => /intel|iris|uhd|integrated|radeon graphics/i.test(name));
  const tier: LocalBrainTier = totalRamGb >= 24 && logicalCores >= 8
    ? 'performance'
    : totalRamGb >= 12 && logicalCores >= 4 ? 'balanced' : 'minimal';
  return {
    platform: platform(), architecture: arch(),
    cpuModel: cpuList[0]?.model?.trim() || 'Unknown CPU', logicalCores,
    totalRamGb, freeRamGb: roundGb(freemem()), gpuNames,
    integratedGraphics,
    tier,
    contextSize: tier === 'performance' ? 16384 : tier === 'balanced' ? 8192 : 4096,
    threads: Math.max(2, Math.min(Math.max(2, logicalCores - 1), tier === 'performance' ? 12 : 8)),
    gpuLayers: gpuNames.length === 0 ? 0 : integratedGraphics
      ? (tier === 'performance' ? 24 : tier === 'balanced' ? 12 : 4)
      : 999,
    preferredModelSizes: tier === 'performance' ? ['14b', '12b', '9b', '8b', '7b']
      : tier === 'balanced' ? ['9b', '8b', '7b', '4b', '3b'] : ['3b', '2b', '1.5b', '1b'],
  };
}

export function selectInstalledModel(models: string[], profile: LocalHardwareProfile, requested?: string): string {
  if (requested && models.includes(requested)) return requested;
  for (const size of profile.preferredModelSizes) {
    const match = models.find((model) => model.toLowerCase().includes(size));
    if (match) return match;
  }
  // A model with no size marker may be a custom quantized model. Avoid
  // automatically choosing an explicitly oversized model on a small laptop.
  return models.find((model) => !/\b\d+(?:\.\d+)?b\b/i.test(model)) ?? requested ?? '';
}
