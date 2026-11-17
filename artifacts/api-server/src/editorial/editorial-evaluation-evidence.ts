import assert from "node:assert/strict";
import {
  candidateDigest,
  digest,
  evaluatePublication,
  publicationSchema,
  sha256,
  type PublicationBundle,
} from "@workspace/valo-core";
import type { ArtifactRef } from "./publication-artifacts";

type Attestations = {
  reviews: ArtifactRef[];
  provenance: ArtifactRef;
  rights: ArtifactRef;
  exportReport: ArtifactRef;
};
type ReviewedSummary = {
  id: string;
  version: number;
  candidateHash: string;
  attestations: Attestations;
  reviews: {
    role: "factual" | "challenge";
    providerResponseId: string;
    model: string;
    verdict: "pass" | "hold";
    findings: string[];
  }[];
};
const boundAttestations = (a: Attestations) => ({
  provenance: a.provenance,
  rights: a.rights,
  exportReport: a.exportReport,
  reviews: [...a.reviews].sort((x, y) => x.id.localeCompare(y.id)),
});

/** The summary file, persisted row, bundle and retrieved receipt references
 * must identify the same baseline. This does not certify publication eligibility. */
export function reviewedBaselineEvidence(
  retained: { id: string; version: number; candidateHash: string; bundle: unknown; attestations: unknown },
  sourceBytes: Uint8Array,
  sourcePath: string,
) {
  const summary = JSON.parse(Buffer.from(sourceBytes).toString()) as ReviewedSummary;
  const bundle = publicationSchema.parse(retained.bundle),
    attestations = retained.attestations as Attestations;
  assert.equal(
    sourcePath,
    `docs/valo/evidence/operational-publication-v${summary.version}.json`,
    "REVIEW_BASELINE_SOURCE_PATH_MISMATCH",
  );
  assert.equal(retained.id, summary.id, "REVIEW_BASELINE_ID_MISMATCH");
  assert.equal(retained.version, summary.version, "REVIEW_BASELINE_VERSION_MISMATCH");
  assert.equal(bundle.candidate.version, summary.version, "REVIEW_BASELINE_VERSION_MISMATCH");
  assert.equal(retained.candidateHash, summary.candidateHash, "REVIEW_BASELINE_CANDIDATE_MISMATCH");
  assert.equal(
    candidateDigest(bundle.candidate),
    summary.candidateHash,
    "REVIEW_BASELINE_CANDIDATE_MISMATCH",
  );
  assert.equal(bundle.candidate.hash, summary.candidateHash, "REVIEW_BASELINE_CANDIDATE_MISMATCH");
  assert.equal(
    digest(boundAttestations(attestations)),
    digest(boundAttestations(summary.attestations)),
    "REVIEW_BASELINE_ATTESTATIONS_MISMATCH",
  );
  assert.equal(bundle.reviews.length, 2, "REVIEW_BASELINE_ROLES_MISMATCH");
  assert.equal(summary.reviews.length, 2, "REVIEW_BASELINE_ROLES_MISMATCH");
  for (const role of ["factual", "challenge"] as const) {
    const actual = bundle.reviews.filter((r) => r.role === role),
      saved = summary.reviews.filter((r) => r.role === role);
    assert.equal(actual.length, 1, "REVIEW_BASELINE_ROLES_MISMATCH");
    assert.equal(saved.length, 1, "REVIEW_BASELINE_ROLES_MISMATCH");
    assert.equal(actual[0]!.runId, saved[0]!.providerResponseId, "REVIEW_BASELINE_RESPONSE_MISMATCH");
    assert.equal(actual[0]!.model, saved[0]!.model, "REVIEW_BASELINE_MODEL_MISMATCH");
    assert.equal(actual[0]!.verdict, saved[0]!.verdict, "REVIEW_BASELINE_VERDICT_MISMATCH");
    assert.deepEqual(actual[0]!.findings, saved[0]!.findings, "REVIEW_BASELINE_FINDINGS_MISMATCH");
  }
  return {
    bundle: structuredClone(bundle),
    evidence: {
      baselineId: retained.id,
      baselineVersion: retained.version,
      baselineCandidateHash: summary.candidateHash,
      baselineBundleHash: digest(bundle),
      originalBaselineEligible: evaluatePublication(bundle).decision === "eligible",
      retainedVersion: summary.version,
      reviewEvidencePath: sourcePath,
      reviewEvidenceHash: sha256(sourceBytes),
      reviewArtifacts: structuredClone(attestations.reviews),
      reviewRuns: summary.reviews.map((r) => ({ ...r })),
    },
  };
}

