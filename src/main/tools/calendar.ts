// Calendar Tool — ICS file generation for calendar apps
import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Tool, ToolContext, ToolResult } from "./base.js";

const OUTPUT_DIR = join(process.env.HOME || process.env.USERPROFILE || ".", "infinite-calendar");

function pad(n: number): string {
  return n < 10 ? "0" + n : "" + n;
}

function toICSDate(date: Date, allDay: boolean): string {
  if (allDay) {
    return date.getUTCFullYear() + pad(date.getUTCMonth() + 1) + pad(date.getUTCDate());
  }
  return date.getUTCFullYear() + pad(date.getUTCMonth() + 1) + pad(date.getUTCDate()) + "T" + pad(date.getUTCHours()) + pad(date.getUTCMinutes()) + pad(date.getUTCSeconds()) + "Z";
}

function escapeICS(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function buildICS(title: string, desc: string, loc: string, start: Date, end: Date, allDay: boolean, recur: string, atts: string[]): string {
  let s = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Infinite OS//Calendar//EN\r\n";
  s += "CALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\n";
  s += "BEGIN:VEVENT\r\n";
  s += "UID:" + randomUUID() + "\r\n";
  s += "DTSTAMP:" + toICSDate(new Date(), false) + "\r\n";
  if (allDay) {
    s += "DTSTART;VALUE=DATE:" + toICSDate(start, true) + "\r\n";
    s += "DTEND;VALUE=DATE:" + toICSDate(end, true) + "\r\n";
  } else {
    s += "DTSTART:" + toICSDate(start, false) + "\r\n";
    s += "DTEND:" + toICSDate(end, false) + "\r\n";
  }
  if (title) s += "SUMMARY:" + escapeICS(title) + "\r\n";
  if (desc) s += "DESCRIPTION:" + escapeICS(desc) + "\r\n";
  if (loc) s += "LOCATION:" + escapeICS(loc) + "\r\n";
  if (recur) s += "RRULE:" + recur + "\r\n";
  for (const a of atts) s += "ATTENDEE;CN=" + a + ":mailto:" + a + "\r\n";
  s += "END:VEVENT\r\nEND:VCALENDAR\r\n";
  return s;
}

export const calendarTool: Tool = {
  name: "Calendar",
  description: "Generate calendar events as ICS files. Import into Google Calendar, Outlook, Apple Calendar. Supports recurring events, attendees, all-day events.",
  permission: "allow",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", description: "create_event, create_ics, today, week" },
      title: { type: "string" },
      description: { type: "string" },
      location: { type: "string" },
      start: { type: "string", description: "ISO 8601 date/time" },
      end: { type: "string", description: "ISO 8601 date/time" },
      allDay: { type: "boolean" },
      recurrence: { type: "string", description: "RRULE string" },
      attendees: { type: "array", items: { type: "string" } },
      filename: { type: "string" },
      outputDir: { type: "string" },
    },
    required: ["action"],
  },
  async execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
    const a = args as { action: string; title?: string; description?: string; location?: string; start?: string; end?: string; allDay?: boolean; recurrence?: string; attendees?: string[]; filename?: string; outputDir?: string };
    try {
      const outDir = a.outputDir || OUTPUT_DIR;
      await mkdir(outDir, { recursive: true });

      if (a.action === "create_event" || a.action === "create_ics") {
        if (!a.start) return { content: "Start date required", is_error: true };
        const startDate = new Date(a.start);
        const endDate = a.end ? new Date(a.end) : new Date(startDate.getTime() + 3600000);
        const ics = buildICS(a.title || "Untitled", a.description || "", a.location || "", startDate, endDate, !!a.allDay, a.recurrence || "", a.attendees || []);
        const fname = a.filename || ((a.title || "event").replace(/[^a-z0-9]/gi, "-").toLowerCase()) + ".ics";
        const fpath = join(outDir, fname);
        await writeFile(fpath, ics);
        return { content: "Calendar event created: " + fpath + "\nImport into Google Calendar, Outlook, or Apple Calendar." };
      }

      if (a.action === "today") {
        const d = new Date();
        return { content: "Today: " + d.toISOString().split("T")[0] + " (" + d.toLocaleDateString("en-US", { weekday: "long" }) + ")" };
      }

      if (a.action === "week") {
        const now = new Date();
        const ws = new Date(now);
        ws.setDate(now.getDate() - now.getDay());
        const days = [];
        for (let i = 0; i < 7; i++) {
          const dd = new Date(ws);
          dd.setDate(ws.getDate() + i);
          days.push("  " + dd.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }));
        }
        return { content: "This Week:\n" + days.join("\n") };
      }

      return { content: "Unknown action: " + a.action, is_error: true };
    } catch (err) {
      return { content: "Calendar error: " + (err instanceof Error ? err.message : String(err)), is_error: true };
    }
  },
};
