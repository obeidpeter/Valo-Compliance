import { z } from "zod";
import { digest } from "./publication";
import { evaluateBusinessNameCandidate } from "./checker-business-name";
import { evaluateSourceCandidateOffline } from "./checker-source-candidates";

/** Customer facts are assertions, never source policy, proof of permission or a
 * publication manifest. No defaults: saved v1 snapshots must retain their bytes. */
export const richAnswerMarkerSchema = z.object({
  status: z.enum(["unknown", "unanswered", "not_applicable"]), value: z.null(),
}).strict();
const flag = z.union([z.boolean(), richAnswerMarkerSchema]);
const text = z.union([z.string().min(1).max(300), richAnswerMarkerSchema]);
const names = z.union([z.array(z.string().min(1).max(150)).max(20), richAnswerMarkerSchema]);
const choice = <const T extends readonly [string, ...string[]]>(values: T) => z.union([z.enum(values), richAnswerMarkerSchema]);
export const richBusinessNameSchema = z.object({
  legalForm: choice(["individual", "firm", "company", "other"]).optional(),
  hasPlaceOfBusinessInNigeria: flag.optional(), carryingOnBusiness: flag.optional(),
  trueSurname: text.optional(), trueForenames: names.optional(), recognizedAbbreviations: names.optional(),
  businessName: text.optional(), corporateName: text.optional(),
  partners: z.union([z.array(z.object({
    type: choice(["individual", "corporation"]).optional(), surname: text.optional(),
    forenames: names.optional(), recognizedAbbreviations: names.optional(), corporateName: text.optional(),
  }).strict()).max(30), richAnswerMarkerSchema]).optional(),
  operatorRole: choice(["proprietor", "manager", "receiver", "other"]).optional(),
  appointmentAuthority: choice(["court", "private_contract", "other"]).optional(), appointmentConfirmed: flag.optional(),
  namingAssessment: z.union([z.object({
    onlyAddedWordsIndicateSuccession: flag.optional(), otherBrandAddition: flag.optional(),
    sameSurnameAllPartners: flag.optional(), onlyAdditionIsPluralS: flag.optional(),
  }).strict(), richAnswerMarkerSchema]).optional(),
  businessNameRegistered: flag.optional(),
}).strict();
export const richPrivacySchema = z.object({
  processesPersonalData: flag.optional(), controllerRole: choice(["controller", "processor_only", "mixed", "other"]).optional(),
  collectionMethod: choice(["direct", "indirect", "mixed", "other"]).optional(), newCollectionEvent: flag.optional(),
  operatesInNigeria: flag.optional(), processingOccursInNigeria: flag.optional(), dataSubjectsInNigeria: flag.optional(),
  controllerDomiciledInNigeria: flag.optional(), controllerResidentInNigeria: flag.optional(), processorConnectionInNigeria: flag.optional(),
  processingPurpose: text.optional(), commercialUse: flag.optional(), privacyRightsViolationIndicated: flag.optional(),
  section3Exception: choice(["none", "personal_household", "legal_claim", "other"]).optional(),
  determinesPurposesAndMeans: flag.optional(), ownPurposeReuse: flag.optional(),
  dataSubjectAlreadyInformed: z.union([z.boolean(), richAnswerMarkerSchema, z.literal("claimed_not_verified")]).optional(),
  indirectNoticeException: choice(["none", "disproportionate_effort_claim", "other"]).optional(),
  exceptionScopeConfirmed: flag.optional(), exceptionSupportingFacts: text.optional(),
  dataCategories: names.optional(), automatedDecisionMaking: flag.optional(), profiling: flag.optional(),
}).strict();
export const richTaxSchema = z.object({
  legalForm: choice(["company", "company_limited_by_guarantee", "foreign_company", "individual_business_name", "ordinary_unincorporated_partnership", "incorporated_trustees", "other"]).optional(),
  incorporatedInNigeria: flag.optional(), incorporatedAsCompany: flag.optional(),
  effectiveManagementCountry: text.optional(), managementStatusVerification: text.optional(), nonresident: flag.optional(),
  onlyNigeriaIncome: text.optional(), finalTaxTreatment: text.optional(), companyStatus: text.optional(),
  accountingPeriodStart: z.union([z.string().date(), richAnswerMarkerSchema]).optional(),
  accountingPeriodEnd: z.union([z.string().date(), richAnswerMarkerSchema]).optional(),
}).strict();
export const richProductSchema = z.object({
  productCategory: choice(["processed_food", "cosmetic", "claimed_cosmetic", "water", "drug", "drug_product", "medical_device", "live_fish", "other"]).optional(),
  manufacturesInNigeria: flag.optional(), commercialSupplyInNigeria: flag.optional(), commercialSupplyOfRegulatedProducts: flag.optional(),
  activity: choice(["manufacture", "resale_only", "own_brand_repackaging", "import_and_distribute", "service_use_only", "sample_for_registration", "sample_for_registration_only", "other"]).optional(),
  productRegistration: choice(["current_for_product_and_manufacturer", "supplier_registration_claimed", "none"]).optional(),
  ownBrandOrRepackaging: flag.optional(), processingOrPackaging: flag.optional(), drugOrMedicalUse: flag.optional(), therapeuticClaims: flag.optional(),
  specialSamplePermit: choice(["permit_held", "none"]).optional(), permitScopeMatchesActivity: flag.optional(),
  permitConditionsSatisfied: flag.optional(), registrationCoversExactProductAndManufacturer: flag.optional(), registrationConditionsChanged: flag.optional(),
}).strict();
export const richCheckerFactsSchema = z.object({
  businessName: richBusinessNameSchema.optional(), privacy: richPrivacySchema.optional(),
  tax: richTaxSchema.optional(), product: richProductSchema.optional(),
}).strict();
export type RichCheckerFacts = z.infer<typeof richCheckerFactsSchema>;
export type RichAnswerState = z.infer<typeof richAnswerMarkerSchema>["status"];

