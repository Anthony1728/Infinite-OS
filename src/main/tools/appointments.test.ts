import { describe, expect, it } from 'vitest';
import { findConflicts, freeSlots, type Appointment } from './appointments.js';

const apt = (id: string, start: string, end: string, status: Appointment['status'] = 'confirmed'): Appointment => ({
  id, title: id, start, end, source: 'test', status, createdAt: 0,
});

describe('appointments ledger', () => {
  it('detects overlaps but allows touching edges', () => {
    const all = [apt('a', '2026-09-12T10:00:00Z', '2026-09-12T11:00:00Z')];
    const overlap = findConflicts(all, Date.parse('2026-09-12T10:30:00Z'), Date.parse('2026-09-12T11:30:00Z'));
    expect(overlap.map((x) => x.id)).toEqual(['a']);
    expect(findConflicts(all, Date.parse('2026-09-12T11:00:00Z'), Date.parse('2026-09-12T12:00:00Z'))).toEqual([]);
    expect(findConflicts(all, Date.parse('2026-09-12T09:00:00Z'), Date.parse('2026-09-12T10:00:00Z'))).toEqual([]);
  });

  it('ignores cancelled rows and the row itself', () => {
    const all = [
      apt('dead', '2026-09-12T10:00:00Z', '2026-09-12T11:00:00Z', 'cancelled'),
      apt('self', '2026-09-12T10:00:00Z', '2026-09-12T11:00:00Z', 'proposed'),
    ];
    expect(findConflicts(all, Date.parse('2026-09-12T10:30:00Z'), Date.parse('2026-09-12T10:45:00Z'), 'self')).toEqual([]);
    expect(findConflicts(all, Date.parse('2026-09-12T10:30:00Z'), Date.parse('2026-09-12T10:45:00Z')).map((x) => x.id)).toEqual(['self']);
  });

  it('lists only genuinely free slots', () => {
    const all = [apt('busy', '2026-09-12T10:00:00Z', '2026-09-12T11:00:00Z')];
    const slots = freeSlots(all, Date.parse('2026-09-12T09:00:00Z'), Date.parse('2026-09-12T12:00:00Z'), 30);
    expect(slots.map((s) => s.start.slice(11, 16))).toEqual(['09:00', '09:30', '11:00', '11:30']);
  });
});
