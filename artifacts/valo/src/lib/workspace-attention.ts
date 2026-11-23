import type { WorkspaceTask } from "@workspace/api-client-react";
import { dueDateUrgency } from "./date-shortcuts";
import { lagosToday } from "./format";

export type WorkspaceAttentionTone = "destructive" | "ochre" | "ink";

export type WorkspaceAttentionItem = {
  id: string;
  tone: WorkspaceAttentionTone;
  title: string;
  detail: string;
  actionLabel: string;
  href: string;
};

/**
 * Surfaces prioritized actionable workspace items for the Workspace Home strip. Returns an empty
 * array when no urgent task, changed-rule review, or stale profile check needs attention.
 */
export function buildWorkspaceAttention(input: {
  openTasks: readonly Pick<WorkspaceTask, "dueDate" | "state" | "needsReview">[];
  profileMovedAhead: boolean;
  today?: string;
}): WorkspaceAttentionItem[] {
  const today = input.today ?? lagosToday();
  const active = input.openTasks.filter((t) => t.state !== "completed_by_user");
  const overdue = active.filter((t) => dueDateUrgency(t.dueDate, false, today) === "overdue").length;
  const needsReview = active.filter((t) => t.needsReview || t.state === "needs_review").length;
  const dueSoon = active.filter((t) => dueDateUrgency(t.dueDate, false, today) === "due_soon").length;

  const items: WorkspaceAttentionItem[] = [];
  if (overdue > 0) {
    items.push({
      id: "overdue-tasks",
      tone: "destructive",
      title: overdue === 1 ? "1 overdue task" : `${overdue} overdue tasks`,
      detail: "Review the due date or mark it done if you have already handled it.",
      actionLabel: "Open overdue tasks",
      href: "/workspace/tasks?focus=overdue",
    });
  }
  if (needsReview > 0) {
    items.push({
      id: "review-tasks",
      tone: "ochre",
      title: needsReview === 1 ? "1 task needs review" : `${needsReview} tasks need review`,
      detail: "A linked rule changed after the task was created.",
      actionLabel: "Review tasks",
      href: "/workspace/tasks?focus=review",
    });
  }
  if (input.profileMovedAhead) {
    items.push({
      id: "stale-check",
      tone: "ochre",
      title: "Business profile changed since your last check",
      detail: "Re-run your requirements check using the updated profile to see if anything changed.",
      actionLabel: "Check with updated profile",
      href: "/workspace/checker?prefill=profile",
    });
  }
  if (dueSoon > 0) {
    items.push({
      id: "due-soon-tasks",
      tone: "ink",
      title: dueSoon === 1 ? "1 task due within 7 days" : `${dueSoon} tasks due within 7 days`,
      detail: "Check your due dates or export them to your calendar.",
      actionLabel: "View due soon",
      href: "/workspace/tasks?focus=due_soon",
    });
  }
  return items;
}
