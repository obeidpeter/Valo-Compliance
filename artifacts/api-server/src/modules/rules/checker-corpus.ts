import {
  assess,
  checkerFactsSchema,
  digest,
  richBusinessNameSchema,
  richPrivacySchema,
  richProductSchema,
  richTaxSchema,
  type CheckerFacts,
  type ReleasedRule,
} from "@workspace/valo-core";
import { evaluateBusinessNameCandidate } from "@workspace/valo-core/checker-business-name";
import { evaluateSourceCandidateOffline } from "@workspace/valo-core/checker-source-candidates";
import { INDUSTRIES } from "@workspace/valo-core/checker-questionnaire";
import type { z } from "zod";

/**
 * RUL-008: the frozen scenario corpus (`docs/evaluation-candidates/checker.json`) put to the
 * requirements check as a business would answer it. The corpus states each case's facts in its four
 * research notes' own words; the check asks its own questions. This maps each case to the check's
 * answers and says, for each case, which facts the check asks in other words, which it has no question
 * for, and what the case implies without saying. The corpus is not changed.
 */
export const corpusCandidates = {
  "CAND-CAMA-814-BUSINESS-NAME": { ruleId: "cac-business-name-814", family: "businessName" },
  "CAND-NDPA-27-COLLECTION-INFORMATION": { ruleId: "ndpa-27-collection-information", family: "privacy" },
  "CAND-NTAA-11-COMPANY-RETURN": { ruleId: "ntaa-11-company-return", family: "tax" },
  "CAND-NAFDAC-F33-PRODUCT-MANUFACTURING": {
    ruleId: "nafdac-f33-product-registration",
    family: "product",
  },
} as const;
type CandidateId = keyof typeof corpusCandidates;
type Family = (typeof corpusCandidates)[CandidateId]["family"];

/** A case of the frozen corpus, as far as the check reads it. */
export type CorpusCase = {
  caseID: string;
  title: string;
  assessmentDate: string;
  sourceCandidateID: string;
  facts: Record<string, unknown> & {
    sector: string;
    geography: { stateOrFCT: unknown; lga: unknown };
    sourceContext: { mode: string };
  };
  expectedOutcomeCandidate: {
    nationalApplicability: string;
    customerLabelCandidate: string;
    mustShowLocalCoverageGap: boolean;
    automaticStatutoryDeadline: boolean;
    automaticReminder: boolean;
    complianceCertification: boolean;
  };
  coverageTags: string[];
  executionPreconditions: { intentionalEligibilityFailureScenario: boolean };
};

/**
 * How a case meets the check. Most cases meet released rules on their date. A case that tests a hold
 * says which, and the run sets it up as the live check would meet it:
 * - `before_rule_in_force`: the date is before the rule's text took effect;
 * - `review_lapsed`: the rule's source review has run out;
 * - `future`: the date is after today, which the check does not assess;
 * - `rule_not_released`: only a proposed rule exists, so no released rule answers the case.
 */
export type CorpusContext =
  "current" | "before_rule_in_force" | "review_lapsed" | "future" | "rule_not_released";
const contexts: Record<string, CorpusContext> = {
  evaluate_only_after_final_source_and_rule_review: "current",
  historical_period_outside_candidate_source: "before_rule_in_force",
  historical_tax_period_requires_separate_source: "before_rule_in_force",
  simulated_review_expiry: "review_lapsed",
  future_period_beyond_review: "future",
  draft_instrument_only_no_released_evidence_bundle: "rule_not_released",
};

export type CorpusMapping = {
  caseId: string;
  ruleId: string;
  context: CorpusContext;
  asOfDate: string;
  facts: CheckerFacts;
  /** Each fact the check asks in other words, with the answer given for it. */
  translated: { fact: string; from: unknown; to: Record<string, unknown> }[];
  /** Each fact the check has no question for, so no answer is given for it. */
  notAsked: string[];
  /** An answer the case implies without stating it. */
  assumed: { answer: string; value: unknown; why: string }[];
};

