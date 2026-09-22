/**
 * Appointments — the ledger behind "run my business" flows: customers request
 * time, the agent checks real availability, books free slots, flags conflicts,
 * and asks the owner when unsure. Backed by a JSON ledger in the profile home
 * so website agents (via exec/API), chat, and messaging channels all share one
 * source of truth. Times are ISO strings; overlaps are conflicts, touching
 * edges are not.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { infiniteHome } from '../profiles/home.js';
import type { Tool, ToolResult } from './base.js';

export interface Appointment {
  id: string;
  title: string;
  start: string;
  end: string;
  with?: string;
  notes?: string;
  source: string;
  status: 'proposed' | 'confirmed' | 'cancelled';
  createdAt: number;
}

export function appointmentsPath(): string {
  return join(infiniteHome(), 'appointments.json');
}

export function loadAppointments(): Appointment[] {
  try {
    if (!existsSync(appointmentsPath())) return [];
    const parsed = JSON.parse(readFileSync(appointmentsPath(), 'utf8')) as unknown;
    return Array.isArray(parsed) ? (parsed as Appointment[]).filter((a) => a && typeof a.id === 'string') : [];
  } catch {
    return [];
  }
}

function saveAppointments(all: Appointment[]): void {
  mkdirSync(dirname(appointmentsPath()), { recursive: true });
  writeFileSync(appointmentsPath(), JSON.stringify(all, null, 2), 'utf8');
}

function toMs(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Overlapping confirmed/proposed appointments (touching edges are free). Pure — exported for tests. */
export function findConflicts(all: Appointment[], startMs: number, endMs: number, ignoreId?: string): Appointment[] {
  return all.filter(
    (a) =>
      a.id !== ignoreId &&
      a.status !== 'cancelled' &&
      (() => {
        const s = Date.parse(a.start);
        const e = Date.parse(a.end);
        return Number.isFinite(s) && Number.isFinite(e) && s < endMs && e > startMs;
      })(),
  );
}

export interface AvailabilitySlot {
  start: string;
  end: string;
}

/** Free slots inside a window given existing bookings and a slot length. Pure — exported for tests. */
export function freeSlots(all: Appointment[], windowStartMs: number, windowEndMs: number, slotMin: number): AvailabilitySlot[] {
  const busy = all
    .filter((a) => a.status !== 'cancelled')
    .map((a) => ({ s: Date.parse(a.start), e: Date.parse(a.end) }))
    .filter((b) => Number.isFinite(b.s) && Number.isFinite(b.e) && b.e > windowStartMs && b.s < windowEndMs)
    .sort((x, y) => x.s - y.s);
  const slots: AvailabilitySlot[] = [];
  const step = slotMin * 60_000;
  for (let t = windowStartMs; t + step <= windowEndMs; t += step) {
    const end = t + step;
    if (!busy.some((b) => b.s < end && b.e > t)) {
      slots.push({ start: new Date(t).toISOString(), end: new Date(end).toISOString() });
    }
  }
  return slots;
}

function fmt(a: Appointment): string {
  return `- ${a.id} · ${a.status} · ${a.start} → ${a.end} · ${a.title}${a.with ? ` (with ${a.with})` : ''}${a.notes ? ` — ${a.notes}` : ''}`;
}

