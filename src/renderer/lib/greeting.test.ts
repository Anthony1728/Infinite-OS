import { describe, expect, it } from 'vitest';
import { creativeGreeting, dayOfYearSeed } from './greeting.js';

const base = { firstName: 'Alex', weekday: 3, dayOfYear: 100 };

describe('creativeGreeting', () => {
  it('greets by time of day', () => {
    expect(creativeGreeting({ ...base, hour: 9 }).greeting).toMatch(/morning|Morning|Rise/i);
    expect(creativeGreeting({ ...base, hour: 14 }).greeting).toMatch(/afternoon|Afternoon|momentum/i);
    expect(creativeGreeting({ ...base, hour: 20 }).greeting).toMatch(/evening|Evening|session/i);
  });

  it('nudges late-night users to look after themselves', () => {
    const lines = [0, 1, 2].map(
      (seed) => {
        const g = creativeGreeting({ ...base, hour: 2, dayOfYear: seed });
        return `${g.greeting} ${g.sub}`;
      },
    );
    expect(lines.some((l) => /look after yourself|downtime|rest|pace/i.test(l))).toBe(true);
  });

  it('acknowledges running agents before pleasantry', () => {
    const g = creativeGreeting({ ...base, hour: 10, activeRuns: 2 });
    expect(g.accent).toMatch(/2 agents/);
    expect(g.sub).toMatch(/running in the background/);
  });

  it('marks Monday mornings as a clean slate', () => {
    const g = creativeGreeting({ ...base, hour: 9, weekday: 1 });
    expect(`${g.greeting} ${g.accent} ${g.sub}`).toMatch(/Monday|week|slate/i);
  });

  it('rotates deterministically: same seed, same line', () => {
    const a = creativeGreeting({ ...base, hour: 10 });
    const b = creativeGreeting({ ...base, hour: 10 });
    expect(a).toEqual(b);
  });

  it('computes a 1-based day-of-year seed', () => {
    expect(dayOfYearSeed(new Date(2026, 0, 1))).toBe(1);
    expect(dayOfYearSeed(new Date(2026, 11, 31))).toBe(365);
  });
});
