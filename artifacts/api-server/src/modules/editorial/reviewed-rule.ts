import {
  candidateDigest,
  canonical,
  digest,
  disclosure,
  isPreparedRuleId,
  mandatoryMechanicalChecks,
  planRuleRelease,
  publicationSchema,
  releaseNotice,
  routeOnOfficialHost,
  ruleSchema,
  sha256,
  sourceFamilyBindingMatches,
  type PublicationBundle,
  type ReleasedRule,
} from "@workspace/valo-core";
import { GUIDANCE_NOTICE, GUIDE_PART_PREFIX } from "@workspace/valo-core/printed-page";
import { printedCalendarDate } from "@workspace/valo-core/guided-runtime";
import { documentInput } from "../../lib/valo-validation";
import type { AmendmentRecord, GuidePassages, inspectOperationalExports } from "../publication";
import type { CurrentSourceCapture } from "../sources";
import type { OwnerRuleCandidate } from "./owner-rule-candidates";
import { bindRuleSources, OWNER_RULE_QUOTE_WORDS } from "./rule-sources";

/**
 * A requirements-check rule prepared in the repository, built for the reviewed route
 * (docs/architecture/reviewed-route.md, part 3; slice 3a).
 *
 * The rule's sources are bound to today's captures as the owner's route binds them (`bindRuleSources`).
 * A source is current only on its amendment record's decision: on this route nobody confirms the
 * enhanced checks, which the two reviews run (decision 0014). The rule is the owner route's with the
 * reviewed route's provenance; its candidate's body is the rule without its manifest hash; it carries
 * the reviewed route's disclosure and the guidance policy; its ten mechanical checks are measured from
 * the rule; and its two files are the rule's sheet. Its rights record is the one the owner chose for
 * this route (`reviewedRouteRights`); with none, the rule is held.
 *
 * Building a rule calls no model, reviews nothing and releases nothing.
 */

/** What the drafting record says of a rule written in the repository: what is known, and no more. */
export const REPOSITORY_RULE_DRAFT = {
  model: "Written in the repository from research notes; the model that drafted it is not recorded",
  promptVersion: "repository-rule-candidate-1",
} as const;
/** What a rule's two reviews are, and are not (EDP-008), as its sheet prints it. */
export const RULE_REVIEW_MEANING =
  "A rule is released on this route only after two separate automated AI checks and the source, scenario and file checks pass. That is not legal or regulatory verification, and it is not professional certification.";
/** The notice a rule's sheet prints at the top of every page. */
export const RULE_SHEET_NOTICE = GUIDANCE_NOTICE;
const DAY = 86_400_000;
/** Words a rule may never use of itself (EDP-008). */
const professionalClaim =
  /lawyer.approved|professionally (?:verified|reviewed|certified)|guaranteed (?:compliant|valid)|reviewed by (?:a|our) (?:lawyer|solicitor|tax adviser|accountant|regulator)/i;
const wordCount = (text: string) => text.trim().split(/\s+/u).filter(Boolean).length;
/** Why a rule with no rights record for this route is held. */
export const REVIEWED_ROUTE_RIGHTS_MISSING =
  "No rights record covers this rule on the reviewed route: its record adopts each version's wording by the development owner's signature, and this route has none. The owner chooses whether a version released here is adopted, and on what basis.";
/** The rights record a rule carries on this route while the owner has chosen none. It is never cleared. */
const noRightsRecord: PublicationBundle["rights"] = {
  status: "unknown",
  evidence: REVIEWED_ROUTE_RIGHTS_MISSING,
  evidenceHash: sha256(REVIEWED_ROUTE_RIGHTS_MISSING),
  commercialUse: false,
};
const placeholderManifest = "0".repeat(64);

