import { candidateDigest, digest, disclosure, type PublicationBundle } from "@workspace/valo-core";
import { documentInput } from "../../lib/valo-validation";
import { decidedSource, guideSourceDecision, type AmendmentRecord } from "./guidance-amendments";
import type { GuideClaimScope } from "./guidance-bundle";
import { guideReferences, guideSourceLines, lagosDay } from "./guidance-document";
import { retainedGuidePassages, type GuidePassage, type GuidePassages } from "./guidance-passages";
import { readTemplateIntake } from "./operational-intake";
import { buildTemplateClaims, type TemplateClaimMap } from "./template-claim-map";
import { templateLawClaimMaps } from "./template-law-maps";

/**
 * A template that states the law, as a candidate for the reviewed route
 * (docs/architecture/reviewed-route.md, part 4): its retained words, its claim map bound to the
 * passages supplied, each source with the decision its amendment record supports, and what it
 * covers, its limits, what it assumes and leaves open, and its sources, shown after its own words.
 *
 * Building one reviews nothing and releases nothing. It is held, as the gate holds anything, until
 * every source is current, both reviews pass and the source-backed policy for templates is the text
 * the owner approved (template-law-policy.ts).
 */

/** What every such template covers, in the words its files show under "What it covers". */
export const TEMPLATE_LAW_SCOPE =
  "A starting document for its users to complete under Nigeria's national rules. It does not cover rules made by a state, the Federal Capital Territory or a local government.";
/** Every such template's limits, in the words shown under "Limits you should know". */
export const TEMPLATE_LAW_LIMITATIONS =
  "A starting document, not advice on your own situation. It does not decide whether a rule applies to your business, whether your business complies, or whether the completed document is valid or enforceable. A rule can change after the date the sources were checked. Read the official sources, and ask a qualified adviser about your own case.";
/** What such a template's two reviews are, and are not (EDP-008). */
export const TEMPLATE_LAW_REVIEW_MEANING =
  "A template that states the law is released only after two separate automated AI checks and the source and file checks pass. That is not legal or regulatory verification, and it is not professional certification.";
/** Its sources are checked again within this many days, as a guide's are. */
export const TEMPLATE_LAW_REVIEW_DAYS = 30;

/** The ids of the blocks added after a template's own words. */
export const TEMPLATE_LAW_PART = {
  covers: "template-law-covers",
  limits: "template-law-limits",
  assumesTitle: "template-law-assumes-title",
  assumes: "template-law-assumes",
  openTitle: "template-law-open-title",
  open: "template-law-open",
  sourcesTitle: "template-law-sources-title",
  sources: "template-law-sources",
  written: "template-law-written",
  reviewMeaning: "template-law-review-meaning",
  sourcesChecked: "template-law-sources-checked",
} as const;

/** A block of a document, as the document schema holds it. */
type Block = ReturnType<typeof documentInput.parse>["content"]["blocks"][number];

/**
 * The whole template a candidate carries: its own words as the intake reads them, then what it
 * covers, its limits, what it assumes and leaves open, its sources, how it was written and checked,
 * and when its sources were checked, printed as a day in Lagos and as the exact instant the gate
 * compares. Its files are made from this one document.
 */
