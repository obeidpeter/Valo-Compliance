import { eq } from "drizzle-orm";
import { db, valoContentVersions } from "@workspace/db";
import { candidateDigest, digest, publicationSchema } from "@workspace/valo-core";
import {
  getPublicationArtifact,
  readOperationalIntake,
  templateCandidate,
  loadChatGPTPermission,
  operationalPolicy,
  operationalMechanicalChecks,
  inspectOperationalExports,
  type OperationalServerEvidence,
  type ReleaseAttestations,
} from "../modules/publication";
import { supportsOperationalInferenceTemplate } from "./inference-operational-coverage";

/** Reconstruct a supported saved original form and recheck all its retained
 * private evidence. Intake coverage alone never establishes readiness. */
export async function readOperationalInferenceReadiness(candidateVersionId: string) {
  if (!/^[a-f0-9-]{36}$/.test(candidateVersionId)) throw Error("CANDIDATE_VERSION_REQUIRED");
  const [row] = await db
    .select()
    .from(valoContentVersions)
    .where(eq(valoContentVersions.id, candidateVersionId));
  if (!row || ["withdrawn", "superseded"].includes(row.status) || row.reviewBy.getTime() <= Date.now())
    throw Error("CANDIDATE_UNAVAILABLE_OR_STALE");
  if (!supportsOperationalInferenceTemplate(row.templateId))
    throw Error("CANDIDATE_REQUEST_PREPARER_UNAVAILABLE");
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
  const intake = await readOperationalIntake(row.templateId, row.version),
    { policy } = await operationalPolicy();
  if (
    intake.sourceHash !== provenance.hash ||
    intake.manifestHash !== provenance.noteHash ||
    policy.hash !== bundle.policy.hash
  )
    throw Error("SAVED_PLAN_INPUT_CHANGED");
  const original = await templateCandidate(row.templateId, row.version, new Date(candidate.sourceCheckDate), {
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