/** A rule as the reviewed route releases it, before its manifest hash is known. */
export type ReviewedRuleContent = Omit<ReleasedRule, "manifestHash">;
export type ReviewedRuleInput = {
  version: number;
  captures: readonly CurrentSourceCapture[];
  passages: GuidePassages;
  records: readonly AmendmentRecord[];
  /** The guidance policy as the code reads it today. */
  policy: PublicationBundle["policy"];
  now: Date;
};

/** The day an instant falls on in Lagos (UTC+01:00, no daylight saving), as a file prints a day. */
function lagosDay(instant: string) {
  const time = Date.parse(instant);
  if (!Number.isFinite(time)) throw Error("RULE_SOURCE_CHECK_DATE_INVALID");
  return printedCalendarDate(new Date(time + 3_600_000).toISOString().slice(0, 10));
}

const figureWords = { fee: "Fee", deadline: "Deadline", rate: "Rate", threshold: "Threshold" } as const;

/**
 * The rule's sheet: what the requirements check shows for the rule, where to act, the figures it
 * shows, what it covers, its limits and assumptions, its sources with the words it quotes, how it was
 * written and checked, and when its sources were checked. Both of a rule's files are made from it;
 * the check itself shows the rule on screen.
 */
export function ruleSheet(rule: ReviewedRuleContent, candidate: PublicationBundle["candidate"]) {
  const part = (id: string) => `${GUIDE_PART_PREFIX}rule-${id}`;
  const paragraph = (id: string, text: string) => ({
    id: part(id),
    type: "paragraph" as const,
    text,
    rows: [],
  });
  const list = (id: string, lines: readonly string[]) => ({
    id: part(id),
    type: "list" as const,
    text: lines.join("\n"),
    rows: [],
  });
  return documentInput.parse({
    title: rule.title,
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
        paragraph("why", `Why it may matter: ${rule.reason}`),
        paragraph("next", `What to do next: ${rule.nextStep}`),
        ...(rule.officialRoute
          ? [paragraph("route", `Where to do it: ${rule.officialRoute.authority}, ${rule.officialRoute.url}`)]
          : []),
        ...(rule.figures?.length
          ? [
              paragraph("figures-title", "Figures it shows:"),
              list(
                "figures",
                rule.figures.map((f) => `${figureWords[f.kind]}: ${f.words}`),
              ),
            ]
          : []),
        paragraph("covers", `What it covers: ${candidate.scope}`),
        paragraph("limits", `Limits you should know: ${candidate.limitations}`),
        ...(candidate.assumptions.length
          ? [paragraph("assumptions-title", "What it assumes:"), list("assumptions", candidate.assumptions)]
          : []),
        paragraph("sources-title", "Sources:"),
        list(
          "sources",
          rule.sources.map((s) => `${s.title}, ${s.locator}: "${s.quote}". ${s.url}`),
        ),
        paragraph("written", `How it was written and checked: ${disclosure}`),
        paragraph("review-meaning", RULE_REVIEW_MEANING),
        paragraph(
          "sources-checked",
          `Sources checked: ${lagosDay(candidate.sourceCheckDate)} (${candidate.sourceCheckDate}).`,
        ),
      ],
      selectedClauses: [],
      formatting: { font: "sans", accent: "forest" },
    },
  });
}

/** The drafting record of a rule written in the repository, bound to its candidate and sources. */
export function repositoryRuleDraftRun(
  candidate: OwnerRuleCandidate,
  bundle: Pick<PublicationBundle, "candidate" | "sources">,
): PublicationBundle["draftRun"] {
  return {
    runId: `repository-rule:${digest(candidate)}`,
    model: REPOSITORY_RULE_DRAFT.model,
    promptVersion: REPOSITORY_RULE_DRAFT.promptVersion,
    candidateHash: bundle.candidate.hash,
    evidenceHash: digest(bundle.sources),
  };
}

/**
 * The ten mechanical checks the gate requires, each measured from the rule, its candidate and its
 * sources, against the rule prepared in the repository. No model verdict and no list of names stands
 * in for a result. They are checks of binding and form, and of the rule's own scenarios; they are not
 * legal, tax or regulatory review.
 */
