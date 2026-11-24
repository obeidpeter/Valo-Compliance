import {
  checkerFactsSchema,
  sha256,
  sourceFamilyAlgorithmHashes,
  type OwnerRuleBundle,
  type PublicationBundle,
  type ReleasedRule,
  type RichCheckerFacts,
} from "@workspace/valo-core";

/** A requirements-checker rule prepared in the repository for the owner's sign-off (decision 0020). */
export type OwnerRuleCandidate = {
  rule: Pick<
    ReleasedRule,
    | "id"
    | "requirementVersionId"
    | "title"
    | "jurisdiction"
    | "validFrom"
    | "validTo"
    | "reason"
    | "nextStep"
    | "relatedTemplateIds"
  > &
    Partial<Pick<ReleasedRule, "condition" | "evaluator">>;
  risk: PublicationBundle["candidate"]["risk"];
  scope: string;
  limitations: string;
  assumptions: string[];
  /** Anything recorded here holds the whole rule (EDP-005). */
  unresolvedMaterialIssues: string[];
  missingEvidence: string[];
  sources: {
    id: string;
    /** A passage the guides use; its words, place and official text come from today's capture. */
    passageId: string;
    /** The registered official source that capture is of. */
    leadId: string;
    /** Where the quote is, as the customer sees it ("section 814(1)"). */
    locator: string;
    /** The words of the passage the rule shows the customer. */
    quote: string;
  }[];
  claims: PublicationBundle["candidate"]["claims"];
  rights: PublicationBundle["rights"];
  scenarios: OwnerRuleBundle["scenarios"];
};

/**
 * The rights record of the rules below. The development owner chose its basis on 24 November 2026,
 * answering "I adopt it" when asked what the rights record of these two rules' wording should state:
 * the owner adopts the wording as Valo's own and allows its commercial use. What a customer is told
 * comes from the research notes the rules' calculations are (committed on 14 November 2026, with no
 * record of how they were written); each rule's title, scope, limits, assumptions and claims were
 * written for it on 24 November 2026. The owner signs each version's exact wording, rights record
 * included (its hash is in the manifest).
 */
const ownerAdoption =
  "On 24 November 2026 the Valo development owner chose the basis for the wording of the business-name and privacy rules: the owner adopts it as Valo's own and allows its commercial use (\"I adopt it\"). What the requirements check tells a customer comes from the research notes committed on 14 November 2026, with no record of how they were written; each rule's title, scope, limits, assumptions and claims were written for it on 24 November 2026. The owner adopts each version's wording by signing it. Official text is quoted no more than 20 words in a row, as the guidance policy's point 7 allows. No copyright opinion, exclusivity, non-infringement or clearance of anyone else's rights is claimed.";
const ownerAdoptedRights: PublicationBundle["rights"] = {
  status: "cleared",
  evidence: ownerAdoption,
  evidenceHash: sha256(ownerAdoption),
  commercialUse: true,
};

/** A scenario's answers: only the rich answers its rule's calculation reads, the rest unknown. */
const answers = (rich: RichCheckerFacts) =>
  checkerFactsSchema.parse({
    legalForm: "unknown",
    registrationStatus: "unknown",
    activities: [],
    state: "Lagos",
    lga: "unknown",
    employees: "unknown",
    turnoverBand: "unknown",
    turnoverYear: "unknown",
    turnoverMetric: "gross_revenue",
    turnoverCurrency: "NGN",
    premises: "unknown",
    manufacturing: "unknown",
    importing: "unknown",
    personalData: "unknown",
    factsVersion: "checker-facts-v2",
    rich,
  });
const asOfDate = "2026-11-24";
type Label = "Likely relevant" | "May apply" | "More information needed" | "Not indicated by these answers";
const scenario = (id: string, rich: RichCheckerFacts, expectedLabel: Label) => ({
  id,
  facts: answers(rich),
  asOfDate,
  expectedLabel,
  critical: true,
});
const notKnown = { status: "unknown" as const, value: null };
type BusinessNameAnswers = NonNullable<RichCheckerFacts["businessName"]>;

