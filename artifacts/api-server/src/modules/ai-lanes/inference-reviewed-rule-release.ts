import { evaluatePublication, isPreparedRuleId } from "@workspace/valo-core";
import { requestDigest } from "../ai";
import type { RuleReleaseRequest } from "../editorial";
import { getPublicationArtifact, putPublicationArtifact, type ArtifactRef } from "../publication";
import { assertDevelopmentRuntime } from "../../platform/valo-development-runtime";
import {
  pairReviewParts,
  readReviewedPairBatch,
  verifiedPairReviews,
} from "./inference-reviewed-publication";

/** The kind of a reviewed rule's release request as it is kept (docs/architecture/reviewed-route.md, part 3). */
export const REVIEWED_RULE_RELEASE_REQUEST = "reviewed-rule-release-request-v1";

/**
 * The reviewed route's release request for a rule (docs/architecture/reviewed-route.md, part 3, slice
 * 3b). Once a prepared rule's two reviews have run under an approved batch:
 *
 * - the rule is built again from its own sources and records, as before admission and dispatch, and
 *   must still be the candidate the batch reviewed;
 * - each review must be the one the batch settled for that candidate, plan and request;
 * - the rule's bundle is made with its two reviews and the enhanced checks they ran.
 *
 * When the gate finds the bundle eligible, the request the release command reads is kept as a private
 * artifact: the rule with its manifest hash, the bundle, the scenarios, the captures its sources are
 * bound to and the reason, if one is given. When the gate holds it, the reasons are returned and
 * nothing is kept. Nothing is released and no model is called.
 */
export async function assembleReviewedRuleRelease(input: {
  batchId: string;
  reviews: ArtifactRef[];
  reason?: string;
  now?: Date;
}) {
  assertDevelopmentRuntime();
  if (!/^[-a-zA-Z0-9_:]{1,160}$/.test(input.batchId) || input.reviews.length !== 2)
    throw Error("REVIEWED_PAIR_ARGUMENTS_INVALID");
  // Loaded only when a request is assembled, so that this module's index loads no database client.
  const [{ db }, editorial] = await Promise.all([import("@workspace/db"), import("../editorial")]);
  const reason = input.reason === undefined ? undefined : editorial.ruleChangeReason(input.reason);
  if (reason === null) throw Error("RULE_RELEASE_REASON_INVALID");
  const pair = await readReviewedPairBatch(db, input.batchId);
  if (!isPreparedRuleId(pair.candidateArtifact.templateId)) throw Error("REVIEWED_PAIR_NOT_A_RULE");
  const now = input.now ?? new Date();
  const current = await editorial.readReviewedRuleReadiness(
    { candidateVersionId: pair.candidateVersionId, candidateArtifact: pair.candidateArtifact },
    { now },
  );
  if (
    current.row.candidateHash !== pair.first.candidateHash ||
    requestDigest(current.bundle) !== pair.first.caseHash
  )
    throw Error("CANDIDATE_BINDING_CHANGED");
  const reviewed = await verifiedPairReviews(
    db,
    { ...pair, batchId: input.batchId, reviews: input.reviews },
    current,
  );
  const { bundle, rule } = editorial.reviewedRuleBundle(
    current.built,
    current.exportReport,
    pairReviewParts(current.bundle, reviewed),
  );
  const eligibility = evaluatePublication(bundle, now);
  const outcome = {
    ruleId: rule.id,
    version: rule.version,
    candidateHash: bundle.candidate.hash,
    reviews: bundle.reviews.map((r) => ({ role: r.role, runId: r.runId, verdict: r.verdict })),
  };
  if (eligibility.decision !== "eligible")
    return { ...outcome, state: "held" as const, reasons: eligibility.reasons, request: null };
  const request: RuleReleaseRequest = {
    rule,
    bundle,
    scenarios: current.prepared.scenarios,
    snapshotIds: current.serverEvidence.sourceSnapshots,
    ...(reason ? { reason } : {}),
  };
  const artifact = await putPublicationArtifact(
    Buffer.from(
      JSON.stringify({
        kind: REVIEWED_RULE_RELEASE_REQUEST,
        batchId: input.batchId,
        reviews: input.reviews,
        request,
      }),
    ),
    "json",
  );
  return {
    ...outcome,
    state: "ready" as const,
    reasons: [],
    manifestHash: rule.manifestHash,
    request: { ...artifact, extension: "json" as const },
  };
}

/** A reviewed rule's release request, read back from the private artifact it was kept as. */
export async function readReviewedRuleReleaseRequest(ref: ArtifactRef): Promise<RuleReleaseRequest> {
  const kept = JSON.parse((await getPublicationArtifact(ref)).toString()) as {
    kind?: unknown;
    request?: RuleReleaseRequest;
  };
  if (kept.kind !== REVIEWED_RULE_RELEASE_REQUEST || !kept.request)
    throw Error("RULE_RELEASE_REQUEST_INVALID");
  return kept.request;
}
