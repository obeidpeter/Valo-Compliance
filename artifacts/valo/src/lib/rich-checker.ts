import type { CheckerFacts, RichCheckerFacts as RichFactGroups } from "@workspace/api-client-react";

export const ANSWER_STATES = ["unknown", "unanswered", "not_applicable"] as const;
export type AnswerState = (typeof ANSWER_STATES)[number];
export type RichMarker = { status: AnswerState; value: null };
export type RichValue = string | boolean | RichMarker | RichValue[] | { [key: string]: RichValue };
export type RichSection = "businessName" | "privacy" | "tax" | "product";
export type RichPartner = Record<string, RichValue>;
export type RichSectionAnswers = Record<string, RichValue>;
export type RichAnswers = RichFactGroups;
export type RichCheckerFacts = CheckerFacts;

export const RESULT_LABELS = [
  "Likely relevant",
  "May apply",
  "More information needed",
  "Not indicated by these answers",
] as const;
export const RESULT_TONES: Record<string, string> = {
  "Likely relevant": "pill-forest",
  "May apply": "pill-ochre",
  "More information needed": "pill-ochre",
  "Not indicated by these answers": "pill-ink",
};
export const ANSWER_STATE_LABELS: Record<AnswerState, string> = {
  unknown: "I do not know",
  unanswered: "Skipped for now",
  not_applicable: "Not applicable",
};
export const MISSING_ANSWER_STATE_LABELS = { ...ANSWER_STATE_LABELS, review: "Review this answer" };
export const SECTION_LABELS: Record<RichSection, string> = {
  businessName: "Business name",
  privacy: "Personal data",
  tax: "Company facts",
  product: "Products and activities",
};
const ENUM_FIELDS = new Set([
  "legalForm",
  "operatorRole",
  "appointmentAuthority",
  "type",
  "controllerRole",
  "collectionMethod",
  "dataCategories",
  "processingPurpose",
  "section3Exception",
  "indirectNoticeException",
  "effectiveManagementCountry",
  "managementStatusVerification",
  "companyStatus",
  "productCategory",
  "activity",
  "productRegistration",
  "specialSamplePermit",
]);

/** Exact names and other free text must remain distinguishable in saved comparisons. */
export function richStringLabel(path: string, value: string): string {
  return ENUM_FIELDS.has(path.split(".").at(-1) ?? "") ? humaniseFact(value) : value;
}

export function isRichMarker(value: unknown): value is RichMarker {
  return (
    !!value &&
    typeof value === "object" &&
    "status" in value &&
    "value" in value &&
    value.value === null &&
    ANSWER_STATES.includes(value.status as AnswerState)
  );
}

export function humaniseFact(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}

export function richFactLabel(path: string): string {
  if (path === "rich") return "Additional answers";
  const parts = path.replace(/^rich\./, "").split(".");
  return parts
    .map((part) =>
      /^\d+$/.test(part)
        ? `Partner ${Number(part) + 1}`
        : (SECTION_LABELS[part as RichSection] ?? humaniseFact(part)),
    )
    .join(" · ");
}

export function factAtPath(facts: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === "object" && Object.hasOwn(value, key) ? Reflect.get(value, key) : undefined,
      facts,
    );
}

export function richReviewEntries(facts: unknown): [string, unknown][] {
  const rich = factAtPath(facts, "rich");
  if (!rich || typeof rich !== "object") return [];
  const entries: [string, unknown][] = [];
  const visit = (value: unknown, path: string) => {
    if (
      value &&
      typeof value === "object" &&
      !isRichMarker(value) &&
      (!Array.isArray(value) || value.some((v) => v && typeof v === "object"))
    ) {
      const children = Object.entries(value);
      if (children.length) children.forEach(([key, child]) => visit(child, `${path}.${key}`));
      else entries.push([path, value]);
    } else entries.push([path, value]);
  };
  Object.entries(rich).forEach(([section, value]) => visit(value, `rich.${section}`));
  return entries;
}

