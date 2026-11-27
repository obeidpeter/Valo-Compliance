/** Bounded publisher: no customer/draft tables, model calls, prices, money or policy writes. */
import { randomUUID } from "node:crypto";
import {
  loadRightsApplicability,
  loadChatGPTPermission,
  assertPermissionRoute,
  chatGPTSourcePath,
} from "./rights-applicability";
import { and, eq, sql } from "drizzle-orm";
import type { db } from "@workspace/db";
import { digest, evaluatePublication, publicationSchema, sha256 } from "@workspace/valo-core";
import { getPublicationArtifact, type ArtifactRef } from "./publication-artifacts";
import { developmentPublicationOnly, operationalPolicy } from "./operational-policy";
import { enhancedChecksFromReviews, operationalReviewSchemaFor } from "./operational-review-contract";
import { templateCandidate } from "./operational-content";
import type { GuideClaimScope } from "./guidance-bundle";
import {
  practicalGuideCandidate,
  practicalGuideReleasePolicy,
  readPracticalGuideIntake,
} from "./practical-guide";
import { guidanceCandidate } from "./guidance-candidate";
import { guideReferences } from "./guidance-document";
import { guideMechanicalChecks } from "./guidance-mechanical";
import { guidancePolicy } from "./guidance-policy";
import { originalFormSchema, formMarkdown } from "./operational-authoring-contract";
import { operationalMechanicalChecks } from "./operational-mechanical";
import { recheckOperationalExports } from "./operational-export-inspection";
import {
  bindReleasedSources,
  closeWithdrawnReviewWork,
  lockSourceState,
  recordSourceImpact,
} from "../sources";
import { publicationCheckTime } from "./operational-restrictions";
import { finalOperationalPublicationCheck } from "./publication-final-check";
import { reviewedGuideChecked } from "./reviewed-guide-check";
type PublicationTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const regulatorySourceHold = "REGULATORY_ARTICLE_AWAITING_OWNER_SOURCE_CHECK";

/**
 * Reviews attest to the submitted evidence. Releasing a regulatory article also needs the development
 * owner's check of its exact candidate's sources, made within the last day (decision 0018;
 * docs/architecture/reviewed-route.md, part 2). That check is not part of the bundle: the publish command
 * asks for it before it saves an eligible guide, and the publisher and the database ask again at release.
 */
export function evaluateOperationalRelease(bundle: unknown) {
  return evaluatePublication(bundle);
}

export type ReleaseAttestations = {
  sourceSnapshots?: Record<string, string>;
  provenance: ArtifactRef;
  rights: ArtifactRef;
  reviews: ArtifactRef[];
  rightsApplicabilityHash?: string;
  exports: { docx: ArtifactRef; pdf: ArtifactRef };
  exportReport: ArtifactRef;
  /** A guide's recorded claim scope: the map that classified it and where its sources were read. */
  claimScope?: ArtifactRef;
};
/** Shared trusted checks for the real publisher and rollback-only validation.
 * A future evaluation time can deny stale evidence; it can never backdate it. */
