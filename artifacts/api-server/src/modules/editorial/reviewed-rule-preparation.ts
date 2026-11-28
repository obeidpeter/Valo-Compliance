import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { digest, evaluatePublication, isPreparedRuleId } from "@workspace/valo-core";
import { renderDocument } from "../../lib/valo-render";
import { assertDevelopmentRuntime } from "../../platform/valo-development-runtime";
import {
  assertDrafterCanLogIn,
  capturedGuidePassages,
  developmentPublicationOnly,
  guideAmendmentRecords,
  guidancePolicy,
  guideOpenReasons,
  inspectOperationalExports,
  putPublicationArtifact,
  savePreparedCandidate,
  type AmendmentRecord,
} from "../publication";
import { currentSourceCaptures, type CurrentSourceCapture } from "../sources";
import { ownerRuleCandidates, type OwnerRuleCandidate } from "./owner-rule-candidates";
import { buildReviewedRule, reviewedRuleBundle, RULE_SHEET_NOTICE } from "./reviewed-rule";
import { unique } from "./rule-sources";

/** Where a rule on the reviewed route was written, as its candidate keeps it: what is known, and no more. */
export function repositoryRuleProvenance(prepared: OwnerRuleCandidate) {
  return {
    kind: "repository-rule-v1" as const,
    ruleId: prepared.rule.id,
    requirementVersionId: prepared.rule.requirementVersionId,
    candidateDigest: digest(prepared),
    path: "artifacts/api-server/src/modules/editorial/owner-rule-candidates.ts",
    written:
      "Prepared in the repository for the owner's sign-off (decision 0020) and built for the reviewed route from that preparation. Its rights record says how its wording came to be. The model that drafted it is not recorded, and no model run of Valo's own produced it.",
  };
}

type Options = {
  /** Stands in for the repository's rules (tests). */
  candidates?: readonly OwnerRuleCandidate[];
  /** Stands in for the captures the daily source check holds (tests). */
  captures?: readonly CurrentSourceCapture[];
  records?: readonly AmendmentRecord[];
  now?: Date;
};

/**
 * Prepares a rule from the repository for its two reviews on the reviewed route
 * (docs/architecture/reviewed-route.md, part 3; slice 3a).
 *
 * The rule's next version is built from today's captures of its official sources and put through the
 * gate with everything but the reviews: the guidance policy, its rights record, its sources'
 * decisions, its mechanical checks and both of its files.
 *
 * - If anything other than the two missing reviews holds it, the reasons are returned and nothing is
 *   kept.
 * - Otherwise it is kept as a prepared candidate, as a guide is: a private artifact awaiting its
 *   reviews, with a row on drafting's own login that lets staff find it. It becomes a rule version only
 *   once both reviews have passed and the release command applies it.
 *
 * Nothing here calls a model, approves anything or releases a rule.
 */
export async function prepareReviewedRuleCandidate(ruleId: string, options: Options = {}) {
  assertDevelopmentRuntime();
  developmentPublicationOnly();
  const prepared = (options.candidates ?? ownerRuleCandidates).find((c) => c.rule.id === ruleId);
  if (!prepared || !isPreparedRuleId(prepared.rule.requirementVersionId)) throw Error("RULE_NOT_PREPARED");
  const { db, drafterDb, valoPreparedCandidates } = await import("@workspace/db");
  // A rule that passes is kept as a candidate, which only drafting's own login may add. The preparation
  // finds out now, before anything is read, rendered or saved, whether drafting can log in.
  await assertDrafterCanLogIn();
  const now = options.now ?? new Date();
  // The next version after every version stored on either route.
  const stored = await db.execute<{ version: number }>(
    sql`select coalesce(max(version), 0)::int as version from valo_rule_releases where rule_id = ${ruleId}`,
  );
  const version = Number(stored.rows[0]!.version) + 1;
  const leads = unique(prepared.sources.map((s) => s.leadId));
  const captures = options.captures ?? (await currentSourceCaptures(leads, now));
  const { policy } = await guidancePolicy();
  const built = buildReviewedRule(prepared, {
    version,
    captures,
    passages: capturedGuidePassages(captures),
    records: options.records ?? guideAmendmentRecords,
    policy,
    now,
  });
  const files = {
    docx: await renderDocument(built.sheet, "docx", version, "rule_sheet"),
    pdf: await renderDocument(built.sheet, "pdf", version, "rule_sheet"),
  };
  const exportReport = await inspectOperationalExports(
    built.candidate,
    files,
    RULE_SHEET_NOTICE,
    built.sheet,
  );
  const { bundle } = reviewedRuleBundle(built, exportReport);
  const reasons = unique([
    ...built.holds,
    ...guideOpenReasons(evaluatePublication(bundle, now)),
    ...(exportReport.passed ? [] : ["export_inspection_failed"]),
  ]);
  const outcome = {
    rule: ruleId,
    requirementVersionId: prepared.rule.requirementVersionId,
    version,
    candidateHash: built.candidate.hash,
    policyHash: policy.hash,
    sourceCheckDate: built.candidate.sourceCheckDate,
    reviewBy: built.candidate.reviewBy!,
    failedChecks: built.mechanicalChecks.filter((c) => c.result !== "pass").map((c) => c.name),
  };
  // Not ready: something other than the two reviews holds it. Nothing is kept.
  if (reasons.length) return { ...outcome, state: "held" as const, reasons, candidateArtifact: null };

  const provenance = await putPublicationArtifact(
    Buffer.from(JSON.stringify(repositoryRuleProvenance(prepared))),
    "json",
  );
  const exports = {
    docx: await putPublicationArtifact(files.docx, "docx"),
    pdf: await putPublicationArtifact(files.pdf, "pdf"),
  };
  const report = await putPublicationArtifact(Buffer.from(JSON.stringify(exportReport)), "json");
  const versionId = randomUUID();
  const candidateArtifact = await savePreparedCandidate({
    kind: "valo-prepared-candidate-v1",
    versionId,
    templateId: prepared.rule.requirementVersionId,
    version,
    // A rule has no page of its own; its candidate is found by the rule's id.
    slug: ruleId,
    policyId: policy.version,
    candidateHash: built.candidate.hash,
    bundle,
    attestations: {
      // Each source, by its id in the candidate, and the capture it is bound to.
      sourceSnapshots: built.snapshotIds,
      // Where each source's passage was read from, so that the rule can be built again from its own
      // sources for its reviews.
      passages: built.passages,
      provenance,
      exports,
      exportReport: report,
      reviews: [],
    },
    reviewBy: built.candidate.reviewBy!,
    preparedAt: now.toISOString(),
  });
  // The artifact is the candidate; this row only lets staff find it in the Content area. It is added on
  // drafting's own connection, as the drafter role: the database takes it from no other.
  await drafterDb().transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE valo_content_drafter_dev`);
    await tx.insert(valoPreparedCandidates).values({
      artifactId: candidateArtifact.id,
      artifactHash: candidateArtifact.hash,
      versionId,
      templateId: prepared.rule.requirementVersionId,
      version,
      candidateHash: built.candidate.hash,
      preparedAt: now,
      reviewBy: new Date(built.candidate.reviewBy!),
    });
  });
  return { ...outcome, state: "awaiting_reviews" as const, reasons: [], id: versionId, candidateArtifact };
}
