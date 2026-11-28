import assert from "node:assert/strict";
import { test } from "node:test";
import { buildWorkspaceAttention } from "./workspace-attention";

test("buildWorkspaceAttention returns an empty list for a clean workspace", () => {
  const items = buildWorkspaceAttention({
    openTasks: [{ dueDate: "2026-12-20", state: "not_started", needsReview: false }],
    recheck: undefined,
    today: "2026-11-23",
  });
  assert.deepEqual(items, []);
});

test("buildWorkspaceAttention prioritizes overdue tasks, rule-changed reviews, the offer of a new check, and due-soon tasks", () => {
  const items = buildWorkspaceAttention({
    openTasks: [
      { dueDate: "2026-11-20", state: "in_progress", needsReview: false },
      { dueDate: "2026-11-25", state: "needs_review", needsReview: true },
      { dueDate: "2026-11-10", state: "completed_by_user", needsReview: true },
    ],
    // PRO-003: the server offers a new check after the profile changed its state and employee count.
    recheck: {
      assessmentId: "00000000-0000-4000-8000-00000000a001",
      savedAt: "2026-11-18T08:00:00.000Z",
      changed: ["state", "employees"],
    },
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
  assert.deepEqual(items[2], {
    id: "stale-check",
    tone: "ochre",
    title: "Your business profile has changed since your last saved result",
    detail:
      "These answers have changed since the result saved on 18 Nov 2026, 09:00: State or FCT and Employees.",
    actionLabel: "Check again with my profile",
    href: "/workspace/checker?prefill=profile&since=00000000-0000-4000-8000-00000000a001",
  });
  assert.equal(items[3]?.title, "1 task due within 7 days");
  assert.equal(items[3]?.href, "/workspace/tasks?focus=due_soon");
});