export async function validateOperationalVersionInTransaction(
  tx: PublicationTx,
  id: string,
  requestedTime?: Date,
) {
  const { valoContentVersions, valoPublicationPolicies } = await import("@workspace/db");
  developmentPublicationOnly();
  // SET ROLE on a shared development connection must not turn an explicitly
  // scoped author/reviewer call back into a publisher call.
  const actor = (await tx.execute(sql`select current_user as role`)).rows[0]?.role;
  if (actor === "valo_content_drafter_dev" || actor === "valo_content_reviewer_dev")
    throw Error("EDITORIAL_ROLE_CANNOT_PUBLISH");
  const now = publicationCheckTime(requestedTime);
  await lockSourceState(tx, true);
  await tx.execute(sql`SET LOCAL ROLE valo_content_publisher_dev`);
  const [row] = await tx
    .select()
    .from(valoContentVersions)
    .where(eq(valoContentVersions.id, id))
    .for("update");
  if (!row || !["candidate", "published"].includes(row.status)) throw Error("VERSION_NOT_RELEASABLE");
  const bundle = publicationSchema.parse(row.bundle);
  const [policy] = await tx
    .select()
    .from(valoPublicationPolicies)
    .where(eq(valoPublicationPolicies.id, row.policyId));
  // A guide says what the law requires, so it is released only under the guidance policy, which the
  // owner approves on its own (decision 0017). The templates' policy never releases one.
  const guide = bundle.candidate.contentClass === "sourced_guidance";
  const practical = bundle.candidate.contentClass === "practical_guide";
  const trusted = practical
    ? await practicalGuideReleasePolicy(bundle.candidate)
    : guide
      ? await guidancePolicy()
      : await operationalPolicy();
  if (
    !trusted ||
    !policy ||
    policy.hash !== trusted.policy.hash ||
    digest(policy.policy) !== digest(bundle.policy) ||
    bundle.policy.hash !== trusted.policy.hash ||
    !bundle.policy.developmentOnly
  )
    throw Error("POLICY_NOT_TRUSTED");
  if (row.reviewBy.toISOString() !== bundle.candidate.reviewBy || +row.reviewBy <= +now)
    throw Error("STALE_RELEASE");
  const result = evaluatePublication(bundle, now);
  if (result.decision !== "eligible") throw Error(`PUBLICATION_HELD:${result.reasons.join(",")}`);
  if ((bundle.candidate.contentClass === "general_template") !== bundle.candidate.id.startsWith("TPL-"))
    throw Error("CONTENT_CLASS_ID_MISMATCH");
  const a = row.attestations as ReleaseAttestations;
  const provenance = JSON.parse((await getPublicationArtifact(a.provenance)).toString());
  if (
    sha256(provenance.sourceText) !== provenance.hash ||
    sha256(provenance.note) !== provenance.noteHash ||
    !provenance.note.includes(provenance.hash) ||
    provenance.templateId !== bundle.candidate.id
  )
    throw Error("PROVENANCE_EVIDENCE_INVALID");
  let recorded;
  if (provenance.generation) {
    const generation = JSON.parse((await getPublicationArtifact(provenance.generation)).toString());
    const output = originalFormSchema.parse(generation.output);
    if (
      generation.providerResponseId !== bundle.draftRun.runId ||
      generation.model !== bundle.draftRun.model ||
      JSON.stringify(output) !== provenance.sourceText
    )
      throw Error("AUTHORING_RECEIPT_INVALID");
    recorded = { original: formMarkdown(output), provenance };
  } else if (provenance.path !== chatGPTSourcePath) {
    const { readTemplateIntake, readGuidanceIntake } = await import("./operational-intake");
    const intake = practical
      ? await readPracticalGuideIntake(bundle.candidate.id, row.version)
      : bundle.candidate.contentClass === "general_template"
        ? await readTemplateIntake(bundle.candidate.id, row.version)
        : await readGuidanceIntake(bundle.candidate.id, row.version);
    if (intake.sourceHash !== provenance.hash || sha256(intake.provenance.note) !== provenance.noteHash)
      throw Error("INTAKE_AUTHORING_LINEAGE_MISMATCH");
    recorded = { original: intake.section.body, provenance };
  }
  // A guide lists the sources its claims point to, so it is rebuilt with them.
  const original = practical
    ? await practicalGuideCandidate(
        bundle.candidate.id,
        row.version,
        new Date(bundle.candidate.sourceCheckDate),
        recorded,
      )
    : bundle.candidate.contentClass === "sourced_guidance"
      ? await guidanceCandidate(
          bundle.candidate.id,
          row.version,
          new Date(bundle.candidate.sourceCheckDate),
          recorded,
          guideReferences(bundle),
        )
      : await templateCandidate(
          bundle.candidate.id,
          row.version,
          new Date(bundle.candidate.sourceCheckDate),
          recorded,
        );
  if (
    row.version !== bundle.candidate.version ||
    bundle.candidate.body !== JSON.stringify(original.document) ||
    bundle.candidate.scope !== original.scope ||
    bundle.candidate.limitations !== original.limitations
  )
    throw Error("OPERATIONAL_BODY_OUTSIDE_REVIEWED_ORIGINAL");
  const rights = JSON.parse((await getPublicationArtifact(a.rights)).toString());
  const provider = JSON.parse((await getPublicationArtifact(rights.snapshot as ArtifactRef)).toString());
  const applicability = provenance.generation
    ? await loadRightsApplicability()
    : await loadChatGPTPermission(provider, provenance);
  assertPermissionRoute(applicability.record, Boolean(provenance.generation));
  if (
    !provenance.generation &&
    (applicability.record.sourceBinding?.hash !== provenance.hash ||
      applicability.record.sourceBinding?.noteHash !== provenance.noteHash)
  )
    throw Error("ORIGINAL_SOURCE_BINDING_INVALID");
  if (
    !applicability.verified ||
    rights.authoringRoute !== (provenance.generation ? "recorded_server_ai" : "coordinator_chatgpt") ||
    rights.applicabilityHash !== applicability.hash ||
    a.rightsApplicabilityHash !== applicability.hash
  )
    throw Error("PROVIDER_RIGHTS_APPLICABILITY_UNVERIFIED");
  if (
    digest(rights) !== bundle.rights.evidenceHash ||
    bundle.rights.evidence !== JSON.stringify(rights) ||
    // A form's record is for an original form that quotes no law; a guide's is its own kind.
    (practical && (rights.kind !== "practical-business-guide-v1" || Boolean(provenance.generation))) ||
    (guide
      ? rights.kind !== "valo-guide-rights-1" || rights.sourcedGuidance !== true
      : !rights.originalOperationalOnly) ||
    rights.customerLicenceAccepted !== false ||
    rights.provenanceHash !== a.provenance.hash ||
    Date.parse(rights.validUntil) <= +now
  )
    throw Error("RIGHTS_EVIDENCE_INVALID");
  if (JSON.stringify(rights.permissions) !== JSON.stringify(applicability.record.evidence))
    throw Error("RECORDED_PROVIDER_PERMISSION_TEXT_MISSING");
  for (const evidence of applicability.record.evidence) {
    const page = provider.pages.find((p: { url: string }) => p.url === evidence.url);
    if (!page || page.truncated || sha256(page.text) !== evidence.hash || !page.text.includes(evidence.quote))
      throw Error("APPLICABLE_TERMS_SNAPSHOT_MISSING");
  }
  if (guide && !a.claimScope) throw Error("GUIDE_CLAIM_SCOPE_MISSING");
  const measuredChecks = guide
    ? await guideMechanicalChecks({
        bundle,
        canonicalBody: JSON.stringify(original.document),
        claimScope: JSON.parse((await getPublicationArtifact(a.claimScope!)).toString()) as GuideClaimScope,
        provenance,
        provenanceArtifactHash: a.provenance.hash,
        rights,
        applicability,
        snapshot: provider,
        trustedPolicy: trusted.policy,
        now,
      })
    : operationalMechanicalChecks({
        candidate: bundle.candidate,
        policy: bundle.policy,
        provenance,
        provenanceArtifactHash: a.provenance.hash,
        rights,
        applicability,
        snapshot: provider,
        sources: bundle.sources,
      });
  if (
    measuredChecks.some((check) => check.result !== "pass") ||
    digest(measuredChecks) !== digest(bundle.mechanicalChecks)
  )
    throw Error("MECHANICAL_EXECUTION_ATTESTATION_INVALID");
  if (a.reviews.length !== 2) throw Error("INDEPENDENT_REVIEWS_MISSING");
  const providerIds = new Set<string>();
  const outputs: Parameters<typeof enhancedChecksFromReviews>[1] = [];
  for (const ref of a.reviews) {
    const record = JSON.parse((await getPublicationArtifact(ref)).toString());
    const output = operationalReviewSchemaFor(bundle.candidate).parse(record.output);
    const bound = bundle.reviews.find((r) => r.role === record.role);
    const checked = record.serverEvidence;
    if (
      !checked ||
      checked.candidateHash !== row.candidateHash ||
      checked.sourceCheckedAt !== bundle.candidate.sourceCheckDate ||
      checked.sourceHash !== provenance.hash ||
      checked.provenanceArtifactHash !== a.provenance.hash ||
      checked.rightsArtifactHash !== a.rights.hash ||
      checked.exportReportArtifactHash !== a.exportReport.hash ||
      checked.providerSnapshotHash !== rights.snapshot.hash ||
      checked.authoringRoute !== rights.authoringRoute
    )
      throw Error("REVIEW_SERVER_BINDING_INVALID");
    if (
      !bound ||
      record.providerResponseId !== bound.runId ||
      record.model !== bound.model ||
      record.promptVersion !== bound.promptVersion ||
      record.receivedOtherVerdict ||
      output.verdict !== "pass" ||
      output.findings.length ||
      output.missingEvidence.length ||
      record.candidateHash !== bundle.candidate.hash ||
      record.evidenceHash !== digest(bundle.sources)
    )
      throw Error("REVIEW_ATTESTATION_INVALID");
    providerIds.add(record.providerResponseId);
    outputs.push({ role: record.role, output });
  }
  if (providerIds.size !== 2) throw Error("REVIEWS_NOT_INDEPENDENT");
  // Content that is not general carries the enhanced checks its two reviews ran (decision 0014):
  // they are derived again from the attested reviews, never taken from the bundle alone.
  if (
    bundle.candidate.risk !== "general" &&
    digest(enhancedChecksFromReviews(bundle, outputs)) !== digest(bundle.enhancedChecks)
  )
    throw Error("ENHANCED_CHECK_ATTESTATION_INVALID");
  const exportReport = JSON.parse((await getPublicationArtifact(a.exportReport)).toString());
  if (exportReport.candidateHash !== row.candidateHash || exportReport.passed !== true)
    throw Error("EXPORT_REPORT_INVALID");
  const bytes = {
    docx: await getPublicationArtifact(a.exports.docx),
    pdf: await getPublicationArtifact(a.exports.pdf),
  };
  await recheckOperationalExports(bundle.candidate, bytes, exportReport);
  for (const format of ["docx", "pdf"] as const) {
    const attested = bundle.exports.find((e) => e.format === format);
    if (attested?.fileHash !== a.exports[format].hash || exportReport.hashes[format] !== attested.fileHash)
      throw Error("EXPORT_ATTESTATION_INVALID");
  }
  await bindReleasedSources(tx, "content", id, bundle, a.sourceSnapshots, now);
  // Artifact/source I/O is not instantaneous. Re-read current owner scope and
  // actual time immediately before state mutation, while locks remain held.
  const finalNow = await finalOperationalPublicationCheck(
    bundle,
    trusted.policy.hash,
    row.reviewBy,
    rights.validUntil,
    requestedTime,
  );
  await bindReleasedSources(tx, "content", id, bundle, a.sourceSnapshots, finalNow);
  return { row, bundle, checkedAt: finalNow.toISOString() };
}

