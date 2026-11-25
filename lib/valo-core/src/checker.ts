import { z } from "zod";
import { digest, disclosure, ownerRuleDisclosure } from "./publication";
import { checkerQuestion, INDUSTRIES, isAsked } from "./checker-questionnaire";
import {
  richCheckerFactsSchema,
  sourceFamilyReleaseSchema,
  sourceFamilyBindingMatches,
  evaluateReleasedSourceFamily,
  type MissingQuestionState,
} from "./checker-rich";

export const unknownAnswers = ["unknown", "unanswered", "not_applicable"] as const;
const unknown = z.enum(unknownAnswers);
const answer = z.enum(["yes", "no", ...unknownAnswers]);
export const legacyCheckerFactsSchema = z
  .object({
    legalForm: z.string().max(80),
    registrationStatus: z.string().max(80),
    activities: z.union([z.array(z.string().min(1).max(120)).max(10), unknown]),
    productTypes: z.union([z.array(z.string().min(1).max(120)).max(10), unknown]).default("unanswered"),
    state: z.string().max(80),
    lga: z.string().max(100),
    employees: z.string().regex(/^(unknown|unanswered|not_applicable|[0-9]{1,7})$/),
    turnoverBand: z.enum(["under_5m", "5m_to_25m", "25m_to_100m", "over_100m", ...unknownAnswers]),
    turnoverYear: z.string().regex(/^(unknown|unanswered|not_applicable|[0-9]{4})$/),
    turnoverMetric: z.enum(["gross_revenue", ...unknownAnswers]),
    turnoverCurrency: z.enum(["NGN", ...unknownAnswers]),
    turnoverPeriod: z.enum(["annual", "monthly", "quarterly", ...unknownAnswers]).default("unanswered"),
    turnoverAmountKobo: z
      .string()
      .regex(/^[0-9]{1,24}$/)
      .nullable()
      .default(null),
    turnoverPeriodStart: z.union([z.string().date(), unknown]).default("unanswered"),
    turnoverPeriodEnd: z.union([z.string().date(), unknown]).default("unanswered"),
    premises: answer,
    manufacturing: answer,
    importing: answer,
    personalData: answer,
  })
  .strict();
export const checkerFactsSchema = legacyCheckerFactsSchema
  .extend({
    factsVersion: z.literal("checker-facts-v2").optional(),
    rich: richCheckerFactsSchema.optional(),
  })
  .strict()
  .superRefine((facts, ctx) => {
    if (facts.rich !== undefined && facts.factsVersion !== "checker-facts-v2")
      ctx.addIssue({
        code: "custom",
        path: ["factsVersion"],
        message: "Rich answers require their explicit facts version",
      });
    const tax = facts.rich?.tax;
    if (
      typeof tax?.accountingPeriodStart === "string" &&
      typeof tax.accountingPeriodEnd === "string" &&
      tax.accountingPeriodStart > tax.accountingPeriodEnd
    )
      ctx.addIssue({
        code: "custom",
        path: ["rich", "tax", "accountingPeriodEnd"],
        message: "The accounting period end must not precede its start",
      });
  });
