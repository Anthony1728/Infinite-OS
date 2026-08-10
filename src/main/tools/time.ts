// Time tool — timezone-aware date/time utilities and cron scheduling math.
// Uses Intl (no external date library).

import type { Tool, ToolResult } from './base.js';

interface TimeInput {
  action: string;
  // now / convert_timezone
  timezone?: string;
  // parse / format / diff / convert
  timestamp?: string;
  epoch?: number;
  format?: string;
  targetTimezone?: string;
  // add / subtract
  amount?: number;
  unit?: string;
  // diff
  from?: string;
  to?: string;
  // cron
  cron?: string;
  limit?: number;
}

const UNIT_MS: Record<string, number> = {
  ms: 1,
  second: 1000,
  seconds: 1000,
  s: 1000,
  minute: 60_000,
  minutes: 60_000,
  m: 60_000,
  hour: 3_600_000,
  hours: 3_600_000,
  h: 3_600_000,
  day: 86_400_000,
  days: 86_400_000,
  d: 86_400_000,
  week: 604_800_000,
  weeks: 604_800_000,
  w: 604_800_000,
};

export const timeTool: Tool = {
  name: 'Time',
  description: 'Timezone-aware date/time utilities: current time anywhere, parse/format with tokens (YYYY, MM, DD, HH, mm, ss), add/subtract durations, diff between dates, list IANA timezones, convert between timezones, and compute next runs for cron expressions (5-field, evaluated in UTC).',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['now', 'timezone_list', 'parse', 'format', 'add', 'subtract', 'diff', 'convert_timezone', 'cron_next'] },
      timezone: { type: 'string', description: 'IANA timezone, e.g. "America/New_York" (default local).' },
      timestamp: { type: 'string', description: 'Date string for parse/format (any Date.parse-compatible value).' },
      epoch: { type: 'number', description: 'Epoch milliseconds (alternative to timestamp).' },
      format: { type: 'string', description: 'Format string with tokens YYYY YY MM MMM MMMM DD DDth HH hh mm ss SSS A Z (default ISO).' },
      targetTimezone: { type: 'string', description: 'Target timezone for convert_timezone.' },
      amount: { type: 'number', description: 'Magnitude for add/subtract.' },
      unit: { type: 'string', enum: ['ms', 's', 'm', 'h', 'd', 'w', 'second', 'minute', 'hour', 'day', 'week'] },
      from: { type: 'string', description: 'Start for diff.' },
      to: { type: 'string', description: 'End for diff.' },
      cron: { type: 'string', description: '5-field cron, e.g. "0 9 * * 1-5".' },
      limit: { type: 'number', description: 'Number of cron next runs (default 5).' },
    },
    required: ['action'],
  },
  permission: 'none',

  async execute(args, _ctx): Promise<ToolResult> {
    const input = args as TimeInput;
    try {
      switch (input.action) {
        case 'now': {
          const date = new Date();
          const tz = input.timezone;
          return json({
            iso: date.toISOString(),
            epochMs: date.getTime(),
            epochSeconds: Math.floor(date.getTime() / 1000),
            local: formatWithTokens(date, 'YYYY-MM-DD HH:mm:ss', undefined),
            inTimezone: tz ? formatWithTokens(date, 'YYYY-MM-DD HH:mm:ss Z', tz) : undefined,
            dayOfWeek: new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: tz ?? undefined }).format(date),
          });
        }
        case 'timezone_list': {
          let zones = Intl.supportedValuesOf('timeZone');
          if (!zones.includes('UTC')) zones = ['UTC', ...zones];
          const filter = input.timezone?.toLowerCase();
          const filtered = filter ? zones.filter((z) => z.toLowerCase().includes(filter)) : zones;
          return json({ count: filtered.length, hint: 'Filter with timezone=<substring>', timezones: filtered });
        }
        case 'parse': {
          const date = toDate(input.timestamp, input.epoch);
          return json({
            input: input.timestamp ?? `epoch:${input.epoch}`,
            iso: date.toISOString(),
            epochMs: date.getTime(),
            utc: formatWithTokens(date, 'YYYY-MM-DD HH:mm:ss', 'UTC'),
            local: formatWithTokens(date, 'YYYY-MM-DD HH:mm:ss', undefined),
          });
        }
        case 'format': {
          const date = toDate(input.timestamp, input.epoch);
          const fmt = input.format ?? 'YYYY-MM-DD HH:mm:ss';
          return {
            content: formatWithTokens(date, fmt, input.timezone),
          };
        }
        case 'add':
        case 'subtract': {
          if (input.amount === undefined || !input.unit) return bad(`${input.action} requires amount and unit.`);
          const base = toDate(input.timestamp, input.epoch);
          const msPerUnit = UNIT_MS[input.unit];
          if (msPerUnit === undefined) return bad(`Unknown unit: ${input.unit}`);
          const delta = msPerUnit * input.amount * (input.action === 'add' ? 1 : -1);
          const result = new Date(base.getTime() + delta);
          return json({ from: base.toISOString(), to: result.toISOString(), addedMs: delta });
        }
        case 'diff': {
          if (input.from === undefined || input.to === undefined) return bad('diff requires from and to.');
          const a = new Date(input.from).getTime();
          const b = new Date(input.to).getTime();
          if (!Number.isFinite(a) || !Number.isFinite(b)) return bad('diff requires valid date strings.');
          const ms = Math.abs(b - a);
          return json({
            from: new Date(a).toISOString(),
            to: new Date(b).toISOString(),
            ms,
            seconds: round(ms / 1000, 3),
            minutes: round(ms / 60_000, 3),
            hours: round(ms / 3_600_000, 3),
            days: round(ms / 86_400_000, 3),
            weeks: round(ms / 604_800_000, 3),
          });
        }
        case 'convert_timezone': {
          if (!input.timestamp && input.epoch === undefined) return bad('convert_timezone requires timestamp.');
          if (!input.targetTimezone) return bad('convert_timezone requires targetTimezone.');
          const date = toDate(input.timestamp, input.epoch);
          return json({
            iso: date.toISOString(),
            source: {
              timezone: input.timezone ?? '(local)',
              value: formatWithTokens(date, 'YYYY-MM-DD HH:mm:ss Z', input.timezone),
            },
            target: {
              timezone: input.targetTimezone,
              value: formatWithTokens(date, 'YYYY-MM-DD HH:mm:ss Z', input.targetTimezone),
            },
          });
        }
        case 'cron_next': {
          if (!input.cron) return bad('cron_next requires cron.');
          const schedule = parseCron(input.cron);
          const now = toDate(input.timestamp, input.epoch);
          const next = nextCronRuns(schedule, now, clampInt(input.limit, 1, 100, 5));
          return json({ cron: input.cron, from: now.toISOString(), next });
        }
        default:
          return bad(`Unknown Time action: ${input.action}`);
      }
    } catch (error) {
      return bad((error as Error).message);
    }
  },
};