export const appointmentsTool: Tool = {
  name: 'Appointments',
  description:
    'Booking ledger with real availability. request proposes (conflicts reported, never double-booked); confirm/cancel/status; availability lists free slots; list shows upcoming. Unsure (VIP, conflict, odd hours)? Ask the owner instead of guessing. Times are ISO.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['request', 'confirm', 'cancel', 'list', 'availability'], description: 'request, confirm, cancel, list, availability' },
      title: { type: 'string', description: 'What the appointment is about' },
      start: { type: 'string', description: 'ISO start, e.g. 2026-09-12T22:00:00+02:00' },
      end: { type: 'string', description: 'ISO end' },
      with: { type: 'string', description: 'Customer or staff name' },
      notes: { type: 'string' },
      id: { type: 'string', description: 'confirm/cancel target' },
      from: { type: 'string', description: 'availability window start (ISO)' },
      to: { type: 'string', description: 'availability window end (ISO)' },
      slotMin: { type: 'number', description: 'availability slot length in minutes (default 30)' },
      source: { type: 'string', description: 'Where the request came from (chat, whatsapp, website, telegram)' },
    },
    required: ['action'],
  },
  permission: 'ask',

  async execute(args): Promise<ToolResult> {
    const a = (args ?? {}) as {
      action?: string; title?: string; start?: string; end?: string; with?: string;
      notes?: string; id?: string; from?: string; to?: string; slotMin?: number; source?: string;
    };
    const all = loadAppointments();
    const persist = () => saveAppointments(all);
    switch (a.action) {
      case 'request': {
        const startMs = a.start ? toMs(a.start) : null;
        const endMs = a.end ? toMs(a.end) : null;
        if (startMs === null || endMs === null || endMs <= startMs) {
          return { content: 'request needs valid ISO start/end with end after start.', is_error: true };
        }
        const conflicts = findConflicts(all, startMs, endMs);
        const appt: Appointment = {
          id: `apt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          title: (a.title ?? 'Appointment').slice(0, 200),
          start: new Date(startMs).toISOString(),
          end: new Date(endMs).toISOString(),
          ...(a.with ? { with: a.with.slice(0, 120) } : {}),
          ...(a.notes ? { notes: a.notes.slice(0, 500) } : {}),
          source: (a.source ?? 'chat').slice(0, 40),
          status: conflicts.length > 0 ? 'proposed' : 'confirmed',
          createdAt: Date.now(),
        };
        all.push(appt);
        persist();
        if (conflicts.length > 0) {
          return {
            content: `Slot conflicts — held as PROPOSED, not booked:\n${fmt(appt)}\nConflicts:\n${conflicts.map(fmt).join('\n')}\nAsk the owner which to keep (question UI), then confirm one and cancel the other.`,
          };
        }
        return { content: `Booked:\n${fmt(appt)}` };
      }
      case 'confirm': {
        const appt = all.find((x) => x.id === a.id);
        if (!appt) return { content: `No appointment ${a.id ?? ''}.`, is_error: true };
        const conflicts = findConflicts(all, Date.parse(appt.start), Date.parse(appt.end), appt.id);
        if (conflicts.length > 0) {
          return { content: `Cannot confirm — still conflicts:\n${conflicts.map(fmt).join('\n')}\nResolve first (cancel the loser or ask the owner).`, is_error: true };
        }
        appt.status = 'confirmed';
        persist();
        return { content: `Confirmed:\n${fmt(appt)}` };
      }
      case 'cancel': {
        const appt = all.find((x) => x.id === a.id);
        if (!appt) return { content: `No appointment ${a.id ?? ''}.`, is_error: true };
        appt.status = 'cancelled';
        persist();
        return { content: `Cancelled:\n${fmt(appt)}` };
      }
      case 'availability': {
        const fromMs = a.from ? toMs(a.from) : null;
        const toMsVal = a.to ? toMs(a.to) : null;
        if (fromMs === null || toMsVal === null || toMsVal <= fromMs) {
          return { content: 'availability needs valid ISO from/to with to after from.', is_error: true };
        }
        const slots = freeSlots(all, fromMs, toMsVal, a.slotMin ?? 30).slice(0, 40);
        if (slots.length === 0) return { content: 'No free slots in that window — propose alternatives or ask the owner.' };
        return { content: `Free slots:\n${slots.map((s) => `- ${s.start} → ${s.end}`).join('\n')}` };
      }
      case 'list':
      default: {
        const upcoming = all
          .filter((x) => x.status !== 'cancelled')
          .sort((x, y) => Date.parse(x.start) - Date.parse(y.start))
          .slice(0, 30);
        if (upcoming.length === 0) return { content: 'No upcoming appointments.' };
        return { content: `Upcoming:\n${upcoming.map(fmt).join('\n')}` };
      }
    }
  },
};
