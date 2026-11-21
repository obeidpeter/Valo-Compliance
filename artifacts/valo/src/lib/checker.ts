import type { CheckerFacts, Profile, Answer } from "@workspace/api-client-react";
import {
  ANSWER_STATE_LABELS,
  isRichMarker,
  normaliseRichAnswers,
  richFactLabel,
  richReviewEntries,
  richStringLabel,
  type RichCheckerFacts,
} from "./rich-checker";
import { formatNaira } from "./format";

export const MARKERS = ["unknown", "unanswered", "not_applicable"] as const;
export type Marker = (typeof MARKERS)[number];
export const isMarker = (v: unknown): v is Marker =>
  typeof v === "string" && (MARKERS as readonly string[]).includes(v);

export const MARKER_LABEL: Record<Marker, string> = {
  unknown: "I do not know",
  unanswered: "Skip for now",
  not_applicable: "Not applicable",
};

/** Shared query options: short staleness, refresh when the tab regains focus. */
export const live = { staleTime: 30_000, refetchOnWindowFocus: true } as const;

export const EMPTY_FACTS: CheckerFacts = {
  legalForm: "unanswered",
  registrationStatus: "unanswered",
  activities: "unanswered",
  state: "unanswered",
  lga: "unanswered",
  employees: "unanswered",
  turnoverBand: "unanswered",
  turnoverYear: "unanswered",
  turnoverMetric: "unanswered",
  turnoverCurrency: "unanswered",
  turnoverPeriod: "unanswered",
  turnoverAmountKobo: null,
  turnoverPeriodStart: "unanswered",
  turnoverPeriodEnd: "unanswered",
  premises: "unanswered",
  manufacturing: "unanswered",
  importing: "unanswered",
  personalData: "unanswered",
};

/** Profile -> checker facts. Business name is deliberately never copied. */
export function factsFromProfile(p: Profile): CheckerFacts {
  const acts = p.activities.map((a) => a.trim()).filter(Boolean);
  return {
    ...EMPTY_FACTS,
    legalForm: p.legalForm,
    registrationStatus: p.registrationStatus,
    activities: acts.length ? acts : "unanswered",
    state: p.state,
    lga: p.lga.trim() ? p.lga.trim() : "unanswered",
    employees: p.employees,
    turnoverBand: p.turnoverBand,
    turnoverYear: p.turnoverYear,
    turnoverMetric: p.turnoverMetric,
    turnoverCurrency: p.turnoverCurrency,
    premises: p.premises,
    manufacturing: p.manufacturing,
    importing: p.importing,
    personalData: p.personalData,
  };
}

export const needsProducts = (f: CheckerFacts) => f.manufacturing === "yes" || f.importing === "yes";

/**
 * The checker's steps in order, each with the questions it asks. The last step reviews the answers.
 * The optional detail sections (lib/rich-checker.ts) sit inside these steps and are not listed.
 */
export const CHECKER_STEPS = [
  { name: "Your business", questions: ["legalForm", "registrationStatus"] },
  { name: "What it does", questions: ["activities", "manufacturing", "importing", "productTypes"] },
  { name: "Where it is", questions: ["premises", "state", "lga"] },
  {
    name: "Size and turnover",
    questions: [
      "employees",
      "turnoverBand",
      "turnoverAmountKobo",
      "turnoverYear",
      "turnoverPeriod",
      "turnoverPeriodStart",
      "turnoverPeriodEnd",
      "turnoverMetric",
      "turnoverCurrency",
    ],
  },
  { name: "Personal data", questions: ["personalData"] },
  { name: "Review your answers", questions: [] },
] as const satisfies readonly { name: string; questions: readonly (keyof CheckerFacts)[] }[];

/** The step that asks a question. */
export const stepOf = (question: string) =>
  Math.max(
    0,
    CHECKER_STEPS.findIndex((step) => (step.questions as readonly string[]).includes(question)),
  );

/** The questions about the turnover figure, which are skipped when turnover does not apply. */
const TURNOVER_DETAILS: readonly string[] = [
  "turnoverAmountKobo",
  "turnoverYear",
  "turnoverPeriod",
  "turnoverPeriodStart",
  "turnoverPeriodEnd",
  "turnoverMetric",
  "turnoverCurrency",
];

/**
 * Whether the checker asks a question, given the other answers. RUL-001: "irrelevant questions are
 * skipped". The rule engine leaves the same questions out of what is still unanswered
 * (`missingQuestions` in lib/valo-core/src/checker.ts).
 */
export function asked(f: CheckerFacts, question: string): boolean {
  if (question === "productTypes") return needsProducts(f);
  if (question === "lga") return f.premises !== "no";
  if (TURNOVER_DETAILS.includes(question)) return f.turnoverBand !== "not_applicable";
  return true;
}

/**
 * Whether the visitor has dealt with a question: given an answer, said they do not know or that it
 * does not apply, or chosen to skip it (`skipped` holds those). A question nobody has touched holds
 * the same "unanswered" as a skipped one, and is not dealt with.
 */
export function answered(f: CheckerFacts, skipped: ReadonlySet<string>, question: string): boolean {
  const value: unknown = Reflect.get(f, question);
  if (Array.isArray(value)) return value.some((entry) => String(entry).trim() !== "");
  if (value === undefined || value === null || value === "" || value === "unanswered")
    return skipped.has(question);
  return true;
}

/** Whether every question a step asks has been dealt with. The optional exact figure never holds a
 * step back, and the review step asks nothing. */
export function stepDone(f: CheckerFacts, skipped: ReadonlySet<string>, step: number): boolean {
  const questions = (CHECKER_STEPS[step]?.questions ?? []).filter(
    (question) => question !== "turnoverAmountKobo" && asked(f, question),
  );
  return questions.length > 0 && questions.every((question) => answered(f, skipped, question));
}