// ---------------------------------------------------------------------------

function toDate(timestamp: string | undefined, epoch: number | undefined): Date {
  if (timestamp !== undefined) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) throw new Error(`Invalid timestamp: ${timestamp}`);
    return date;
  }
  if (epoch !== undefined) {
    const date = new Date(epoch);
    if (Number.isNaN(date.getTime())) throw new Error(`Invalid epoch: ${epoch}`);
    return date;
  }
  throw new Error('A timestamp or epoch is required.');
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function formatWithTokens(date: Date, fmt: string, timezone?: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone ?? undefined,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hour12: false,
    timeZoneName: 'short',
  }).formatToParts(date);

  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const monthNum = get('month');
  const dayNum = get('day');
  const year = get('year');
  const hour = get('hour');
  const minute = get('minute');
  const second = get('second');
  const fraction = get('fractionalSecond');
  const monthIndex = Number(monthNum) - 1;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const h24 = Number(hour);
  const h12 = ((h24 + 11) % 12) + 1;
  const ampm = h24 < 12 ? 'AM' : 'PM';
  const dayOfWeek = new Intl.DateTimeFormat('en-US', { timeZone: timezone ?? undefined, weekday: 'long' }).format(date);
  const dayNumber = new Intl.DateTimeFormat('en-US', { timeZone: timezone ?? undefined, day: 'numeric' }).format(date);

  const ordinal = (n: number): string => {
    const mod10 = n % 10;
    const mod100 = n % 100;
    let suffix = 'th';
    if (mod10 === 1 && mod100 !== 11) suffix = 'st';
    else if (mod10 === 2 && mod100 !== 12) suffix = 'nd';
    else if (mod10 === 3 && mod100 !== 13) suffix = 'rd';
    return `${String(n).padStart(2, '0')}${suffix}`;
  };

  const tokens: Record<string, string> = {
    YYYY: year,
    YY: year.slice(-2),
    MMMM: MONTHS_FULL[monthIndex] ?? monthNum,
    MMM: MONTHS[monthIndex] ?? monthNum,
    MM: monthNum,
    DDth: ordinal(Number(dayNumber)),
    DD: dayNum,
    dddd: dayOfWeek,
    ddd: get('weekday'),
    HH: hour,
    H: String(h24),
    hh: String(h12).padStart(2, '0'),
    h: String(h12),
    mm: minute,
    ss: second,
    SSS: fraction,
    A: ampm,
    a: ampm.toLowerCase(),
    Z: timezone ?? (get('timeZoneName') || ''),
  };

  return fmt.replace(/YYYY|YY|dddd|ddd|MMMM|MMM|MM|DDth|DD|HH|H|hh|h|mm|ss|SSS|A|a|Z/g, (token) => tokens[token] ?? token);
}

