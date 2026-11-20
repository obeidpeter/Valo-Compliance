import { parseBoundedProviderJSON, type FiniteManifest, type ManagedCompletionResult } from "../ai";
import { operationalReviewSchemaFor } from "../publication";
import { editorialCaseCandidate, isPreparableEditorialCase } from "./editorial-case-reviews";

/** An admitted batch as the ledger keeps it: its manifest and the provider result of each work. */
export type EditorialCaseBatch = {
  id: string;
  manifest: FiniteManifest;
  results: Record<string, unknown> | null;
};

/**
 * What the editorial suite records for a case-bound case (decision 0015, point 4): the two reviews
 * of its latest admitted pair, read from the results the dispatcher kept, as their answers stand.
 * A case whose candidate the gate could never release has no automatic pass: with both reviews in,
 * an independent reviewer decides whether they found the case's defect and whether the hold rests on
 * a real unmet gate (point 5). Without both, the case is blocked.
 */
export function editorialCaseOutcome(caseId: string, batches: EditorialCaseBatch[]) {
  if (!isPreparableEditorialCase(caseId))
    return { status: "blocked" as const, reason: "case_review_pair_not_prepared" };
  const c = editorialCaseCandidate(caseId);
  const runs = batches
    .filter(
      (b) =>
        b.manifest?.works?.length === 2 &&
        b.manifest.works.every(
          (w) =>
            w.lane === "editorial_evaluation" &&
            w.bindings.caseId === caseId &&
            w.candidateHash === c.candidate.hash &&
            w.caseHash === c.caseHash,
        ),
    )
    .sort((a, b) => Date.parse(a.manifest.preparedAt) - Date.parse(b.manifest.preparedAt));
  const run = runs.at(-1);
  if (!run) return { status: "blocked" as const, reason: "no_admitted_review_pair" };
  const reviews = run.manifest.works.map((w) => {
    const result = run.results?.[w.key] as ManagedCompletionResult | undefined;
    const choice = result?.choices?.[0];
    if (!result || choice?.finish_reason !== "stop") return null;
    try {
      const output = operationalReviewSchemaFor(c.candidate).parse(
        parseBoundedProviderJSON(choice.message.content ?? ""),
      );
      return {
        role: w.role,
        providerResponseId: result.id,
        model: result.model,
        verdict: output.verdict,
        findings: output.findings,
        missingEvidence: output.missingEvidence,
      };
    } catch {
      // A result that is not a valid review leaves that review missing; the case stays blocked.
      return null;
    }
  });
  if (reviews.some((r) => r === null))
    return { status: "blocked" as const, reason: "review_pair_incomplete", batchId: run.id };
  return {
    status: "needs_evaluator_decision" as const,
    reason: "An independent reviewer decides whether each review found the case's defect.",
    batchId: run.id,
    candidateHash: c.candidate.hash,
    reviews,
  };
}
