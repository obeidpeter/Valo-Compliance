import { and, eq, or } from "drizzle-orm";
import {
  isPracticalGuideId,
  candidateDigest,
  digest,
  publicationSchema,
  type PublicationBundle,
} from "@workspace/valo-core";
import {
  getPublicationArtifact,
  readPreparedCandidate,
  readOperationalIntake,
  readGuidanceIntake,
  templateCandidate,
  readPracticalGuideIntake,
  practicalGuideCandidate,
  practicalGuidePreparationPolicy,
  guidanceCandidate,
  guidancePolicy,
  guideReviewInputs,
  guideMechanicalChecks,
  guideReferences,
  mappedGuideIds,
  loadChatGPTPermission,
  operationalPolicy,
  operationalMechanicalChecks,
  inspectOperationalExports,
  supportsOperationalInferenceTemplate,
  type GuideClaimScope,
  type GuideRightsRecord,
  type OperationalServerEvidence,
  type ReleaseAttestations,
} from "../publication";

export type OperationalCandidateBinding = {
  candidateVersionId: string;
  candidateArtifact: { id: string; hash: string; extension: "json"; templateId: string };
};

/** Reconstruct a supported prepared original form, or a prepared guide, and recheck all its retained
 * private evidence. The candidate is the private artifact a review reads before its version is saved
 * (decision 0014). Intake coverage alone never establishes readiness. */
export async function readOperationalInferenceReadiness(binding: OperationalCandidateBinding) {
  if (!/^[a-f0-9-]{36}$/.test(binding.candidateVersionId)) throw Error("CANDIDATE_VERSION_REQUIRED");
  const prepared = await readPreparedCandidate(binding.candidateArtifact);
  if (
    prepared.versionId !== binding.candidateVersionId ||
    prepared.templateId !== binding.candidateArtifact.templateId
  )
    throw Error("CANDIDATE_BINDING_CHANGED");
  if (Date.parse(prepared.reviewBy) <= Date.now()) throw Error("CANDIDATE_UNAVAILABLE_OR_STALE");
  // A prepared candidate is one of the supported original forms, or a guide with a claim map.
  const guide = mappedGuideIds.includes(prepared.templateId);
  const practical = isPracticalGuideId(prepared.templateId);
  if (!guide && !practical && !supportsOperationalInferenceTemplate(prepared.templateId))
    throw Error("CANDIDATE_REQUEST_PREPARER_UNAVAILABLE");
  // A saved version ends a candidate's review: this one, published or held, or another saved under
  // the same version number. The database client loads only when a readiness check runs.
  const { db, valoContentVersions } = await import("@workspace/db");
  const saved = await db
    .select({ id: valoContentVersions.id })
    .from(valoContentVersions)
    .where(
      or(
        eq(valoContentVersions.id, prepared.versionId),
        and(
          eq(valoContentVersions.templateId, prepared.templateId),
          eq(valoContentVersions.version, prepared.version),
        ),
      ),
    )
    .limit(1);
  if (saved.length) throw Error("CANDIDATE_ALREADY_SAVED");
  const row = {
    id: prepared.versionId,
    templateId: prepared.templateId,
    version: prepared.version,
    slug: prepared.slug,
    policyId: prepared.policyId,
    candidateHash: prepared.candidateHash,
    bundle: prepared.bundle,
    attestations: prepared.attestations,
    reviewBy: new Date(prepared.reviewBy),
    preparedAt: prepared.preparedAt,
  };
  const bundle = publicationSchema.parse(row.bundle),
    candidate = bundle.candidate,
    a = row.attestations as ReleaseAttestations;
  if (
    candidate.id !== row.templateId ||
    candidate.version !== row.version ||
    candidateDigest(candidate) !== row.candidateHash ||
    candidate.hash !== row.candidateHash
  )
    throw Error("CANDIDATE_BINDING_CHANGED");
  const provenance = JSON.parse((await getPublicationArtifact(a.provenance)).toString());
  const rights = JSON.parse((await getPublicationArtifact(a.rights)).toString());
  const snapshot = JSON.parse((await getPublicationArtifact(rights.snapshot)).toString());
  if (guide) return { row, ...(await guideReadiness(row, bundle, a, provenance, rights, snapshot)) };
  const intake = practical
      ? await readPracticalGuideIntake(row.templateId, row.version)
      : await readOperationalIntake(row.templateId, row.version),
    { policy } = practical
      ? await practicalGuidePreparationPolicy(row.templateId)
      : await operationalPolicy();
  if (
    intake.sourceHash !== provenance.hash ||
    intake.manifestHash !== provenance.noteHash ||
    policy.hash !== bundle.policy.hash
  )
    throw Error("SAVED_PLAN_INPUT_CHANGED");
  const build = practical ? practicalGuideCandidate : templateCandidate;
  const original = await build(row.templateId, row.version, new Date(candidate.sourceCheckDate), {
    original: intake.section.body,
    provenance,
  });
  if (JSON.stringify(original.document) !== candidate.body)
    throw Error("SAVED_BODY_NOT_EXACT_CURRENT_INTAKE");
  const applicability = await loadChatGPTPermission(snapshot, provenance);
  const checks = operationalMechanicalChecks({
    candidate,
    policy,
    provenance,
    provenanceArtifactHash: a.provenance.hash,
    rights,
    applicability,
    snapshot,
    now: new Date(),
    sources: bundle.sources,
  });
  if (!applicability.verified || checks.some((c) => c.result !== "pass"))
    throw Error("SAVED_PLAN_MECHANICAL_HOLD");
  const exportReport = await inspectOperationalExports(candidate, {
    docx: await getPublicationArtifact(a.exports.docx),
    pdf: await getPublicationArtifact(a.exports.pdf),
  });
  if (!exportReport.passed) throw Error("SAVED_PLAN_EXPORT_HOLD");
  const storedReport = JSON.parse((await getPublicationArtifact(a.exportReport)).toString());
  if (digest(exportReport) !== digest(storedReport)) throw Error("SAVED_EXPORT_CHECK_CHANGED");
  const serverEvidence: OperationalServerEvidence = {
    candidateHash: candidate.hash,
    policyHash: policy.hash,
    sourceCheckedAt: candidate.sourceCheckDate,
    sourceHash: provenance.hash,
    provenanceArtifactHash: a.provenance.hash,
    rightsArtifactHash: a.rights.hash,
    exportReportArtifactHash: a.exportReport.hash,
    providerSnapshotHash: rights.snapshot.hash,
    authoringRoute: rights.authoringRoute,
    sourceAttribution: "Retained authoring attribution; no independently certified upstream model/run",
    performedChecks: checks.map((c) => c.name),
  };
  const { evidence: _includedInPermissions, ...permissionScope } = applicability.record;
  return {
    row,
    bundle,
    candidate,
    checks,
    serverEvidence,
    exportReport,
    rightsInput: {
      permissions: rights.permissions,
      conclusion: rights.conclusion,
      customerLicenceAccepted: false,
      providerPermissionScope: permissionScope,
    },
    provenanceInput: {
      authoringRoute: provenance.authoringRoute,
      sourceHash: provenance.hash,
      sourcePath: provenance.path,
      originalItem: original.original,
      actualAuthoringAttribution: intake.authoringAttribution,
      authoringNoteHash: provenance.noteHash,
      adaptation: provenance.transformation,
      upstreamModelAndRunNotRecorded: true,
    },
  };
}

