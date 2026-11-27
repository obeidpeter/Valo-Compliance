import type { ProfileRecheck } from "@workspace/api-client-react";
import { factLabel } from "./checker";
import { formatDateTime } from "./format";

/** "A", "A and B", "A, B and C". */
function listed(names: readonly string[]): string {
  return names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * PRO-003: the words of the offer of a new requirements check, made after the business profile
 * changes an answer the check reads. The server decides when, and names the result and the answers
 * (`Workspace.recheck`); the answers are named as a saved result and a comparison name them.
 */
export function recheckWords(recheck: ProfileRecheck) {
  const names = recheck.changed.map(factLabel);
  return {
    title: "Your business profile has changed since your last saved result",
    changed: `${names.length === 1 ? "This answer has" : "These answers have"} changed since the result saved on ${formatDateTime(recheck.savedAt)}: ${listed(names)}.`,
    kept: "Check again to see what that means for your requirements. Your saved results and your tasks stay as they are.",
    action: "Check again with my profile",
  };
}

/**
 * Where the offer sends: the check, filled in from the profile as it is now, and told which result it
 * follows, so that the new result opens beside it (`savedResultHref`).
 */
export function recheckHref(recheck: Pick<ProfileRecheck, "assessmentId">): string {
  return `/workspace/checker?prefill=profile&since=${encodeURIComponent(recheck.assessmentId)}`;
}

/** The earlier result a check says it follows (`recheckHref`), when its address names one. */
export function followedResult(search: string): string {
  const since = new URLSearchParams(search).get("since")?.trim() ?? "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(since) ? since : "";
}

/**
 * A newly saved result's page. One that follows an earlier result opens compared with it: "changed
 * location, activities or employee count produces a dated comparison".
 */
export function savedResultHref(id: string, follows: string): string {
  const page = `/workspace/assessments/${encodeURIComponent(id)}`;
  return follows && follows !== id ? `${page}?compare=${encodeURIComponent(follows)}` : page;
}
