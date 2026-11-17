import { z } from "zod";
import { digest } from "./publication";
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
    provenance: z.enum(["editorial_release", "synthetic_fixture"]),
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
  })
  .strict()
  .superRefine((rule, ctx) => {
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
  jurisdiction: ReleasedRule["jurisdiction"];
  sources: ReleasedRule["sources"];
  relatedTemplateIds: string[];
};
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

export function missingQuestions(f: CheckerFacts) {
  return factNames.filter(
    (k) =>
      k !== "turnoverAmountKobo" &&
      absent(f[k]) &&
      !(k === "productTypes" && f.manufacturing === "no" && f.importing === "no") &&
      !(k === "lga" && f.premises === "no") &&
      !(
        [
          "turnoverYear",
          "turnoverMetric",
          "turnoverCurrency",
          "turnoverPeriod",
          "turnoverPeriodStart",
          "turnoverPeriodEnd",
        ].includes(k) && f.turnoverBand === "not_applicable"
      ),
  );
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
  const activeCounts = new Map<string, number>();
  for (const r of parsedRules) {
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
  for (const raw of [...parsedRules].sort((a, b) => a.id.localeCompare(b.id) || a.version - b.version)) {
    const r = ruleSchema.parse(raw),
      key = `${r.id}@${r.version}`;
    let hold = r.status !== "published" ? "Rule is not released" : null;
    if (r.provenance === "synthetic_fixture" && !options.fixtureMode)
      hold = "Synthetic fixture is not Nigerian publication evidence";
    if (r.provenance === "editorial_release" && !options.trustedManifestHashes?.has(r.manifestHash))
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
        jurisdiction: r.jurisdiction,
        sources: r.sources,
        relatedTemplateIds: r.relatedTemplateIds,
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
          ? uniq(condition.predicates.filter((_, i) => results[i].truth === "true").map((p) => p.field))
          : [],
      nextStep:
        truth === "unknown"
          ? "Answer the missing questions or confirm with the named authority."
          : r.nextStep,
      jurisdiction: r.jurisdiction,
      sources: r.sources,
      relatedTemplateIds: r.relatedTemplateIds,
    });
  }
  const rulesetVersion = digest({
    rules: [...parsedRules].sort((a, b) => a.id.localeCompare(b.id) || a.version - b.version),
    eligibility,
  });
  const unanswered = uniq([...missingQuestions(f), ...items.flatMap((i) => i.missingFacts)]);
  const gaps = [
    ...(items.length === 0
      ? [
          "No eligible released rules are available for these answers. This is not a finding that no duties apply.",
        ]
      : []),
    `State/FCT and LGA coverage is not comprehensive. Confirm location-specific requirements for ${absent(f.state) ? "your location" : f.state}.`,
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
    officialRoutes: [
      { title: "Corporate Affairs Commission service discovery", url: "https://icrp.cac.gov.ng/" },
    ],
    notice:
      "Conditional source-governed guidance, not legal certification. Unknown answers never establish exemption.",
    sourceBackedRecommendations: items.filter((i) => i.label === "Likely relevant").length,
  };
  return { ...result, resultHash: digest(result) };
}
export type AssessmentResult = ReturnType<typeof assess>;
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
