/**
 * The requirements check's questions, held as data (RUL-001; docs/architecture/requirements-questions.md).
 * The page draws its steps and questions from this file: each question's words, its choices, the ways
 * of not answering it offers, and when it is asked.
 *
 * This file imports nothing, so the web app runs it in the browser and the engine runs the same file.
 */

/** The three ways of not answering a question. */
export const NOT_ANSWERED = ["unknown", "unanswered", "not_applicable"] as const;
export type NotAnswered = (typeof NOT_ANSWERED)[number];

export type AnswerValue = string | boolean;

/**
 * When a question is asked: a condition on earlier answers. `is` holds when the answer is one of the
 * values, or when a list of answers holds one of them. `isNot` holds when it is none of them, so it
 * holds for a question not answered at all. An answer of a rule's question that says how it was not
 * answered (`{ status: "unknown", value: null }`) is read as that status.
 */
export type When =
  | { readonly answer: string; readonly is: readonly AnswerValue[] }
  | { readonly answer: string; readonly isNot: readonly AnswerValue[] }
  | { readonly all: readonly When[] }
  | { readonly any: readonly When[] };

/** What kind of answer a question takes, which decides the control the page draws for it. */
export type QuestionKind =
  | "choice" // one of a few answers
  | "list" // a short list in the visitor's own words
  | "state" // one of the 36 states or the FCT
  | "area" // a local government area
  | "count" // a whole number
  | "amount" // an amount in naira
  | "year" // a year
  | "date"; // a date

export interface Choice {
  readonly value: string;
  readonly label: string;
}

export interface CheckerQuestion {
  /** The answer it fills: a key of the check's answers. */
  readonly answer: string;
  readonly kind: QuestionKind;
  readonly label: string;
  readonly hint?: string;
  readonly placeholder?: string;
  /** A choice's answers, before the ways of not answering. */
  readonly choices?: readonly Choice[];
  /** The ways of not answering it that it offers. */
  readonly notAnswered: readonly NotAnswered[];
  /** An optional figure: it never holds a step back, and is never listed as still unanswered. */
  readonly optional?: true;
  /** Asked only while this holds; asked always without it. */
  readonly askedWhen?: When;
  /** The group of questions it is shown in, within its step. */
  readonly group?: QuestionGroupId;
  /** Said in its place while it is not asked. */
  readonly skippedNote?: string;
}

export type QuestionGroupId = "turnoverDetails";

export interface QuestionGroup {
  readonly legend: string;
  readonly intro: string;
  /** Said in the group's place while none of its questions is asked. */
  readonly skippedNote: string;
}

export interface CheckerStep {
  readonly name: string;
  readonly questions: readonly CheckerQuestion[];
}

/** The 36 states and the FCT, as the check's answers name them. */
export const STATES = [
  "Abia",
  "Adamawa",
  "Akwa Ibom",
  "Anambra",
  "Bauchi",
  "Bayelsa",
  "Benue",
  "Borno",
  "Cross River",
  "Delta",
  "Ebonyi",
  "Edo",
  "Ekiti",
  "Enugu",
  "FCT",
  "Gombe",
  "Imo",
  "Jigawa",
  "Kaduna",
  "Kano",
  "Katsina",
  "Kebbi",
  "Kogi",
  "Kwara",
  "Lagos",
  "Nasarawa",
  "Niger",
  "Ogun",
  "Ondo",
  "Osun",
  "Oyo",
  "Plateau",
  "Rivers",
  "Sokoto",
  "Taraba",
  "Yobe",
  "Zamfara",
] as const;

const yesNo: readonly Choice[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];
const KNOWN_OR_SKIPPED = ["unknown", "unanswered"] as const satisfies readonly NotAnswered[];
const TURNOVER_APPLIES: When = { answer: "turnoverBand", isNot: ["not_applicable"] };

export const QUESTION_GROUPS: Readonly<Record<QuestionGroupId, QuestionGroup>> = {
  turnoverDetails: {
    legend: "Optional turnover details",
    intro: "Add whatever details you have. You can leave any of these blank or skip them to continue.",
    skippedNote: "The questions about that figure are skipped because turnover does not apply.",
  },
};