export type CheckerFacts = z.infer<typeof checkerFactsSchema>;
export const factNames = Object.keys(legacyCheckerFactsSchema.shape) as (keyof z.infer<
  typeof legacyCheckerFactsSchema
>)[];
const field = z.enum(
  factNames as [
    keyof z.infer<typeof legacyCheckerFactsSchema>,
    ...(keyof z.infer<typeof legacyCheckerFactsSchema>)[],
  ],
);
const scalar = z.union([z.string().max(160), z.number().int().safe(), z.boolean()]);
export const predicateSchema = z
  .object({
    field,
    op: z.enum(["eq", "in", "exists", "lt", "lte", "gt", "gte"]),
    value: z.union([scalar, z.array(scalar).max(30)]).optional(),
    metric: z.string().max(40).optional(),
    currency: z.string().max(10).optional(),
    period: z.enum(["annual", "monthly", "quarterly"]).optional(),
    year: z
      .string()
      .regex(/^[0-9]{4}$/)
      .optional(),
    periodStart: z.string().date().optional(),
    periodEnd: z.string().date().optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.op !== "exists" && p.value === undefined)
      ctx.addIssue({ code: "custom", message: "An operand is required" });
    if (p.op === "in" && !Array.isArray(p.value))
      ctx.addIssue({ code: "custom", message: "in requires an array" });
    if (["lt", "lte", "gt", "gte"].includes(p.op) && !["employees", "turnoverAmountKobo"].includes(p.field))
      ctx.addIssue({ code: "custom", message: "Numeric comparisons require a typed numeric fact" });
    if (
      p.field === "turnoverAmountKobo" &&
      (!p.metric ||
        !p.currency ||
        !p.period ||
        !p.year ||
        !p.periodStart ||
        !p.periodEnd ||
        !["eq", "lt", "lte", "gt", "gte"].includes(p.op))
    )
      ctx.addIssue({
        code: "custom",
        message: "Turnover comparisons require a numeric operator, metric, currency, exact period and year",
      });
  });
export const conditionSchema = z
  .object({
    mode: z.enum(["all", "any"]),
    predicates: z.array(predicateSchema).min(1).max(30),
  })
  .strict();