/** Normalise before sending: dependent questions become not_applicable / omitted. */
export function finaliseFacts(f: RichCheckerFacts): RichCheckerFacts {
  const out: RichCheckerFacts = { ...f };
  if (f.rich) out.rich = normaliseRichAnswers(f.rich) as NonNullable<RichCheckerFacts["rich"]>;
  if (Array.isArray(out.activities)) {
    const a = out.activities.map((x) => x.trim()).filter(Boolean);
    out.activities = a.length ? a : "unanswered";
  }
  if (needsProducts(out)) {
    if (Array.isArray(out.productTypes)) {
      const a = out.productTypes.map((x) => x.trim()).filter(Boolean);
      out.productTypes = a.length ? a : "unanswered";
    } else if (!out.productTypes) out.productTypes = "unanswered";
  } else if (out.manufacturing === "no" && out.importing === "no") {
    out.productTypes = "not_applicable";
  } else {
    delete out.productTypes;
  }
  if (out.premises === "no") out.lga = "not_applicable";
  else if (!out.lga.trim()) out.lga = "unanswered";
  else out.lga = out.lga.trim();
  if (out.turnoverBand === "not_applicable") {
    out.turnoverYear = "not_applicable";
    out.turnoverPeriod = "not_applicable";
    out.turnoverPeriodStart = "not_applicable";
    out.turnoverPeriodEnd = "not_applicable";
    out.turnoverMetric = "not_applicable";
    out.turnoverCurrency = "not_applicable";
    out.turnoverAmountKobo = null;
  }
  if (!out.turnoverAmountKobo) out.turnoverAmountKobo = null;
  return out;
}

/** "1,250,000.5" naira -> "125000050" kobo, string math only. Returns null when invalid/blank. */
export function nairaToKobo(input: string): string | null {
  const s = input.replace(/[,\s]/g, "");
  if (!s) return null;
  const m = /^(\d{1,22})(?:\.(\d{0,2}))?$/.exec(s);
  if (!m) return null;
  const kobo = (m[1] + (m[2] ?? "").padEnd(2, "0")).replace(/^0+(?=\d)/, "");
  return kobo.length > 24 ? null : kobo;
}

export function koboToNaira(kobo: string | null | undefined): string {
  if (!kobo) return "";
  const p = kobo.padStart(3, "0");
  const n = p.slice(0, -2).replace(/^0+(?=\d)/, "");
  const k = p.slice(-2);
  return k === "00" ? n : n + "." + k;
}

export const FACT_LABELS: Record<string, string> = {
  legalForm: "Legal form",
  registrationStatus: "Registration status",
  activities: "Activities",
  productTypes: "Product types",
  state: "State or FCT",
  lga: "Local government area",
  employees: "Employees",
  turnoverBand: "Turnover band",
  turnoverYear: "Turnover year",
  turnoverMetric: "Turnover measured as",
  turnoverCurrency: "Turnover currency",
  turnoverPeriod: "Turnover period",
  turnoverAmountKobo: "Exact turnover",
  turnoverPeriodStart: "Turnover period start",
  turnoverPeriodEnd: "Turnover period end",
  premises: "Operates from premises",
  manufacturing: "Manufactures goods",
  importing: "Imports goods",
  personalData: "Holds personal data",
};

export const factLabel = (k: string) => FACT_LABELS[k] ?? richFactLabel(k);

const VALUE_LABELS: Record<string, string> = {
  unknown: "I do not know",
  unanswered: "Not answered",
  not_applicable: "Not applicable",
  yes: "Yes",
  no: "No",
  under_5m: "Under ₦5 million",
  "5m_to_25m": "₦5 million to ₦25 million",
  "25m_to_100m": "₦25 million to ₦100 million",
  over_100m: "Over ₦100 million",
  gross_revenue: "Gross revenue",
  NGN: "Naira (NGN)",
};

export function valueLabel(v: string): string {
  return VALUE_LABELS[v] ?? v.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function displayFact(k: string, v: unknown): string {
  if (v === undefined) return "Not supplied";
  if (v === null) return "Not answered";
  if (isRichMarker(v)) return ANSWER_STATE_LABELS[v.status];
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.length ? v.map((item) => displayFact(k, item)).join("; ") : "None listed";
  if (typeof v === "object")
    return (
      Object.entries(v)
        .map(
          ([field, value]) =>
            `${factLabel(field)}: ${displayFact(k === "rich" || k.startsWith("rich.") ? `${k}.${field}` : field, value)}`,
        )
        .join("; ") || "No details supplied"
    );
  if ((k === "rich" || k.startsWith("rich.")) && typeof v === "string") return richStringLabel(k, v);
  if (k === "turnoverAmountKobo" && typeof v === "string" && !isMarker(v)) return formatNaira(v);
  return valueLabel(String(v));
}

export const ANSWER_OPTIONS: Answer[] = ["yes", "no", "unknown", "unanswered"];

export const LEGAL_FORMS = [
  "sole_proprietor",
  "partnership",
  "limited_company",
  "incorporated_trustees",
  "company_limited_by_guarantee",
];
export const REG_STATUSES = ["registered", "unregistered", "pending"];

export const FACT_ORDER = Object.keys(FACT_LABELS);

export function reviewFacts(facts: object): [string, unknown][] {
  const record = facts as Record<string, unknown>;
  return [
    ...FACT_ORDER.filter((key) => key in record).map((key) => [key, record[key]] as [string, unknown]),
    ...richReviewEntries(facts),
  ];
}
