import { describe, expect, it } from 'vitest';
import { timeTool } from './time.js';
import { parseCron, nextCronRuns } from './time.js';

function exec(action: string, args: Record<string, unknown>) {
  return timeTool.execute({ action, ...args }, {} as never);
}

describe('Time tool', () => {
  it('reports the current time in multiple representations', async () => {
    const before = Date.now();
    const result = await exec('now', {});
    const parsed = JSON.parse(String(result.content));
    expect(parsed.epochMs).toBeGreaterThanOrEqual(before);
    expect(new Date(parsed.iso).getTime()).toBe(parsed.epochMs);
  });

  it('lists IANA timezones and filters them', async () => {
    const all = await exec('timezone_list', {});
    const parsed = JSON.parse(String(all.content));
    expect(parsed.count).toBeGreaterThan(200);
    expect(parsed.timezones).toContain('UTC');

    const filtered = await exec('timezone_list', { timezone: 'europe' });
    const parsedFiltered = JSON.parse(String(filtered.content));
    expect(parsedFiltered.timezones.every((z: string) => z.toLowerCase().includes('europe'))).toBe(true);
  });

  it('parses timestamps and epochs', async () => {
    const result = await exec('parse', { timestamp: '2024-03-01T12:00:00.000Z' });
    const parsed = JSON.parse(String(result.content));
    expect(parsed.iso).toBe('2024-03-01T12:00:00.000Z');
    expect(parsed.epochMs).toBe(new Date('2024-03-01T12:00:00.000Z').getTime());

    const epoch = await exec('parse', { epoch: 0 });
    expect(JSON.parse(String(epoch.content)).iso).toBe('1970-01-01T00:00:00.000Z');
  });

  it('formats with tokens in a timezone', async () => {
    const result = await exec('format', { timestamp: '2024-03-05T15:30:00.000Z', timezone: 'UTC', format: 'YYYY-MM-DD HH:mm:ss' });
    expect(String(result.content)).toBe('2024-03-05 15:30:00');
  });

  it('formats 12-hour time and ordinals', async () => {
    const result = await exec('format', { timestamp: '2024-03-05T15:30:00.000Z', timezone: 'UTC', format: 'hh:mm A DDth MMM dddd' });
    expect(String(result.content)).toBe('03:30 PM 05th Mar Tuesday');
  });

  it('adds and subtracts durations', async () => {
    const added = await exec('add', { timestamp: '2024-03-01T00:00:00.000Z', amount: 90, unit: 'm' });
    expect(JSON.parse(String(added.content)).to).toBe('2024-03-01T01:30:00.000Z');

    const subtracted = await exec('subtract', { timestamp: '2024-03-01T00:00:00.000Z', amount: 1, unit: 'day' });
    expect(JSON.parse(String(subtracted.content)).to).toBe('2024-02-29T00:00:00.000Z');
  });

  it('computes diffs across units', async () => {
    const result = await exec('diff', { from: '2024-03-01T00:00:00.000Z', to: '2024-03-02T06:00:00.000Z' });
    const parsed = JSON.parse(String(result.content));
    expect(parsed.hours).toBe(30);
    expect(parsed.days).toBe(1.25);
  });

  it('converts between timezones', async () => {
    const result = await exec('convert_timezone', { timestamp: '2024-03-01T12:00:00.000Z', targetTimezone: 'America/New_York' });
    const parsed = JSON.parse(String(result.content));
    expect(parsed.target.value).toContain('07:00:00'); // EST = UTC-5 in March
  });

  it('rejects invalid input', async () => {
    const bad = await exec('parse', { timestamp: 'nonsense' });
    expect(bad.is_error).toBe(true);
    const missing = await exec('diff', { from: '2024-01-01T00:00:00Z' });
    expect(missing.is_error).toBe(true);
  });

  it('computes next cron runs (daily at 09:00, Mon-Fri)', async () => {
    const schedule = parseCron('0 9 * * 1-5');
    const from = new Date('2024-03-01T12:00:00.000Z'); // Friday
    const runs = nextCronRuns(schedule, from, 3).map((iso) => new Date(iso));
    expect(runs[0].getUTCDay()).toBe(1); // Monday
    expect(runs[0].getUTCHours()).toBe(9);
    expect(runs[1].getUTCDay()).toBe(2);
    expect(runs[2].getUTCDay()).toBe(3);
  });

  it('respects month fields in cron', async () => {
    const schedule = parseCron('0 0 1 1 *'); // Jan 1, midnight
    const runs = nextCronRuns(schedule, new Date('2024-03-01T00:00:00.000Z'), 2);
    expect(runs[0]).toBe('2025-01-01T00:00:00.000Z');
    expect(runs[1]).toBe('2026-01-01T00:00:00.000Z');
  });

  it('rejects malformed cron', async () => {
    expect(() => parseCron('0 9 *')).toThrow();
    expect(() => parseCron('a b c d e')).toThrow();
  });
});