/** The corpus's six sectors, as the specification's industries the check offers. */
const industries: Record<string, (typeof INDUSTRIES)[number]> = {
  retail_wholesale: "retail/wholesale",
  packaged_foods: "packaged-food manufacturing",
  restaurants_hospitality: "restaurants/hospitality",
  technology_software: "technology/software",
  professional_services: "professional services",
  beauty_personal_care: "beauty/personal care",
};
const schemas = {
  businessName: richBusinessNameSchema,
  privacy: richPrivacySchema,
  tax: richTaxSchema,
  product: richProductSchema,
} satisfies Record<Family, z.ZodObject<z.ZodRawShape>>;
/** The facts that set the scene rather than answer a rule's questions. */
const sceneFacts = new Set(["sector", "geography", "sourceContext"]);

/**
 * A value the check's choices word differently. The check takes every answer as the business's
 * assertion and asks separately what would confirm it, so a confirmed and a claimed exception are the
 * same answer here; the questions that confirm it are mapped on their own.
 */
const values: Partial<Record<Family, Record<string, Record<string, unknown>>>> = {
  privacy: {
    section3Exception: {
      solely_household_confirmed: "personal_household",
      household_claim: "personal_household",
      legal_claim_asserted: "legal_claim",
    },
  },
  product: {
    productRegistration: {
      not_registered: "none",
      supplier_registration_confirmed_for_scenario: "supplier_registration_claimed",
      confirmed_current_for_scenario: "current_for_product_and_manufacturer",
    },
    specialSamplePermit: { confirmed_for_scenario: "permit_held", claimed_not_verified: "permit_held" },
  },
};

/**
 * The business-name facts the check asks as other questions. The corpus names the section 814(2)
 * exception a case claims; the check asks what the name adds (its naming questions) and who carries on
 * the business. A receiver or manager, appointed by a court or claimed to be, is said by who carries
 * on the business and their appointment, which those cases give.
 */
const namingFor: Record<string, Record<string, boolean> | null> = {
  none: { onlyAddedWordsIndicateSuccession: false, onlyAdditionIsPluralS: false },
  succession_only_confirmed: { onlyAddedWordsIndicateSuccession: true },
  succession_claim_with_other_addition: { onlyAddedWordsIndicateSuccession: false, otherBrandAddition: true },
  shared_surname_plural_s_confirmed: { onlyAddedWordsIndicateSuccession: false, onlyAdditionIsPluralS: true },
  court_manager_confirmed: null,
  court_receiver_confirmed: null,
  unverified_claim: null,
};

const marker = (value: unknown): value is { status: string; value: null } =>
  typeof value === "object" && value !== null && "status" in value && Reflect.get(value, "value") === null;
const place = (value: unknown) =>
  typeof value === "string" ? value : marker(value) ? value.status : "unknown";

