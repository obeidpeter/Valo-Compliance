import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTasksIcs } from "./calendar-export";

test("buildTasksIcs generates RFC 5545 all-day events with VALARM triggers and skips done or undated tasks", () => {
  const ics = buildTasksIcs(
    [
      {
        id: "t-1",
        title: "File annual return; CAC, Ikeja",
        notes: "Check portal\nBring receipt",
        dueDate: "2026-12-01",
        dateConfirmed: true,
        state: "in_progress",
      },
      {
        id: "t-2",
        title: "Already done",
        notes: "",
        dueDate: "2026-12-02",
        dateConfirmed: true,
        state: "completed_by_user",
      },
      {
        id: "t-3",
        title: "No date",
        notes: "",
        dueDate: null,
        dateConfirmed: false,
        state: "not_started",
      },
    ],
    { alarmDaysBefore: [7, 1, 0], now: new Date("2026-11-23T10:00:00Z") },
  );

  assert.ok(ics);
  assert.match(ics!, /BEGIN:VCALENDAR\r\n/);
  assert.match(ics!, /DTSTART;VALUE=DATE:20261201\r\n/);
  assert.match(ics!, /DTEND;VALUE=DATE:20261202\r\n/);
  assert.match(ics!, /SUMMARY:File annual return\\; CAC\\, Ikeja\r\n/);
  assert.match(ics!, /TRIGGER:-P7D\r\n/);
  assert.match(ics!, /TRIGGER:-P1D\r\n/);
  assert.match(ics!, /TRIGGER:-PT0M\r\n/);
  assert.doesNotMatch(ics!, /Already done/);
  assert.doesNotMatch(ics!, /No date/);
});

test("buildTasksIcs returns null when no open task has a valid due date", () => {
  assert.equal(
    buildTasksIcs([
      {
        id: "t-1",
        title: "Done",
        notes: "",
        dueDate: "2026-12-01",
        dateConfirmed: true,
        state: "completed_by_user",
      },
    ]),
    null,
  );
  assert.equal(buildTasksIcs([]), null);
});
