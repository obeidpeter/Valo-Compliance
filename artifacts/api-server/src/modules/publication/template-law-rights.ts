import { digest, type PublicationBundle } from "@workspace/valo-core";
import { documentInput } from "../../lib/valo-validation";
import { measureGuideCopying, type GuideCopyingMeasure } from "./guidance-copying";
import type { ArtifactRef } from "./publication-artifacts";
import { templateWords } from "./template-claim-map";
import { TEMPLATE_LAW_PART } from "./template-law-candidate";
import { TEMPLATE_LAW_POLICY_PATH } from "./template-law-policy";

/**
 * The rights record of a template that states the law (docs/architecture/reviewed-route.md, part 4),
 * on the guide's model. Two different rights are involved, and the record keeps them apart:
 *
 * - The template's own wording. The record is the one a guide uses: the provider's terms, captured
 *   within a day, with the passages that assign the output and allow commercial use.
 * - Official text. A template explains and names its sources; it does not copy them. That is
 *   measured: the longest run of words the template shares with any passage it cites, against the
 *   policy's limit.
 *
 * Its basis is the policy for templates that state the law, so a policy the owner has not approved
 * clears nothing. The record claims no copyright opinion, exclusivity or clearance of anyone else's
 * rights.
 */
export type LawTemplateRightsRecord = {
  kind: "valo-template-law-rights-1";
  /** The provider's terms as captured. */
  snapshot: ArtifactRef;
  provenanceHash: string;
  statesLaw: true;
  applicabilityHash: string;
  applicability: unknown;
  customerLicenceAccepted: false;
  checkedAt: string;
  validUntil: string;
  authoringRoute: "coordinator_chatgpt";
  officialText: GuideCopyingMeasure & {
    rule: string;
    /** The policy file whose point 8 this measures, and that file's hash. */
    policyPath: string;
    policyFileHash: string;
  };
  conclusion: string;
  permissions: unknown[];
};

export const LAW_TEMPLATE_RIGHTS_RULE =
  "A template explains official text in its own words and names the passages it rests on. It repeats no more than the limit of words in a row from any passage it cites.";
export const LAW_TEMPLATE_RIGHTS_CONCLUSION =
  "The provider's permissions for the template's own wording, and the measure of wording repeated from official passages, were checked for this free development release only. The provider's execution records for the drafting are not held. No copyright opinion, exclusivity, non-infringement or clearance of anyone else's rights is claimed, for the template's wording or for the official texts it rests on. Not for sale; no customer licence is accepted.";

type LawTemplateBundle = Pick<PublicationBundle, "candidate" | "sources">;
const parts: readonly string[] = Object.values(TEMPLATE_LAW_PART);

/** A template's own words out of its whole document: every block that is not one of the added parts. */
export function lawTemplateOwnWords(body: string) {
  const parsed = documentInput.safeParse(JSON.parse(body));
  if (!parsed.success) throw Error("TEMPLATE_RIGHTS_BODY_NOT_A_DOCUMENT");
  return templateWords(parsed.data.content.blocks.filter((b) => !parts.includes(b.id)));
}

/** The measure for a candidate: its own words against the passages it cites. */
export function measureLawTemplateCopying(bundle: LawTemplateBundle) {
  return measureGuideCopying(lawTemplateOwnWords(bundle.candidate.body), bundle.sources);
}

const policyFileHashOf = (policy: PublicationBundle["policy"]) =>
  policy.authorityRefs?.find((ref) => ref.path === TEMPLATE_LAW_POLICY_PATH)?.hash;

export function lawTemplateRightsRecord(input: {
  bundle: LawTemplateBundle;
  snapshot: ArtifactRef;
  provenanceArtifactHash: string;
  applicability: { record: { evidence: unknown[] }; hash: string };
  policy: PublicationBundle["policy"];
  now: Date;
}): LawTemplateRightsRecord {
  const { bundle, applicability, policy } = input;
  const policyFileHash = policyFileHashOf(policy);
  if (!policyFileHash || !bundle.candidate.reviewBy) throw Error("TEMPLATE_RIGHTS_INPUT_INCOMPLETE");
  return {
    kind: "valo-template-law-rights-1",
    snapshot: input.snapshot,
    provenanceHash: input.provenanceArtifactHash,
    statesLaw: true,
    applicabilityHash: applicability.hash,
    applicability: applicability.record,
    customerLicenceAccepted: false,
    checkedAt: input.now.toISOString(),
    validUntil: bundle.candidate.reviewBy,
    authoringRoute: "coordinator_chatgpt",
    officialText: {
      rule: LAW_TEMPLATE_RIGHTS_RULE,
      policyPath: TEMPLATE_LAW_POLICY_PATH,
      policyFileHash,
      ...measureLawTemplateCopying(bundle),
    },
    conclusion: LAW_TEMPLATE_RIGHTS_CONCLUSION,
    permissions: applicability.record.evidence,
  };
}

/**
 * Why a template's rights record does not clear it, measured again from the candidate itself. An
 * empty list means every condition holds.
 */
export function lawTemplateRightsProblems(input: {
  rights: LawTemplateRightsRecord;
  bundle: LawTemplateBundle;
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
  const measured = measureLawTemplateCopying(bundle);
  fail(
    rights.kind !== "valo-template-law-rights-1" || rights.statesLaw !== true,
    "rights_record_not_for_a_template_that_states_the_law",
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
    rights.officialText.rule !== LAW_TEMPLATE_RIGHTS_RULE ||
      rights.officialText.policyPath !== TEMPLATE_LAW_POLICY_PATH ||
      rights.officialText.policyFileHash !== policyFileHashOf(policy),
    "rights_official_text_rule_changed",
  );
  const { rule: _rule, policyPath: _path, policyFileHash: _hash, ...recorded } = rights.officialText;
  fail(digest(recorded) !== digest(measured), "rights_copying_measure_changed");
  fail(!measured.withinLimit, `rights_official_text_copied:${measured.longestSharedWords}_words_in_a_row`);
  fail(!policy.ownerApproved, "rights_basis_not_approved_by_owner");
  return problems;
}

/** The rights entry a template's bundle carries: cleared only when nothing above is wrong. */
export function lawTemplateBundleRights(rights: LawTemplateRightsRecord, problems: readonly string[]) {
  const cleared = problems.length === 0;
  return {
    status: cleared ? ("cleared" as const) : ("unknown" as const),
    commercialUse: cleared,
    evidence: JSON.stringify(rights),
    evidenceHash: digest(rights),
  };
}