export function ruleMechanicalChecks(input: {
  prepared: OwnerRuleCandidate;
  rule: ReviewedRuleContent;
  bundle: Pick<PublicationBundle, "candidate" | "sources" | "policy" | "rights">;
  /** The guidance policy as the code reads it today. */
  trustedPolicy: PublicationBundle["policy"];
  now: Date;
}): PublicationBundle["mechanicalChecks"] {
  const { prepared, rule, bundle, now } = input;
  const c = bundle.candidate,
    p = bundle.policy;
  const parsedRule = ruleSchema.safeParse({ ...rule, manifestHash: placeholderManifest });
  const official = (url: string) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" && p.officialHosts.includes(parsed.hostname);
    } catch {
      return false;
    }
  };

  const claimFacts = c.claims.map((claim) => {
    const source = bundle.sources.find((s) => s.id === claim.sourceId);
    return {
      claimHash: digest(claim),
      bound: Boolean(
        source &&
        sha256(source.text) === source.hash &&
        source.text.includes(claim.quote) &&
        claim.numbers.every((n) => claim.quote.includes(n)),
      ),
    };
  });
  const quotations = rule.sources.map((s) => ({
    sourceId: s.id,
    bound:
      bundle.sources.some(
        (bs) => bs.id === s.id && bs.url === s.url && bs.hash === s.snapshotHash && bs.text.includes(s.quote),
      ) &&
      c.claims.some(
        (claim) => claim.sourceId === s.id && claim.locator === s.locator && claim.quote === s.quote,
      ),
  }));
  const longQuotes = [
    ...new Set([...rule.sources.map((s) => s.quote), ...c.claims.map((x) => x.quote)]),
  ].filter((q) => wordCount(q) > OWNER_RULE_QUOTE_WORDS).length;
  const sourceIds = bundle.sources.map((s) => s.id);
  const claimsBound = claimFacts.length > 0 && claimFacts.every((f) => f.bound);
  const sourcesBound =
    quotations.length > 0 &&
    quotations.every((q) => q.bound) &&
    digest([...sourceIds].sort()) === digest(prepared.sources.map((s) => s.id).sort()) &&
    new Set(sourceIds).size === sourceIds.length;

  const checked = Date.parse(c.sourceCheckDate),
    reviewBy = Date.parse(c.reviewBy ?? "");
  const dates =
    [checked, reviewBy].every(Number.isFinite) &&
    checked <= +now &&
    reviewBy > +now &&
    reviewBy - checked <= (c.risk === "general" ? 90 : 30) * DAY &&
    rule.sourceCheckedAt === c.sourceCheckDate &&
    rule.reviewBy === c.reviewBy &&
    bundle.sources.length > 0 &&
    // The rule's check date is the day its oldest source was read; none was read before it.
    Math.min(...bundle.sources.map((s) => Date.parse(s.retrievedAt))) === checked &&
    bundle.sources.every(
      (s) =>
        Date.parse(s.retrievedAt) <= +now &&
        Date.parse(s.freshUntil) > +now &&
        Date.parse(s.effectiveFrom) <= +now &&
        s.effectiveTo === null,
    );

  const same = (a: unknown, b: unknown) => digest(a) === digest(b);
  const scopeProblems = [
    ...(digest(p) === digest(input.trustedPolicy)
      ? []
      : ["the candidate's policy is not the guidance policy"]),
    ...(p.ownerApproved ? [] : ["the owner has not approved the guidance policy"]),
    ...(p.developmentOnly === true ? [] : ["the policy is not limited to development"]),
    ...(p.allowedClasses.includes(c.contentClass) &&
    p.jurisdictions.includes(c.jurisdiction) &&
    p.risks.includes(c.risk)
      ? []
      : ["the rule's class, place or subject is outside the policy"]),
    ...(isPreparedRuleId(c.id) &&
    c.id === prepared.rule.requirementVersionId &&
    rule.id === prepared.rule.id &&
    c.contentClass === "sourced_guidance" &&
    c.coverage === undefined &&
    c.evidenceMode === undefined
      ? []
      : ["the candidate is not a rule prepared in the repository"]),
    ...(c.legalScopeStatus === "verified" ? [] : ["the rule's legal scope is not verified"]),
    ...(c.risk === prepared.risk &&
    c.scope === prepared.scope &&
    c.limitations === prepared.limitations &&
    same(c.assumptions, prepared.assumptions) &&
    same(c.unresolvedMaterialIssues, prepared.unresolvedMaterialIssues) &&
    same(c.missingEvidence, prepared.missingEvidence) &&
    same(c.claims, prepared.claims)
      ? []
      : ["the candidate's scope, limits, assumptions or claims are not the prepared rule's"]),
    ...bundle.sources
      .filter((s) => !official(s.url))
      .map((s) => `a source is not on an official host: ${s.id}`),
    ...(routeOnOfficialHost(rule, p.officialHosts)
      ? []
      : ["the rule's official route is not on an official host"]),
  ];

  const figures = (rule.figures ?? []).map((f) => ({
    kind: f.kind,
    bound: bundle.sources.some(
      (s) =>
        s.id === f.sourceId &&
        rule.sources.some((rs) => rs.id === f.sourceId && rs.quote.includes(f.words)) &&
        s.text.includes(f.words),
    ),
  }));

  const rightsBound =
    prepared.reviewedRouteRights !== undefined &&
    same(bundle.rights, prepared.reviewedRouteRights) &&
    bundle.rights.status === "cleared" &&
    bundle.rights.commercialUse &&
    bundle.rights.evidenceHash === sha256(bundle.rights.evidence);

  const fields = [rule.title, rule.reason, rule.nextStep, rule.requirementVersionId].every(
    (t) => t.trim().length > 0,
  );

  // The scenarios run through the requirements check with this rule alone in place, as the release
  // plan runs them; the manifest is trusted for these runs only.
  const plan = parsedRule.success
    ? planRuleRelease({
        candidate: parsedRule.data,
        current: [],
        scenarios: prepared.scenarios,
        profiles: [],
        latestVersion: rule.version - 1,
        now,
        // The day in Lagos; each scenario is run on its own date.
        asOfDate: new Date(+now + 3_600_000).toISOString().slice(0, 10),
        trustedManifestHashes: new Set<string>(),
      })
    : null;
  const scenarios = plan?.scenarios ?? [];

  const facts = {
    schema: {
      pass:
        publicationSchema.shape.candidate.safeParse(c).success &&
        parsedRule.success &&
        rule.provenance === "editorial_release" &&
        rule.status === "published" &&
        candidateDigest(c) === c.hash &&
        c.body === canonical(rule),
      ruleParsed: parsedRule.success,
      canonicalHash: c.hash,
    },
    source_locators: {
      pass: claimsBound && sourcesBound && longQuotes === 0,
      claimFacts,
      quotations,
      quotationsOverLimit: longQuotes,
    },
    dates: {
      pass: dates,
      checked: c.sourceCheckDate,
      reviewBy: c.reviewBy,
    },
    scope: {
      pass: scopeProblems.length === 0,
      rule: rule.id,
      policy: p.version,
      problems: scopeProblems,
    },
    numeric_extraction: {
      // Every number a claim carries is in its quotation, and every figure the rule shows is in the
      // words its source quotes and in that source's passage.
      pass: claimsBound && figures.every((f) => f.bound),
      legalClaimCount: c.claims.length,
      numbers: c.claims.reduce((count, claim) => count + claim.numbers.length, 0),
      figures,
    },
    rights: {
      pass: rightsBound,
      rightsHash: digest(bundle.rights),
    },
    required_fields: {
      pass: fields && c.body === canonical(rule) && rule.sources.length > 0,
      bodyIsCanonical: c.body === canonical(rule),
    },
    disclosures: {
      pass:
        c.disclosure === disclosure &&
        releaseNotice(rule).releaseNotice === disclosure &&
        !professionalClaim.test(c.body),
      requiredNotice: disclosure,
    },
    arithmetic: {
      // A rule's calculation is its source family's, bound by the hash of the algorithm the code runs;
      // a rule with a condition computes nothing.
      pass:
        parsedRule.success &&
        (rule.evaluator ? sourceFamilyBindingMatches(rule.evaluator) : Boolean(rule.condition)),
      evaluator: rule.evaluator ?? null,
    },
    rule_fixtures: {
      pass:
        scenarios.length === prepared.scenarios.length &&
        scenarios.some((s) => s.critical) &&
        scenarios.every((s) => s.passed),
      scenarios: scenarios.map((s) => ({ id: s.id, expected: s.expectedLabel, actual: s.actualLabel })),
    },
  };
  return mandatoryMechanicalChecks.map((name) => ({
    name,
    candidateHash: c.hash,
    result: facts[name].pass ? "pass" : "fail",
    evidenceHash: digest({ validator: "rule-mechanical-1", name, ...facts[name] }),
  }));
}

