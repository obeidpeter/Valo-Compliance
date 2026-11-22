import { candidateDigest, digest, disclosure, type PublicationBundle } from "@workspace/valo-core";
import { decidedSource, guideSourceDecision, type AmendmentRecord } from "./guidance-amendments";
import { guidanceCandidate } from "./guidance-candidate";
import { buildGuideClaims, type GuideClaimMap } from "./guidance-claim-map";
import { employmentClaimMaps } from "./guidance-claims-employment";
import { foodClaimMaps } from "./guidance-claims-food";
import { privacyClaimMaps } from "./guidance-claims-privacy";
import { registrationTaxClaimMaps } from "./guidance-claims-registration-tax";
import { guideReferences } from "./guidance-document";
import {
  retainedGuidePassages,
  type GuideInstrument,
  type GuidePassage,
  type GuidePassages,
} from "./guidance-passages";
import { readGuidanceIntake } from "./operational-intake";

/** Every guide with a claim map. A guide without one cannot be built. */
export const guideClaimMaps: readonly GuideClaimMap[] = [
  ...registrationTaxClaimMaps,
  ...privacyClaimMaps,
  ...foodClaimMaps,
  ...employmentClaimMaps,
];
export const mappedGuideIds = guideClaimMaps.map((m) => m.id);
/**
 * The guides that can be built from the repository alone: most of their passages are kept in it.
 * Every other mapped guide rests on texts that are not kept, and is built only from captures.
 */
export const repositoryBuiltGuideIds = registrationTaxClaimMaps.map((m) => m.id);

/** Every passage a guide's claim map names. */
export function guidePassageIds(id: string) {
  const map = guideClaimMaps.find((m) => m.id === id);
  if (!map) throw Error(`GUIDE_CLAIM_MAP_MISSING:${id}`);
  return [
    ...new Set(
      map.sentences
        .flatMap((sentence) => ("support" in sentence ? (sentence.support ?? []) : []))
        .map((s) => s.passage),
    ),
  ];
}

