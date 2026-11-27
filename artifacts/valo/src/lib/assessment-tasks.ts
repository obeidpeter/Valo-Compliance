import type { AssessmentItem, SavedAssessment, WorkspaceTask } from "@workspace/api-client-react";
import { displayFact, isMarker } from "./checker";
import { canCreateSourceTask } from "./rich-checker";

export type AssessmentListFilter = "all" | "likely_relevant" | "from_profile";

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

/** Filters saved requirement check results by search text and quick status/origin filter. */
export function filterSavedAssessments(
  assessments: readonly SavedAssessment[],
  query: string,
  filter: AssessmentListFilter,
): SavedAssessment[] {
  const trimmed = query.trim().toLowerCase();
  return assessments.filter((assessment) => {
    if (
      filter === "likely_relevant" &&
      !assessment.result.items.some((item) => item.label === "Likely relevant")
    ) {
      return false;
    }
    if (filter === "from_profile" && !assessment.profileRevision) {
      return false;
    }
    if (!trimmed) return true;

    const parts: string[] = [assessment.result.asOfDate, assessment.result.rulesetVersion];
    const facts = assessment.facts;
    if (facts.legalForm && !isMarker(facts.legalForm)) parts.push(displayFact("legalForm", facts.legalForm));
    if (facts.state && !isMarker(facts.state)) parts.push(displayFact("state", facts.state));
    if (typeof facts.lga === "string" && !isMarker(facts.lga)) parts.push(facts.lga);
    if (Array.isArray(facts.activities)) parts.push(facts.activities.join(" "));
    for (const item of assessment.result.items) {
      parts.push(item.title, item.label);
    }
    return parts.join(" ").toLowerCase().includes(trimmed);
  });
}
