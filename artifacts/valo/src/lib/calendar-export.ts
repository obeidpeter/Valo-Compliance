import type { WorkspaceTask } from "@workspace/api-client-react";
import { addCalendarDays } from "./date-shortcuts";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function escapeIcsText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\r\n", "\\n")
    .replaceAll("\n", "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,");
}

function compactDate(isoDate: string): string {
  return isoDate.replaceAll("-", "");
}

function formatUtcStamp(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`
  );
}

/**
 * Builds a standards-compliant RFC 5545 `.ics` calendar file for one or more dated workspace tasks.
 * Uses all-day `VALUE=DATE` events so Nigerian due dates never shift across viewer time zones, and
 * embeds optional `VALARM` triggers matching the user's reminder offsets.
 */
export function buildTasksIcs(
  tasks: readonly Pick<WorkspaceTask, "id" | "title" | "notes" | "dueDate" | "dateConfirmed" | "state">[],
  options: { alarmDaysBefore?: readonly number[]; now?: Date } = {},
): string | null {
  const dated = tasks.filter(
    (task) => task.state !== "completed_by_user" && task.dueDate && ISO_DATE.test(task.dueDate),
  );
  if (dated.length === 0) return null;

  const stamp = formatUtcStamp(options.now ?? new Date());
  const alarms = [...new Set(options.alarmDaysBefore ?? [])]
    .filter((days) => Number.isInteger(days) && days >= 0 && days <= 90)
    .sort((a, b) => b - a);

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Valo//Workspace Tasks//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  for (const task of dated) {
    const start = task.dueDate!;
    const end = addCalendarDays(start, 1);
    const descriptionParts = [
      task.notes.trim(),
      task.dateConfirmed
        ? "Personal task recorded in Valo (due date confirmed by you)."
        : "Personal task recorded in Valo (due date not yet confirmed).",
      "Valo does not file anything or verify official regulator deadlines.",
    ].filter(Boolean);

    lines.push(
      "BEGIN:VEVENT",
      `UID:valo-task-${task.id}@valo.invalid`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compactDate(start)}`,
      `DTEND;VALUE=DATE:${compactDate(end)}`,
      `SUMMARY:${escapeIcsText(task.title.trim() || "Valo task")}`,
      `DESCRIPTION:${escapeIcsText(descriptionParts.join("\n\n"))}`,
    );

    for (const days of alarms) {
      lines.push(
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        `TRIGGER:${days === 0 ? "-PT0M" : `-P${days}D`}`,
        `DESCRIPTION:${escapeIcsText(task.title.trim() || "Valo task due")}`,
        "END:VALARM",
      );
    }

    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR", "");
  return lines.join("\r\n");
}

/** Triggers a browser download for a generated `.ics` calendar file. */
export function downloadIcsFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".ics") ? filename : `${filename}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