export async function publishOperationalVersionInTransaction(tx: PublicationTx, id: string) {
  const { valoContentVersions, valoPublicationAudit } = await import("@workspace/db");
  const { row, bundle } = await validateOperationalVersionInTransaction(tx, id);
  if (row.status === "published") return { id, decision: "published" as const, idempotent: true };
  // A guide is released only on the development owner's check of its exact candidate and captures, made
  // within the last day (decision 0018). The database refuses the release without it too.
  if (
    bundle.candidate.contentClass === "sourced_guidance" &&
    !(await reviewedGuideChecked(
      tx,
      id,
      row.candidateHash,
      (row.attestations as ReleaseAttestations).sourceSnapshots,
    ))
  )
    throw Error(regulatorySourceHold);
  await tx
    .update(valoContentVersions)
    .set({ status: "published", publishedAt: new Date() })
    .where(and(eq(valoContentVersions.id, id), eq(valoContentVersions.status, "candidate")));
  await tx.insert(valoPublicationAudit).values({
    id: randomUUID(),
    versionId: id,
    actor: "bounded_development_publisher",
    action: "published",
    reason: `Eligible immutable manifest ${digest(bundle.manifest)}`,
  });
  await tx.execute(sql`update valo_source_review_work w set status='superseded_by_eligible_version',replacement_kind='content',replacement_id=${id}::uuid,completed_at=now()
      from valo_source_impacts i where w.impact_id=i.id and w.status='awaiting_authorized_review' and i.target_kind='content'
      and i.target_key=${row.templateId} and i.target_version<${row.version}`);
  return { id, decision: "published" as const, idempotent: false };
}
/**
 * Checks that the publisher's own connection works and logged in as the publisher. Work that pays
 * for reviews and then releases asks this first, so a login that is missing or cannot log in is
 * found before the money is spent, not after.
 */