/** The case's answers to the check's questions, and what the mapping says about them. */
export function mapCorpusCase(c: CorpusCase): CorpusMapping {
  const candidate = corpusCandidates[c.sourceCandidateID as CandidateId];
  if (!candidate) throw new Error(`${c.caseID}: no rule is prepared from ${c.sourceCandidateID}`);
  const context = contexts[c.facts.sourceContext.mode];
  if (!context) throw new Error(`${c.caseID}: unknown source context ${c.facts.sourceContext.mode}`);
  const industry = industries[c.facts.sector];
  if (!industry) throw new Error(`${c.caseID}: unknown sector ${c.facts.sector}`);
  const { family } = candidate;
  const shape: Record<string, z.ZodTypeAny> = schemas[family].shape;
  const group: Record<string, unknown> = {};
  const translated: CorpusMapping["translated"] = [];
  const notAsked: string[] = [];
  const assumed: CorpusMapping["assumed"] = [];
  let employees = "unknown";
  for (const [fact, value] of Object.entries(c.facts)) {
    if (sceneFacts.has(fact)) continue;
    if (family === "businessName" && fact === "registrationStatus") {
      if (value !== "not_registered" && value !== "registered")
        throw new Error(`${c.caseID}: registration status ${String(value)} is not mapped`);
      group.businessNameRegistered = value === "registered";
      translated.push({ fact, from: value, to: { businessNameRegistered: value === "registered" } });
      continue;
    }
    if (family === "businessName" && fact === "section814Exception") {
      const naming = typeof value === "string" ? namingFor[value] : undefined;
      if (naming === undefined) throw new Error(`${c.caseID}: exception ${String(value)} is not mapped`);
      if (naming) {
        // A case that states the naming questions itself keeps its own answers.
        const stated = c.facts.namingAssessment;
        group.namingAssessment = { ...naming, ...(stated && !marker(stated) ? stated : {}) };
        translated.push({ fact, from: value, to: { namingAssessment: group.namingAssessment } });
      } else
        translated.push({
          fact,
          from: value,
          to: { operatorRole: c.facts.operatorRole, appointmentAuthority: c.facts.appointmentAuthority },
        });
      continue;
    }
    if (family === "product" && fact === "employeeCount" && typeof value === "number") {
      employees = String(value);
      translated.push({ fact, from: value, to: { employees } });
      continue;
    }
    const field = shape[fact];
    if (!field) {
      notAsked.push(fact);
      continue;
    }
    if (fact === "namingAssessment" && group.namingAssessment) continue;
    const named = typeof value === "string" ? values[family]?.[fact]?.[value] : undefined;
    if (named !== undefined) {
      group[fact] = named;
      translated.push({ fact, from: value, to: { [fact]: named } });
      continue;
    }
    if (field.safeParse(value).success) {
      group[fact] = value;
      continue;
    }
    // A value none of the check's choices names is its "Other".
    if (!field.safeParse("other").success)
      throw new Error(`${c.caseID}: ${fact} ${JSON.stringify(value)} is not among the check's answers`);
    group[fact] = "other";
    translated.push({ fact, from: value, to: { [fact]: "other" } });
  }
  // The check asks who carries on the business. A case that names no receiver or manager says the
  // individual, firm or company it describes carries it on.
  if (family === "businessName" && group.operatorRole === undefined && group.carryingOnBusiness === true) {
    group.operatorRole = "proprietor";
    assumed.push({
      answer: "operatorRole",
      value: "proprietor",
      why: "The case says the business is carried on and names no receiver or manager carrying it on.",
    });
  }
  const facts = checkerFactsSchema.parse({
    legalForm: "unknown",
    registrationStatus: "unknown",
    activities: [industry],
    state: place(c.facts.geography.stateOrFCT),
    lga: place(c.facts.geography.lga),
    employees,
    turnoverBand: "unknown",
    turnoverYear: "unknown",
    turnoverMetric: "gross_revenue",
    turnoverCurrency: "NGN",
    premises: "unknown",
    manufacturing: "unknown",
    importing: "unknown",
    personalData: "unknown",
    factsVersion: "checker-facts-v2",
    rich: { [family]: group },
  });
  return {
    caseId: c.caseID,
    ruleId: candidate.ruleId,
    context,
    asOfDate: c.assessmentDate,
    facts,
    translated,
    notAsked,
    assumed,
  };
}

/**
 * The cases whose live result is not the corpus's expected one, as the run found them on 25 November
 * 2026, with the result the check gives and why. The corpus's expected results are not changed by
 * this record, and nothing here accepts a result: a case leaves this list only when the check, or an
 * accepted correction of the corpus, gives the expected result. The run's test fails when any case's
 * result moves away from what is recorded here.
 */
export const corpusDifferences: Record<
  string,
  {
    live: string;
    /** Whose result it is: the check's own, or its research note's, repeated. */
    source: "check" | "note";
    why: string;
  }
