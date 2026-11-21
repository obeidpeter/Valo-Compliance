import { candidateDigest, disclosure, type PublicationBundle } from "@workspace/valo-core";
import { guidanceCandidate } from "./guidance-candidate";
import { buildGuideClaims, type GuideClaimMap } from "./guidance-claim-map";
import { registrationTaxClaimMaps } from "./guidance-claims-registration-tax";
import { guideReferences } from "./guidance-document";
import { retainedGuidePassages, type GuidePassages } from "./guidance-passages";
import { readGuidanceIntake } from "./operational-intake";

/** Every guide with a claim map. A guide without one cannot be built. */
export const guideClaimMaps: readonly GuideClaimMap[] = [...registrationTaxClaimMaps];
export const mappedGuideIds = guideClaimMaps.map((m) => m.id);

/** What every guide built today still lacks, whatever its claim map says (decision 0017). The
 * preparer that binds a rights record and an amendment record will compute these instead. */
export const GUIDE_OPEN_EVIDENCE = [
  "Rights: no rights record is bound to this guide yet.",
  "Sources: no amendment record exists, so no source is marked current.",
] as const;

/** The conditions a draft's own editorial notes give for the guide to apply, where it records them. */
function applicability(sourceText: string, id: string, title: string) {
  const section = sourceText.split(`## ${id} — ${title}`)[1]?.split(/^## GUD-\d{2} — /m)[0] ?? "";
  const line = /^- \*\*Applicability:\*\* (.+)$/m.exec(section)?.[1];
  return line ? [`Applies when: ${line}`] : [];
}

/**
 * A guide's candidate and sources, built from its retained words, its claim map and the passages
 * supplied (the ones kept in the repository unless others are given).
 *
 * The result cannot pass the gate, and is not meant to: every source is held with no decision on
 * it, the legal scope is unverified, and the evidence still missing is listed. It is what the
 * reviews and the later gates are given, not a release.
 */
export async function buildGuideCandidate(
  id: string,
  version = 1,
  passages: GuidePassages = retainedGuidePassages(),
) {
  const map = guideClaimMaps.find((m) => m.id === id);
  if (!map) throw Error(`GUIDE_CLAIM_MAP_MISSING:${id}`);
  const intake = await readGuidanceIntake(id, version);
  const built = buildGuideClaims(map, intake.section.body, passages);
  if (!built.sources.length) throw Error(`GUIDE_HAS_NO_BOUND_SOURCE:${id}`);
  // The sources were last read when the newest of them was fetched: that is the check date a guide
  // built from retained passages can truthfully carry.
  const checked = new Date(Math.max(...built.sources.map((s) => Date.parse(s.retrievedAt))));
  const content = await guidanceCandidate(
    id,
    version,
    checked,
    undefined,
    guideReferences({ candidate: { claims: built.claims }, sources: built.sources }),
  );
  const raw: Omit<PublicationBundle["candidate"], "hash"> = {
    id,
    version,
    body: JSON.stringify(content.document),
    contentClass: "sourced_guidance",
    jurisdiction: "NG",
    risk: map.risk,
    scope: content.scope,
    limitations: content.limitations,
    assumptions: applicability(intake.provenance.sourceText, id, intake.section.title),
    unresolvedMaterialIssues: [],
    missingEvidence: [...built.missingEvidence, ...GUIDE_OPEN_EVIDENCE],
    sourceCheckDate: content.reviewedAt,
    reviewBy: content.reviewBy,
    disclosure,
    evidenceMode: "regulatory",
    legalScopeStatus: "unverified",
    coverage: { kind: "guidance", industrySlugs: [], locationIds: [] },
    claims: built.claims,
  };
  return {
    candidate: { ...raw, hash: candidateDigest(raw) },
    sources: built.sources,
    document: content.document,
    claimScope: built.scope,
    linkHosts: built.linkHosts,
    provenance: content.provenance,
  };
}