export const ruleSchema = z
  .object({
    id: z.string().min(1).max(100),
    version: z.number().int().positive(),
    requirementVersionId: z.string().min(1),
    title: z.string().min(1).max(200),
    jurisdiction: z
      .object({
        level: z.enum(["federal", "state", "lga"]),
        state: z.string().optional(),
        lga: z.string().optional(),
      })
      .strict(),
    validFrom: z.string().date(),
    validTo: z.string().date().nullable(),
    sourceCheckedAt: z.string().datetime({ offset: true }),
    reviewBy: z.string().datetime({ offset: true }),
    status: z.enum(["published", "held", "withdrawn", "superseded"]),
    /** How the version was released: the reviewed route, the owner's sign-off (decision 0020), or a
     * test fixture, which counts only in fixture mode. */
    provenance: z.enum(["editorial_release", "owner_signoff", "synthetic_fixture"]),
    manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
    sources: z
      .array(
        z
          .object({
            id: z.string().min(1),
            url: z.string().url().startsWith("https://"),
            title: z.string().min(1),
            locator: z.string().min(1),
            quote: z.string().min(1),
            snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .min(1),
    condition: conditionSchema.optional(),
    evaluator: sourceFamilyReleaseSchema.optional(),
    reason: z.string().min(1).max(1000),
    nextStep: z.string().min(1).max(1000),
    relatedTemplateIds: z.array(z.string()).max(20),
    /** Where the business acts on the requirement: the authority, and its own page for it
     * (docs/architecture/results.md). A rule that records none leaves the result's own route. */
    officialRoute: z
      .object({
        authority: z.string().min(1).max(120),
        url: z.string().url().startsWith("https://"),
      })
      .strict()
      .optional(),
    /** CMP-006: each fee, deadline, rate or threshold the rule shows, in the words of the passage of
     * one of its sources. A fee is the government's; a Valo or provider charge is never recorded. */
    figures: z
      .array(
        z
          .object({
            kind: z.enum(["fee", "deadline", "rate", "threshold"]),
            words: z.string().min(1).max(300),
            sourceId: z.string().min(1),
          })
          .strict(),
      )
      .min(1)
      .max(8)
      .optional(),
  })
  .strict()
  .superRefine((rule, ctx) => {
    // A figure is in the words of the passage its source quotes, which the release checks against the
    // official text, so nothing is shown that the source does not say.
    for (const figure of rule.figures ?? [])
      if (
        !rule.sources.some((source) => source.id === figure.sourceId && source.quote.includes(figure.words))
      )
        ctx.addIssue({
          code: "custom",
          message: `A ${figure.kind} must be in the words its source quotes`,
        });
    if (Boolean(rule.condition) === Boolean(rule.evaluator))
      ctx.addIssue({
        code: "custom",
        message: "Exactly one deterministic rule condition or versioned source-family evaluator is required",
      });
    if (rule.evaluator && rule.jurisdiction.level !== "federal")
      ctx.addIssue({
        code: "custom",
        message: "Source-family v1 evaluates only its named national proposition",
      });
  });
export type ReleasedRule = z.infer<typeof ruleSchema>;
/** CMP-007: whether a rule's own route is a page on one of its policy's official hosts, as its sources
 * must be. A rule that records no route passes. */
export function routeOnOfficialHost(
  rule: { officialRoute?: { url: string } | undefined },
  officialHosts: readonly string[],
) {
  if (!rule.officialRoute) return true;
  const url = URL.canParse(rule.officialRoute.url) ? new URL(rule.officialRoute.url) : null;
  return (
    url !== null &&
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    (url.port === "" || url.port === "443") &&
    officialHosts.includes(url.hostname)
  );
}
type Truth = "true" | "false" | "unknown";
export type RuleItem = {
  ruleId: string;
  ruleVersion: number;
  requirementVersionId: string;
  title: string;
  label: "Likely relevant" | "May apply" | "More information needed" | "Not indicated by these answers";
  reason: string;
  missingFacts: string[];
  matchedFacts: string[];
  nextStep: string;
  missingAnswerStates?: { field: string; state: MissingQuestionState }[];
  assessedProposition?: string;
  sourceLinkedTaskEligible?: boolean;
  factsNotice?: string;
  sourceReviewHold?: string;
  /** How the item's rule was released (EDP-008), as `releaseNotice` gives it. */
  releaseNotice?: string;
  jurisdiction: ReleasedRule["jurisdiction"];
  sources: ReleasedRule["sources"];
  relatedTemplateIds: string[];
  officialRoute?: NonNullable<ReleasedRule["officialRoute"]>;
  figures?: NonNullable<ReleasedRule["figures"]>;
};
/** What a requirement carries of where to act and its figures: only what its rule records, so a
 * result from rules that record neither is exactly what it was. */
const routeAndFigures = (rule: ReleasedRule) => ({
  ...(rule.officialRoute && { officialRoute: rule.officialRoute }),
  ...(rule.figures && { figures: rule.figures }),
});
/** EDP-008: what a result says about how its rule was released. A rule released on the reviewed
 * route was AI drafted and reviewed, and its bundle says so; one released on the owner's sign-off
 * was not, and says what was done instead (decision 0020). A synthetic fixture is never shown as
 * Nigerian guidance and says nothing. */
export function releaseNotice(rule: Pick<ReleasedRule, "provenance">): { releaseNotice?: string } {
  if (rule.provenance === "owner_signoff") return { releaseNotice: ownerRuleDisclosure };
  if (rule.provenance === "editorial_release") return { releaseNotice: disclosure };
  return {};
}
const absent = (v: unknown) =>
  v === undefined ||
  v === null ||
  v === "" ||
  (typeof v === "string" && unknownAnswers.includes(v as (typeof unknownAnswers)[number])) ||
  (Array.isArray(v) && v.length === 0);
const uniq = (v: string[]) => [...new Set(v)].sort();
const bands: Record<string, { min: bigint; max: bigint | null }> = {
  under_5m: { min: 0n, max: 499999999n },
  "5m_to_25m": { min: 500000000n, max: 2499999999n },
  "25m_to_100m": { min: 2500000000n, max: 10000000000n },
  over_100m: { min: 10000000001n, max: null },
};
function compare(a: bigint, op: string, b: bigint): boolean {
  return op === "lt" ? a < b : op === "lte" ? a <= b : op === "gt" ? a > b : op === "gte" ? a >= b : a === b;
}
function predicate(
  f: CheckerFacts,
  p: z.infer<typeof predicateSchema>,
  asOfDate: string,
): { truth: Truth; missing: string[] } {
  const v = f[p.field],
    missing: string[] = [];
  if (p.field === "turnoverAmountKobo") {
    for (const [k, expected] of [
      ["turnoverMetric", p.metric],
      ["turnoverCurrency", p.currency],
      ["turnoverPeriod", p.period],
      ["turnoverYear", p.year],
      ["turnoverPeriodStart", p.periodStart],
      ["turnoverPeriodEnd", p.periodEnd],
    ] as const)
      if (f[k] !== expected) missing.push(k);
    if (p.periodEnd && p.periodEnd > asOfDate) missing.push("completedAccountingPeriod");
    if (missing.length) return { truth: "unknown", missing };
    // Decimal-safe integer minor units; broad bands never force a threshold result.
    const operand = String(p.value);
    if (!/^[0-9]{1,24}$/.test(operand)) throw new Error("Unsafe numeric operand");
    const threshold = BigInt(operand);
    if (v === null) {
      const band = bands[f.turnoverBand];
      if (!band) return { truth: "unknown", missing: ["turnoverAmountKobo"] };
      const below = threshold < band.min,
        above = band.max !== null && threshold > band.max;
      const trueForAll =
        p.op === "eq"
          ? band.min === threshold && band.max === threshold
          : p.op === "lt"
            ? band.max !== null && band.max < threshold
            : p.op === "lte"
              ? band.max !== null && band.max <= threshold
              : p.op === "gt"
                ? band.min > threshold
                : band.min >= threshold;
      const falseForAll =
        p.op === "eq"
          ? below || above
          : p.op === "lt"
            ? band.min >= threshold
            : p.op === "lte"
              ? band.min > threshold
              : p.op === "gt"
                ? band.max !== null && band.max <= threshold
                : band.max !== null && band.max < threshold;
      if (!trueForAll && !falseForAll) return { truth: "unknown", missing: ["turnoverAmountKobo"] };
      return { truth: trueForAll ? "true" : "false", missing: [] };
    }
    return { truth: compare(BigInt(String(v)), p.op, threshold) ? "true" : "false", missing: [] };
  }
  if (absent(v)) return { truth: "unknown", missing: [p.field] };
  if (p.op === "exists") return { truth: "true", missing: [] };
  if (["lt", "lte", "gt", "gte"].includes(p.op) || (p.field === "employees" && p.op === "eq")) {
    if (!/^[0-9]+$/.test(String(v)) || !/^[0-9]+$/.test(String(p.value)))
      throw new Error("Unsafe numeric operand");
    return {
      truth: compare(BigInt(String(v)), p.op, BigInt(String(p.value))) ? "true" : "false",
      missing: [],
    };
  }
  const values = Array.isArray(v) ? v : [v],
    expected = Array.isArray(p.value) ? p.value : [p.value];
  return { truth: values.some((x) => x !== null && expected.includes(x)) ? "true" : "false", missing: [] };
}

/** Whether an answer is still to be given: not given, not known, or skipped. "Not applicable" is an
 * answer, as the check's page counts it. */
const stillToGive = (v: unknown) =>
  v === undefined ||
  v === null ||
  v === "" ||
  v === "unknown" ||
  v === "unanswered" ||
  (Array.isArray(v) && v.length === 0);

/**
 * The questions a result lists as still unanswered: those the check asks, by the same conditions as
 * its page (`checker-questionnaire.ts`), whose answer is still to be given. The optional exact
 * turnover figure is never listed.
 */
export function missingQuestions(f: CheckerFacts) {
  return factNames.filter((k) => !checkerQuestion(k)?.optional && isAsked(f, k) && stillToGive(f[k]));
}

/**
 * The release checks each rule version must pass before the check uses it, by its `id@version`: the
 * reason it is held, or null when it is in use. A rule is held unless it is published, trusted,
 * freshly checked, in its effective period, the only such version of its rule, and bound to this
 * build's calculation.
 */
function releaseHolds(
  rules: readonly ReleasedRule[],
  asOfDate: string,
  evaluatedAt: Date,
  options: { fixtureMode?: boolean; trustedManifestHashes?: ReadonlySet<string> },
): Map<string, string | null> {
  const activeCounts = new Map<string, number>();
  for (const r of rules) {
    if (
      r.status === "published" &&
      r.validFrom <= asOfDate &&
      (r.validTo === null || r.validTo > asOfDate) &&
      Date.parse(r.reviewBy) > evaluatedAt.getTime() &&
      Date.parse(r.sourceCheckedAt) <= evaluatedAt.getTime() &&
      (r.provenance === "synthetic_fixture"
        ? options.fixtureMode
        : options.trustedManifestHashes?.has(r.manifestHash))
    )
      activeCounts.set(r.id, (activeCounts.get(r.id) ?? 0) + 1);
  }
  const holds = new Map<string, string | null>();
  for (const r of rules) {
    let hold = r.status !== "published" ? "Rule is not released" : null;
    if (r.provenance === "synthetic_fixture" && !options.fixtureMode)
      hold = "Synthetic fixture is not Nigerian publication evidence";
    if (r.provenance !== "synthetic_fixture" && !options.trustedManifestHashes?.has(r.manifestHash))
      hold = "No trusted eligible publication manifest";
    if (
      Date.parse(r.reviewBy) <= evaluatedAt.getTime() ||
      Date.parse(r.sourceCheckedAt) > evaluatedAt.getTime()
    )
      hold = "Evidence is stale or not yet checked";
    if (r.validFrom > asOfDate || (r.validTo !== null && r.validTo <= asOfDate))
      hold = "Outside effective period";
    if ((activeCounts.get(r.id) ?? 0) > 1)
      hold = "Conflicting released versions require editorial resolution";
    if (r.evaluator && !sourceFamilyBindingMatches(r.evaluator))
      hold = "The released evaluator version does not match this implementation";
    holds.set(`${r.id}@${r.version}`, hold);
  }
  return holds;
}

/**
 * The rule versions the check would use on `asOfDate`: those that pass the same release checks as
 * `assess`, in its order. The route that lists the rules in use reads it, so that the page asks the
 * questions of exactly the rules a result would use (RUL-001).
 */
export function rulesInUse(
  rules: ReleasedRule[],
  asOfDate: string,
  evaluatedAt: Date,
  options: { fixtureMode?: boolean; trustedManifestHashes?: ReadonlySet<string> } = {},
): ReleasedRule[] {
  const parsed = rules.map((r) => ruleSchema.parse(r));
  const holds = releaseHolds(parsed, asOfDate, evaluatedAt, options);
  return [...parsed]
    .sort((a, b) => a.id.localeCompare(b.id) || a.version - b.version)
    .filter((r) => holds.get(`${r.id}@${r.version}`) === null);
}

/** Server supplies the immutable, trusted registry. HTTP callers cannot supply rules or fixtureMode. */
export function assess(
  facts: CheckerFacts,
  rules: ReleasedRule[],
  asOfDate: string,
  evaluatedAt: Date,
  options: { fixtureMode?: boolean; trustedManifestHashes?: ReadonlySet<string> } = {},
) {
  const f = checkerFactsSchema.parse(facts);
  z.string().date().parse(asOfDate);
  const day = new Date(evaluatedAt.getTime() + 3600000).toISOString().slice(0, 10);
  if (asOfDate > day) throw new Error("Future assessments are not supported");
  const items: RuleItem[] = [],
    held: { ruleId: string; reason: string }[] = [];
  const eligibility: Record<string, string> = {};
  const parsedRules = rules.map((r) => ruleSchema.parse(r));
  const holds = releaseHolds(parsedRules, asOfDate, evaluatedAt, options);
  for (const raw of [...parsedRules].sort((a, b) => a.id.localeCompare(b.id) || a.version - b.version)) {
    const r = ruleSchema.parse(raw),
      key = `${r.id}@${r.version}`;
    const hold = holds.get(key) ?? null;
    eligibility[key] = hold ?? "eligible";
    if (hold) {
      held.push({ ruleId: r.id, reason: hold });
      continue;
    }
    let scope: Truth = "true",
      scopeMissing: string[] = [];
    if (r.jurisdiction.level !== "federal") {
      if (!r.jurisdiction.state) throw new Error("State scope is missing");
      if (absent(f.state)) {
        scope = "unknown";
        scopeMissing.push("state");
      } else if (f.state !== r.jurisdiction.state) scope = "false";
      if (r.jurisdiction.level === "lga" && scope !== "false") {
        if (!r.jurisdiction.lga) throw new Error("LGA scope is missing");
        if (absent(f.lga)) {
          scope = "unknown";
          scopeMissing.push("lga");
        } else if (f.lga !== r.jurisdiction.lga) scope = "false";
      }
    }
    if (r.evaluator) {
      const outcome = evaluateReleasedSourceFamily(r.evaluator, f.rich, {
        manifestHash: r.manifestHash,
        version: r.version,
        sources: r.sources,
        asOfDate,
      });
      items.push({
        ruleId: r.id,
        ruleVersion: r.version,
        requirementVersionId: r.requirementVersionId,
        title: r.title,
        ...outcome,
        ...releaseNotice(r),
        jurisdiction: r.jurisdiction,
        sources: r.sources,
        relatedTemplateIds: r.relatedTemplateIds,
        ...routeAndFigures(r),
      });
      continue;
    }
    const condition = r.condition!;
    const results = condition.predicates.map((p) => predicate(f, p, asOfDate));
    const truth: Truth =
      scope === "false"
        ? "false"
        : condition.mode === "all"
          ? results.some((p) => p.truth === "false")
            ? "false"
            : scope === "unknown" || results.some((p) => p.truth === "unknown")
              ? "unknown"
              : "true"
          : scope === "true" && results.some((p) => p.truth === "true")
            ? "true"
            : scope === "unknown" || results.some((p) => p.truth === "unknown")
              ? "unknown"
              : "false";
    items.push({
      ruleId: r.id,
      ruleVersion: r.version,
      requirementVersionId: r.requirementVersionId,
      title: r.title,
      label:
        truth === "true"
          ? "Likely relevant"
          : truth === "unknown"
            ? "More information needed"
            : "Not indicated by these answers",
      reason:
        truth === "false"
          ? "These answers did not indicate this scoped rule. This is not a legal exemption."
          : r.reason,
      missingFacts: truth === "unknown" ? uniq([...scopeMissing, ...results.flatMap((p) => p.missing)]) : [],
      matchedFacts:
        truth === "true"
          ? uniq(condition.predicates.filter((_, i) => results[i]!.truth === "true").map((p) => p.field))
          : [],
      nextStep:
        truth === "unknown"
          ? "Answer the missing questions or confirm with the named authority."
          : r.nextStep,
      ...releaseNotice(r),
      jurisdiction: r.jurisdiction,
      sources: r.sources,
      relatedTemplateIds: r.relatedTemplateIds,
      ...routeAndFigures(r),
    });
  }
  const rulesetVersion = digest({
    rules: [...parsedRules].sort((a, b) => a.id.localeCompare(b.id) || a.version - b.version),
    eligibility,
  });
  const unanswered = uniq([...missingQuestions(f), ...items.flatMap((i) => i.missingFacts)]);
  const eligible = parsedRules.filter((r) => !holds.get(`${r.id}@${r.version}`));
  const gaps = [
    ...(items.length === 0
      ? [
          "No eligible released rules are available for these answers. This is not a finding that no duties apply.",
        ]
      : []),
    `State/FCT and LGA coverage is not comprehensive. Confirm location-specific requirements for ${absent(f.state) ? "your location" : f.state}.`,
    ...uncoveredPlaceAndIndustries(f, eligible),
    "High-impact healthcare, financial services and energy activities require activity-specific released evidence.",
    ...held.map((h) => `${h.ruleId}: ${h.reason}`),
  ];
  const result = {
    schemaVersion:
      f.factsVersion === "checker-facts-v2" || parsedRules.some((r) => r.evaluator)
        ? "checker-v2"
        : "checker-v1",
    asOfDate,
    rulesetVersion,
    items,
    unanswered,
    gaps,
    recommendedTemplateIds: uniq(
      items
        .filter((i) => i.label === "Likely relevant" && i.sourceLinkedTaskEligible !== false)
        .flatMap((i) => i.relatedTemplateIds),
    ),
    // A released rule in force but held, for stale evidence, a conflict or a changed calculation,
    // gives no result, yet still sends the business to its route (CMP-007, EDP-012).
    officialRoutes: officialRoutes(
      items,
      parsedRules.filter(
        (r) =>
          holds.get(`${r.id}@${r.version}`) &&
          r.status === "published" &&
          r.validFrom <= asOfDate &&
          (r.validTo === null || r.validTo > asOfDate) &&
          (r.provenance === "synthetic_fixture"
            ? options.fixtureMode === true
            : options.trustedManifestHashes?.has(r.manifestHash) === true),
      ),
    ),
    notice:
      "Conditional source-governed guidance, not legal certification. Unknown answers never establish exemption.",
    sourceBackedRecommendations: items.filter((i) => i.label === "Likely relevant").length,
  };
  return { ...result, resultHash: digest(result) };
}
export type AssessmentResult = ReturnType<typeof assess>;
/**
 * CMP-003 and RUL-006: what the answers name that no released rule covers (docs/architecture/results.md).
 * The local government area given, unless a released rule is scoped to it; and each of the
 * specification's industries the business does, unless a released rule tests for it. An answer that
 * names neither adds nothing, so a result from such answers is what it was.
 */
function uncoveredPlaceAndIndustries(f: CheckerFacts, eligible: readonly ReleasedRule[]) {
  const gaps: string[] = [];
  if (!absent(f.lga) && !eligible.some((r) => r.jurisdiction.level === "lga" && r.jurisdiction.lga === f.lga))
    gaps.push(`No released rule covers local requirements for ${f.lga}.`);
  const named = Array.isArray(f.activities) ? f.activities : [];
  for (const industry of INDUSTRIES) {
    if (industry === "other" || !named.includes(industry)) continue;
    const tested = eligible.some((r) =>
      r.condition?.predicates.some(
        (p) =>
          p.field === "activities" &&
          (Array.isArray(p.value) ? p.value.includes(industry) : p.value === industry),
      ),
    );
    if (!tested) gaps.push(`No released rule covers requirements specific to ${industry}.`);
  }
  return gaps;
}
/**
 * Where a result sends the business (CMP-007, EDP-012): the routes of its requirements that may
 * apply, and of the rules held from it, each once. A result with none keeps the Corporate Affairs
 * Commission's service page, so a result from rules that record no route is what it was.
 */
function officialRoutes(items: RuleItem[], held: ReleasedRule[]) {
  const routes = new Map<string, string>();
  for (const route of [
    ...items
      .filter((item) => item.label !== "Not indicated by these answers")
      .map((item) => item.officialRoute),
    ...held.map((rule) => rule.officialRoute),
  ])
    if (route && !routes.has(route.url)) routes.set(route.url, route.authority);
  return routes.size
    ? [...routes].map(([url, title]) => ({ title, url }))
    : [{ title: "Corporate Affairs Commission service discovery", url: "https://icrp.cac.gov.ng/" }];
}
export function factsFromProfile(raw: Record<string, unknown>): CheckerFacts {
  return checkerFactsSchema.parse(
    Object.fromEntries(
      factNames.map((k) => [
        k,
        raw[k] ??
          (k === "activities" ? [] : k === "turnoverAmountKobo" ? null : k === "lga" ? "" : "unanswered"),
      ]),
    ),
  );
}
