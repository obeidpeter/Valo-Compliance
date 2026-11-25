import { formatCount, formatDateTime } from "./format";

/**
 * The words for the acceptance cases page (decision 0016, docs/architecture/reviewer-record.md, slice 1):
 * an independent reviewer confirms or rejects each case's expected outcome, with why, for the case's
 * words as the reviewer read them. The words are the owner's to confirm.
 */
export type AcceptanceCorpusName = "editorial" | "checker" | "customer_ai";
export const corpusNames: { value: AcceptanceCorpusName; label: string }[] = [
  { value: "editorial", label: "Editorial cases" },
  { value: "checker", label: "Rule scenarios" },
  { value: "customer_ai", label: "Customer AI cases" },
];
export const pageHeading = "Acceptance cases";
export const pageIntro =
  "Read each case's expected outcome against the sources it cites, then confirm or reject it and say why. A decision holds only for the case's words as you read them: if they change, the case needs a new decision. Nothing here accepts a case or a requirement. Accepting a requirement stays the owner's decision.";
export const roleNote =
  "Only an acceptance reviewer who signed in with both factors recently sees these cases. A reviewer cannot also prepare content.";
export const claimHeading = "What a confirmation claims";
export const expectedHeading = "Expected outcome";
export const criticalHeading = "Critical failure conditions";
export const sourcesHeading = "Sources";
export const noDecision = "No decision on these words yet.";
export const decideButton = "Record a decision";
export const answerLegend = "Your decision";
export const confirmLabel = "Confirm: the expected outcome follows from the cited sources";
export const rejectLabel = "Reject: the expected outcome does not follow from the cited sources";
export const reasonLabel = "Why";
export const reasonHint =
  "Say why, in 20 to 2,000 characters: what in the cited sources supports or contradicts the expected outcome.";
export const saveButton = "Save the decision";
export const leaveDescription =
  "You started a decision that has not been saved. Stay here to finish it, or leave and discard what you wrote.";

export type CaseFilter = "all" | "open" | "confirmed" | "rejected";
export const caseFilters: { value: CaseFilter; label: string }[] = [
  { value: "all", label: "All cases" },
  { value: "open", label: "Without a decision" },
  { value: "confirmed", label: "Confirmed" },
  { value: "rejected", label: "Rejected" },
];
/** Whether a case shows under a filter, by its latest decision on its current words. */
export function shownUnder(filter: CaseFilter, decision: { answer: "confirmed" | "rejected" } | null) {
  if (filter === "all") return true;
  if (filter === "open") return decision === null;
  return decision?.answer === filter;
}

/** Where a corpus stands, on its cases' current words. */
export function tallyLine(cases: number, confirmed: number, rejected: number) {
  const open = cases - confirmed - rejected;
  return `${formatCount(confirmed)} confirmed, ${formatCount(rejected)} rejected and ${formatCount(open)} without a decision, of ${formatCount(cases)} cases.`;
}

/** The latest decision on a case's current words, and how many came before it. */
export function decisionLine(
  decision: { answer: "confirmed" | "rejected"; reviewer: string; createdAt: string },
  decisions: number,
) {
  const what = decision.answer === "confirmed" ? "Confirmed" : "Rejected";
  const earlier = decisions - 1;
  const before =
    earlier > 0 ? ` · ${formatCount(earlier)} earlier ${earlier === 1 ? "decision" : "decisions"}` : "";
  return `${what} by ${decision.reviewer} on ${formatDateTime(decision.createdAt)}${before}`;
}

export function recordedMessage(caseId: string, answer: "confirmed" | "rejected") {
  return `Recorded: you ${answer === "confirmed" ? "confirmed" : "rejected"} the expected outcome of ${caseId}.`;
}

/* The latest kept run (docs/architecture/reviewer-record.md, slice 2). */
export type AcceptanceView = "expected" | "run";
export const viewNames: { value: AcceptanceView; label: string }[] = [
  { value: "expected", label: "Expected outcomes" },
  { value: "run", label: "The latest kept run" },
];
export const runIntro =
  "A suite's command keeps a run for review: every case with the suite's own result, and for each case the suite cannot score itself, what it left for a reviewer. Decide whether the run met each such case, and say why. A decision holds only for the run and the case as kept.";
export const noRun =
  "No run of this suite is kept for review yet. Its command keeps one when it is run with --keep-for-review.";
export const nothingKept = "The run kept nothing on this case to judge.";
export const staleCase =
  "The case's words have changed since this run was kept, so a decision would be about other words.";
export const runAnswerLegend = "Did the run meet the case?";
export const metLabel = "Met: the run's result meets the case";
export const notMetLabel = "Not met: the run's result does not meet the case";
export const runReasonHint =
  "Say why, in 20 to 2,000 characters: what in the run's result meets the case, or what it misses.";

const plainStatus = (status: string) => status.replace(/_/gu, " ");

/** Who kept the run, when, and how many cases it holds. */
export function keptRunLine(run: { keptBy: string; createdAt: string; cases: number }) {
  return `Kept by ${run.keptBy.replace(/^operator:/u, "")} on ${formatDateTime(run.createdAt)} · ${formatCount(run.cases)} cases`;
}
/** The suite's own results in the run, by status. */
export function runStatusesLine(statuses: { status: string; count: number }[]) {
  return `The suite's own results: ${statuses.map((s) => `${formatCount(s.count)} ${plainStatus(s.status)}`).join(", ")}.`;
}
/** Where the cases the run left for a reviewer stand. */
export function runTallyLine(left: number, met: number, notMet: number) {
  return `${formatCount(met)} met, ${formatCount(notMet)} not met and ${formatCount(left - met - notMet)} without a decision, of ${formatCount(left)} left for a reviewer.`;
}
export function runCaseStatusLine(status: string, reason: string | null) {
  return reason
    ? `The suite's result: ${plainStatus(status)}. ${reason}`
    : `The suite's result: ${plainStatus(status)}.`;
}
/** The latest decision on a case as kept, and how many came before it. */
export function runDecisionLine(
  decision: { answer: "met" | "not_met"; reviewer: string; createdAt: string },
  decisions: number,
) {
  const what = decision.answer === "met" ? "Met" : "Not met";
  const earlier = decisions - 1;
  const before =
    earlier > 0 ? ` · ${formatCount(earlier)} earlier ${earlier === 1 ? "decision" : "decisions"}` : "";
  return `${what}, by ${decision.reviewer} on ${formatDateTime(decision.createdAt)}${before}`;
}
export function recordedRunMessage(caseId: string, answer: "met" | "not_met") {
  return `Recorded: you decided the run ${answer === "met" ? "met" : "did not meet"} ${caseId}.`;
}