// Section 814 of the Companies and Allied Matters Act 2020, from the copy the Corporate Affairs
// Commission links (SV-010). The research note is `docs/content-candidates/business-name-release-candidate.json`.
const s814 = { passageId: "CAMA-814", leadId: "SV-010" } as const;
const noAdditions = {
  onlyAddedWordsIndicateSuccession: false,
  onlyAdditionIsPluralS: false,
  otherBrandAddition: false,
};
const brandAddition = { ...noAdditions, otherBrandAddition: true };
const ada: BusinessNameAnswers = {
  legalForm: "individual",
  hasPlaceOfBusinessInNigeria: true,
  carryingOnBusiness: true,
  trueSurname: "Okafor",
  trueForenames: ["Ada"],
  operatorRole: "proprietor",
};
const partners = (
  businessName: string,
  people: { surname: string; forenames: string[] }[],
  namingAssessment: BusinessNameAnswers["namingAssessment"],
): RichCheckerFacts => ({
  businessName: {
    legalForm: "firm",
    hasPlaceOfBusinessInNigeria: true,
    carryingOnBusiness: true,
    operatorRole: "proprietor",
    businessName,
    partners: people.map((p) => ({ type: "individual" as const, ...p })),
    namingAssessment,
  },
});
const company = (businessName: string, more: Partial<BusinessNameAnswers> = {}): RichCheckerFacts => ({
  businessName: {
    legalForm: "company",
    hasPlaceOfBusinessInNigeria: true,
    carryingOnBusiness: true,
    operatorRole: "proprietor",
    corporateName: "Okafor Foods Limited",
    businessName,
    namingAssessment: businessName === "Okafor Foods Limited" ? noAdditions : brandAddition,
    ...more,
  },
});

