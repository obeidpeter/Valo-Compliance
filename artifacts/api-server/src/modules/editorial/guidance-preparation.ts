import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { eq, sql } from "drizzle-orm";
import { renderDocument } from "../../lib/valo-render";
import { assertDevelopmentRuntime } from "../../platform/valo-development-runtime";
import { singleRow } from "../../platform/rows";
import {
  assembleGuideBundle,
  assertPermissionRoute,
  buildGuideCandidate,
  capturedGuidePassages,
  developmentPublicationOnly,
  guidancePolicy,
  guideCaptureLeads,
  guideOpenReasons,
  guideSourceSnapshots,
  inspectOperationalExports,
  loadChatGPTPermission,
  mappedGuideIds,
  putPublicationArtifact,
  savePreparedCandidate,
  type GuideCapture,
  type ReleaseAttestations,
} from "../publication";
import { currentSourceCaptures } from "../sources";

/** A guide's page address: its title in lower case, words joined by hyphens. */
export const guideSlug = (title: string) =>
  title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");

/**
 * Prepares a guide for its two reviews (decisions 0014 and 0017).
 *
 * The guide is built from its retained draft and its claim map, bound to today's captures of the
 * official addresses, and put through the gate with everything but the reviews: its policy, its
 * rights record, its sources' decisions, its mechanical checks and both of its files.
 *
 * - If the gate names anything other than the two missing reviews, the guide is not ready. The
 *   reasons are returned and no candidate is kept.
 * - Otherwise the candidate is kept as a private artifact awaiting its reviews, with a row that lets
 *   staff find it. It becomes a version only once both reviews have passed.
 *
 * Nothing here calls a model, approves anything or publishes. `captures` is for tests; the command
 * reads the captures the daily source check stored.
 */
export async function prepareGuideCandidateRelease(
  id: string,
  snapshotPath: string,
  options: { captures?: readonly GuideCapture[]; now?: Date } = {},
) {
  assertDevelopmentRuntime();
  developmentPublicationOnly();
  if (!mappedGuideIds.includes(id)) throw Error("GUIDE_CLAIM_MAP_MISSING");
  const { db, valoContentVersions, valoPublicationPolicies, valoPreparedCandidates } =
    await import("@workspace/db");
  const now = options.now ?? new Date();
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  if (
    snapshot.kind !== "official_provider_terms_snapshot" ||
    !Array.isArray(snapshot.pages) ||
    snapshot.pages.some((p: { truncated: boolean }) => p.truncated) ||
    !Number.isFinite(Date.parse(snapshot.retrievedAt)) ||
    Date.parse(snapshot.retrievedAt) > +now ||
    +now - Date.parse(snapshot.retrievedAt) > 86_400_000
  )
    throw Error("FRESH_ACTUAL_PROVIDER_TERMS_REQUIRED");

  const versions = await db.select().from(valoContentVersions).where(eq(valoContentVersions.templateId, id));
  const version = Math.max(0, ...versions.map((r) => r.version)) + 1;
  // The passages come from the captures the daily check holds, read before anything else is done.
  const captures = options.captures ?? (await currentSourceCaptures(guideCaptureLeads, now));
  const built = await buildGuideCandidate(id, version, capturedGuidePassages(captures), now);
  const { policy, authority } = await guidancePolicy();
  const applicability = await loadChatGPTPermission(snapshot, built.provenance);
  assertPermissionRoute(applicability.record, false);

  const files = {
    docx: await renderDocument(built.document, "docx", version, "guidance"),
    pdf: await renderDocument(built.document, "pdf", version, "guidance"),
  };
  const exportReport = await inspectOperationalExports(built.candidate, files);
  const provenance = await putPublicationArtifact(Buffer.from(JSON.stringify(built.provenance)), "json");
  const snapshotRef = await putPublicationArtifact(Buffer.from(JSON.stringify(snapshot)), "json");
  const exports = {
    docx: await putPublicationArtifact(files.docx, "docx"),
    pdf: await putPublicationArtifact(files.pdf, "pdf"),
  };
  const assembled = await assembleGuideBundle({
    built,
    policy,
    termsSnapshot: snapshot,
    snapshotRef,
    provenanceRef: provenance,
    applicability,
    exportReport,
    exportHashes: { docx: exports.docx.hash, pdf: exports.pdf.hash },
    now,
  });
  const reasons = [
    ...guideOpenReasons(assembled.eligibility),
    ...(exportReport.passed ? [] : ["export_inspection_failed"]),
  ];
  const outcome = {
    guide: id,
    version,
    candidateHash: built.candidate.hash,
    policyHash: policy.hash,
    sourceCheckDate: built.candidate.sourceCheckDate,
    reviewBy: built.candidate.reviewBy!,
    missingEvidence: built.candidate.missingEvidence,
    rightsProblems: assembled.rightsProblems,
    failedChecks: assembled.bundle.mechanicalChecks.filter((c) => c.result !== "pass").map((c) => c.name),
  };
  // Not ready: the gate names something other than the two reviews. Nothing is kept as a candidate.
  if (reasons.length) return { ...outcome, state: "held" as const, reasons, candidateArtifact: null };

  await db
    .insert(valoPublicationPolicies)
    .values({ id: policy.version, hash: policy.hash, policy, authority })
    .onConflictDoNothing();
  const storedPolicy = singleRow(
    await db.select().from(valoPublicationPolicies).where(eq(valoPublicationPolicies.id, policy.version)),
  );
  if (storedPolicy.hash !== policy.hash) throw Error("POLICY_VERSION_CHANGED_CREATE_NEW_VERSION");

  const rightsRef = await putPublicationArtifact(Buffer.from(JSON.stringify(assembled.rights)), "json");
  const reportRef = await putPublicationArtifact(Buffer.from(JSON.stringify(exportReport)), "json");
  const scopeRef = await putPublicationArtifact(Buffer.from(JSON.stringify(built.claimScope)), "json");
  const attestations: ReleaseAttestations = {
    sourceSnapshots: guideSourceSnapshots(built.sources, captures),
    provenance,
    rights: rightsRef,
    rightsApplicabilityHash: applicability.hash,
    reviews: [],
    exports,
    exportReport: reportRef,
    claimScope: scopeRef,
  };
  const versionId = randomUUID();
  const title = (JSON.parse(built.candidate.body) as { title: string }).title;
  const candidateArtifact = await savePreparedCandidate({
    kind: "valo-prepared-candidate-v1",
    versionId,
    templateId: id,
    version,
    slug: guideSlug(title),
    policyId: policy.version,
    candidateHash: built.candidate.hash,
    bundle: assembled.bundle,
    attestations,
    reviewBy: new Date(built.candidate.reviewBy!).toISOString(),
    preparedAt: now.toISOString(),
  });
  // The artifact is the candidate; this row only lets staff find it in the Content area.
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE valo_content_drafter_dev`);
    await tx.insert(valoPreparedCandidates).values({
      artifactId: candidateArtifact.id,
      artifactHash: candidateArtifact.hash,
      versionId,
      templateId: id,
      version,
      candidateHash: built.candidate.hash,
      preparedAt: now,
      reviewBy: new Date(built.candidate.reviewBy!),
    });
  });
  return { ...outcome, state: "awaiting_reviews" as const, reasons: [], id: versionId, candidateArtifact };
}
