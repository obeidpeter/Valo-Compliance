import type { Pool, PoolClient } from "pg";
import { parseBoundedProviderJSON, type FiniteManifest, type ManagedCompletionResult } from "../ai";
import { operationalReviewSchemaFor } from "../publication";
import {
  editorialCaseCandidate,
  editorialCasePrerequisite,
  hasEditorialCasePair,
} from "./editorial-case-reviews";

/** An admitted batch as the ledger keeps it: its manifest and the provider result of each work. */
export type EditorialCaseBatch = {
  id: string;
  manifest: FiniteManifest;
  results: Record<string, unknown> | null;
};

/** The admitted pairs of these cases, with the results the dispatcher kept. Read outside any
 * transaction, before a step that depends on them. */
export async function readEditorialCaseBatches(db: Pool | PoolClient, caseIds: string[]) {
  const { rows } = await db.query(
    `SELECT id, manifest, results FROM valo_inference_batches
     WHERE manifest->'works'->0->'bindings'->>'caseId' = ANY($1::text[])`,
    [caseIds],
  );
  return rows as EditorialCaseBatch[];
}

/**
 * What the editorial suite records for a case-bound case (decision 0015, point 4): the two reviews
 * of its latest admitted pair, read from the results the dispatcher kept, as their answers stand.
 * A case whose candidate the gate could never release has no automatic pass: with both reviews in,
 * an independent reviewer decides whether they found the case's defect and whether the hold rests on
 * a real unmet gate (point 5). Without both, the case is blocked.
 *
 * A follow-up case (C060) also needs the case it follows to have been held by its real reviews in a
 * pair prepared before its own, so the batches passed must include that case's too. Without that
 * hold it is blocked, whatever its own reviews say, and with it the record names the holding pair.
 */
export function editorialCaseOutcome(caseId: string, batches: EditorialCaseBatch[]) {
  if (!hasEditorialCasePair(caseId))
    return { status: "blocked" as const, reason: "case_review_pair_not_prepared" };
  const outcome = latestPairOutcome(caseId, batches);
  const prior = editorialCasePrerequisite(caseId);
  if (!prior) return outcome;
  const own = "batchId" in outcome ? batches.find((b) => b.id === outcome.batchId) : undefined;
  const prerequisite = heldBy(prior, batches, own?.manifest.preparedAt ?? new Date().toISOString());
  if (!prerequisite)
    return {
      status: "blocked" as const,
      reason: "prerequisite_not_met",
      ...(own ? { batchId: own.id } : {}),
    };
  return { ...outcome, prerequisite };
}

/**
 * A follow-up case is prepared, admitted and run only while the case it follows is held by its real
 * reviews: that case's latest admitted pair has both reviews, and at least one holds. Returns that
 * pair, which keeps the failed evidence, or null for a case with no prerequisite.
 */
export function assertEditorialCasePrerequisite(caseId: string, batches: EditorialCaseBatch[]) {
  const prior = editorialCasePrerequisite(caseId);
  if (!prior) return null;
  const held = heldBy(prior, batches);
  if (!held) throw Error("EDITORIAL_CASE_PREREQUISITE_NOT_MET");
  return held;
}

/** The case's latest admitted pair, among those prepared before `before` when given, if both of its
 * reviews are valid and at least one holds. */
function heldBy(caseId: string, batches: EditorialCaseBatch[], before?: string) {
  const earlier =
    before === undefined
      ? batches
      : batches.filter((b) => Date.parse(b.manifest?.preparedAt) < Date.parse(before));
  const outcome = latestPairOutcome(caseId, earlier);
  return outcome.status === "needs_evaluator_decision" && outcome.reviews.some((r) => r.verdict === "hold")
    ? { caseId, batchId: outcome.batchId }
    : null;
}

function latestPairOutcome(caseId: string, batches: EditorialCaseBatch[]) {
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
    reviews: reviews.filter((r) => r !== null),
  };
}