/** The conditions a draft's own editorial notes give for the guide to apply, where it records them. */
function applicability(sourceText: string, id: string, title: string) {
  const section = sourceText.split(`## ${id} — ${title}`)[1]?.split(/^## GUD-\d{2} — /m)[0] ?? "";
  const line = /^- \*\*Applicability:\*\* (.+)$/m.exec(section)?.[1];
  return line ? [`Applies when: ${line}`] : [];
}

/**
 * The record of a candidate's claim scope (decision 0017, point 4): which claim map classified its
 * sentences, how many of each kind, and where each of its sources was read from. It is kept with the
 * candidate so that the release can build the claims again from the candidate's own sources and
 * find the same ones.
 */
export type GuideClaimScope = {
  guide: string;
  sentences: number;
  byKind: Record<string, number>;
  mapDigest: string;
  passages: { id: string; recordedLocator: string; sections: string[]; instrument: GuideInstrument }[];
};

/**
 * A guide's candidate and sources, built from its retained words, its claim map and the passages
 * supplied (the ones kept in the repository unless others are given).
 *
 * Each source carries the decision its text's amendment record supports on the day given: approved
 * only when that record is recent, describes the same file and leaves nothing open about the
 * passage. The legal scope is verified only when every sentence about the law is bound and every
 * source is approved. Anything short of that is listed as missing evidence, and the gate holds the
 * candidate. Building a candidate reviews nothing and releases nothing.
 */
export async function buildGuideCandidate(
  id: string,
  version = 1,
  passages: GuidePassages = retainedGuidePassages(),
  now = new Date(),
  records?: readonly AmendmentRecord[],
) {
  const map = guideClaimMaps.find((m) => m.id === id);
  if (!map) throw Error(`GUIDE_CLAIM_MAP_MISSING:${id}`);
  const intake = await readGuidanceIntake(id, version);
  const built = buildGuideClaims(map, intake.section.body, passages);
  if (!built.sources.length) throw Error(`GUIDE_HAS_NO_BOUND_SOURCE:${id}`);

  const used: GuidePassage[] = [],
    notCurrent: string[] = [];
  const sources = built.sources.map((source) => {
    const passage = passages(source.id);
    if (!passage) throw Error(`GUIDE_SOURCE_PASSAGE_MISSING:${id}:${source.id}`);
    used.push(passage);
    const quotes = built.claims.filter((c) => c.sourceId === source.id).map((c) => c.quote);
    const decision = guideSourceDecision(passage, now, records, quotes);
    if (decision.status !== "approved")
      notCurrent.push(
        `${id}: ${source.title} (${source.id}) is not marked current: ${decision.reasons.join("; ")}.`,
      );
    return decidedSource(source, decision);
  });
  const missingEvidence = [...built.missingEvidence, ...notCurrent];

  // The sources were last read when the newest of them was fetched: that is the check date a guide
  // can truthfully carry.
  const checked = new Date(Math.max(...sources.map((s) => Date.parse(s.retrievedAt))));
  const content = await guidanceCandidate(
    id,
    version,
    checked,
    undefined,
    guideReferences({ candidate: { claims: built.claims }, sources }),
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
    missingEvidence,
    sourceCheckDate: content.reviewedAt,
    reviewBy: content.reviewBy,
    disclosure,
    evidenceMode: "regulatory",
    legalScopeStatus: missingEvidence.length ? "unverified" : "verified",
    coverage: { kind: "guidance", industrySlugs: [], locationIds: [] },
    claims: built.claims,
  };
  const claimScope: GuideClaimScope = {
    ...built.scope,
    passages: used.map((p) => ({
      id: p.id,
      recordedLocator: p.recordedLocator,
      sections: p.sections,
      instrument: p.instrument,
    })),
  };
  return {
    candidate: { ...raw, hash: candidateDigest(raw) },
    sources,
    document: content.document,
    original: content.original,
    claimScope,
    linkHosts: built.linkHosts,
    provenance: content.provenance,
  };
}

/**
 * Builds a candidate's claims and source decisions again from its own sources and its recorded
 * claim scope, with today's claim map and amendment records, and says what differs. An empty list
 * means the candidate's claims are exactly what the map yields from those sources, every sentence
 * is classified, and each source carries the decision its record supports now.
 */
export async function guideClaimScopeProblems(
  bundle: Pick<PublicationBundle, "candidate" | "sources">,
  scope: GuideClaimScope,
  now: Date,
  records?: readonly AmendmentRecord[],
) {
  const c = bundle.candidate,
    problems: string[] = [];
  const map = guideClaimMaps.find((m) => m.id === c.id);
  if (!map) return [`no claim map exists for ${c.id}`];
  if (scope.guide !== c.id || scope.mapDigest !== digest(map))
    problems.push("the claim map has changed since the candidate was built");
  if (map.risk !== c.risk) problems.push("the candidate's risk class is not the claim map's");
  const held = new Map<string, GuidePassage>();
  for (const recorded of scope.passages) {
    const source = bundle.sources.find((s) => s.id === recorded.id);
    if (
      !source ||
      source.url !== recorded.instrument.url ||
      source.title !== recorded.instrument.title ||
      source.retrievedAt !== recorded.instrument.retrievedAt ||
      source.effectiveFrom !== recorded.instrument.effectiveFrom
    ) {
      problems.push(`the recorded passage ${recorded.id} does not describe a source of the candidate`);
      continue;
    }
    held.set(recorded.id, { ...recorded, text: source.text, hash: source.hash });
  }
  if (held.size !== bundle.sources.length) problems.push("a source has no recorded passage");
  if (problems.length) return problems;

  const intake = await readGuidanceIntake(c.id, c.version);
  let rebuilt;
  try {
    rebuilt = buildGuideClaims(map, intake.section.body, (id) => held.get(id));
  } catch (error) {
    return [`the claim map no longer builds from the candidate's sources: ${(error as Error).message}`];
  }
  if (digest(rebuilt.claims) !== digest(c.claims))
    problems.push("the candidate's claims are not what the claim map yields from its sources");
  for (const line of rebuilt.missingEvidence) problems.push(line);
  for (const source of bundle.sources) {
    const quotes = c.claims.filter((claim) => claim.sourceId === source.id).map((claim) => claim.quote);
    const decision = guideSourceDecision(held.get(source.id)!, now, records, quotes);
    if (
      decision.status !== source.status ||
      decision.operativeTextConfirmed !== source.operativeTextConfirmed ||
      decision.amendmentsResolved !== source.amendmentsResolved
    )
      problems.push(`the decision recorded for ${source.id} is not the one its amendment record supports`);
    if (decision.status !== "approved")
      problems.push(`${source.id} is not marked current: ${decision.reasons.join("; ")}`);
  }
  return problems;
}
