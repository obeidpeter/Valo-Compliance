import { isPracticalGuideId, sha256 } from "@workspace/valo-core";
import type { valoContentVersions } from "@workspace/db";
import { getPublicationArtifact, type ArtifactRef } from "./publication-artifacts";
import {
  loadRightsApplicability,
  loadChatGPTPermission,
  assertPermissionRoute,
} from "./rights-applicability";
import type { ReleaseAttestations } from "./publication-publisher";
/** Revalidate the actual authoring route at discovery AND download time.
 * This checks only scoped permission, never substitutes for eligibility/reviews. */
export async function currentOperationalPermission(row: typeof valoContentVersions.$inferSelect) {
  const a = row.attestations as ReleaseAttestations;
  const provenance = JSON.parse((await getPublicationArtifact(a.provenance)).toString());
  const rights = JSON.parse((await getPublicationArtifact(a.rights)).toString());
  if (
    typeof provenance.sourceText !== "string" ||
    typeof provenance.note !== "string" ||
    sha256(provenance.sourceText) !== provenance.hash ||
    sha256(provenance.note) !== provenance.noteHash
  )
    return false;
  const recorded = Boolean(provenance.generation);
  if (
    isPracticalGuideId(row.templateId) &&
    (recorded || rights.kind !== "practical-business-guide-v1" || provenance.templateId !== row.templateId)
  )
    return false;
  const snapshot = JSON.parse((await getPublicationArtifact(rights.snapshot as ArtifactRef)).toString());
  const applicable = recorded
    ? await loadRightsApplicability()
    : await loadChatGPTPermission(snapshot, provenance);
  assertPermissionRoute(applicable.record, recorded);
  return (
    applicable.verified &&
    a.rightsApplicabilityHash === applicable.hash &&
    rights.authoringRoute === (recorded ? "recorded_server_ai" : "coordinator_chatgpt") &&
    (recorded ||
      (applicable.record.sourceBinding?.hash === provenance.hash &&
        applicable.record.sourceBinding?.noteHash === provenance.noteHash))
  );
}