/** A negative control must introduce its target failure. An already-held
 * baseline is allowed, but an already-broken target is not a new proof. */
export function publicationHoldTransition(
  baseline: PublicationBundle,
  mutate: (bundle: PublicationBundle) => void,
  target: RegExp,
) {
  const before = evaluatePublication(baseline);
  assert.ok(!before.reasons.some((r) => target.test(r)), "TARGET_FAILURE_ALREADY_PRESENT_IN_BASELINE");
  const changed = structuredClone(baseline);
  mutate(changed);
  const result = evaluatePublication(changed);
  assert.equal(result.decision, "hold");
  const targetReasons = result.reasons.filter((r) => target.test(r));
  assert.ok(targetReasons.length, "TARGET_FAILURE_NOT_INTRODUCED");
  assert.notEqual(digest(changed), digest(baseline), "BASELINE_NOT_MUTATED");
  return {
    decision: result.decision,
    targetReasons,
    baselineReasons: before.reasons,
    baselineBundleHash: digest(baseline),
    bundleHash: digest(changed),
    mutatedCandidateHash: candidateDigest(changed.candidate),
    originalBaselineEligible: before.decision === "eligible",
  };
}

export const editorialDeniedActions = ["price", "payment", "government_filing"] as const;
export type EditorialDeniedAction = (typeof editorialDeniedActions)[number];
export type EditorialDenialReceipt = {
  auditId: string;
  versionId: string;
  requestedAction: EditorialDeniedAction;
  evaluationRunId: string | null;
};
export const editorialDenialReason = (action: EditorialDeniedAction, runId: string | null) =>
  `Editorial scope excludes ${action}; no external action dispatched.${runId ? ` Evaluation run ${runId}.` : ""}`;
export class EditorialExternalActionDenied extends Error {
  constructor(public readonly denial: EditorialDenialReceipt) {
    super("EDITORIAL_EXTERNAL_ACTION_FORBIDDEN");
  }
}
export type EditorialDenialAuditRow = {
  id: string;
  version_id: string;
  action: string;
  actor: string;
  reason: string;
};
/** Read back the precise committed rows returned by these three invocations.
 * Old aggregate counts, another run, or a different action cannot satisfy this. */
export function verifyCurrentEditorialDenials(
  versionId: string,
  runId: string,
  receipts: EditorialDenialReceipt[],
  rows: EditorialDenialAuditRow[],
  previousIds: readonly string[] = [],
) {
  assert.equal(receipts.length, 3, "CURRENT_DENIAL_RECEIPTS_INCOMPLETE");
  assert.ok(
    receipts.every((r) => !previousIds.includes(r.auditId)),
    "CURRENT_DENIAL_NOT_NEW",
  );
  assert.equal(new Set(receipts.map((r) => r.auditId)).size, 3, "CURRENT_DENIAL_IDS_NOT_DISTINCT");
  assert.equal(rows.length, 3, "CURRENT_DENIAL_ROWS_INCOMPLETE");
  assert.equal(new Set(rows.map((r) => r.id)).size, 3, "CURRENT_DENIAL_ROWS_NOT_DISTINCT");
  for (const action of editorialDeniedActions) {
    const matching = receipts.filter((r) => r.requestedAction === action);
    assert.equal(matching.length, 1, "CURRENT_DENIAL_ACTION_MISMATCH");
    const receipt = matching[0]!;
    assert.equal(receipt.versionId, versionId, "CURRENT_DENIAL_VERSION_MISMATCH");
    assert.equal(receipt.evaluationRunId, runId, "CURRENT_DENIAL_RUN_MISMATCH");
    const row = rows.find((r) => r.id === receipt.auditId);
    assert.ok(row, "CURRENT_DENIAL_ROW_MISSING");
    assert.equal(row.version_id, versionId, "CURRENT_DENIAL_VERSION_MISMATCH");
    assert.equal(row.action, "external_action_denied", "CURRENT_DENIAL_ACTION_MISMATCH");
    assert.equal(row.actor, "bounded-publisher", "CURRENT_DENIAL_ACTOR_MISMATCH");
    assert.equal(row.reason, editorialDenialReason(action, runId), "CURRENT_DENIAL_REASON_MISMATCH");
  }
  return receipts.map((r) => ({ ...r }));
}