/**
 * A prepared rule built for the reviewed route from today's captures: the rule, its candidate, its
 * sources and their decisions, its rights record, the policy, the drafting record, its mechanical
 * checks, its sheet, what holds it, and the capture each source is bound to. Its files and manifest
 * come once the sheet has been rendered (`reviewedRuleBundle`). Nothing is read or written.
 */
export function buildReviewedRule(prepared: OwnerRuleCandidate, input: ReviewedRuleInput) {
  const { parts, holds, checkedAt, freshUntil, passageText } = bindRuleSources(prepared, input);
  const url = (p: (typeof parts)[number]) => p.lead?.url ?? "https://invalid.invalid/";
  const rule: ReviewedRuleContent = {
    ...prepared.rule,
    version: input.version,
    sourceCheckedAt: checkedAt.toISOString(),
    reviewBy: freshUntil,
    status: "published",
    provenance: "editorial_release",
    sources: parts.map((p) => ({
      id: p.source.id,
      url: url(p),
      title: p.title,
      locator: p.source.locator,
      quote: p.source.quote,
      snapshotHash: sha256(passageText(p)),
    })),
  };
  const sources: PublicationBundle["sources"] = parts.map((p) => ({
    id: p.source.id,
    url: url(p),
    title: p.title,
    issuingBody: p.passage?.instrument.issuingBody ?? p.lead?.title ?? "Unknown",
    text: passageText(p),
    hash: sha256(passageText(p)),
    jurisdiction: "NG",
    retrievedAt: p.capture?.checkedAt ?? checkedAt.toISOString(),
    freshUntil,
    effectiveFrom: p.passage?.instrument.effectiveFrom ?? checkedAt.toISOString(),
    effectiveTo: null,
    status: p.decision?.status === "approved" ? "approved" : "held",
    operativeTextConfirmed: Boolean(p.decision?.operativeTextConfirmed),
    amendmentsResolved: Boolean(p.decision?.amendmentsResolved),
  }));
  // The legal scope is verified only when every source is bound to its capture and current on its
  // amendment record. Anything short of that is held by the source's own hold.
  const verified =
    parts.every((p) => p.capture && p.passage) &&
    sources.every((s) => s.status === "approved" && s.operativeTextConfirmed && s.amendmentsResolved);
  const raw: Omit<PublicationBundle["candidate"], "hash"> = {
    id: prepared.rule.requirementVersionId,
    version: input.version,
    body: canonical(rule),
    contentClass: "sourced_guidance",
    jurisdiction: "NG",
    risk: prepared.risk,
    scope: prepared.scope,
    limitations: prepared.limitations,
    assumptions: prepared.assumptions,
    unresolvedMaterialIssues: prepared.unresolvedMaterialIssues,
    missingEvidence: prepared.missingEvidence,
    sourceCheckDate: checkedAt.toISOString(),
    reviewBy: freshUntil,
    disclosure,
    legalScopeStatus: verified ? "verified" : "unverified",
    claims: prepared.claims,
  };
  const candidate = { ...raw, hash: candidateDigest(raw) };
  // The rights record is the one the owner chose for this route; with none, the rule is held.
  const rights = prepared.reviewedRouteRights ?? noRightsRecord;
  if (!prepared.reviewedRouteRights) holds.push(REVIEWED_ROUTE_RIGHTS_MISSING);
  const content = { candidate, sources, rights, policy: input.policy };
  const mechanicalChecks = ruleMechanicalChecks({
    prepared,
    rule,
    bundle: content,
    trustedPolicy: input.policy,
    now: input.now,
  });
  const snapshotIds = Object.fromEntries(
    parts.flatMap((p) => (p.capture && p.passage ? [[p.source.id, p.capture.snapshotId]] : [])),
  );
  // Where each source's passage was read from, so that the rule can be built again from its own
  // sources for its reviews.
  const passages = parts.flatMap((p) =>
    p.passage
      ? [
          {
            sourceId: p.source.id,
            id: p.passage.id,
            recordedLocator: p.passage.recordedLocator,
            sections: p.passage.sections,
            instrument: p.passage.instrument,
          },
        ]
      : [],
  );
  return {
    rule,
    ...content,
    draftRun: repositoryRuleDraftRun(prepared, content),
    mechanicalChecks,
    sheet: ruleSheet(rule, candidate),
    holds,
    snapshotIds,
    passages,
  };
}
export type BuiltReviewedRule = ReturnType<typeof buildReviewedRule>;

