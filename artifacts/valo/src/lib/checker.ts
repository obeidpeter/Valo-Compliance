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

export function lagosToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
}

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

/** Normalise before sending: dependent questions become not_applicable / omitted. */
export function finaliseFacts(f: RichCheckerFacts): RichCheckerFacts {
  const out: RichCheckerFacts = { ...f };
  if (f.rich) out.rich = normaliseRichAnswers(f.rich) as RichCheckerFacts["rich"];
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

export function formatKobo(kobo: string): string {
  const p = kobo.padStart(3, "0");
  const n = p
    .slice(0, -2)
    .replace(/^0+(?=\d)/, "")
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return "NGN " + n + "." + p.slice(-2);
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
  unknown: "Unknown",
  unanswered: "Not answered",
  not_applicable: "Not applicable",
  yes: "Yes",
  no: "No",
  under_5m: "Under N5m",
  "5m_to_25m": "N5m to N25m",
  "25m_to_100m": "N25m to N100m",
  over_100m: "Over N100m",
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
  if (k === "turnoverAmountKobo" && typeof v === "string" && !isMarker(v)) return formatKobo(v);
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