const QUESTION_FIELDS = {
  businessName: [
    "legalForm",
    "hasPlaceOfBusinessInNigeria",
    "carryingOnBusiness",
    "businessName",
    "trueSurname",
    "trueForenames",
    "recognizedAbbreviations",
    "corporateName",
    "operatorRole",
    "appointmentAuthority",
    "appointmentConfirmed",
    "businessNameRegistered",
  ],
  privacy: [
    "processesPersonalData",
    "dataCategories",
    "automatedDecisionMaking",
    "profiling",
    "controllerRole",
    "determinesPurposesAndMeans",
    "ownPurposeReuse",
    "collectionMethod",
    "newCollectionEvent",
    "operatesInNigeria",
    "processingOccursInNigeria",
    "dataSubjectsInNigeria",
    "controllerDomiciledInNigeria",
    "controllerResidentInNigeria",
    "processorConnectionInNigeria",
    "processingPurpose",
    "commercialUse",
    "privacyRightsViolationIndicated",
    "section3Exception",
    "dataSubjectAlreadyInformed",
    "indirectNoticeException",
    "exceptionScopeConfirmed",
    "exceptionSupportingFacts",
  ],
  tax: [
    "legalForm",
    "incorporatedAsCompany",
    "incorporatedInNigeria",
    "effectiveManagementCountry",
    "managementStatusVerification",
    "companyStatus",
    "accountingPeriodStart",
    "accountingPeriodEnd",
  ],
  product: [
    "productCategory",
    "manufacturesInNigeria",
    "commercialSupplyInNigeria",
    "commercialSupplyOfRegulatedProducts",
    "activity",
    "ownBrandOrRepackaging",
    "processingOrPackaging",
    "drugOrMedicalUse",
    "therapeuticClaims",
    "productRegistration",
    "registrationCoversExactProductAndManufacturer",
    "registrationConditionsChanged",
    "specialSamplePermit",
    "permitScopeMatchesActivity",
    "permitConditionsSatisfied",
  ],
} as const satisfies { [S in RichSection]: readonly (keyof NonNullable<RichAnswers[S]>)[] };
const NAMING_QUESTION_FIELDS = [
  "onlyAddedWordsIndicateSuccession",
  "otherBrandAddition",
  "sameSurnameAllPartners",
  "onlyAdditionIsPluralS",
];
const PARTNER_QUESTION_FIELDS = ["type", "surname", "forenames", "recognizedAbbreviations", "corporateName"];
const LIST_QUESTION_FIELDS = ["trueForenames", "recognizedAbbreviations", "forenames", "dataCategories"];
type RichQuestionTarget = { section: RichSection; step: number; id: string; fallbackId?: string };
const arrayIndex = (value: string | undefined, limit: number) =>
  value !== undefined && /^(0|[1-9]\d*)$/.test(value) && Number(value) < limit;

/** Only fields with customer controls have targets. Legal review aliases do not. */
export function richQuestionTarget(path: string): RichQuestionTarget | undefined {
  const [root, sectionKey, ...parts] = path.split(".");
  if (root !== "rich" || !Object.hasOwn(QUESTION_FIELDS, sectionKey ?? "")) return undefined;
  const section = sectionKey as RichSection;
  const step = section === "privacy" ? 4 : section === "product" ? 1 : 0;
  const target = (id: string, fallbackId?: string): RichQuestionTarget => ({
    section,
    step,
    id,
    ...(fallbackId ? { fallbackId } : {}),
  });
  if (!parts.length) return target(`rich-${section}-summary`);
  const [key, index, child, listIndex] = parts;
  if (section === "businessName" && key === "partners") {
    if (parts.length === 1) return target("rich-partners-add", "rich-partner-0-type-state");
    if (!arrayIndex(index, 30)) return undefined;
    if (parts.length === 2) return target(`rich-partner-${index}-type-state`, "rich-partners-add");
    if (
      !PARTNER_QUESTION_FIELDS.includes(child) ||
      (parts.length !== 3 &&
        !(parts.length === 4 && LIST_QUESTION_FIELDS.includes(child) && arrayIndex(listIndex, 20)))
    )
      return undefined;
    return target(`rich-partner-${index}-${child}-state`, "rich-partners-add");
  }
  if (section === "businessName" && key === "namingAssessment") {
    if (parts.length === 1) return target("rich-naming-onlyAddedWordsIndicateSuccession-state");
    return parts.length === 2 && NAMING_QUESTION_FIELDS.includes(index)
      ? target(`rich-naming-${index}-state`)
      : undefined;
  }
  if (!(QUESTION_FIELDS[section] as readonly string[]).includes(key)) return undefined;
  if (
    parts.length !== 1 &&
    !(parts.length === 2 && LIST_QUESTION_FIELDS.includes(key) && arrayIndex(index, 20))
  )
    return undefined;
  return target(`rich-${section}-${key}-state`);
}

export function richStep(path: string): number {
  return richQuestionTarget(path)?.step ?? 0;
}

/** Omitted fields remain omitted. Only an explicit selection creates a marker. */
export function updateRichAnswer(
  facts: RichCheckerFacts,
  section: RichSection,
  key: string,
  value: RichSectionAnswers[string] | undefined,
): RichCheckerFacts {
  const answers = { ...facts.rich?.[section] } as RichSectionAnswers;
  if (value === undefined) delete answers[key];
  else answers[key] = value;
  const rich = { ...facts.rich, [section]: answers };
  if (!Object.keys(answers).length) delete rich[section];
  return { ...facts, factsVersion: "checker-facts-v2", rich: rich as RichAnswers };
}

/** Remove unfinished blank list rows, without changing markers or known false values. */
export function normaliseRichAnswers(value: unknown): unknown {
  if (Array.isArray(value)) return value.filter((item) => item !== "").map(normaliseRichAnswers);
  if (value && typeof value === "object" && !isRichMarker(value))
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== "")
        .map(([key, item]) => [key, normaliseRichAnswers(item)]),
    );
  return value;
}

export function canCreateSourceTask(item: { label: string; sourceLinkedTaskEligible?: boolean }): boolean {
  return item.label === "Likely relevant" && item.sourceLinkedTaskEligible !== false;
}