/** The check's steps in order, each with the questions it asks. The last step reviews the answers. */
export const CHECKER_QUESTIONNAIRE: readonly CheckerStep[] = [
  {
    name: "Your business",
    questions: [
      {
        answer: "legalForm",
        kind: "choice",
        label: "How is the business set up?",
        hint: "For example: Business Name (sole trader or partnership), Private Limited Company (Ltd), or Unregistered.",
        choices: [
          { value: "sole_proprietor", label: "Sole proprietor" },
          { value: "partnership", label: "Partnership" },
          { value: "limited_company", label: "Limited company" },
          { value: "incorporated_trustees", label: "Incorporated trustees" },
          { value: "company_limited_by_guarantee", label: "Company limited by guarantee" },
        ],
        notAnswered: KNOWN_OR_SKIPPED,
      },
      {
        answer: "registrationStatus",
        kind: "choice",
        label: "Is it registered with the Corporate Affairs Commission (CAC)?",
        hint: "Choose Registered if you hold a CAC Business Name, Company or Incorporated Trustees certificate.",
        choices: [
          { value: "registered", label: "Registered" },
          { value: "unregistered", label: "Unregistered" },
          { value: "pending", label: "Pending" },
        ],
        notAnswered: KNOWN_OR_SKIPPED,
      },
    ],
  },
  {
    name: "What it does",
    questions: [
      {
        answer: "activities",
        kind: "list",
        label: "What does the business do?",
        hint: "In your own words. You can add up to 10.",
        placeholder: "e.g. Selling fabric wholesale",
        notAnswered: KNOWN_OR_SKIPPED,
      },
      {
        answer: "manufacturing",
        kind: "choice",
        label: "Do you manufacture or process goods?",
        choices: yesNo,
        notAnswered: KNOWN_OR_SKIPPED,
      },
      {
        answer: "importing",
        kind: "choice",
        label: "Do you import goods into Nigeria?",
        choices: yesNo,
        notAnswered: KNOWN_OR_SKIPPED,
      },
      {
        answer: "productTypes",
        kind: "list",
        label: "Which kinds of product?",
        hint: "Asked because you make, process or import goods, or are not sure whether you do.",
        placeholder: "e.g. Packaged snacks",
        notAnswered: KNOWN_OR_SKIPPED,
        // Asked too of a business that does not know whether it makes or imports goods: the rules
        // that read the products need them unless it does neither.
        askedWhen: {
          any: [
            { answer: "manufacturing", is: ["yes", "unknown"] },
            { answer: "importing", is: ["yes", "unknown"] },
          ],
        },
      },
    ],
  },
  {
    name: "Where it is",
    questions: [
      {
        answer: "premises",
        kind: "choice",
        label: "Do you operate from physical premises?",
        hint: "Choose Yes for a shop, office, workshop or warehouse; choose No if you operate only from home or online.",
        choices: yesNo,
        notAnswered: KNOWN_OR_SKIPPED,
      },
      {
        answer: "state",
        kind: "state",
        label: "Which state is the business in?",
        placeholder: "Choose a state or the FCT",
        choices: STATES.map((state) => ({ value: state, label: state })),
        notAnswered: KNOWN_OR_SKIPPED,
      },
      {
        answer: "lga",
        kind: "area",
        label: "Which local government area (LGA)?",
        hint: "Where the business is run from, even if that is a home.",
        placeholder: "e.g. Ikeja",
        notAnswered: KNOWN_OR_SKIPPED,
        // Asked once a state is chosen, with or without premises: a business run from home is in
        // an area too, and a rule for one area needs it.
        askedWhen: { answer: "state", is: STATES },
        skippedNote: "The local government area is asked once you choose a state.",
      },
    ],
  },
  {
    name: "Size and turnover",
    questions: [
      {
        answer: "employees",
        kind: "count",
        label: "How many people work in the business?",
        notAnswered: NOT_ANSWERED,
      },
      {
        answer: "turnoverBand",
        kind: "choice",
        label: "Roughly, what is the business's turnover?",
        hint: "Turnover is the total of the business's sales over a period.",
        choices: [
          { value: "under_5m", label: "Under ₦5 million" },
          { value: "5m_to_25m", label: "₦5 million to ₦25 million" },
          { value: "25m_to_100m", label: "₦25 million to ₦100 million" },
          { value: "over_100m", label: "Over ₦100 million" },
        ],
        notAnswered: NOT_ANSWERED,
      },
      {
        answer: "turnoverAmountKobo",
        kind: "amount",
        label: "The exact figure, if you have it",
        hint: "In naira. Leave this blank if you would rather not say.",
        notAnswered: [],
        optional: true,
        askedWhen: TURNOVER_APPLIES,
        group: "turnoverDetails",
      },
      {
        answer: "turnoverYear",
        kind: "year",
        label: "Which year is that figure for?",
        notAnswered: NOT_ANSWERED,
        askedWhen: TURNOVER_APPLIES,
        group: "turnoverDetails",
      },
      {
        answer: "turnoverPeriod",
        kind: "choice",
        label: "What period does the figure cover?",
        choices: [
          { value: "annual", label: "Annual" },
          { value: "monthly", label: "Monthly" },
          { value: "quarterly", label: "Quarterly" },
        ],
        notAnswered: NOT_ANSWERED,
        askedWhen: TURNOVER_APPLIES,
        group: "turnoverDetails",
      },
      {
        answer: "turnoverPeriodStart",
        kind: "date",
        label: "First day of that period",
        notAnswered: NOT_ANSWERED,
        askedWhen: TURNOVER_APPLIES,
        group: "turnoverDetails",
      },
      {
        answer: "turnoverPeriodEnd",
        kind: "date",
        label: "Last day of that period",
        notAnswered: NOT_ANSWERED,
        askedWhen: TURNOVER_APPLIES,
        group: "turnoverDetails",
      },
      {
        answer: "turnoverMetric",
        kind: "choice",
        label: "What does the figure measure?",
        hint: "Gross revenue is all sales, before any costs are taken off.",
        choices: [{ value: "gross_revenue", label: "Gross revenue" }],
        notAnswered: NOT_ANSWERED,
        askedWhen: TURNOVER_APPLIES,
        group: "turnoverDetails",
      },
      {
        answer: "turnoverCurrency",
        kind: "choice",
        label: "Which currency is the figure in?",
        choices: [{ value: "NGN", label: "Naira (NGN)" }],
        notAnswered: NOT_ANSWERED,
        askedWhen: TURNOVER_APPLIES,
        group: "turnoverDetails",
      },
    ],
  },
  {
    name: "Personal data",
    questions: [
      {
        answer: "personalData",
        kind: "choice",
        label: "Do you collect or keep customer or staff personal data?",
        hint: "Names, phone numbers, addresses, ID numbers and similar.",
        choices: yesNo,
        notAnswered: KNOWN_OR_SKIPPED,
      },
    ],
  },
  { name: "Review your answers", questions: [] },
];

