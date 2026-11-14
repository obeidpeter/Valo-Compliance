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
}).strict().superRefine((groups,ctx)=>{
  // Reserve room for internal factual normalization below the unchanged
  // candidate algorithms' 40,000-character limit. Reject before evaluation.
  for(const [family,answers] of Object.entries(groups))if(answers!==undefined&&JSON.stringify(answers).length>39_000)
    ctx.addIssue({code:"custom",path:[family],message:"These optional details are too long. Shorten this section before checking."});
});
export type RichCheckerFacts = z.infer<typeof richCheckerFactsSchema>;
export type RichAnswerState = z.infer<typeof richAnswerMarkerSchema>["status"];
export type MissingQuestionState = RichAnswerState | "review";

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
  const unanswered = (path:string) => read(path) === undefined || isMarker(read(path));
  const holds = new Set<string>();
  const questions = new Map<string,MissingQuestionState>();
  const schemas = {businessName:richBusinessNameSchema,privacy:richPrivacySchema,tax:richTaxSchema,product:richProductSchema};
  const knownPath = (path:string) => Object.hasOwn(schemas[binding.family].shape,path) || binding.family === "businessName" &&
    (/^partners\.\d+\.(type|surname|forenames|recognizedAbbreviations|corporateName)$/.test(path) ||
     /^namingAssessment\.(onlyAddedWordsIndicateSuccession|otherBrandAddition|sameSurnameAllPartners|onlyAdditionIsPluralS)$/.test(path));
  const add = (path:string) => {
    if(!knownPath(path)){ holds.add("Valo needs source review before this question can be resolved; no customer answer can certify it.");return; }
    // A group marker applies to its children too. Known conflicting facts are
    // marked for review; they are never relabelled as an unanswered assertion.
    const ancestors=path.split(".").map((_,i,parts)=>parts.slice(0,i+1).join("."));
    const markerPath=ancestors.find(p=>isMarker(read(p)));
    const actualPath=markerPath??path,value=read(actualPath);
    questions.set(prefix+actualPath,isMarker(value)?value.status:value===undefined?"unanswered":"review");
  };
  for(const m of missingFacts){
    let paths:string[];
    switch(m.field){
      case "processesPersonalData/dataClassification":
        paths=["processesPersonalData",...(["dataCategories","profiling","automatedDecisionMaking"].filter(p=>read(p)!==undefined))];break;
      case "commercialUse/privacyRightsViolationIndicated":
        paths=["commercialUse","privacyRightsViolationIndicated"].filter(unanswered);
        if(!paths.length)holds.add("The supplied circumstances do not establish the household exception. Valo needs source review; this is not a request for you to approve an exemption.");break;
      case "verifiedIndirectCollectionException":
        paths=[];holds.add("Valo needs source review of any indirect-collection exception and its scope. Your answers cannot certify that an exception applies.");break;
      case "classificationUnderNtaaSection147":
        paths=[];holds.add("Valo needs source review of this entity's classification under the applicable tax definition. No company-return conclusion is established.");break;
      case "formationFacts":paths=["legalForm","incorporatedInNigeria"];break;
      case "legalForm/incorporationRecordType":paths=["legalForm","incorporatedAsCompany"];break;
      case "effectiveManagementCountry":
        paths=unanswered(m.field)?[m.field]:[];
        if(!paths.length)holds.add("Valo needs source review of the supplied management location and applicable entity classification; a location answer does not establish tax residence.");break;
      case "managementStatusVerification":
        paths=unanswered(m.field)?[m.field]:[];
        holds.add("Valo needs source review of the management facts and applicable entity classification; the presence of records does not decide tax residence.");break;
      case "exceptionScopeConfirmed":
        paths=unanswered(m.field)?[m.field]:[];
        holds.add("Valo needs source review of the legal-claim context, necessity and scope. Checking circumstances is not approval of an exemption.");break;
      case "exceptionSupportingFacts":
        paths=unanswered(m.field)?[m.field]:[];
        if(!paths.length)holds.add("Valo needs source review of the supplied indirect-collection circumstances; describing them does not establish an exception.");break;
      case "productCategory/processingClassification":paths=["productCategory","processingOrPackaging","drugOrMedicalUse"];break;
      case "samplePermitAuthorityAndScope":
        paths=["specialSamplePermit","permitScopeMatchesActivity","permitConditionsSatisfied"].filter(unanswered);
        holds.add("Valo needs source review of the sample permit's authority and product scope. A claimed permit does not establish commercial-supply permission.");break;
      case "manufacturesInNigeria/activity":
        paths=["manufacturesInNigeria","activity","commercialSupplyInNigeria"].filter(unanswered);
        if(!paths.length)paths=["manufacturesInNigeria","activity","commercialSupplyInNigeria"];break;
      case "section814Exception":
        paths=["operatorRole","namingAssessment.onlyAddedWordsIndicateSuccession","namingAssessment.onlyAdditionIsPluralS"].filter(unanswered);
        if(!paths.length)holds.add("Valo needs source review of the naming exception for the supplied facts.");break;
      case "operatorRole/appointmentAuthority/appointmentConfirmed":
        paths=["operatorRole","appointmentAuthority","appointmentConfirmed"].filter(unanswered);break;
      case "namingAssessment.successionNameComposition":
        paths=["businessName","namingAssessment.onlyAddedWordsIndicateSuccession","namingAssessment.otherBrandAddition"];
        holds.add("Valo needs source review of the succession-name composition. Review the actual name and wording; do not certify a legal exception.");break;
      default:
        if(binding.family === "businessName" && /^partners\.\d+\.type$/.test(m.field) && read(m.field) === "corporation"){
          paths=[];holds.add("Valo needs a separately supported source rule for corporate-partner firms. Do not change an accurate partner type to obtain a result.");
        }else paths=[aliases[m.field]??m.field];
    }
    paths.forEach(add);
  }
  const missingAnswerStates=[...questions].map(([field,state])=>({field,state}));
  const sourceReviewHold=holds.size?[...holds].join(" "):undefined;
  const existingRegistration = binding.family === "businessName" ? rich?.businessName?.businessNameRegistered === true :
    binding.family === "product" && ["current_for_product_and_manufacturer", "supplier_registration_claimed"].includes(String(rich?.product?.productRegistration));
  const nextStep = sourceReviewHold ? "Review any factual questions below. This result remains held for Valo source review; no source-linked action is available." : label === "More information needed" || label === "May apply"
    ? "Review the unanswered facts and the source's conditions before choosing an action."
    : existingRegistration ? "Check the exact existing record and its continuing conditions; do not create a duplicate application."
    : label === "Likely relevant" ? "Review this scoped requirement and the official source before choosing your next step."
    : "This answer concerns only the stated question; check other requirements and local coverage separately.";
  return {
    label, reason, missingAnswerStates, ...(sourceReviewHold?{sourceReviewHold}:{}),
    missingFacts: missingAnswerStates.map(m => m.field),
    matchedFacts: "matchedFacts" in outcome ? outcome.matchedFacts.map(f => prefix + f) : [],
    assessedProposition: propositions[binding.family], nextStep,
    sourceLinkedTaskEligible: label === "Likely relevant" && !existingRegistration && !sourceReviewHold,
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