> = {
  "CHK-CAND-NDPA-009": {
    live: "More information needed",
    source: "check",
    why: 'The check\'s own calculation. The business claims the personal or household exception while it uses the list for promotions. The check takes the answer as the exception it names, and its calculation then asks whether privacy rights were violated, where the research note and the corpus say commercial reuse ends the exception. The answer cannot say "claimed" apart from "confirmed".',
  },
  "CHK-CAND-NDPA-018": {
    live: "More information needed",
    source: "note",
    why: "The research note's own result, which the check repeats. Section 2(2)(a) also reaches a controller or processor domiciled, resident or operating in Nigeria, and the case does not say where the business is domiciled or resident (docs/valo/source-checker-oracle-v2-proposed.md).",
  },
  "CHK-CAND-NTAA-009": {
    live: "More information needed",
    source: "note",
    why: "The research note's own result, which the check repeats and holds for source review. Section 147's meaning of a company includes associations, so an ordinary partnership not incorporated is not shown to fall outside it (oracle v2 proposal).",
  },
  "CHK-CAND-NAFDAC-005": {
    live: "Likely relevant",
    source: "note",
    why: "The research note's own result, which the check repeats. Section 1(1) names sale and distribution; a supplier's registration is a way of meeting the requirement, not a sign it does not apply (oracle v2 proposal).",
  },
  "CHK-CAND-NAFDAC-009": {
    live: "Likely relevant",
    source: "note",
    why: "The research note's own result, which the check repeats. Supply and repackaging of a processed food are known, and the supplier's registration of the original product does not cover the repackaged one (oracle v2 proposal).",
  },
  "CHK-CAND-NAFDAC-012": {
    live: "Likely relevant",
    source: "note",
    why: "The research note's own result, which the check repeats. A cosmetic supplied commercially is within section 1(1); how the questions' \"commercial supply\" meets the section's activities is to be challenged (oracle v2 proposal).",
  },
  "CHK-CAND-NAFDAC-013": {
    live: "Likely relevant",
    source: "note",
    why: "The research note's own result, which the check repeats. Section 1(1) names importation, which does not depend on making the product in Nigeria (oracle v2 proposal).",
  },
  "CHK-CAND-NAFDAC-016": {
    live: "Likely relevant",
    source: "note",
    why: "The research note's own result, which the check repeats. A product with therapeutic claims needs classifying under section 13, but a drug and a cosmetic are both within section 1(1) (oracle v2 proposal).",
  },
  "CHK-CAND-NAFDAC-017": {
    live: "Not indicated by these answers",
    source: "note",
    why: "The research note's own result, which the check repeats. Section 1(2) allows the confirmed sample activity under its permit; this says nothing of later commercial supply (oracle v2 proposal).",
  },
};

export type CorpusRun = {
  caseId: string;
  title: string;
  ruleId: string;
  context: CorpusContext;
  asOfDate: string;
  expected: { applicability: string; label: string };
  /** What the live check gives: a result from the case's rule, a hold on it, or a refusal. */
  live:
    | {
        outcome: "result";
        label: string;
        reason: string;
        missingFacts: string[];
        sourceReviewHold: string | null;
        taskOffered: boolean;
        resultHash: string;
      }
    | { outcome: "held"; hold: string; resultHash: string }
    | { outcome: "refused"; reason: string };
  /** The label the case's research note gives on the case's own words, for a case not held. */
  noteLabel: string | null;
  /** The corpus's conditions every result must meet, each checked on this case's result. */
  checks: {
    sameResultTwice: boolean;
    nationalOnly: boolean;
    noDeadlineOrReminder: boolean;
    noCertification: boolean;
    unknownsNotExemptions: boolean;
    heldWhenExpected: boolean;
    reviewHoldOffersNoTask: boolean;
  };
  matchesExpected: boolean;
  mapping: Pick<CorpusMapping, "translated" | "notAsked" | "assumed">;
};

const localGap = "State/FCT and LGA coverage is not comprehensive.";
const certifies = /\b(?:(?:is|are) (?:fully )?compliant|(?:is|are) exempt\b|exempt from)/iu;
const familyOf = (ruleId: string) => Object.values(corpusCandidates).find((c) => c.ruleId === ruleId)!.family;

/**
 * Puts one mapped case to the live check: `assess`, with the rules given, as the check would meet it.
 * `rules` are released rule versions and `trusted` the manifests the registry trusts. Nothing is
 * read or written.
 */
