import { digest, type PublicationBundle } from "@workspace/valo-core";
import { measureGuideCopying, type GuideCopyingMeasure } from "./guidance-copying";
import { guidePageText } from "./guidance-document";
import { GUIDANCE_POLICY_PATH } from "./guidance-policy";
import type { ArtifactRef } from "./publication-artifacts";

/**
 * A guide's rights record (decision 0017, point 3). Two different rights are involved, and the
 * record keeps them apart:
 *
 * - Valo's own wording. The record is the one a template uses: the provider's terms, captured within
 *   a day, with the passages that assign the output and allow commercial use.
 * - Official text. A guide explains, cites and links; it does not copy. That is measured: the
 *   longest run of words the guide shares with any passage it cites, against the policy's limit.
 *
 * The record claims no copyright opinion, exclusivity or clearance of anyone else's rights.
 */
export type GuideRightsRecord = {
  kind: "valo-guide-rights-1";
  /** The provider's terms as captured. */
  snapshot: ArtifactRef;
  provenanceHash: string;
  sourcedGuidance: true;
  applicabilityHash: string;
  applicability: unknown;
  customerLicenceAccepted: false;
  checkedAt: string;
  validUntil: string;
  authoringRoute: "coordinator_chatgpt";
  officialText: GuideCopyingMeasure & {
    rule: string;
    /** The policy file whose point 7 this measures, and that file's hash. */
    policyPath: string;
    policyFileHash: string;
  };
  conclusion: string;
  permissions: unknown[];
};

export const GUIDE_RIGHTS_RULE =
  "A guide explains official text in its own words, names the section and links to the official address. It repeats no more than the limit of words in a row from any passage it cites.";
export const GUIDE_RIGHTS_CONCLUSION =
  "The provider's permissions for Valo's own wording, and the measure of wording repeated from official passages, were checked for this free development release only. The provider's execution records for the drafting are not held. No copyright opinion, exclusivity, non-infringement or clearance of anyone else's rights is claimed, for Valo's wording or for the official texts it cites. Not for sale; no customer licence is accepted.";

type GuideBundle = Pick<PublicationBundle, "candidate" | "sources">;

/** The measure for a candidate: its own words, as its page shows them, against its sources. */
export function measureCandidateCopying(bundle: GuideBundle) {
  const page = guidePageText(bundle.candidate.body);
  if (!page) throw Error("GUIDE_RIGHTS_BODY_NOT_A_GUIDE");
  return measureGuideCopying(page.body, bundle.sources);
}

export function guideRightsRecord(input: {
  bundle: GuideBundle;
  snapshot: ArtifactRef;
  provenanceArtifactHash: string;
  applicability: { record: { evidence: unknown[] }; hash: string };
  policy: PublicationBundle["policy"];
  now: Date;
}): GuideRightsRecord {
  const { bundle, applicability, policy } = input;
  const policyFileHash = policy.authorityRefs?.find((ref) => ref.path === GUIDANCE_POLICY_PATH)?.hash;
  if (!policyFileHash || !bundle.candidate.reviewBy) throw Error("GUIDE_RIGHTS_INPUT_INCOMPLETE");
  return {
    kind: "valo-guide-rights-1",
    snapshot: input.snapshot,
    provenanceHash: input.provenanceArtifactHash,
    sourcedGuidance: true,
    applicabilityHash: applicability.hash,
    applicability: applicability.record,
    customerLicenceAccepted: false,
    checkedAt: input.now.toISOString(),
    validUntil: bundle.candidate.reviewBy,
    authoringRoute: "coordinator_chatgpt",
    officialText: {
      rule: GUIDE_RIGHTS_RULE,
      policyPath: GUIDANCE_POLICY_PATH,
      policyFileHash,
      ...measureCandidateCopying(bundle),
    },
    conclusion: GUIDE_RIGHTS_CONCLUSION,
    permissions: applicability.record.evidence,
  };
}

/**
 * Why a guide's rights record does not clear it, measured again from the candidate itself. An empty
 * list means every condition holds. The basis of the record is the policy's point 7, so a policy the
 * owner has not approved clears nothing.
 */
export function guideRightsProblems(input: {
  rights: GuideRightsRecord;
  bundle: GuideBundle;
  provenanceArtifactHash: string;
  applicability: { record: { evidence: unknown[] }; hash: string; verified: boolean };
  policy: PublicationBundle["policy"];
  now: Date;
}) {
  const { rights, bundle, applicability, policy } = input;
  const problems: string[] = [];
  const fail = (condition: boolean, reason: string) => {
    if (condition) problems.push(reason);
  };
  const measured = measureCandidateCopying(bundle);
  const policyFileHash = policy.authorityRefs?.find((ref) => ref.path === GUIDANCE_POLICY_PATH)?.hash;
  fail(
    rights.kind !== "valo-guide-rights-1" || rights.sourcedGuidance !== true,
    "rights_record_not_for_a_guide",
  );
  fail(rights.customerLicenceAccepted !== false, "rights_customer_licence_marked_accepted");
  fail(rights.provenanceHash !== input.provenanceArtifactHash, "rights_provenance_mismatch");
  fail(rights.authoringRoute !== "coordinator_chatgpt", "rights_authoring_route_unknown");
  fail(!applicability.verified, "rights_provider_permission_unverified");
  fail(
    rights.applicabilityHash !== applicability.hash ||
      digest(rights.permissions) !== digest(applicability.record.evidence),
    "rights_provider_permission_changed",
  );
  fail(
    !Number.isFinite(Date.parse(rights.validUntil)) ||
      Date.parse(rights.validUntil) <= +input.now ||
      rights.validUntil !== bundle.candidate.reviewBy,
    "rights_record_expired_or_unbound",
  );
  fail(
    rights.officialText.rule !== GUIDE_RIGHTS_RULE ||
      rights.officialText.policyPath !== GUIDANCE_POLICY_PATH ||
      rights.officialText.policyFileHash !== policyFileHash,
    "rights_official_text_rule_changed",
  );
  const { rule: _rule, policyPath: _path, policyFileHash: _hash, ...recorded } = rights.officialText;
  fail(digest(recorded) !== digest(measured), "rights_copying_measure_changed");
  fail(!measured.withinLimit, `rights_official_text_copied:${measured.longestSharedWords}_words_in_a_row`);
  fail(!policy.ownerApproved, "rights_basis_not_approved_by_owner");
  return problems;
}

/** The rights entry a guide's bundle carries: cleared only when nothing above is wrong. */
export function guideBundleRights(rights: GuideRightsRecord, problems: readonly string[]) {
  const cleared = problems.length === 0;
  return {
    status: cleared ? ("cleared" as const) : ("unknown" as const),
    commercialUse: cleared,
    evidence: JSON.stringify(rights),
    evidenceHash: digest(rights),
  };
}