// -- cron ----------------------------------------------------------------------

interface CronField {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
}

const MONTH_NAMES: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const DOW_NAMES: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

export function parseCron(expr: string): CronField {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('cron must have 5 fields: minute hour day-of-month month day-of-week');
  const [minute, hour, dom, month, dow] = parts;
  return {
    minutes: expandField(minute, 0, 59, false),
    hours: expandField(hour, 0, 23, false),
    daysOfMonth: expandField(dom, 1, 31, false),
    months: expandField(month, 1, 12, true),
    daysOfWeek: expandField(dow, 0, 6, true),
  };
}

function expandField(field: string, min: number, max: number, named: boolean): Set<number> {
  const out = new Set<number>();
  const parseValue = (v: string): number => {
    if (named) {
      const lower = v.toLowerCase();
      if (MONTH_NAMES[lower]) return MONTH_NAMES[lower];
      if (DOW_NAMES[lower]) return DOW_NAMES[lower];
    }
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`Invalid cron value: ${v}`);
    return Math.trunc(n);
  };
  for (const raw of field.split(',')) {
    const segment = raw.trim();
    if (segment === '') throw new Error(`Invalid cron field: ${field}`);
    const rangeMatch = /^(\*|\d+|\w+)-(\*|\d+|\w+)(?:\/(\d+))?$/.exec(segment);
    if (rangeMatch) {
      const start = rangeMatch[1] === '*' ? min : parseValue(rangeMatch[1]);
      const end = rangeMatch[2] === '*' ? max : parseValue(rangeMatch[2]);
      const step = rangeMatch[3] ? Number(rangeMatch[3]) : 1;
      if (step < 1) throw new Error(`Invalid cron step: ${rangeMatch[3]}`);
      for (let v = start; v <= end; v += step) out.add(v);
      continue;
    }
    const stepMatch = /^(\*|\d+|\w+)(?:\/(\d+))?$/.exec(segment);
    if (!stepMatch) throw new Error(`Invalid cron field segment: ${segment}`);
    if (stepMatch[1] === '*') {
      const step = stepMatch[2] ? Number(stepMatch[2]) : 1;
      if (step < 1) throw new Error(`Invalid cron step: ${stepMatch[2]}`);
      for (let v = min; v <= max; v += step) out.add(v);
    } else if (stepMatch[2]) {
      const start = parseValue(stepMatch[1]);
      const step = Number(stepMatch[2]);
      if (step < 1) throw new Error(`Invalid cron step: ${stepMatch[2]}`);
      for (let v = start; v <= max; v += step) out.add(v);
    } else {
      out.add(parseValue(stepMatch[1]));
    }
  }
  return out;
}

export function nextCronRuns(schedule: CronField, from: Date, count: number): string[] {
  const results: string[] = [];
  // Operate entirely in UTC so results are deterministic across machines.
  const candidate = new Date(from.getTime());
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1); // strictly after `from`
  let iterations = 0;
  while (results.length < count && iterations < 5_000_000) {
    iterations++;
    const monthOk = schedule.months.has(candidate.getUTCMonth() + 1);
    const domOk = schedule.daysOfMonth.has(candidate.getUTCDate());
    const dowOk = schedule.daysOfWeek.has(candidate.getUTCDay());
    if (monthOk && domOk && dowOk && schedule.hours.has(candidate.getUTCHours()) && schedule.minutes.has(candidate.getUTCMinutes())) {
      results.push(candidate.toISOString());
    }
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }
  return results;
}

function json(value: unknown): ToolResult { return { content: JSON.stringify(value, null, 2) }; }
function bad(content: string): ToolResult { return { content, is_error: true }; }