export function lawTemplateDocument(input: {
  title: string;
  blocks: readonly Block[];
  map: TemplateClaimMap;
  sourcesCheckedAt: string;
  references: readonly { title: string; locator: string; url: string }[];
}) {
  const { title, blocks, map, sourcesCheckedAt, references } = input;
  if (references.some((r) => new URL(r.url).protocol !== "https:"))
    throw Error("TEMPLATE_REFERENCE_NOT_HTTPS");
  const paragraph = (id: string, text: string): Block => ({ id, type: "paragraph", text, rows: [] });
  const list = (id: string, lines: readonly string[]): Block => ({
    id,
    type: "list",
    text: lines.join("\n"),
    rows: [],
  });
  return documentInput.parse({
    title,
    content: {
      fields: {
        issuerName: "",
        recipientName: "",
        documentNumber: "",
        issueDate: "",
        dueDate: "",
        notes: "",
      },
      blocks: [
        ...blocks,
        paragraph(TEMPLATE_LAW_PART.covers, `What it covers: ${TEMPLATE_LAW_SCOPE}`),
        paragraph(TEMPLATE_LAW_PART.limits, `Limits you should know: ${TEMPLATE_LAW_LIMITATIONS}`),
        ...(map.contract
          ? [
              paragraph(TEMPLATE_LAW_PART.assumesTitle, "What it assumes:"),
              list(TEMPLATE_LAW_PART.assumes, [...map.contract.parties, ...map.contract.use]),
              paragraph(TEMPLATE_LAW_PART.openTitle, "Left for the parties to settle:"),
              list(TEMPLATE_LAW_PART.open, map.contract.openClauses),
            ]
          : []),
        ...(references.length
          ? [
              paragraph(TEMPLATE_LAW_PART.sourcesTitle, "Sources:"),
              list(TEMPLATE_LAW_PART.sources, guideSourceLines(references)),
            ]
          : []),
        paragraph(TEMPLATE_LAW_PART.written, `How it was written and checked: ${disclosure}`),
        paragraph(TEMPLATE_LAW_PART.reviewMeaning, TEMPLATE_LAW_REVIEW_MEANING),
        paragraph(
          TEMPLATE_LAW_PART.sourcesChecked,
          `Sources checked: ${lagosDay(sourcesCheckedAt)} (${sourcesCheckedAt}).`,
        ),
      ],
      selectedClauses: [],
      formatting: { font: "sans", accent: "forest" },
    },
  });
}

/** The record of a template candidate's claim scope, kept with it as a guide's is. */
export type TemplateClaimScope = Omit<GuideClaimScope, "guide"> & { template: string };

/**
 * A template's candidate and sources, built from its retained words, its claim map and the passages
 * supplied (the ones kept in the repository unless others are given).
 *
 * Each source carries the decision its text's amendment record supports on the day given. The legal
 * scope is verified only when every sentence about the law is bound and every source is approved;
 * anything short of that is listed as missing evidence, and the gate holds the candidate.
 */
