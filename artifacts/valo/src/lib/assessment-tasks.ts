import type { AssessmentItem, WorkspaceTask } from "@workspace/api-client-react";
import { canCreateSourceTask } from "./rich-checker";

/**
 * Returns the set of rule IDs already represented in the workspace's tasks — either linked
 * directly to this saved result or still open from an earlier result — so duplicate tasks are
 * visibly avoided.
 */
export function trackedRuleIdsForAssessment(
  tasks: readonly Pick<WorkspaceTask, "assessmentId" | "ruleId" | "state">[],
  assessmentId: string,
): Set<string> {
  const tracked = new Set<string>();
  for (const task of tasks) {
    if (!task.ruleId) continue;
    if (task.assessmentId === assessmentId || task.state !== "completed_by_user") {
      tracked.add(task.ruleId);
    }
  }
  return tracked;
}

/** Returns result items eligible for task creation that are not already tracked in tasks. */
export function untrackedActionableItems(
  items: readonly AssessmentItem[],
  trackedRuleIds: ReadonlySet<string>,
): AssessmentItem[] {
  return items.filter((item) => canCreateSourceTask(item) && !trackedRuleIds.has(item.ruleId));
}