/**
 * The rule's publication bundle, with its two files' inspection and, once they have run, its reviews
 * and the enhanced checks they ran. The manifest binds every part; it is eligible only once both
 * reviews have passed, and the rule's manifest hash is the manifest's digest.
 */
export function reviewedRuleBundle(
  built: BuiltReviewedRule,
  exportReport: Pick<Awaited<ReturnType<typeof inspectOperationalExports>>, "formats" | "hashes">,
  reviewed: { reviews: PublicationBundle["reviews"]; enhancedChecks: PublicationBundle["enhancedChecks"] } = {
    reviews: [],
    enhancedChecks: [],
  },
) {
  const exports = (["docx", "pdf"] as const).map((format) => ({
    format,
    candidateHash: built.candidate.hash,
    fileHash: exportReport.hashes[format],
    rendered: exportReport.formats[format].parsed,
    disclosureIncluded: exportReport.formats[format].disclosureIncluded,
    scopeIncluded: exportReport.formats[format].scopeIncluded,
    limitationsIncluded: exportReport.formats[format].limitationsIncluded,
    sourceDateIncluded: exportReport.formats[format].sourceDateIncluded,
  }));
  const parts = {
    candidate: built.candidate,
    sources: built.sources,
    rights: built.rights,
    policy: built.policy,
    draftRun: built.draftRun,
    reviews: reviewed.reviews,
    mechanicalChecks: built.mechanicalChecks,
    enhancedChecks: reviewed.enhancedChecks,
    exports,
  };
  const bundle: PublicationBundle = {
    ...parts,
    manifest: {
      candidateHash: built.candidate.hash,
      evidenceHash: digest(built.sources),
      rightsHash: digest(built.rights),
      policyHash: built.policy.hash,
      reviewHash: digest({ draft: parts.draftRun, reviews: parts.reviews }),
      checksHash: digest({ mechanical: parts.mechanicalChecks, enhanced: parts.enhancedChecks }),
      exportsHash: digest(exports),
      // A bundle with no reviews is never eligible.
      status: reviewed.reviews.length ? "eligible" : "review",
    },
  };
  return { bundle, rule: { ...built.rule, manifestHash: digest(bundle.manifest) } as ReleasedRule };
}
