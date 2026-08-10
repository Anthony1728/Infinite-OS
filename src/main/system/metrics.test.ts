import { describe, expect, it } from 'vitest';
import { calculateCpuUsage, snapshotCpuTimes } from './metrics.js';

describe('system metrics', () => {
  it('calculates aggregate CPU usage from real OS tick deltas', () => {
    expect(calculateCpuUsage({ idle: 1_000, total: 2_000 }, { idle: 1_250, total: 3_000 })).toBe(75);
  });

  it('rejects invalid or unchanged samples instead of inventing a percentage', () => {
    expect(calculateCpuUsage({ idle: 10, total: 20 }, { idle: 10, total: 20 })).toBeNull();
    expect(calculateCpuUsage({ idle: 10, total: 20 }, { idle: 9, total: 30 })).toBeNull();
  });

  it('aggregates all CPU time buckets and cores', () => {
    const result = snapshotCpuTimes([
      { model: 'CPU', speed: 1, times: { user: 10, nice: 1, sys: 3, idle: 20, irq: 2 } },
      { model: 'CPU', speed: 1, times: { user: 5, nice: 0, sys: 2, idle: 15, irq: 1 } },
    ]);
    expect(result).toEqual({ idle: 35, total: 59 });
  });
});
