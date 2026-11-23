import assert from "node:assert/strict";
import { test } from "node:test";
import { addCalendarDays, dueDateUrgency, sortTasksByDueDate } from "./date-shortcuts";

test("addCalendarDays advances dates accurately across month and year boundaries", () => {
  assert.equal(addCalendarDays("2026-11-23", 0), "2026-11-23");
  assert.equal(addCalendarDays("2026-11-23", 7), "2026-11-30");
  assert.equal(addCalendarDays("2026-11-23", 14), "2026-12-07");
  assert.equal(addCalendarDays("2026-12-20", 30), "2027-01-19");
});

test("dueDateUrgency flags overdue and due-within-7-days open tasks and ignores completed tasks", () => {
  const today = "2026-11-23";
  assert.equal(dueDateUrgency("2026-11-22", false, today), "overdue");
  assert.equal(dueDateUrgency("2026-11-23", false, today), "due_soon");
  assert.equal(dueDateUrgency("2026-11-30", false, today), "due_soon");
  assert.equal(dueDateUrgency("2026-12-01", false, today), null);
  assert.equal(dueDateUrgency("2026-11-20", true, today), null);
  assert.equal(dueDateUrgency(null, false, today), null);
});

test("sortTasksByDueDate places earliest open due dates first, then undated, then completed", () => {
  const items = [
    { id: "done", dueDate: "2026-11-01", state: "completed_by_user" as const },
    { id: "nodate", dueDate: null, state: "not_started" as const },
    { id: "later", dueDate: "2026-12-10", state: "in_progress" as const },
    { id: "soon", dueDate: "2026-11-20", state: "not_started" as const },
  ];
  assert.deepEqual(
    sortTasksByDueDate(items, "due_soonest").map((t) => t.id),
    ["soon", "later", "nodate", "done"],
  );
  assert.deepEqual(
    sortTasksByDueDate(items, "default").map((t) => t.id),
    ["done", "nodate", "later", "soon"],
  );
});
