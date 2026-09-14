/**
 * Creative greeting composer — the human words behind the Power Center hero
 * and the chat empty-state header. Time-aware, weekday-aware, and workload-
 * aware: late nights get a look-after-yourself nudge, Monday gets a clean-
 * slate note, active agent runs get acknowledged. Variants rotate
 * deterministically by day-of-year, so the line feels fresh every morning
 * but never flickers mid-session. Pure, instant, offline — no model call.
 */

export interface GreetingContext {
  firstName: string;
  /** Local hour 0-23. */
  hour: number;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  /** Day-of-year seed for the daily rotation. */
  dayOfYear: number;
  recentSessions?: number;
  activeRuns?: number;
  readyAutomations?: number;
}

export interface Greeting {
  /** "Good evening" / "Burning the midnight oil" — precedes ", {name}". */
  greeting: string;
  /** Hero accent after the name ("ready to build." by default). */
  accent: string;
  /** One-line sub headline. */
  sub: string;
}

function pick<T>(list: T[], seed: number): T {
  return list[Math.abs(seed) % list.length];
}

const MORNING = ['Good morning', 'Rise and build', 'Morning spark'];
const AFTERNOON = ['Good afternoon', 'Afternoon momentum', 'Good afternoon'];
const EVENING = ['Good evening', 'Evening session', 'Good evening'];
const LATE_NIGHT = ['Burning the midnight oil', 'Still up', 'Night shift'];

const MORNING_SUBS = [
  'Fresh day, clean slate — what are we building first?',
  'Coffee’s on. Your workspace is warm and ready.',
  'Early hours, sharp mind — let’s make them count.',
];
const AFTERNOON_SUBS = [
  'How can I help you build, create and automate today?',
  'Midday momentum — point me at the next thing.',
  'Your agents are rested. Put them to work.',
];
const EVENING_SUBS = [
  'Winding down or gearing up? Either way, I’m here.',
  'Evening session — let’s close something out.',
  'How can I help you build, create and automate tonight?',
];
const LATE_SUBS = [
  'Look after yourself — even operating systems need downtime. What’s keeping you up?',
  'Late hours, quiet house. I’ll carry the heavy lifting — you just point.',
  'Burning bright past midnight? Pace yourself, I’ve got the watch.',
];

export function creativeGreeting(ctx: GreetingContext): Greeting {
  const { firstName, hour, weekday, dayOfYear } = ctx;
  const name = firstName || 'there';
  const isLateNight = hour < 5;
  const isMorning = hour >= 5 && hour < 12;
  const isAfternoon = hour >= 12 && hour < 18;

  // Workload truth beats pleasantry: acknowledge live work first.
  if ((ctx.activeRuns ?? 0) > 0) {
    const n = ctx.activeRuns as number;
    return {
      greeting: pick(isLateNight ? LATE_NIGHT : isMorning ? MORNING : isAfternoon ? AFTERNOON : EVENING, dayOfYear),
      accent: `${n} agent${n === 1 ? '' : 's'} on it.`,
      sub: isLateNight
        ? `Look after yourself, ${name} — your ${n === 1 ? 'agent keeps' : 'agents keep'} working while you rest your eyes.`
        : `${n} agent${n === 1 ? ' is' : 's are'} running in the background, ${name} — carry on, I’ll report back.`,
    };
  }

  if (isLateNight) {
    return {
      greeting: pick(LATE_NIGHT, dayOfYear),
      accent: 'pace yourself.',
      sub: pick(LATE_SUBS, dayOfYear).replace('What’s keeping you up?', `What’s keeping you up, ${name}?`),
    };
  }

  // Monday mornings earn a clean-slate note; Friday afternoons a ship-it nudge.
  if (weekday === 1 && isMorning) {
    return {
      greeting: pick(['New week', 'Monday reset', 'Good morning'], dayOfYear),
      accent: 'clean slate.',
      sub: `Monday, ${name} — new week, empty board. Name the first thing and it’s done.`,
    };
  }
  if (weekday === 5 && isAfternoon) {
    return {
      greeting: pick(['Shipping Friday', 'Good afternoon', 'Friday push'], dayOfYear),
      accent: 'let’s ship it.',
      sub: `Friday afternoon, ${name} — let’s land something before the weekend.`,
    };
  }
  if (weekday === 0 || weekday === 6) {
    return {
      greeting: pick(isMorning ? MORNING : isAfternoon ? AFTERNOON : EVENING, dayOfYear + 3),
      accent: 'weekend build.',
      sub: `Weekend time, ${name} — no meetings, no noise. Just you and the work.`,
    };
  }

  if (isMorning) {
    return { greeting: pick(MORNING, dayOfYear), accent: 'ready to build.', sub: pick(MORNING_SUBS, dayOfYear + 1) };
  }
  if (isAfternoon) {
    return { greeting: pick(AFTERNOON, dayOfYear), accent: 'ready to build.', sub: pick(AFTERNOON_SUBS, dayOfYear + 1) };
  }
  return { greeting: pick(EVENING, dayOfYear), accent: 'ready to build.', sub: pick(EVENING_SUBS, dayOfYear + 1) };
}

/** Day-of-year seed (1-366) for the daily rotation. */
export function dayOfYearSeed(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date.getTime() - start.getTime()) / 86_400_000);
}
