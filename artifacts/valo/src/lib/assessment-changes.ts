import type { AssessmentChange } from "@workspace/api-client-react";

/**
 * CMP-005: why one rule's result differs between two saved assessments, in sentences a customer
 * reads. `factLabel` turns an answer's internal name into the words the checker asks it with.
 */
export function describeAssessmentChange(
  change: AssessmentChange,
  factLabel: (name: string) => string,
): string[] {
  const lines: string[] = [];
  if (change.change === "added") lines.push(`It is new in this result, marked “${change.currentLabel}”.`);
  else if (change.change === "removed")
    lines.push(`It is no longer in this result. It was marked “${change.previousLabel}”.`);
  else if (change.previousLabel !== change.currentLabel)
    lines.push(`Its result changed from “${change.previousLabel}” to “${change.currentLabel}”.`);
  if (
    change.previousVersion !== null &&
    change.currentVersion !== null &&
    change.previousVersion !== change.currentVersion
  )
    lines.push(
      `The rule was updated from version ${change.previousVersion} to version ${change.currentVersion}.`,
    );
  if (change.changedFacts.length)
    lines.push(`Your answers changed for: ${change.changedFacts.map(factLabel).join(", ")}.`);
  if (change.change === "changed" && lines.length === 0)
    lines.push("Its wording, sources or next step were updated.");
  return lines;
}
