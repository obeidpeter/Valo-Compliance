import { z } from "zod";
import { digest } from "./publication";
import type { BusinessNameCandidateBinding, CandidateLabel } from "./checker-business-name";

/** Research algorithms only: never imported by the live assessment/release service. */
export const remainingSourceCandidateIds = [
  "CAND-NDPA-27-COLLECTION-INFORMATION",
  "CAND-NTAA-11-COMPANY-RETURN",
  "CAND-NAFDAC-F33-PRODUCT-MANUFACTURING",
] as const;
type Id = typeof remainingSourceCandidateIds[number];
const marker = z.object({ status: z.enum(["unknown", "unanswered", "not_applicable"]), value: z.null() }).strict();
const flag = z.union([z.boolean(), marker]).optional();
const text = z.union([z.string().min(1).max(300), marker]).optional();
const privacy = z.object({
  processesPersonalData: flag, controllerRole: text, collectionMethod: text, newCollectionEvent: flag,
  operatesInNigeria: flag, processingOccursInNigeria: flag, dataSubjectsInNigeria: flag,
  controllerDomiciledInNigeria: flag, controllerResidentInNigeria: flag, processorConnectionInNigeria: flag,
  processingPurpose: text, commercialUse: flag, privacyRightsViolationIndicated: flag,
  section3Exception: text, determinesPurposesAndMeans: flag, ownPurposeReuse: flag,
  dataSubjectAlreadyInformed: z.union([z.string().max(100), z.boolean(), marker]).optional(),
  indirectNoticeException: text, exceptionScopeConfirmed: flag,
}).passthrough();
const tax = z.object({
  legalForm: text, incorporatedInNigeria: flag, incorporatedAsCompany: flag,
  effectiveManagementCountry: text, managementStatusVerification: text, nonresident: flag,
  onlyNigeriaIncome: text, finalTaxTreatment: text, companyStatus: text,
  accountingPeriodStart: z.union([z.string().date(), marker]).optional(),
  accountingPeriodEnd: z.union([z.string().date(), marker]).optional(),
}).passthrough();
const product = z.object({
  productCategory: text, manufacturesInNigeria: flag, commercialSupplyInNigeria: flag,
  commercialSupplyOfRegulatedProducts: flag, activity: text, productRegistration: text,
  ownBrandOrRepackaging: flag, processingOrPackaging: flag, drugOrMedicalUse: flag,
  therapeuticClaims: flag, specialSamplePermit: text,
  permitScopeMatchesActivity: flag, permitConditionsSatisfied: flag,
  registrationCoversExactProductAndManufacturer: flag, registrationConditionsChanged: flag,
}).passthrough();
export const sourceCandidateFactsSchemas = { privacy, tax, product };
type Missing = { field: string; state: "unknown" | "unanswered" | "not_applicable" };
const missing = (field: string, value: unknown): Missing => ({
  field, state: value && typeof value === "object" && "status" in value &&
    ["unknown", "unanswered", "not_applicable"].includes(String(value.status))
    ? value.status as Missing["state"] : value === undefined ? "unanswered" : "unknown",
});
const known = (v: unknown): v is string => typeof v === "string" && !!v.trim();
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function evaluateSourceCandidateOffline(id: Id, rawFacts: unknown, assessmentDate: string,
  binding: BusinessNameCandidateBinding) {
  if (!remainingSourceCandidateIds.includes(id)) throw new Error("Candidate is outside the implemented source scope");
  if (binding.mode !== "isolated_candidate_validation" || !binding.candidateVersion ||
      !/^[a-f0-9]{64}$/u.test(binding.bindingHash) || !Object.keys(binding.sourceVersionHashes).length)
    throw new Error("An exact isolated source/candidate binding is required");
  z.string().date().parse(assessmentDate);
  if ((JSON.stringify(rawFacts) ?? "null").length > 40_000) throw new Error("Candidate facts exceed the bounded schema");
  const schema = id === remainingSourceCandidateIds[0] ? privacy : id === remainingSourceCandidateIds[1] ? tax : product;
  const parsed = schema.safeParse(rawFacts);
  const f: Record<string, unknown> = parsed.success ? parsed.data : {};
  const context = isObject(f.sourceContext) ? f.sourceContext : {};
  const finish = (label: CandidateLabel, reason: string, questions: Missing[] = [],
    details: Record<string, unknown> = {}) => {
    const body = { candidateId: id, candidateVersion: binding.candidateVersion, bindingHash: binding.bindingHash,
      sourceVersionHashes: binding.sourceVersionHashes, inputHash: digest(rawFacts ?? null), assessmentDate,
      label, reason, missingFacts: questions, details: {
        assessedProposition: id === remainingSourceCandidateIds[0]
          ? "Controller information/privacy-policy relevance; new collection timing assessed separately."
          : id === remainingSourceCandidateIds[1]
            ? "Narrow Nigerian-company return candidate, not all tax returns or withholding treatment."
            : "National product-registration relevance including conditional exceptions, not local-manufacturer route eligibility.",
        ...details } as Record<string,unknown>,
      availability: "offline_candidate_only", eligibleForCustomerUse: false, releasedManifestId: null,
      createRegistrationTask: false, automaticStatutoryDeadline: null, automaticReminder: false,
      stateAndLocalCoverage: "not_evaluated",
      gaps: ["This national candidate establishes no state/FCT/LGA coverage.",
        "A negative result concerns only the named candidate, never general exemption or full compliance."],
    };
    return { ...body, resultHash: digest(body) };
  };
  if (!parsed.success) return finish("More information needed", "The structured candidate facts are invalid.",
    parsed.error.issues.map(i => missing(i.path.join("."), null)));
  if (!binding.supportedAssessmentDates.includes(assessmentDate))
    return finish("More information needed", "The period is outside this candidate's checked research context.");
  // These are authored eligibility fault controls, never customer-supplied source policy.
  if ((known(context.reviewValidThrough) && context.reviewValidThrough < assessmentDate) ||
      context.mode === "draft_instrument_only_no_released_evidence_bundle")
    return finish("More information needed", "The fixture intentionally selects stale or draft-only evidence.",
      [], { eligibilityFaultInjection: true });

  if (id === remainingSourceCandidateIds[0]) {
    if (f.processesPersonalData === false &&
        ((Array.isArray(f.dataCategories) && f.dataCategories.some(v => typeof v === "string" &&
          /phone|email|employee_name|bank_account/u.test(v))) ||
          f.automatedDecisionMaking === true || f.profiling === true))
      return finish("More information needed", "The no-personal-data answer conflicts with supplied identifiable-data or profiling facts.",
        [missing("processesPersonalData/dataClassification", null)]);
    if (f.processesPersonalData === false)
      return finish("Not indicated by these answers", "The supplied facts affirm no personal-data processing; no general privacy exemption is decided.");
    if (f.processesPersonalData !== true)
      return finish("More information needed", "Confirm whether the selected activity processes personal data.",
        [missing("processesPersonalData", f.processesPersonalData)]);
    const connections = ["operatesInNigeria", "processingOccursInNigeria", "dataSubjectsInNigeria",
      "controllerDomiciledInNigeria", "controllerResidentInNigeria", "processorConnectionInNigeria"];
    if (!connections.some(k => f[k] === true)) {
      const uncertain = connections.filter(k => f[k] !== false).map(k => missing(k, f[k]));
      if (uncertain.length) return finish("More information needed",
        "Section 2 also addresses domicile/residence and processor connections; a territorial conclusion is not a substitute for those facts.", uncertain);
      return finish("Not indicated by these answers", "All scoped section 2 connections are explicitly negated for this candidate only.");
    }
    if (f.processingPurpose === "solely_personal_household" && f.commercialUse === false &&
        f.privacyRightsViolationIndicated === false)
      return finish("Not indicated by these answers", "The supplied solely-household facts and no privacy-rights violation support the narrow section 3(1) branch.");
    if (f.section3Exception === "solely_household_confirmed" &&
        (f.commercialUse !== false || f.privacyRightsViolationIndicated !== false))
      return finish("More information needed", "A household label does not establish all section 3(1) facts.",
        [missing("commercialUse/privacyRightsViolationIndicated", undefined)]);
    if (f.controllerRole === "processor_only" && f.determinesPurposesAndMeans === false && f.ownPurposeReuse === false)
      return finish("Not indicated by these answers", "The confirmed processor-only role does not trigger this controller-information candidate; processor duties are not excluded.");
    if (f.controllerRole !== "controller")
      return finish("More information needed", "Confirm who determines the processing purposes and means.",
        [missing("controllerRole", f.controllerRole)]);
    if (f.section3Exception === "legal_claim_asserted")
      return finish("May apply", "The asserted legal-claim exception needs its necessity and scope checked under section 3(2); it is not a blanket privacy exemption.",
        [missing("exceptionScopeConfirmed", f.exceptionScopeConfirmed)]);
    if (f.processingPurpose === "household_and_commercial_promotions" && f.newCollectionEvent !== true)
      return finish("Likely relevant", "Commercial reuse does not retain the solely-household exception. Section 27(3) privacy-policy relevance is separate from section 27(1): reuse alone does not establish a new direct collection or its timing.",
        [], { solelyHouseholdExceptionSupported: false, privacyPolicyRelevance: "Likely relevant",
          newCollectionEventEstablished: false, section27_1CollectionTiming: "not established",
          reuseTimingNotDetermined: true });
    if (!["direct", "indirect"].includes(String(f.collectionMethod)))
      return finish("More information needed", "Confirm whether collection is direct or indirect.",
        [missing("collectionMethod", f.collectionMethod)]);
    if (f.collectionMethod === "indirect") {
      if (f.indirectNoticeException === "disproportionate_effort_claim")
        return finish("More information needed", "The indirect-collection exception requires actual supporting circumstances, not its label.",
          [missing("exceptionSupportingFacts", f.exceptionSupportingFacts)]);
      return finish("May apply", "Section 27(2) contains indirect-collection exceptions; distinguish the specific notice question from the accessible-policy requirement in section 27(3).",
        [missing("verifiedIndirectCollectionException", undefined)]);
    }
    return finish("Likely relevant", "A scoped controller directly collecting personal data is within section 27(1)/(3). Missing lawful-basis or retention answers do not remove relevance; neither value is invented.",
      [], { automatedDecisionInformationRelevant: f.automatedDecisionMaking === true || f.profiling === true,
        reuseTimingNotDetermined: f.processingPurpose === "household_and_commercial_promotions" });
  }

  if (id === remainingSourceCandidateIds[1]) {
    if (f.legalForm === "individual_business_name" && f.incorporatedAsCompany === false)
      return finish("Not indicated by these answers", "This positively identified Nigerian-company return candidate does not decide an individual's tax-return duties.");
    if (f.legalForm === "ordinary_unincorporated_partnership")
      return finish("More information needed", "Section 147 includes associations; lack of CAMA incorporation alone does not establish this tax-definition exclusion.",
        [missing("classificationUnderNtaaSection147", undefined)],
        { section147Classification: "unresolved", companyReturnOwedDetermined: false });
    if (f.legalForm === "foreign_company") {
      if (f.incorporatedInNigeria === true)
        return finish("More information needed", "The foreign-company label conflicts with the Nigerian-incorporation answer; reconcile actual formation facts, not a tax-residence conclusion.",
          [missing("formationFacts", undefined)]);
      if (f.effectiveManagementCountry === "Nigeria")
        return finish("May apply", "Foreign incorporation alone does not settle Nigerian-company status under section 147; effective management/control needs verification.",
          [missing("managementStatusVerification", f.managementStatusVerification)],
          { incorporatedOutsideNigeriaDeclared: true, incorporationFactBasis: "supplied foreign_company legal form",
            taxResidenceClassification: "unresolved", section147Classification: "unresolved" });
      if (f.effectiveManagementCountry === "outside_Nigeria" && f.nonresident === true)
        return finish("Not indicated by these answers", "This domestic-company candidate is not indicated by the supplied nonresident/outside-management facts. Nonresident returns and final-withholding classification are not decided.",
          [], { finalWithholdingClassificationVerified: false, nonresidentReturnDetermined: false,
            withholdingTreatment: "not established by a stipulated conclusion",
            domesticCandidateExclusionOnly: true });
      return finish("More information needed", "Confirm residence and effective management before selecting the applicable return branch.",
        [missing("effectiveManagementCountry", f.effectiveManagementCountry)]);
    }
    if (!["company", "company_limited_by_guarantee"].includes(String(f.legalForm)))
      return finish("More information needed", "An NGO label or generic registration description does not identify the tax entity.",
        [missing("legalForm/incorporationRecordType", f.legalForm)]);
    if (f.incorporatedInNigeria !== true)
      return finish("More information needed", "Confirm Nigerian formation/incorporation or supported effective-management facts.",
        [missing("incorporatedInNigeria", f.incorporatedInNigeria)]);
    // Research uncertainty boundary, NOT an asserted commencement or due date.
    if (known(f.accountingPeriodStart) && known(f.accountingPeriodEnd) &&
        f.accountingPeriodStart < "2026-01-01" && f.accountingPeriodEnd >= "2026-01-01")
      return finish("May apply", "Broad section 11 filing relevance remains; the cross-transition period/timing needs the applicable period evidence.",
        [], { annualFilingRelevance: "Likely relevant", periodTreatment: "More information needed" });
    return finish("Likely relevant", f.companyStatus === "permanently_ceased"
      ? "Section 11(4) addresses cessation-year and outstanding returns; cessation is not an automatic filing exemption."
      : "Section 11(1) covers positively identified companies whether or not tax is payable. Turnover, nonprofit purpose and small-company claims do not alone remove filing relevance.",
    [], { taxRateDetermined: false, smallCompanyStatusDetermined: false, statutoryDueDateDetermined: false });
  }

  if (f.commercialSupplyOfRegulatedProducts === false && f.manufacturesInNigeria === false)
    return finish("Not indicated by these answers", "The supplied activity involves neither regulated-product supply nor manufacture; unrelated sector duties are not decided.");
  if (f.productCategory === "live_fish" && f.processingOrPackaging === false && f.drugOrMedicalUse === false)
    return finish("Not indicated by these answers", "Section 13 excludes live fish from the food definition; the supplied scope excludes processing and drug/medical use.");
  if (f.activity === "service_use_only" && f.manufacturesInNigeria === false && f.ownBrandOrRepackaging === false)
    return finish("Not indicated by these answers", "Service use alone is not a confirmed manufacture/import/advertise/sale/distribution activity under this narrow product candidate.");
  const regulated = ["processed_food", "cosmetic", "water", "drug", "drug_product", "medical_device"];
  const bothRegulatedClasses = f.productCategory === "claimed_cosmetic" && f.therapeuticClaims === true;
  if (!regulated.includes(String(f.productCategory)) && !bothRegulatedClasses)
    return finish("More information needed", "Confirm the regulated product and activity; an industry name alone is insufficient.",
      [missing("productCategory/processingClassification", f.productCategory)]);
  if (f.activity === "sample_for_registration" || f.activity === "sample_for_registration_only") {
    if (f.productCategory !== "processed_food" && f.specialSamplePermit === "confirmed_for_scenario" &&
        f.permitScopeMatchesActivity === true && f.permitConditionsSatisfied === true)
      return finish("Not indicated by these answers", "The supplied qualifying sample permit and conditions engage section 1(2), not an ordinary commercial-supply exemption.",
        [], { scope: "confirmed conditional sample activity only", continuingPermitConditions: true });
    return finish("More information needed", "Section 1(2) does not list processed food; a claimed sample permit requires its actual authority and scope.",
      [missing("samplePermitAuthorityAndScope", f.permitScopeMatchesActivity)]);
  }
  const definiteActivity = f.manufacturesInNigeria === true || f.commercialSupplyInNigeria === true ||
    ["resale_only", "own_brand_repackaging", "import_and_distribute"].includes(String(f.activity));
  if (!definiteActivity)
    return finish("More information needed", "Confirm manufacture, import, advertising, sale or distribution; absence of one does not negate the others.",
      [missing("manufacturesInNigeria/activity", f.manufacturesInNigeria)]);
  return finish("Likely relevant", "Section 1(1) covers the regulated product and the confirmed activity, including import/sale/distribution. An uncertain local-manufacturer route does not erase national registration relevance.",
    [], { scope: "national product-registration relevance, not local-manufacturer application eligibility",
      proceduralClassification: bothRegulatedClasses || f.manufacturesInNigeria !== true ? "Needs authority confirmation" : "Not determined here",
      existingRegistrationAsserted: ["confirmed_current_for_scenario", "supplier_registration_confirmed_for_scenario"].includes(String(f.productRegistration)),
      duplicateApplicationSuggested: false, feesOrMicroScaleEligibilityDetermined: false });
}