/** These fingerprints bind the existing unchanged candidate implementations.
 * A released rule also binds its exact source passages through publication EDP.
 * Changing an algorithm requires a new adapter version and fresh rule review. */
export const sourceFamilyAlgorithmHashes = {
  businessName: "ae98191857ecab8a06fc12a9873612f11a7d6dbe43fc6b988c15166af4ba4d33",
  privacy: "eddb88ec068d4151b8dae69e9ac293beec23eb31c67b5a5ef1a380bb5f5b4f24",
  tax: "eddb88ec068d4151b8dae69e9ac293beec23eb31c67b5a5ef1a380bb5f5b4f24",
  product: "eddb88ec068d4151b8dae69e9ac293beec23eb31c67b5a5ef1a380bb5f5b4f24",
} as const;
export const sourceFamilyReleaseSchema = z.object({
  family: z.enum(["businessName", "privacy", "tax", "product"]),
  version: z.literal("source-family-v1"), algorithmHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type SourceFamilyRelease = z.infer<typeof sourceFamilyReleaseSchema>;
export function sourceFamilyBindingMatches(binding: SourceFamilyRelease) {
  return binding.version === "source-family-v1" && binding.algorithmHash === sourceFamilyAlgorithmHashes[binding.family];
}
const candidateIds = {
  privacy: "CAND-NDPA-27-COLLECTION-INFORMATION", tax: "CAND-NTAA-11-COMPANY-RETURN",
  product: "CAND-NAFDAC-F33-PRODUCT-MANUFACTURING",
} as const;
const propositions = {
  businessName: "The national business-name naming trigger only; not general registration or incorporation duties.",
  privacy: "Controller information and privacy-policy relevance; collection timing and exceptions remain separate.",
  tax: "The narrow Nigerian-company return question; not all returns, tax rates or withholding treatment.",
  product: "National product-registration relevance; not eligibility for a local-manufacturer application.",
};
type Source = { id: string; snapshotHash: string };
type Context = { manifestHash: string; version: number; sources: Source[]; asOfDate: string };
const isMarker = (value: unknown): value is z.infer<typeof richAnswerMarkerSchema> => richAnswerMarkerSchema.safeParse(value).success;

/** Internal deterministic dispatch, called by assess only AFTER all live release
 * gates. The isolated functions keep their original output and corpus semantics;
 * no candidate eligibility bit is ever copied into a customer result. */
export function evaluateReleasedSourceFamily(binding: SourceFamilyRelease, rich: RichCheckerFacts | undefined, context: Context) {
  if (!sourceFamilyBindingMatches(binding)) throw new Error("Unsupported source-family implementation binding");
  const raw = rich?.[binding.family] ?? {};
  const facts: Record<string, unknown> = { ...raw };
  if (binding.family === "businessName") {
    const naming = rich?.businessName?.namingAssessment;
    const details = naming && !isMarker(naming) ? naming : undefined;
    facts.section814Exception = details?.onlyAddedWordsIndicateSuccession === true
      ? "succession_only_confirmed" : details?.otherBrandAddition === true && details.onlyAddedWordsIndicateSuccession === false &&
        typeof facts.businessName === "string" && /\bsuccessors?\s+to\b/iu.test(facts.businessName)
        ? "succession_claim_with_other_addition" : details?.onlyAdditionIsPluralS === true
          ? "shared_surname_plural_s_confirmed" : details?.onlyAddedWordsIndicateSuccession === false && details.onlyAdditionIsPluralS === false
            ? "none" : {status:"unanswered", value:null};
  }
  if (binding.family === "privacy") {
    if (facts.section3Exception === "legal_claim") facts.section3Exception = "legal_claim_asserted";
    if (facts.section3Exception === "personal_household") {
      facts.section3Exception = "solely_household_confirmed";
    }
  }
  if (binding.family === "product") {
    if (facts.productRegistration === "current_for_product_and_manufacturer") facts.productRegistration = "confirmed_current_for_scenario";
    if (facts.productRegistration === "supplier_registration_claimed") facts.productRegistration = "supplier_registration_confirmed_for_scenario";
    if (facts.specialSamplePermit === "permit_held") facts.specialSamplePermit = "confirmed_for_scenario";
  }
  const evaluatorBinding = {
    mode: "isolated_candidate_validation" as const,
    candidateVersion: `${binding.version}:${context.version}`,
    bindingHash: digest({ binding, manifestHash: context.manifestHash, sources: context.sources }),
    sourceVersionHashes: Object.fromEntries(context.sources.map(s => [s.id, s.snapshotHash])),
    supportedAssessmentDates: [context.asOfDate],
  };
  const outcome = binding.family === "businessName"
    ? evaluateBusinessNameCandidate(facts, context.asOfDate, evaluatorBinding)
    : evaluateSourceCandidateOffline(candidateIds[binding.family], facts, context.asOfDate, evaluatorBinding);
  const prefix = `rich.${binding.family}.`;
  let label = outcome.label, reason = outcome.reason;
  let missingFacts = outcome.missingFacts;
  const stateOf = (value: unknown): RichAnswerState => isMarker(value) ? value.status : value === undefined ? "unanswered" : "unknown";
  if (binding.family === "privacy" && raw && "section3Exception" in raw && raw.section3Exception === "personal_household" &&
      facts.processingPurpose !== "solely_personal_household" && facts.commercialUse !== true) {
    label = "More information needed";
    reason = "A personal or household context does not establish the activity's sole purpose. Confirm the actual purpose and any commercial use before considering that narrow exception.";
    missingFacts = [{field:"processingPurpose",state:stateOf(facts.processingPurpose)}];
  }
  if (binding.family === "businessName" && label === "Likely relevant" &&
      (facts.operatorRole === undefined || isMarker(facts.operatorRole))) {
    label = "More information needed";
    reason = "Confirm who carries on the business; an unanswered operator role cannot settle a potentially relevant appointment exception.";
    missingFacts = [{field:"operatorRole",state:stateOf(facts.operatorRole)}];
  }
  const aliases: Record<string,string> = {"individual.surname":"trueSurname", "individual.forenames":"trueForenames", "individual.recognizedAbbreviations":"recognizedAbbreviations"};
  const read = (path:string):unknown => path.split(".").reduce<unknown>((v,k)=>v&&typeof v==="object"?Reflect.get(v,k):undefined,raw);
  const missingAnswerStates = missingFacts.flatMap(m => {
    const paths = m.field === "section814Exception"
      ? ["operatorRole","namingAssessment.onlyAddedWordsIndicateSuccession","namingAssessment.onlyAdditionIsPluralS"]
        .filter(p=>read(p)===undefined||isMarker(read(p)))
      : [aliases[m.field]??m.field];
    return (paths.length?paths:["namingAssessment"]).map(field=>({field:prefix+field,state:isMarker(read(field))?stateOf(read(field)):read(field)===undefined?"unanswered" as const:m.state}));
  });
  const existingRegistration = binding.family === "businessName" ? rich?.businessName?.businessNameRegistered === true :
    binding.family === "product" && ["current_for_product_and_manufacturer", "supplier_registration_claimed"].includes(String(rich?.product?.productRegistration));
  const nextStep = label === "More information needed" || label === "May apply"
    ? "Review the unanswered facts and the source's conditions before choosing an action."
    : existingRegistration ? "Check the exact existing record and its continuing conditions; do not create a duplicate application."
    : label === "Likely relevant" ? "Review this scoped requirement and the official source before choosing your next step."
    : "This answer concerns only the stated question; check other requirements and local coverage separately.";
  return {
    label, reason, missingAnswerStates,
    missingFacts: missingAnswerStates.map(m => m.field),
    matchedFacts: "matchedFacts" in outcome ? outcome.matchedFacts.map(f => prefix + f) : [],
    assessedProposition: propositions[binding.family], nextStep,
    sourceLinkedTaskEligible: label === "Likely relevant" && !existingRegistration,
    factsNotice: "Based on your stated facts; records, permissions and source exceptions have not been independently verified.",
  };
}

/** Union of leaf paths includes removed answers; arrays use stable positions in
 * the immutable snapshot. Marker objects remain atomic to preserve their state. */
export function changedCheckerFactPaths(previous: Record<string, unknown>, current: Record<string, unknown>): string[] {
  const result: string[] = [];
  const visit = (a: unknown, b: unknown, path: string) => {
    if (digest(a ?? null) === digest(b ?? null) && (a === undefined) === (b === undefined)) return;
    if (path.startsWith("rich") && a !== null && b !== null && typeof a === "object" && typeof b === "object" && !isMarker(a) && !isMarker(b)) {
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
      if (keys.length) { for (const k of keys) visit(Reflect.get(a, k), Reflect.get(b, k), `${path}.${k}`); return; }
    }
    result.push(path);
  };
  for (const key of [...new Set([...Object.keys(previous), ...Object.keys(current)])].filter(k=>k!=="factsVersion").sort()) visit(previous[key], current[key], key);
  return result;
}