/**
 * The same recheck for a prepared guide: its words built again from the retained draft and its own
 * sources, its policy the guidance policy as it stands, and the guide's mechanical checks run again
 * on what is stored. The reviewers are given its sources, its claim scope and the amendment records
 * of the texts it quotes.
 */
async function guideReadiness(
  row: { templateId: string; version: number },
  bundle: PublicationBundle,
  a: ReleaseAttestations,
  provenance: {
    path: string;
    hash: string;
    sourceText: string;
    note: string;
    noteHash: string;
    authoringRoute: string;
    transformation: string;
    templateId: string;
    version: number;
  },
  rights: GuideRightsRecord,
  snapshot: { retrievedAt: string; pages: { url: string; text: string; truncated: boolean }[] },
) {
  const candidate = bundle.candidate;
  const intake = await readGuidanceIntake(row.templateId, row.version),
    { policy } = await guidancePolicy();
  if (
    intake.sourceHash !== provenance.hash ||
    intake.provenance.noteHash !== provenance.noteHash ||
    policy.hash !== bundle.policy.hash
  )
    throw Error("SAVED_PLAN_INPUT_CHANGED");
  const original = await guidanceCandidate(
    row.templateId,
    row.version,
    new Date(candidate.sourceCheckDate),
    { original: intake.section.body, provenance },
    guideReferences(bundle),
  );
  if (JSON.stringify(original.document) !== candidate.body)
    throw Error("SAVED_BODY_NOT_EXACT_CURRENT_INTAKE");
  const applicability = await loadChatGPTPermission(snapshot, provenance);
  if (!a.claimScope) throw Error("GUIDE_CLAIM_SCOPE_MISSING");
  const claimScope = JSON.parse((await getPublicationArtifact(a.claimScope)).toString()) as GuideClaimScope;
  const checks = await guideMechanicalChecks({
    bundle,
    canonicalBody: JSON.stringify(original.document),
    claimScope,
    provenance,
    provenanceArtifactHash: a.provenance.hash,
    rights,
    applicability,
    snapshot,
    trustedPolicy: policy,
    now: new Date(),
  });
  if (!applicability.verified || checks.some((c) => c.result !== "pass"))
    throw Error("SAVED_PLAN_MECHANICAL_HOLD");
  const exportReport = await inspectOperationalExports(candidate, {
    docx: await getPublicationArtifact(a.exports.docx),
    pdf: await getPublicationArtifact(a.exports.pdf),
  });
  if (!exportReport.passed) throw Error("SAVED_PLAN_EXPORT_HOLD");
  const storedReport = JSON.parse((await getPublicationArtifact(a.exportReport)).toString());
  if (digest(exportReport) !== digest(storedReport)) throw Error("SAVED_EXPORT_CHECK_CHANGED");
  const serverEvidence: OperationalServerEvidence = {
    candidateHash: candidate.hash,
    policyHash: policy.hash,
    sourceCheckedAt: candidate.sourceCheckDate,
    sourceHash: provenance.hash,
    provenanceArtifactHash: a.provenance.hash,
    rightsArtifactHash: a.rights.hash,
    exportReportArtifactHash: a.exportReport.hash,
    providerSnapshotHash: rights.snapshot.hash,
    authoringRoute: rights.authoringRoute,
    sourceAttribution: "Retained authoring attribution; no independently certified upstream model/run",
    performedChecks: checks.map((c) => c.name),
  };
  const { evidence: _includedInPermissions, ...permissionScope } = applicability.record;
  return {
    bundle,
    candidate,
    checks,
    serverEvidence,
    exportReport,
    // What the reviewers check the claims, the rights and the amendment checks against.
    ...guideReviewInputs({
      provenance,
      originalText: original.original,
      rebuiltBody: JSON.stringify(original.document),
      candidateBody: candidate.body,
      rights,
      permissionScope,
      claimScope,
    }),
  };
}
