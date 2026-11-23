import assert from "node:assert/strict";
import { test } from "node:test";
import { buildWorkspaceAttention } from "./workspace-attention";

test("buildWorkspaceAttention returns an empty list for a clean workspace", () => {
  const items = buildWorkspaceAttention({
    openTasks: [{ dueDate: "2026-12-20", state: "not_started", needsReview: false }],
    profileMovedAhead: false,
    today: "2026-11-23",
  });
  assert.deepEqual(items, []);
});

test("buildWorkspaceAttention prioritizes overdue tasks, rule-changed reviews, stale profile checks, and due-soon tasks", () => {
  const items = buildWorkspaceAttention({
    openTasks: [
      { dueDate: "2026-11-20", state: "in_progress", needsReview: false },
      { dueDate: "2026-11-25", state: "needs_review", needsReview: true },
      { dueDate: "2026-11-10", state: "completed_by_user", needsReview: true },
    ],
    profileMovedAhead: true,
    today: "2026-11-23",
  });

  assert.deepEqual(
    items.map((item) => item.id),
    ["overdue-tasks", "review-tasks", "stale-check", "due-soon-tasks"],
  );
  assert.equal(items[0]?.title, "1 overdue task");
  assert.equal(items[0]?.href, "/workspace/tasks?focus=overdue");
  assert.equal(items[1]?.title, "1 task needs review");
  assert.equal(items[1]?.href, "/workspace/tasks?focus=review");
  assert.equal(items[2]?.href, "/workspace/checker?prefill=profile");
  assert.equal(items[3]?.title, "1 task due within 7 days");
  assert.equal(items[3]?.href, "/workspace/tasks?focus=due_soon");
});