export function runCorpusCase(
  c: CorpusCase,
  rules: ReleasedRule[],
  options: { now: Date; trusted: ReadonlySet<string> },
): CorpusRun {
  const mapping = mapCorpusCase(c);
  const rule = rules.find((r) => r.id === mapping.ruleId);
  if (!rule) throw new Error(`${c.caseID}: no released version of ${mapping.ruleId} is given`);
  // A lapsed review is met an hour after the rule's review date; a rule not released is one whose
  // manifest the registry does not trust.
  const at =
    mapping.context === "review_lapsed" ? new Date(Date.parse(rule.reviewBy) + 3_600_000) : options.now;
  const trusted =
    mapping.context === "rule_not_released"
      ? new Set([...options.trusted].filter((hash) => hash !== rule.manifestHash))
      : options.trusted;
  const run = () => {
    try {
      return assess(mapping.facts, rules, mapping.asOfDate, at, { trustedManifestHashes: trusted });
    } catch (error) {
      return { refused: error instanceof Error ? error.message : String(error) };
    }
  };
  const first = run(),
    second = run();
  let live: CorpusRun["live"];
  if ("refused" in first) live = { outcome: "refused", reason: first.refused };
  else {
    const item = first.items.find((i) => i.ruleId === mapping.ruleId);
    const hold = first.gaps.find((g) => g.startsWith(`${mapping.ruleId}: `));
    live = item
      ? {
          outcome: "result",
          label: item.label,
          reason: item.reason,
          missingFacts: item.missingFacts,
          sourceReviewHold: item.sourceReviewHold ?? null,
          taskOffered: item.sourceLinkedTaskEligible === true,
          resultHash: first.resultHash,
        }
      : { outcome: "held", hold: hold ?? "No result was given.", resultHash: first.resultHash };
  }
  const item = "refused" in first ? undefined : first.items.find((i) => i.ruleId === mapping.ruleId);
  const expectedHeld = c.expectedOutcomeCandidate.nationalApplicability === "held";
  const checks: CorpusRun["checks"] = {
    sameResultTwice:
      "refused" in first
        ? "refused" in second && second.refused === first.refused
        : !("refused" in second) && second.resultHash === first.resultHash,
    // The rule is national, and the result says the state and local government are not covered.
    nationalOnly:
      rule.jurisdiction.level === "federal" &&
      ("refused" in first || first.gaps.some((g) => g.startsWith(localGap))),
    // A rule's figure is its source's words; none is a deadline here, and the check schedules nothing.
    noDeadlineOrReminder: !(item?.figures ?? []).some((f) => f.kind === "deadline"),
    noCertification:
      ("refused" in first || first.notice.includes("not legal certification")) &&
      !certifies.test(`${item?.reason ?? ""} ${item?.nextStep ?? ""}`),
    unknownsNotExemptions:
      !item?.missingFacts.length || ["More information needed", "May apply"].includes(item.label),
    heldWhenExpected: expectedHeld ? live.outcome !== "result" : live.outcome === "result",
    reviewHoldOffersNoTask: !item?.sourceReviewHold || item.sourceLinkedTaskEligible !== true,
  };
  const label = c.expectedOutcomeCandidate.customerLabelCandidate;
  return {
    caseId: c.caseID,
    title: c.title,
    ruleId: mapping.ruleId,
    context: mapping.context,
    asOfDate: mapping.asOfDate,
    expected: { applicability: c.expectedOutcomeCandidate.nationalApplicability, label },
    live,
    noteLabel: expectedHeld ? null : noteLabel(c, rule),
    checks,
    matchesExpected: expectedHeld
      ? live.outcome !== "result"
      : live.outcome === "result" && live.label === label,
    mapping: { translated: mapping.translated, notAsked: mapping.notAsked, assumed: mapping.assumed },
  };
}

/**
 * The research note's own label for the case, in the note's own words, on the case's date, bound to the
 * rule's sources as the live check binds its calculation.
 */
function noteLabel(c: CorpusCase, rule: ReleasedRule) {
  const binding = {
    mode: "isolated_candidate_validation" as const,
    candidateVersion: `corpus-comparison:${rule.version}`,
    bindingHash: digest({ manifestHash: rule.manifestHash, sources: rule.sources }),
    sourceVersionHashes: Object.fromEntries(rule.sources.map((s) => [s.id, s.snapshotHash])),
    supportedAssessmentDates: [c.assessmentDate],
  };
  return familyOf(rule.id) === "businessName"
    ? evaluateBusinessNameCandidate(c.facts, c.assessmentDate, binding).label
    : evaluateSourceCandidateOffline(
        c.sourceCandidateID as Parameters<typeof evaluateSourceCandidateOffline>[0],
        c.facts,
        c.assessmentDate,
        binding,
      ).label;
}