const businessNameRule: OwnerRuleCandidate = {
  rule: {
    id: "cac-business-name-814",
    requirementVersionId: "CAC-BUSINESS-NAME-814",
    title: "Registering the name you trade under as a business name",
    jurisdiction: { level: "federal" },
    validFrom: "2020-08-07",
    validTo: null,
    reason:
      "Section 814 of the Companies and Allied Matters Act 2020 says when a business carried on under a name must register that name.",
    nextStep:
      "Compare the name you trade under with section 814, and register it with the Corporate Affairs Commission if the section applies.",
    relatedTemplateIds: [],
    evaluator: {
      family: "businessName",
      version: "source-family-v1",
      algorithmHash: sourceFamilyAlgorithmHashes.businessName,
    },
  },
  risk: "governance",
  scope:
    "Whether the name an individual, firm or company carries on business under in Nigeria must be registered as a business name, under section 814 of the Companies and Allied Matters Act 2020 and the exceptions in its subsection (2), read with the meanings section 868 gives to business name, firm, forename and initials.",
  limitations:
    "It does not work out the time allowed to register (section 815), approve a name, give fees, fines or processing times, or decide whether a company can be formed. A firm with a corporate partner is held for a rule of its own. It covers no tax, state or local duty, and no other part of the Act.",
  assumptions: [
    "The names, legal form, place of business and operator the customer gives are taken as stated; Valo does not verify them.",
    "Only national law is covered: no state or local requirement is checked.",
  ],
  unresolvedMaterialIssues: [],
  missingEvidence: [],
  sources: [
    {
      id: "cama-814",
      ...s814,
      locator: "section 814(1)",
      quote: "in Nigeria and carrying on business under a business name shall be registered",
    },
  ],
  claims: [
    {
      text: "Section 814(1) requires an individual, firm or company that has a place of business in Nigeria and carries on business under a business name to register it, unless the name is only what section 814(1)(a) to (c) allow: the true surname of the individual or of every partner, with nothing added but their true forenames or initials, or a company's corporate name with nothing added.",
      kind: "source_statement",
      sourceId: "cama-814",
      quote: "in Nigeria and carrying on business under a business name shall be registered",
      locator: "section 814(1)",
      numbers: [],
    },
    {
      text: "An addition that merely shows the business is carried on in succession to a former owner does not of itself make registration necessary.",
      kind: "source_statement",
      sourceId: "cama-814",
      quote: "(a) the addition merely indicates that the business is carried on in",
      locator: "section 814(2)(a)",
      numbers: [],
    },
    {
      text: "Where two or more individual partners have the same surname, adding an “s” to the end of it does not of itself make registration necessary.",
      kind: "source_statement",
      sourceId: "cama-814",
      quote: "(b) two or more individual partners have the same surname, the addition",
      locator: "section 814(2)(b)",
      numbers: [],
    },
    {
      text: "Registration is not necessary while the business is carried on by a receiver or manager appointed by a court.",
      kind: "source_statement",
      sourceId: "cama-814",
      quote: "(c) the business is carried on by a receiver or manager appointed by any",
      locator: "section 814(2)(c)",
      numbers: [],
    },
  ],
  rights: ownerAdoptedRights,
  scenarios: [
    scenario(
      "individual-trading-under-own-names",
      { businessName: { ...ada, businessName: "Ada Okafor", namingAssessment: noAdditions } },
      "Not indicated by these answers",
    ),
    scenario(
      "individual-trading-under-initials-and-surname",
      { businessName: { ...ada, businessName: "A. Okafor", namingAssessment: noAdditions } },
      "Not indicated by these answers",
    ),
    scenario(
      "individual-adds-other-words",
      { businessName: { ...ada, businessName: "Okafor Bakery", namingAssessment: brandAddition } },
      "Likely relevant",
    ),
    scenario(
      "individual-trades-under-another-name",
      { businessName: { ...ada, businessName: "Sunrise Bakery", namingAssessment: brandAddition } },
      "Likely relevant",
    ),
    scenario(
      "individual-already-registered",
      {
        businessName: {
          ...ada,
          businessName: "Sunrise Bakery",
          namingAssessment: brandAddition,
          businessNameRegistered: true,
        },
      },
      "Likely relevant",
    ),
    scenario(
      "addition-only-shows-succession",
      {
        businessName: {
          ...ada,
          businessName: "Ada Okafor successor to Bello",
          namingAssessment: { ...noAdditions, onlyAddedWordsIndicateSuccession: true },
        },
      },
      "Not indicated by these answers",
    ),
    scenario(
      "partners-share-a-surname-and-add-s",
      partners(
        "Okafors",
        [
          { surname: "Okafor", forenames: ["Ada"] },
          { surname: "Okafor", forenames: ["Chidi"] },
        ],
        { ...noAdditions, onlyAdditionIsPluralS: true, sameSurnameAllPartners: true },
      ),
      "Not indicated by these answers",
    ),
    scenario(
      "firm-name-is-all-partners-surnames",
      partners(
        "Okafor Bello",
        [
          { surname: "Okafor", forenames: ["Ada"] },
          { surname: "Bello", forenames: ["Musa"] },
        ],
        noAdditions,
      ),
      "Not indicated by these answers",
    ),
    scenario(
      "firm-name-leaves-out-a-partner",
      partners(
        "Okafor",
        [
          { surname: "Okafor", forenames: ["Ada"] },
          { surname: "Bello", forenames: ["Musa"] },
        ],
        noAdditions,
      ),
      "Likely relevant",
    ),
    scenario(
      "company-trading-under-its-corporate-name",
      company("Okafor Foods Limited"),
      "Not indicated by these answers",
    ),
    scenario("company-trading-under-another-name", company("Sunrise Bakery"), "Likely relevant"),
    scenario(
      "court-appointed-receiver",
      company("Sunrise Bakery", {
        operatorRole: "receiver",
        appointmentAuthority: "court",
        appointmentConfirmed: true,
      }),
      "Not indicated by these answers",
    ),
    scenario(
      "receiver-appointed-by-contract",
      company("Sunrise Bakery", {
        operatorRole: "receiver",
        appointmentAuthority: "private_contract",
        appointmentConfirmed: true,
      }),
      "Likely relevant",
    ),
    scenario(
      "no-place-of-business-in-nigeria",
      {
        businessName: {
          ...ada,
          hasPlaceOfBusinessInNigeria: false,
          businessName: "Sunrise Bakery",
          namingAssessment: brandAddition,
        },
      },
      "Not indicated by these answers",
    ),
    scenario(
      "additions-not-answered",
      { businessName: { ...ada, businessName: "Okafor Bakery" } },
      "More information needed",
    ),
    scenario("nothing-answered", {}, "More information needed"),
  ],
};

