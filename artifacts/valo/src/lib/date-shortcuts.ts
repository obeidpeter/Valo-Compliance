import type { WorkspaceTask } from "@workspace/api-client-react";
import { lagosToday } from "./format";

export const DATE_QUICK_OFFSETS = [
  { label: "Today", days: 0 },
  { label: "+7 days", days: 7 },
  { label: "+14 days", days: 14 },
  { label: "+30 days", days: 30 },
] as const;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Adds whole calendar days to a YYYY-MM-DD date string using UTC calendar math (zone-independent). */
export function addCalendarDays(isoDate: string, days: number): string {
  const match = ISO_DATE.exec(isoDate);
  if (!match) return isoDate;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export type DueUrgency = "overdue" | "due_soon" | null;

/** Classifies an open task's due date against Lagos today ("overdue" or "due_soon" within 7 days). */
export function dueDateUrgency(
  dueDate: string | null | undefined,
  done: boolean,
  today = lagosToday(),
): DueUrgency {
  if (done || !dueDate || !ISO_DATE.test(dueDate)) return null;
  if (dueDate < today) return "overdue";
  if (dueDate <= addCalendarDays(today, 7)) return "due_soon";
  return null;
}

export type TaskSortMode = "default" | "due_soonest";

export type TaskListFilter = "open" | "done" | "all";

export type TaskFocus = "all" | "overdue" | "review" | "due_soon";

export const TASK_FOCUS_LABELS: Record<Exclude<TaskFocus, "all">, string> = {
  overdue: "Overdue",
  review: "Needs review",
  due_soon: "Due within 7 days",
};

export function parseTaskFilter(raw: string | null | undefined): TaskListFilter {
  if (raw === "done" || raw === "all") return raw;
  return "open";
}

export function parseTaskFocus(raw: string | null | undefined): TaskFocus {
  if (raw === "overdue" || raw === "review" || raw === "due_soon") return raw;
  return "all";
}

/** Whether a task belongs in a given urgency focus view (overdue, rule-changed review, or due within 7 days). */
export function matchesTaskFocus(
  task: Pick<WorkspaceTask, "dueDate" | "state" | "needsReview">,
  focus: TaskFocus,
  today = lagosToday(),
): boolean {
  if (focus === "all") return true;
  const done = task.state === "completed_by_user";
  if (done) return false;
  if (focus === "overdue") return dueDateUrgency(task.dueDate, false, today) === "overdue";
  if (focus === "due_soon") return dueDateUrgency(task.dueDate, false, today) === "due_soon";
  return Boolean(task.needsReview || task.state === "needs_review");
}

/** Sorts tasks by earliest due date first (overdue at top, then upcoming, then undated, then done). */
export function sortTasksByDueDate<T extends Pick<WorkspaceTask, "dueDate" | "state">>(
  tasks: readonly T[],
  mode: TaskSortMode,
): T[] {
  if (mode === "default") return [...tasks];
  return [...tasks].sort((a, b) => {
    const aDone = a.state === "completed_by_user" ? 1 : 0;
    const bDone = b.state === "completed_by_user" ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    const aHas = a.dueDate ? 0 : 1;
    const bHas = b.dueDate ? 0 : 1;
    if (aHas !== bHas) return aHas - bHas;
    if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) {
      return a.dueDate.localeCompare(b.dueDate);
    }
    return 0;
  });
}