/** Every question the check asks, in order. */
export const CHECKER_QUESTIONS: readonly CheckerQuestion[] = CHECKER_QUESTIONNAIRE.flatMap(
  (step) => step.questions,
);

/** The question that fills an answer. */
export function checkerQuestion(answer: string): CheckerQuestion | undefined {
  return CHECKER_QUESTIONS.find((question) => question.answer === answer);
}

/** The step that asks a question, or the first step for an answer no question fills. */
export function stepOfQuestion(answer: string): number {
  return Math.max(
    0,
    CHECKER_QUESTIONNAIRE.findIndex((step) => step.questions.some((question) => question.answer === answer)),
  );
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** An answer, read for a condition. A rule's answer `{ status, value: null }` reads as its status. */
export function answerAt(answers: unknown, path: string): unknown {
  let value: unknown = answers;
  for (const key of path.split("."))
    value = isObject(value) && Object.hasOwn(value, key) ? value[key] : undefined;
  return isObject(value) && value.value === null && typeof value.status === "string" ? value.status : value;
}

/** Whether a condition holds for these answers. */
export function holds(when: When, answers: unknown): boolean {
  if ("all" in when) return when.all.every((part) => holds(part, answers));
  if ("any" in when) return when.any.some((part) => holds(part, answers));
  const value = answerAt(answers, when.answer);
  const values: readonly unknown[] = Array.isArray(value) ? value : [value];
  const matches = (list: readonly AnswerValue[]) =>
    values.some((entry) => list.some((item) => item === entry));
  return "is" in when ? matches(when.is) : !matches(when.isNot);
}

/** Whether the check asks a question, given the other answers (RUL-001: "irrelevant questions are
 * skipped"). A question nothing in this file names is asked. */
export function isAsked(answers: unknown, answer: string): boolean {
  const question = checkerQuestion(answer);
  return !question?.askedWhen || holds(question.askedWhen, answers);
}

/** The kinds of rule the check can release, each reading its own answers under `rich.<family>`. */
export const RULE_FAMILIES = ["businessName", "tax", "privacy", "product"] as const;
export type RuleFamily = (typeof RULE_FAMILIES)[number];

/** What kind of answer a rule's question takes. Its ways of not answering are the three in
 * `NOT_ANSWERED`, stored as `{ status, value: null }`. */
export type RuleQuestionKind =
  | "flag" // yes or no
  | "choice" // one of a few answers
  | "text" // a short answer in the visitor's own words
  | "list" // a list of entries, typed or chosen
  | "date"; // a date

export interface RuleQuestion {
  /** The answer it fills, within its rule's answers. */
  readonly key: string;
  readonly kind: RuleQuestionKind;
  readonly label: string;
  readonly hint?: string;
  /** A choice's answers, or the entries a list chooses from. */
  readonly choices?: readonly Choice[];
}

const businessNameQuestions: readonly RuleQuestion[] = [
  {
    key: "legalForm",
    kind: "choice",
    label: "Who operates under this name?",
    choices: [
      { value: "individual", label: "One individual" },
      { value: "firm", label: "A partnership or firm" },
      { value: "company", label: "A company" },
    ],
  },
  {
    key: "hasPlaceOfBusinessInNigeria",
    kind: "flag",
    label: "Does this operator have a place of business in Nigeria?",
  },
  {
    key: "carryingOnBusiness",
    kind: "flag",
    label: "Is business being carried on under the name?",
  },
  {
    key: "businessName",
    kind: "text",
    label: "Exact name used for this business",
  },
  {
    key: "trueSurname",
    kind: "text",
    label: "Individual operator’s true surname or patronymic",
  },
  {
    key: "trueForenames",
    kind: "list",
    label: "Individual operator’s forenames",
  },
  {
    key: "recognizedAbbreviations",
    kind: "list",
    label: "Recognised abbreviations of the individual’s names",
  },
  {
    key: "corporateName",
    kind: "text",
    label: "Company’s exact registered corporate name",
  },
  {
    key: "operatorRole",
    kind: "choice",
    label: "Role of the person carrying on the business",
    choices: [
      { value: "proprietor", label: "Proprietor or partner" },
      { value: "manager", label: "Manager" },
      { value: "receiver", label: "Receiver" },
      { value: "other", label: "Another role" },
    ],
  },
  {
    key: "appointmentAuthority",
    kind: "choice",
    label: "How was the manager or receiver appointed?",
    choices: [
      { value: "court", label: "By a court" },
      { value: "private_contract", label: "By private agreement" },
      { value: "other", label: "Another route" },
    ],
  },
  {
    key: "appointmentConfirmed",
    kind: "flag",
    label: "Have you checked the appointment record?",
  },
  {
    key: "businessNameRegistered",
    kind: "flag",
    label: "Do you have a registration record for this exact name and operator?",
    hint: "This records your answer; Valo does not verify the registration.",
  },
];

const taxQuestions: readonly RuleQuestion[] = [
  {
    key: "legalForm",
    kind: "choice",
    label: "What do the entity’s formation records describe?",
    choices: [
      { value: "individual_business_name", label: "Individual with a business name" },
      { value: "ordinary_unincorporated_partnership", label: "Ordinary unincorporated partnership" },
      { value: "company", label: "Company" },
      { value: "company_limited_by_guarantee", label: "Company limited by guarantee" },
      { value: "foreign_company", label: "Company incorporated outside Nigeria" },
      { value: "incorporated_trustees", label: "Incorporated trustees" },
      { value: "other", label: "Another form" },
    ],
  },
  {
    key: "incorporatedAsCompany",
    kind: "flag",
    label: "Was the entity incorporated as a company?",
  },
  {
    key: "incorporatedInNigeria",
    kind: "flag",
    label: "Was the entity incorporated in Nigeria?",
  },
  {
    key: "effectiveManagementCountry",
    kind: "choice",
    label: "Where are the entity’s central management decisions made?",
    hint: "This answer does not establish tax residence.",
    choices: [
      { value: "Nigeria", label: "Nigeria" },
      { value: "outside_Nigeria", label: "Outside Nigeria" },
      { value: "mixed", label: "In more than one country" },
    ],
  },
  {
    key: "managementStatusVerification",
    kind: "choice",
    label: "Have you checked records supporting that management location?",
    choices: [
      { value: "not_verified", label: "Not checked" },
      { value: "records_available", label: "Supporting records available" },
    ],
  },
  {
    key: "companyStatus",
    kind: "choice",
    label: "What is the entity’s current operating status?",
    choices: [
      { value: "active", label: "Operating" },
      { value: "dormant", label: "Dormant" },
      { value: "permanently_ceased", label: "Permanently ceased operations" },
    ],
  },
  {
    key: "accountingPeriodStart",
    kind: "date",
    label: "Accounting period start",
  },
  {
    key: "accountingPeriodEnd",
    kind: "date",
    label: "Accounting period end",
  },
];

const privacyQuestions: readonly RuleQuestion[] = [
  {
    key: "processesPersonalData",
    kind: "flag",
    label: "Does the selected activity use information about identifiable people?",
  },
  {
    key: "dataCategories",
    kind: "list",
    label: "Kinds of personal information used",
    hint: "Select categories only. Do not enter anyone’s actual details.",
    choices: [
      { value: "phone", label: "Phone numbers" },
      { value: "email", label: "Email addresses" },
      { value: "employee_name", label: "Employee names" },
      { value: "bank_account", label: "Bank account details" },
      { value: "other", label: "Other information about identifiable people" },
    ],
  },
  {
    key: "automatedDecisionMaking",
    kind: "flag",
    label: "Are decisions about people made automatically?",
  },
  {
    key: "profiling",
    kind: "flag",
    label: "Is the information used to profile people?",
  },
  {
    key: "controllerRole",
    kind: "choice",
    label: "Who decides why and how that information is used?",
    choices: [
      { value: "controller", label: "We make those decisions" },
      { value: "processor_only", label: "We act only on another organisation’s instructions" },
      { value: "mixed", label: "It varies by activity" },
    ],
  },
  {
    key: "determinesPurposesAndMeans",
    kind: "flag",
    label: "Do you decide the purposes and means of this particular use?",
  },
  {
    key: "ownPurposeReuse",
    kind: "flag",
    label: "Do you reuse the information for your own purposes?",
  },
  {
    key: "collectionMethod",
    kind: "choice",
    label: "How is the information collected?",
    choices: [
      { value: "direct", label: "Directly from the person" },
      { value: "indirect", label: "From someone or somewhere else" },
      { value: "mixed", label: "Both" },
    ],
  },
  {
    key: "newCollectionEvent",
    kind: "flag",
    label: "Does this activity involve collecting information now?",
  },
  {
    key: "operatesInNigeria",
    kind: "flag",
    label: "Does the organisation operate in Nigeria?",
  },
  {
    key: "processingOccursInNigeria",
    kind: "flag",
    label: "Does any processing for this activity take place in Nigeria?",
  },
  {
    key: "dataSubjectsInNigeria",
    kind: "flag",
    label: "Are any of the people concerned located in Nigeria?",
  },
  {
    key: "controllerDomiciledInNigeria",
    kind: "flag",
    label: "Is the organisation deciding the use domiciled in Nigeria?",
  },
  {
    key: "controllerResidentInNigeria",
    kind: "flag",
    label: "Is that organisation resident in Nigeria?",
  },
  {
    key: "processorConnectionInNigeria",
    kind: "flag",
    label: "Does a processor involved have a Nigerian connection?",
    hint: "Consider its domicile, residence, operations, processing, and the people whose information it uses.",
  },
  {
    key: "processingPurpose",
    kind: "choice",
    label: "What is the information used for?",
    choices: [
      { value: "solely_personal_household", label: "Only personal or household activity" },
      { value: "household_and_commercial_promotions", label: "Household activity and commercial promotion" },
      { value: "commercial", label: "Business or commercial activity" },
      { value: "legal_claim", label: "A legal claim" },
      { value: "other", label: "Another purpose" },
    ],
  },
  {
    key: "commercialUse",
    kind: "flag",
    label: "Is there any business or commercial use?",
  },
  {
    key: "privacyRightsViolationIndicated",
    kind: "flag",
    label: "Is there any reported or indicated privacy-rights concern?",
  },
  {
    key: "section3Exception",
    kind: "choice",
    label: "Is any of this context relevant?",
    hint: "A context choice does not establish a legal exemption.",
    choices: [
      { value: "none", label: "None of these contexts" },
      { value: "personal_household", label: "Personal or household activity" },
      { value: "legal_claim", label: "A legal claim" },
      { value: "other", label: "Another context" },
    ],
  },
  {
    key: "dataSubjectAlreadyInformed",
    kind: "flag",
    label: "Has the person already been given information about this use?",
  },
  {
    key: "indirectNoticeException",
    kind: "choice",
    label: "For indirect collection, has an effort-related concern been raised?",
    hint: "This does not establish that a notice exception applies.",
    choices: [
      { value: "none", label: "No such concern" },
      { value: "disproportionate_effort_claim", label: "Concern about the effort of contacting people" },
      { value: "other", label: "Another concern" },
    ],
  },
  {
    key: "exceptionScopeConfirmed",
    kind: "flag",
    label: "Have the particular circumstances behind the stated context been checked?",
    hint: "This records a factual check, not approval of a legal exception.",
  },
  {
    key: "exceptionSupportingFacts",
    kind: "text",
    label: "What factual circumstances support the stated context or contacting concern?",
    hint: "Describe circumstances only. Do not include names, contact details or other personal or sensitive information. This does not establish a legal exception.",
  },
];

const productQuestions: readonly RuleQuestion[] = [
  {
    key: "productCategory",
    kind: "choice",
    label: "Which description fits the particular product?",
    choices: [
      { value: "processed_food", label: "Processed food" },
      { value: "cosmetic", label: "Cosmetic" },
      { value: "claimed_cosmetic", label: "Described as cosmetic, with classification unresolved" },
      { value: "water", label: "Water" },
      { value: "drug", label: "Drug" },
      { value: "medical_device", label: "Medical device" },
      { value: "live_fish", label: "Live fish" },
      { value: "other", label: "Another product" },
    ],
  },
  {
    key: "manufacturesInNigeria",
    kind: "flag",
    label: "Do you manufacture this product in Nigeria?",
  },
  {
    key: "commercialSupplyInNigeria",
    kind: "flag",
    label: "Do you commercially supply this product in Nigeria?",
  },
  {
    key: "commercialSupplyOfRegulatedProducts",
    kind: "flag",
    label: "Does the activity supply food, drugs, cosmetics, water, or medical devices?",
  },
  {
    key: "activity",
    kind: "choice",
    label: "What do you do with this product?",
    choices: [
      { value: "manufacture", label: "Manufacture it" },
      { value: "resale_only", label: "Resell it" },
      { value: "own_brand_repackaging", label: "Repackage or supply it under our own brand" },
      { value: "import_and_distribute", label: "Import and distribute it" },
      { value: "sample_for_registration_only", label: "Use samples only for registration" },
      { value: "service_use_only", label: "Use it only while providing a service" },
      { value: "other", label: "Another activity" },
    ],
  },
  {
    key: "ownBrandOrRepackaging",
    kind: "flag",
    label: "Do you add your own brand or repackage the product?",
  },
  {
    key: "processingOrPackaging",
    kind: "flag",
    label: "Do you process or package the product?",
  },
  {
    key: "drugOrMedicalUse",
    kind: "flag",
    label: "Is it supplied for drug or medical use?",
  },
  {
    key: "therapeuticClaims",
    kind: "flag",
    label: "Are treatment or therapeutic claims made about it?",
  },
  {
    key: "productRegistration",
    kind: "choice",
    label: "What product-registration record do you state that you hold?",
    hint: "These are your stated records, not verification by Valo. A supplier’s record may not cover your activity.",
    choices: [
      {
        value: "current_for_product_and_manufacturer",
        label: "A current record for this product and manufacturer",
      },
      { value: "supplier_registration_claimed", label: "A supplier’s claimed registration" },
      { value: "none", label: "No registration record held" },
    ],
  },
  {
    key: "registrationCoversExactProductAndManufacturer",
    kind: "flag",
    label: "Does the registration record identify this exact product and manufacturer?",
    hint: "Your answer is not independent verification of registration.",
  },
  {
    key: "registrationConditionsChanged",
    kind: "flag",
    label: "Have any recorded registration conditions changed?",
  },
  {
    key: "specialSamplePermit",
    kind: "choice",
    label: "Do you state that you hold a special permit for these samples?",
    hint: "Valo has not independently verified permission. A permit claim does not establish commercial-supply permission.",
    choices: [
      { value: "permit_held", label: "I hold a sample permit" },
      { value: "none", label: "I do not hold a sample permit" },
    ],
  },
  {
    key: "permitScopeMatchesActivity",
    kind: "flag",
    label: "Does the sample permit describe this exact product and activity?",
  },
  {
    key: "permitConditionsSatisfied",
    kind: "flag",
    label: "Have you checked that the stated permit conditions are satisfied?",
  },
];

export const NAMING_QUESTIONS: readonly RuleQuestion[] = [
  {
    key: "onlyAddedWordsIndicateSuccession",
    kind: "flag",
    label: "Do the added words only describe succession to a previous business?",
  },
  {
    key: "otherBrandAddition",
    kind: "flag",
    label: "Is there any other brand wording added to the names?",
  },
  {
    key: "sameSurnameAllPartners",
    kind: "flag",
    label: "Do all the partners have the same surname?",
  },
  {
    key: "onlyAdditionIsPluralS",
    kind: "flag",
    label: "Is the only addition a final “s” making a shared surname plural?",
  },
];

export const PARTNER_QUESTIONS: readonly RuleQuestion[] = [
  {
    key: "type",
    kind: "choice",
    label: "Partner type",
    choices: [
      { value: "individual", label: "Individual" },
      { value: "corporation", label: "Corporation" },
    ],
  },
  {
    key: "surname",
    kind: "text",
    label: "True surname or patronymic",
  },
  {
    key: "forenames",
    kind: "list",
    label: "Forenames",
  },
  {
    key: "recognizedAbbreviations",
    kind: "list",
    label: "Recognised name abbreviations",
  },
  {
    key: "corporateName",
    kind: "text",
    label: "Corporate name, if this partner is a corporation",
  },
];

/** Each rule's questions, in order. The business-name rule's questions on how the name is composed
 * (`NAMING_QUESTIONS`, under `namingAssessment`) and about each partner (`PARTNER_QUESTIONS`, under
 * `partners`) are asked with it. */
export const RULE_QUESTIONS: Readonly<Record<RuleFamily, readonly RuleQuestion[]>> = {
  businessName: businessNameQuestions,
  tax: taxQuestions,
  privacy: privacyQuestions,
  product: productQuestions,
};