// Sections 2, 3 and 27 of the Nigeria Data Protection Act 2023, from the data protection commission's
// copy (S04). The research note is the privacy candidate in `checker-source-candidates.ts`.
const ndpa = { leadId: "S04" } as const;
const controller = {
  processesPersonalData: true,
  controllerRole: "controller",
  operatesInNigeria: true,
  section3Exception: "none",
} as const;

const collectionInformationRule: OwnerRuleCandidate = {
  rule: {
    id: "ndpa-27-collection-information",
    requirementVersionId: "NDPA-27-COLLECTION-INFORMATION",
    title: "Telling people what you will do with their personal data when you collect it",
    jurisdiction: { level: "federal" },
    validFrom: "2023-06-12",
    validTo: null,
    reason:
      "Section 27 of the Nigeria Data Protection Act 2023 says what a business must tell people when it collects their personal data, and that it must be in a privacy policy.",
    nextStep:
      "Compare what you tell people when you collect their personal data with section 27, and keep it in a clear privacy policy.",
    relatedTemplateIds: [],
    evaluator: {
      family: "privacy",
      version: "source-family-v1",
      algorithmHash: sourceFamilyAlgorithmHashes.privacy,
    },
  },
  risk: "privacy",
  scope:
    "Whether a business that collects personal data must give the people concerned the information section 27 of the Nigeria Data Protection Act 2023 lists, and keep it in a privacy policy, with the Act's reach (section 2) and its exemptions (section 3) as they bear on that.",
  limitations:
    "It covers only the information given when personal data is collected. It does not check consent, the lawful basis itself, security, registration with the Commission, audits, transfers abroad, the Commission's 2025 directive or any sector's rules, and it does not write a privacy policy.",
  assumptions: [
    "The customer's answers about their role, how they collect personal data and where they and the people concerned are, are taken as stated; Valo does not verify them.",
    "Only the Act is covered: no regulation, directive or guidance notice of the Commission is checked.",
  ],
  unresolvedMaterialIssues: [],
  missingEvidence: [],
  sources: [
    {
      id: "ndpa-27",
      passageId: "NDPA-27",
      ...ndpa,
      locator: "section 27(1)",
      quote: "Before a data controller collects personal data directly from a",
    },
    {
      id: "ndpa-3",
      passageId: "NDPA-3",
      ...ndpa,
      locator: "section 3(1)",
      quote: "carried out by one or more persons solely for personal or household purposes:",
    },
    {
      id: "ndpa-2",
      passageId: "NDPA-2",
      ...ndpa,
      locator: "section 2(2)",
      quote: "(a) data controller or data processor is domiciled in, resident in, or",
    },
  ],
  claims: [
    {
      text: "Before a data controller collects personal data directly from the person it is about, it must tell them the matters section 27(1) lists, among them who the controller is, the lawful basis and purposes of the processing, the person's rights and how long the data will be kept.",
      kind: "source_statement",
      sourceId: "ndpa-27",
      quote: "Before a data controller collects personal data directly from a",
      locator: "section 27(1)",
      numbers: [],
    },
    {
      text: "When a data controller collects personal data other than from the person it is about, it must give them the same information, unless they already have it or giving it is impossible or would involve disproportionate effort or expense.",
      kind: "source_statement",
      sourceId: "ndpa-27",
      quote: "Before a data controller collects personal data, other than directly",
      locator: "section 27(2)",
      numbers: [],
    },
    {
      text: "The information must be in a privacy policy, in a clear, concise, transparent, intelligible and easily accessible form.",
      kind: "source_statement",
      sourceId: "ndpa-27",
      quote: "The information referred to in subsection (1) shall be contained in a",
      locator: "section 27(3)",
      numbers: [],
    },
    {
      text: "The Act does not apply to processing carried out solely for personal or household purposes, provided it does not violate the fundamental right to privacy of the person concerned.",
      kind: "source_statement",
      sourceId: "ndpa-3",
      quote: "carried out by one or more persons solely for personal or household purposes:",
      locator: "section 3(1)",
      numbers: [],
    },
    {
      text: "Subject to the rights and freedoms under the Constitution, the obligations in Part V other than sections 24, 25, 32 and 40 do not apply to processing that is necessary for the establishment, exercise or defence of legal claims.",
      kind: "source_statement",
      sourceId: "ndpa-3",
      quote: "(e) necessary for the establishment, exercise, or defense of legal claims,",
      locator: "section 3(2)(e)",
      numbers: [],
    },
    {
      text: "The Act applies where the controller or processor is domiciled in, resident in or operating in Nigeria, where the processing occurs in Nigeria, or where personal data of a person in Nigeria is processed from outside it.",
      kind: "source_statement",
      sourceId: "ndpa-2",
      quote: "(a) data controller or data processor is domiciled in, resident in, or",
      locator: "section 2(2)",
      numbers: [],
    },
  ],
  rights: ownerAdoptedRights,
  scenarios: [
    scenario(
      "controller-collects-directly",
      { privacy: { ...controller, collectionMethod: "direct", newCollectionEvent: true } },
      "Likely relevant",
    ),
    scenario(
      "controller-collects-from-others",
      {
        privacy: {
          ...controller,
          collectionMethod: "indirect",
          dataSubjectAlreadyInformed: false,
          indirectNoticeException: "none",
        },
      },
      "May apply",
    ),
    scenario(
      "people-said-to-be-informed-already",
      {
        privacy: {
          ...controller,
          collectionMethod: "indirect",
          dataSubjectAlreadyInformed: "claimed_not_verified",
        },
      },
      "May apply",
    ),
    scenario(
      "processor-acting-only-for-others",
      {
        privacy: {
          processesPersonalData: true,
          controllerRole: "processor_only",
          determinesPurposesAndMeans: false,
          ownPurposeReuse: false,
          operatesInNigeria: true,
          collectionMethod: "direct",
          section3Exception: "none",
        },
      },
      "Not indicated by these answers",
    ),
    scenario(
      "solely-personal-or-household",
      {
        privacy: {
          processesPersonalData: true,
          controllerRole: "controller",
          collectionMethod: "direct",
          operatesInNigeria: true,
          processingPurpose: "solely_personal_household",
          commercialUse: false,
          privacyRightsViolationIndicated: false,
          section3Exception: "personal_household",
        },
      },
      "Not indicated by these answers",
    ),
    scenario(
      "household-label-with-commercial-use",
      {
        privacy: {
          processesPersonalData: true,
          controllerRole: "controller",
          collectionMethod: "direct",
          operatesInNigeria: true,
          commercialUse: true,
          section3Exception: "personal_household",
        },
      },
      "More information needed",
    ),
    scenario(
      "legal-claim-asserted",
      { privacy: { ...controller, collectionMethod: "direct", section3Exception: "legal_claim" } },
      "May apply",
    ),
    scenario(
      "no-personal-data",
      { privacy: { processesPersonalData: false } },
      "Not indicated by these answers",
    ),
    scenario(
      "who-decides-the-purposes-unknown",
      {
        privacy: {
          processesPersonalData: true,
          operatesInNigeria: true,
          collectionMethod: "direct",
          controllerRole: notKnown,
          section3Exception: "none",
        },
      },
      "More information needed",
    ),
    scenario(
      "outside-nigeria-processor-link-unanswered",
      {
        privacy: {
          processesPersonalData: true,
          controllerRole: "controller",
          collectionMethod: "direct",
          operatesInNigeria: false,
          processingOccursInNigeria: false,
          dataSubjectsInNigeria: false,
          controllerDomiciledInNigeria: false,
          controllerResidentInNigeria: false,
          section3Exception: "none",
        },
      },
      "More information needed",
    ),
    scenario("nothing-answered", {}, "More information needed"),
  ],
};

/** The rules prepared for the owner's sign-off: the first two of decision 0020's research notes. The
 * other two wait for their holds (decision 0020, Consequences). Preparing a rule here releases
 * nothing: the owner signs each version in Staff → System. */
export const ownerRuleCandidates: OwnerRuleCandidate[] = [businessNameRule, collectionInformationRule];