export async function buildLawTemplateCandidate(
  id: string,
  version = 1,
  passages: GuidePassages = retainedGuidePassages(),
  now = new Date(),
  records?: readonly AmendmentRecord[],
) {
  const map = templateLawClaimMaps.find((m) => m.id === id);
  if (!map) throw Error(`TEMPLATE_CLAIM_MAP_MISSING:${id}`);
  const intake = await readTemplateIntake(id, version);
  const own = intake.document.content.blocks;
  const built = buildTemplateClaims(map, own, passages);
  // A template whose map states nothing about the law is not this policy's.
  if (!built.statesLaw) throw Error(`TEMPLATE_STATES_NO_LAW:${id}`);
  if (!built.sources.length) throw Error(`TEMPLATE_HAS_NO_BOUND_SOURCE:${id}`);

  const used: GuidePassage[] = [],
    notCurrent: string[] = [];
  const sources = built.sources.map((source) => {
    const passage = passages(source.id);
    if (!passage) throw Error(`TEMPLATE_SOURCE_PASSAGE_MISSING:${id}:${source.id}`);
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

  // The sources were last read when the newest of them was fetched: the check date the template can
  // truthfully carry.
  const reviewedAt = new Date(Math.max(...sources.map((s) => Date.parse(s.retrievedAt)))).toISOString();
  const reviewBy = new Date(Date.parse(reviewedAt) + TEMPLATE_LAW_REVIEW_DAYS * 86_400_000).toISOString();
  const document = lawTemplateDocument({
    title: intake.section.title,
    blocks: own,
    map,
    sourcesCheckedAt: reviewedAt,
    references: guideReferences({ candidate: { claims: built.claims }, sources }),
  });
  const raw: Omit<PublicationBundle["candidate"], "hash"> = {
    id,
    version,
    body: JSON.stringify(document),
    contentClass: "general_template",
    jurisdiction: "NG",
    risk: map.risk,
    scope: TEMPLATE_LAW_SCOPE,
    limitations: TEMPLATE_LAW_LIMITATIONS,
    assumptions: built.assumptions,
    unresolvedMaterialIssues: [],
    missingEvidence,
    sourceCheckDate: reviewedAt,
    reviewBy,
    disclosure,
    evidenceMode: "regulatory",
    legalScopeStatus: missingEvidence.length ? "unverified" : "verified",
    coverage: { kind: "template", industrySlugs: [], locationIds: [] },
    claims: built.claims,
  };
  const { template, ...counts } = built.scope;
  const claimScope: TemplateClaimScope = {
    template,
    ...counts,
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
    document,
    claimScope,
    original: intake.section.body,
    provenance: {
      ...intake.provenance,
      transformation: `${intake.provenance.transformation}; what it covers, its limits, what it assumes and leaves open, and its sources added after its own words`,
    },
  };
}

/**
 * The passages a candidate's claim scope records, each with the words and checksum of the candidate's
 * own source for it, and what does not match: a recorded passage that describes no source of the
 * candidate, or a source with no recorded passage.
 */
export function lawTemplateScopePassages(
  bundle: Pick<PublicationBundle, "sources">,
  scope: Pick<TemplateClaimScope, "passages">,
) {
  const problems: string[] = [];
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
  return { held, problems };
}

/**
 * A stored candidate built again, as its reviews and its release read it: from its retained draft,
 * today's claim map, and the passages its claim scope records, with the words of its own sources. The
 * caller compares what is built with what is stored; anything that differs holds the candidate.
 */
export async function rebuildLawTemplateCandidate(
  bundle: Pick<PublicationBundle, "candidate" | "sources">,
  scope: TemplateClaimScope,
  now = new Date(),
  records?: readonly AmendmentRecord[],
) {
  const { held, problems } = lawTemplateScopePassages(bundle, scope);
  if (problems.length || scope.template !== bundle.candidate.id) throw Error("TEMPLATE_CLAIM_SCOPE_CHANGED");
  const passages: GuidePassages = (id) => held.get(id);
  return buildLawTemplateCandidate(bundle.candidate.id, bundle.candidate.version, passages, now, records);
}

/**
 * Builds a candidate's claims and source decisions again from its own sources and its recorded claim
 * scope, with today's claim map and amendment records, and says what differs, as a guide's check
 * does. An empty list means the candidate's claims and assumptions are exactly what the map yields
 * from those sources, and each source carries the decision its record supports now.
 */
export async function lawTemplateClaimScopeProblems(
  bundle: Pick<PublicationBundle, "candidate" | "sources">,
  scope: TemplateClaimScope,
  now: Date,
  records?: readonly AmendmentRecord[],
) {
  const c = bundle.candidate,
    problems: string[] = [];
  const map = templateLawClaimMaps.find((m) => m.id === c.id);
  if (!map) return [`no claim map exists for ${c.id}`];
  if (scope.template !== c.id || scope.mapDigest !== digest(map))
    problems.push("the claim map has changed since the candidate was built");
  if (map.risk !== c.risk) problems.push("the candidate's risk class is not the claim map's");
  const { held, problems: unheld } = lawTemplateScopePassages(bundle, scope);
  problems.push(...unheld);
  if (problems.length) return problems;

  const intake = await readTemplateIntake(c.id, c.version);
  let rebuilt;
  try {
    rebuilt = buildTemplateClaims(map, intake.document.content.blocks, (id) => held.get(id));
  } catch (error) {
    return [`the claim map no longer builds from the candidate's sources: ${(error as Error).message}`];
  }
  if (digest(rebuilt.claims) !== digest(c.claims))
    problems.push("the candidate's claims are not what the claim map yields from its sources");
  if (digest(rebuilt.assumptions) !== digest(c.assumptions))
    problems.push("the candidate's assumptions are not what the claim map states");
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
