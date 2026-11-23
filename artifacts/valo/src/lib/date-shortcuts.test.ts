import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addCalendarDays,
  dueDateUrgency,
  matchesTaskFocus,
  parseTaskFilter,
  parseTaskFocus,
  sortTasksByDueDate,
} from "./date-shortcuts";

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

test("parseTaskFilter, parseTaskFocus, and matchesTaskFocus handle deep-linked focus views cleanly", () => {
  assert.equal(parseTaskFilter("done"), "done");
  assert.equal(parseTaskFilter("all"), "all");
  assert.equal(parseTaskFilter("unknown"), "open");
  assert.equal(parseTaskFocus("overdue"), "overdue");
  assert.equal(parseTaskFocus("review"), "review");
  assert.equal(parseTaskFocus("due_soon"), "due_soon");
  assert.equal(parseTaskFocus("other"), "all");

  const today = "2026-11-23";
  const overdue = { dueDate: "2026-11-20", state: "in_progress" as const, needsReview: false };
  const review = { dueDate: null, state: "needs_review" as const, needsReview: true };
  const soon = { dueDate: "2026-11-28", state: "not_started" as const, needsReview: false };
  const done = { dueDate: "2026-11-20", state: "completed_by_user" as const, needsReview: true };

  assert.equal(matchesTaskFocus(overdue, "overdue", today), true);
  assert.equal(matchesTaskFocus(overdue, "due_soon", today), false);
  assert.equal(matchesTaskFocus(review, "review", today), true);
  assert.equal(matchesTaskFocus(soon, "due_soon", today), true);
  assert.equal(matchesTaskFocus(done, "overdue", today), false);
  assert.equal(matchesTaskFocus(done, "review", today), false);
  assert.equal(matchesTaskFocus(done, "all", today), true);
});
