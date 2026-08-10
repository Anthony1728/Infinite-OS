import { cpus, freemem, hostname, loadavg, platform, totalmem, type CpuInfo } from 'node:os';

export interface CpuSnapshot {
  idle: number;
  total: number;
}

export interface SystemMetrics {
  cpu: number;
  cpuCores: number;
  ram: number;
  ramUsed: string;
  ramTotal: string;
  load1: string;
  load5: string;
  load15: string;
  platform: string;
  hostname: string;
}

export function snapshotCpuTimes(cpuInfo: CpuInfo[]): CpuSnapshot {
  return cpuInfo.reduce<CpuSnapshot>(
    (snapshot, cpu) => {
      const times = cpu.times;
      snapshot.idle += times.idle;
      snapshot.total += times.user + times.nice + times.sys + times.idle + times.irq;
      return snapshot;
    },
    { idle: 0, total: 0 },
  );
}

export function calculateCpuUsage(previous: CpuSnapshot, current: CpuSnapshot): number | null {
  const totalDelta = current.total - previous.total;
  const idleDelta = current.idle - previous.idle;
  if (totalDelta <= 0 || idleDelta < 0) return null;
  const usage = (1 - idleDelta / totalDelta) * 100;
  return Math.round(Math.max(0, Math.min(100, usage)) * 10) / 10;
}

let previousCpu = snapshotCpuTimes(cpus());
let lastCpuUsage = 0;

/** Collect measured host metrics. CPU is calculated from OS tick deltas so it
 * remains meaningful on Windows, where Node's loadavg() is always zero. */
export function collectSystemMetrics(): SystemMetrics {
  const cpuInfo = cpus();
  const currentCpu = snapshotCpuTimes(cpuInfo);
  const measuredCpu = calculateCpuUsage(previousCpu, currentCpu);
  previousCpu = currentCpu;
  if (measuredCpu !== null) lastCpuUsage = measuredCpu;

  const totalMem = totalmem();
  const freeMem = freemem();
  const usedMem = Math.max(0, totalMem - freeMem);
  const ramUsage = totalMem > 0 ? Math.round((usedMem / totalMem) * 1000) / 10 : 0;
  const loads = loadavg();
  const supportsLoadAverage = platform() !== 'win32';

  return {
    cpu: lastCpuUsage,
    cpuCores: cpuInfo.length,
    ram: ramUsage,
    ramUsed: (usedMem / 1073741824).toFixed(1),
    ramTotal: (totalMem / 1073741824).toFixed(1),
    load1: supportsLoadAverage ? loads[0].toFixed(2) : 'N/A',
    load5: supportsLoadAverage ? loads[1].toFixed(2) : 'N/A',
    load15: supportsLoadAverage ? loads[2].toFixed(2) : 'N/A',
    platform: platform(),
    hostname: hostname(),
  };
}