export async function assertPublisherCanLogIn() {
  const { publisherDb, PUBLISHER_LOGIN_ROLE } = await import("@workspace/db");
  developmentPublicationOnly();
  const { rows } = await publisherDb().execute(sql`select session_user as login`);
  if (rows[0]?.login !== PUBLISHER_LOGIN_ROLE) throw Error("PUBLISHER_LOGIN_NOT_IN_USE");
}
export async function publishOperationalVersion(id: string) {
  const { publisherDb } = await import("@workspace/db");
  developmentPublicationOnly();
  // The release runs on the publisher's own connection. The database lets a version become
  // published only in a session that logged in as the publisher (decision 0017, point 6).
  return publisherDb().transaction((tx) => publishOperationalVersionInTransaction(tx, id));
}
export async function withdrawOperationalVersion(id: string, reason: string) {
  const { db, valoContentVersions, valoPublicationAudit } = await import("@workspace/db");
  developmentPublicationOnly();
  if (!reason.trim()) throw Error("WITHDRAWAL_REASON_REQUIRED");
  return db.transaction(async (tx) => {
    await lockSourceState(tx, true);
    await recordSourceImpact(tx, {
      kind: "content",
      id,
      reason,
      actor: "bounded_development_publisher",
      action: "withdraw",
      dedupe: `publisher-withdraw:${id}`,
    });
    // A withdrawn version never returns, so its review work closes (source-register.md, slice 3).
    await closeWithdrawnReviewWork(tx, "content", id);
    await tx.execute(sql`SET LOCAL ROLE valo_content_publisher_dev`);
    const [row] = await tx
      .select()
      .from(valoContentVersions)
      .where(eq(valoContentVersions.id, id))
      .for("update");
    if (!row || row.status !== "published") throw Error("PUBLISHED_VERSION_REQUIRED");
    await tx
      .update(valoContentVersions)
      .set({ status: "withdrawn", withdrawnReason: reason })
      .where(eq(valoContentVersions.id, id));
    await tx.insert(valoPublicationAudit).values({
      id: randomUUID(),
      versionId: id,
      actor: "bounded_development_publisher",
      action: "withdrawn",
      reason,
    });
    return { id, status: "withdrawn" as const };
  });
}
export async function recordActualPublicationHold(id: string, failureCode?: string) {
  const { db, valoContentVersions, valoPublicationAudit } = await import("@workspace/db");
  developmentPublicationOnly();
  if (failureCode && !/^[A-Z_]{3,80}$/.test(failureCode)) throw Error("INVALID_HOLD_REASON_CODE");
  return db.transaction(async (tx) => {
    await lockSourceState(tx, true);
    await tx.execute(sql`SET LOCAL ROLE valo_content_publisher_dev`);
    const [row] = await tx
      .select()
      .from(valoContentVersions)
      .where(eq(valoContentVersions.id, id))
      .for("update");
    if (!row || row.status !== "candidate") throw Error("CANDIDATE_REQUIRED");
    const decision = evaluateOperationalRelease(row.bundle);
    if (decision.decision !== "hold") throw Error("NO_FAILED_GATE_TO_RECORD");
    await tx.update(valoContentVersions).set({ status: "held" }).where(eq(valoContentVersions.id, id));
    const reasons = [...decision.reasons, ...(failureCode ? [failureCode] : [])];
    await tx.insert(valoPublicationAudit).values({
      id: randomUUID(),
      versionId: id,
      actor: "bounded_development_publisher",
      action: "held",
      reason: reasons.join(","),
    });
    return { id, status: "held", reasons };
  });
}
