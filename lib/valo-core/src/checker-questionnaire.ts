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
 * holds for a question not answered at all. `isOnly` holds when the answer is that one value: the
 * answer itself, or a list of that one entry. `answered` holds when there is an answer that is not
 * one of the three ways of not answering, an empty text or an empty list. An answer of a rule's
 * question that says how it was not answered (`{ status: "unknown", value: null }`) is read as that
 * status.
 */
export type When =
  | { readonly answer: string; readonly is: readonly AnswerValue[] }
  | { readonly answer: string; readonly isNot: readonly AnswerValue[] }
  | { readonly answer: string; readonly isOnly: AnswerValue }
  | { readonly answer: string; readonly answered: true }
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

/**
 * The specification's twenty industries, as it writes them (VALO-TRD-001, "Industry taxonomy and
 * depth"). An answer holds each as written, so that a rule can test for one by its exact name. The
 * site names one as it is written, with a capital first letter.
 */
export const INDUSTRIES = [
  "retail/wholesale",
  "packaged-food manufacturing",
  "restaurants/hospitality",
  "agriculture",
  "general manufacturing",
  "logistics/transport",
  "construction",
  "real estate",
  "technology/software",
  "e-commerce",
  "beauty/personal care",
  "fashion/textiles",
  "healthcare",
  "education",
  "professional services",
  "media/creative",
  "import/export",
  "energy",
  "financial services",
  "other",
] as const;

/**
 * The kinds of product section 1(1) of the product-registration Act names: "processed food, drug,
 * drug product, cosmetic, medical device or water", in the copy its rule was prepared from
 * (docs/content-candidates/source-evidence/nafdac_cap_f33.txt). An answer holds each as the rule's
 * own value, so that one chosen kind fills the rule's answer.
 */
export const PRODUCT_KINDS: readonly Choice[] = [
  { value: "processed_food", label: "Processed food" },
  { value: "drug", label: "Drug" },
  { value: "drug_product", label: "Drug product" },
  { value: "cosmetic", label: "Cosmetic" },
  { value: "medical_device", label: "Medical device" },
  { value: "water", label: "Water" },
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
        hint: "Choose any that fit, and add your own words if you like. Up to 10 in all.",
        placeholder: "e.g. Selling fabric wholesale",
        choices: INDUSTRIES.map((industry) => ({
          value: industry,
          label: industry.charAt(0).toUpperCase() + industry.slice(1),
        })),
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
        hint: "Asked because you make, process or import goods, or are not sure whether you do. Choose any that fit, and add other products in your own words.",
        placeholder: "e.g. Packaged snacks",
        choices: PRODUCT_KINDS,
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
  if ("answered" in when)
    return (
      value !== undefined &&
      value !== null &&
      !(
        typeof value === "string" &&
        (value.trim() === "" || (NOT_ANSWERED as readonly string[]).includes(value))
      ) &&
      !(Array.isArray(value) && value.length === 0)
    );
  const values: readonly unknown[] = Array.isArray(value) ? value : [value];
  if ("isOnly" in when) return values.length === 1 && values[0] === when.isOnly;
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
  /**
   * Asked only while this holds; asked always without it. A condition names answers by their full
   * path (`rich.privacy.processesPersonalData`). Each follows the rule's own calculation, so that a
   * question is asked whenever its answer can change what the rule says, and a test proves it against
   * the calculation.
   */
  readonly askedWhen?: When;
}

/** A condition that never holds: the rule's calculation reads no such answer. */
const NEVER: When = { any: [] };
const businessName = (key: string) => `rich.businessName.${key}`;
const tax = (key: string) => `rich.tax.${key}`;
const privacy = (key: string) => `rich.privacy.${key}`;
const product = (key: string) => `rich.product.${key}`;

/** The business-name rule asks the rest only of an operator with a place of business in Nigeria that
 * carries on business under the name: either "No" settles it. */
const NAME_IN_USE: When = {
  all: [
    { answer: businessName("hasPlaceOfBusinessInNigeria"), is: [true] },
    { answer: businessName("carryingOnBusiness"), is: [true] },
  ],
};
const nameOperator = (...forms: string[]): When => ({
  all: [NAME_IN_USE, { answer: businessName("legalForm"), is: forms }],
});
const APPOINTED: When = {
  all: [NAME_IN_USE, { answer: businessName("operatorRole"), is: ["manager", "receiver"] }],
};
/** How the name is composed matters once there is a name to compare. */
const NAME_GIVEN: When = {
  all: [
    nameOperator("individual", "firm", "company"),
    { answer: businessName("businessName"), answered: true },
  ],
};

const TAX_COMPANY: When = { answer: tax("legalForm"), is: ["company", "company_limited_by_guarantee"] };
const TAX_FOREIGN: When = {
  all: [
    { answer: tax("legalForm"), is: ["foreign_company"] },
    { answer: tax("incorporatedInNigeria"), isNot: [true] },
  ],
};
const TAX_NIGERIAN_COMPANY: When = {
  all: [TAX_COMPANY, { answer: tax("incorporatedInNigeria"), is: [true] }],
};

/** The personal-data rule asks the rest only of a business that uses information about identifiable
 * people, and connected to Nigeria in one of six ways. */
const PERSONAL_DATA_USED: When = { answer: privacy("processesPersonalData"), is: [true] };
const CONNECTIONS = [
  "operatesInNigeria",
  "processingOccursInNigeria",
  "dataSubjectsInNigeria",
  "controllerDomiciledInNigeria",
  "controllerResidentInNigeria",
  "processorConnectionInNigeria",
];
/** Each connection is asked until one of those before it holds. */
const connection = (index: number): When => ({
  all: [
    PERSONAL_DATA_USED,
    ...CONNECTIONS.slice(0, index).map((key): When => ({ answer: privacy(key), isNot: [true] })),
  ],
});
const CONNECTED: When = {
  all: [PERSONAL_DATA_USED, { any: CONNECTIONS.map((key): When => ({ answer: privacy(key), is: [true] })) }],
};
/** A personal or household context, once claimed, needs the purpose and any commercial use whatever
 * else is answered: the rule's calculation never takes the context alone as settling anything. */
const HOUSEHOLD_CONTEXT: When = { answer: privacy("section3Exception"), is: ["personal_household"] };
const HOUSEHOLD_OR_CONNECTED: When = { any: [CONNECTED, HOUSEHOLD_CONTEXT] };
const HOUSEHOLD_CLAIMED: When = {
  any: [
    HOUSEHOLD_CONTEXT,
    { all: [CONNECTED, { answer: privacy("processingPurpose"), is: ["solely_personal_household"] }] },
  ],
};
const CONTROLLER: When = { all: [CONNECTED, { answer: privacy("controllerRole"), is: ["controller"] }] };
const INDIRECT: When = { all: [CONTROLLER, { answer: privacy("collectionMethod"), is: ["indirect"] }] };

/** The product rule asks the rest unless the business neither supplies regulated products nor
 * manufactures in Nigeria: both "No" settle it. */
const PRODUCT_IN_SCOPE: When = {
  any: [
    { answer: product("commercialSupplyOfRegulatedProducts"), isNot: [false] },
    { answer: product("manufacturesInNigeria"), isNot: [false] },
  ],
};
/** The categories section 1(1) of the Act names, which the rule reads as regulated. */
const REGULATED = ["processed_food", "cosmetic", "water", "drug", "drug_product", "medical_device"];
const SAMPLES: When = {
  all: [
    PRODUCT_IN_SCOPE,
    { answer: product("activity"), is: ["sample_for_registration", "sample_for_registration_only"] },
  ],
};

const businessNameQuestions: readonly RuleQuestion[] = [
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
    key: "businessNameRegistered",
    kind: "flag",
    label: "Do you have a registration record for this exact name and operator?",
    hint: "This records your answer; Valo does not verify the registration.",
  },
  {
    key: "legalForm",
    kind: "choice",
    label: "Who operates under this name?",
    choices: [
      { value: "individual", label: "One individual" },
      { value: "firm", label: "A partnership or firm" },
      { value: "company", label: "A company" },
    ],
    askedWhen: NAME_IN_USE,
  },
  {
    key: "businessName",
    kind: "text",
    label: "Exact name used for this business",
    askedWhen: nameOperator("individual", "firm", "company"),
  },
  {
    key: "corporateName",
    kind: "text",
    label: "Company’s exact registered corporate name",
    askedWhen: nameOperator("company"),
  },
  {
    key: "trueSurname",
    kind: "text",
    label: "Individual operator’s true surname or patronymic",
    askedWhen: nameOperator("individual"),
  },
  {
    key: "trueForenames",
    kind: "list",
    label: "Individual operator’s forenames",
    askedWhen: nameOperator("individual"),
  },
  {
    key: "recognizedAbbreviations",
    kind: "list",
    label: "Recognised abbreviations of the individual’s names",
    askedWhen: nameOperator("individual"),
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
    askedWhen: NAME_IN_USE,
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
    askedWhen: APPOINTED,
  },
  {
    key: "appointmentConfirmed",
    kind: "flag",
    label: "Have you checked the appointment record?",
    askedWhen: { all: [APPOINTED, { answer: businessName("appointmentAuthority"), is: ["court"] }] },
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
    askedWhen: {
      answer: tax("legalForm"),
      isNot: [
        "company",
        "company_limited_by_guarantee",
        "foreign_company",
        "ordinary_unincorporated_partnership",
      ],
    },
  },
  {
    key: "incorporatedInNigeria",
    kind: "flag",
    label: "Was the entity incorporated in Nigeria?",
    askedWhen: {
      answer: tax("legalForm"),
      is: ["company", "company_limited_by_guarantee", "foreign_company"],
    },
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
    askedWhen: TAX_FOREIGN,
  },
  {
    key: "managementStatusVerification",
    kind: "choice",
    label: "Have you checked records supporting that management location?",
    choices: [
      { value: "not_verified", label: "Not checked" },
      { value: "records_available", label: "Supporting records available" },
    ],
    askedWhen: { all: [TAX_FOREIGN, { answer: tax("effectiveManagementCountry"), is: ["Nigeria"] }] },
  },
  {
    // The rule's calculation reads it for a foreign company managed outside Nigeria, which no panel
    // asked: without it, such a company could only ever be told that more information is needed.
    key: "nonresident",
    kind: "flag",
    label: "Is the entity non-resident in Nigeria?",
    hint: "This records your answer. It does not establish tax residence.",
    askedWhen: {
      all: [TAX_FOREIGN, { answer: tax("effectiveManagementCountry"), is: ["outside_Nigeria"] }],
    },
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
    askedWhen: TAX_NIGERIAN_COMPANY,
  },
  {
    key: "accountingPeriodStart",
    kind: "date",
    label: "Accounting period start",
    askedWhen: TAX_NIGERIAN_COMPANY,
  },
  {
    key: "accountingPeriodEnd",
    kind: "date",
    label: "Accounting period end",
    askedWhen: TAX_NIGERIAN_COMPANY,
  },
];

const privacyQuestions: readonly RuleQuestion[] = [
  {
    key: "processesPersonalData",
    kind: "flag",
    label: "Does the selected activity use information about identifiable people?",
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
    askedWhen: { answer: privacy("processesPersonalData"), is: [false] },
  },
  {
    key: "automatedDecisionMaking",
    kind: "flag",
    label: "Are decisions about people made automatically?",
    askedWhen: { answer: privacy("processesPersonalData"), is: [false] },
  },
  {
    key: "profiling",
    kind: "flag",
    label: "Is the information used to profile people?",
    askedWhen: { answer: privacy("processesPersonalData"), is: [false] },
  },
  {
    key: "operatesInNigeria",
    kind: "flag",
    label: "Does the organisation operate in Nigeria?",
    askedWhen: connection(0),
  },
  {
    key: "processingOccursInNigeria",
    kind: "flag",
    label: "Does any processing for this activity take place in Nigeria?",
    askedWhen: connection(1),
  },
  {
    key: "dataSubjectsInNigeria",
    kind: "flag",
    label: "Are any of the people concerned located in Nigeria?",
    askedWhen: connection(2),
  },
  {
    key: "controllerDomiciledInNigeria",
    kind: "flag",
    label: "Is the organisation deciding the use domiciled in Nigeria?",
    askedWhen: connection(3),
  },
  {
    key: "controllerResidentInNigeria",
    kind: "flag",
    label: "Is that organisation resident in Nigeria?",
    askedWhen: connection(4),
  },
  {
    key: "processorConnectionInNigeria",
    kind: "flag",
    label: "Does a processor involved have a Nigerian connection?",
    hint: "Consider its domicile, residence, operations, processing, and the people whose information it uses.",
    askedWhen: connection(5),
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
    askedWhen: HOUSEHOLD_OR_CONNECTED,
  },
  {
    key: "commercialUse",
    kind: "flag",
    label: "Is there any business or commercial use?",
    askedWhen: HOUSEHOLD_CLAIMED,
  },
  {
    key: "privacyRightsViolationIndicated",
    kind: "flag",
    label: "Is there any reported or indicated privacy-rights concern?",
    askedWhen: HOUSEHOLD_CLAIMED,
  },
  {
    key: "newCollectionEvent",
    kind: "flag",
    label: "Does this activity involve collecting information now?",
    askedWhen: {
      all: [CONNECTED, { answer: privacy("processingPurpose"), is: ["household_and_commercial_promotions"] }],
    },
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
    askedWhen: CONNECTED,
  },
  {
    key: "determinesPurposesAndMeans",
    kind: "flag",
    label: "Do you decide the purposes and means of this particular use?",
    askedWhen: { all: [CONNECTED, { answer: privacy("controllerRole"), is: ["processor_only"] }] },
  },
  {
    key: "ownPurposeReuse",
    kind: "flag",
    label: "Do you reuse the information for your own purposes?",
    askedWhen: { all: [CONNECTED, { answer: privacy("controllerRole"), is: ["processor_only"] }] },
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
    askedWhen: CONTROLLER,
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
    askedWhen: INDIRECT,
  },
  {
    key: "exceptionSupportingFacts",
    kind: "text",
    label: "What factual circumstances support the stated context or contacting concern?",
    hint: "Describe circumstances only. Do not include names, contact details or other personal or sensitive information. This does not establish a legal exception.",
    askedWhen: {
      all: [INDIRECT, { answer: privacy("indirectNoticeException"), is: ["disproportionate_effort_claim"] }],
    },
  },
  {
    key: "exceptionScopeConfirmed",
    kind: "flag",
    label: "Have the particular circumstances behind the stated context been checked?",
    hint: "This records a factual check, not approval of a legal exception.",
    askedWhen: { all: [CONNECTED, { answer: privacy("section3Exception"), is: ["legal_claim"] }] },
  },
  {
    key: "dataSubjectAlreadyInformed",
    kind: "flag",
    label: "Has the person already been given information about this use?",
    askedWhen: NEVER,
  },
];

const productQuestions: readonly RuleQuestion[] = [
  {
    key: "commercialSupplyOfRegulatedProducts",
    kind: "flag",
    label: "Does the activity supply food, drugs, cosmetics, water, or medical devices?",
  },
  {
    key: "manufacturesInNigeria",
    kind: "flag",
    label: "Do you manufacture this product in Nigeria?",
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
    key: "productCategory",
    kind: "choice",
    label: "Which description fits the particular product?",
    choices: [
      { value: "processed_food", label: "Processed food" },
      { value: "cosmetic", label: "Cosmetic" },
      { value: "claimed_cosmetic", label: "Described as cosmetic, with classification unresolved" },
      { value: "water", label: "Water" },
      { value: "drug", label: "Drug" },
      { value: "drug_product", label: "Drug product" },
      { value: "medical_device", label: "Medical device" },
      { value: "live_fish", label: "Live fish" },
      { value: "other", label: "Another product" },
    ],
    askedWhen: PRODUCT_IN_SCOPE,
  },
  {
    key: "processingOrPackaging",
    kind: "flag",
    label: "Do you process or package the product?",
    askedWhen: { all: [PRODUCT_IN_SCOPE, { answer: product("productCategory"), isNot: REGULATED }] },
  },
  {
    key: "drugOrMedicalUse",
    kind: "flag",
    label: "Is it supplied for drug or medical use?",
    askedWhen: { all: [PRODUCT_IN_SCOPE, { answer: product("productCategory"), isNot: REGULATED }] },
  },
  {
    key: "therapeuticClaims",
    kind: "flag",
    label: "Are treatment or therapeutic claims made about it?",
    askedWhen: { all: [PRODUCT_IN_SCOPE, { answer: product("productCategory"), is: ["claimed_cosmetic"] }] },
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
    askedWhen: PRODUCT_IN_SCOPE,
  },
  {
    key: "commercialSupplyInNigeria",
    kind: "flag",
    label: "Do you commercially supply this product in Nigeria?",
    askedWhen: PRODUCT_IN_SCOPE,
  },
  {
    key: "ownBrandOrRepackaging",
    kind: "flag",
    label: "Do you add your own brand or repackage the product?",
    askedWhen: { all: [PRODUCT_IN_SCOPE, { answer: product("activity"), is: ["service_use_only"] }] },
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
    askedWhen: SAMPLES,
  },
  {
    key: "permitScopeMatchesActivity",
    kind: "flag",
    label: "Does the sample permit describe this exact product and activity?",
    askedWhen: SAMPLES,
  },
  {
    key: "permitConditionsSatisfied",
    kind: "flag",
    label: "Have you checked that the stated permit conditions are satisfied?",
    askedWhen: SAMPLES,
  },
  {
    key: "registrationCoversExactProductAndManufacturer",
    kind: "flag",
    label: "Does the registration record identify this exact product and manufacturer?",
    hint: "Your answer is not independent verification of registration.",
    askedWhen: NEVER,
  },
  {
    key: "registrationConditionsChanged",
    kind: "flag",
    label: "Have any recorded registration conditions changed?",
    askedWhen: NEVER,
  },
];

export const NAMING_QUESTIONS: readonly RuleQuestion[] = [
  {
    key: "onlyAddedWordsIndicateSuccession",
    kind: "flag",
    label: "Do the added words only describe succession to a previous business?",
    askedWhen: NAME_GIVEN,
  },
  {
    key: "otherBrandAddition",
    kind: "flag",
    label: "Is there any other brand wording added to the names?",
    askedWhen: NAME_GIVEN,
  },
  {
    key: "sameSurnameAllPartners",
    kind: "flag",
    label: "Do all the partners have the same surname?",
    askedWhen: nameOperator("firm"),
  },
  {
    key: "onlyAdditionIsPluralS",
    kind: "flag",
    label: "Is the only addition a final “s” making a shared surname plural?",
    askedWhen: NAME_GIVEN,
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
    askedWhen: nameOperator("firm"),
  },
  {
    key: "surname",
    kind: "text",
    label: "True surname or patronymic",
    askedWhen: nameOperator("firm"),
  },
  {
    key: "forenames",
    kind: "list",
    label: "Forenames",
    askedWhen: nameOperator("firm"),
  },
  {
    key: "recognizedAbbreviations",
    kind: "list",
    label: "Recognised name abbreviations",
    askedWhen: nameOperator("firm"),
  },
  {
    key: "corporateName",
    kind: "text",
    label: "Corporate name, if this partner is a corporation",
    askedWhen: nameOperator("firm"),
  },
];

/** The step of the check each rule's questions are asked in. */
export const RULE_STEPS: Readonly<Record<RuleFamily, number>> = {
  businessName: 0,
  tax: 0,
  product: 1,
  privacy: 4,
};

/**
 * An earlier answer that fills a rule's answer, where the earlier answer settles it: they mean
 * exactly the same (the design's section 3, an owner's point row by row). A filled answer is worked
 * out from the earlier answers each time, and the rule's question is not asked while it is filled.
 */
export interface Feed {
  /** The earlier questions whose answers fill it. */
  readonly from: readonly string[];
  /** When those answers fill it. */
  readonly when: When;
  /** The rule's answer it fills, by its full path. */
  readonly fills: string;
  readonly value: AnswerValue;
}

const legalForm = (...forms: string[]): When => ({ answer: "legalForm", is: forms });
const fromLegalForm = (forms: string[], fills: string, value: AnswerValue): Feed => ({
  from: ["legalForm"],
  when: legalForm(...forms),
  fills,
  value,
});

export const RULE_FEEDS: readonly Feed[] = [
  fromLegalForm(["sole_proprietor"], businessName("legalForm"), "individual"),
  fromLegalForm(["sole_proprietor"], tax("incorporatedAsCompany"), false),
  fromLegalForm(["partnership"], businessName("legalForm"), "firm"),
  fromLegalForm(["partnership"], tax("incorporatedAsCompany"), false),
  fromLegalForm(["limited_company", "company_limited_by_guarantee"], businessName("legalForm"), "company"),
  fromLegalForm(["limited_company"], tax("legalForm"), "company"),
  fromLegalForm(["company_limited_by_guarantee"], tax("legalForm"), "company_limited_by_guarantee"),
  fromLegalForm(["limited_company", "company_limited_by_guarantee"], tax("incorporatedAsCompany"), true),
  fromLegalForm(["incorporated_trustees"], tax("legalForm"), "incorporated_trustees"),
  fromLegalForm(["incorporated_trustees"], tax("incorporatedAsCompany"), false),
  {
    // A company registered with the CAC was incorporated by that registration, in Nigeria.
    from: ["legalForm", "registrationStatus"],
    when: {
      all: [
        legalForm("limited_company", "company_limited_by_guarantee"),
        { answer: "registrationStatus", is: ["registered"] },
      ],
    },
    fills: tax("incorporatedInNigeria"),
    value: true,
  },
  {
    from: ["state"],
    when: { answer: "state", is: STATES },
    fills: privacy("operatesInNigeria"),
    value: true,
  },
  // "No" fills nothing: the check's question asks about customers and staff, the rule's about anyone.
  {
    from: ["personalData"],
    when: { answer: "personalData", is: ["yes"] },
    fills: privacy("processesPersonalData"),
    value: true,
  },
  // One kind of product, and nothing else, is the particular product the rule asks about.
  ...PRODUCT_KINDS.map((kind): Feed => ({
    from: ["productTypes"],
    when: { answer: "productTypes", isOnly: kind.value },
    fills: product("productCategory"),
    value: kind.value,
  })),
];

/** The feed that fills a rule's answer now, if any. */
export function feedFor(answers: unknown, path: string): Feed | undefined {
  return RULE_FEEDS.find((feed) => feed.fills === path && holds(feed.when, answers));
}

/** A rule's answers, with those the earlier answers fill in place of the visitor's own. */
function withFilled(
  answers: unknown,
  families: ReadonlySet<RuleFamily>,
): Record<string, Record<string, unknown>> {
  const own = (isObject(answers) && isObject(answers.rich) ? answers.rich : {}) as Record<string, unknown>;
  const rich: Record<string, Record<string, unknown>> = {};
  for (const family of families) if (isObject(own[family])) rich[family] = { ...own[family] };
  for (const feed of RULE_FEEDS) {
    const [, family, key] = feed.fills.split(".") as [string, RuleFamily, string];
    if (families.has(family) && holds(feed.when, answers))
      rich[family] = { ...rich[family], [key]: feed.value };
  }
  return rich;
}

/**
 * The rule answers a check sends, for the rules in use: each rule's own answers with the filled
 * ones in their place, without the answer of any question its conditions do not ask now. An answer
 * a changed choice hides is kept on the page but not sent; the walk in rule-questions.test.ts proves
 * that leaving it out cannot change what the rule says. An answer no question asks, which the page
 * cannot give but a saved check can hold, is sent as it is.
 */
export function ruleAnswersToSend(
  answers: unknown,
  families: ReadonlySet<RuleFamily>,
): Record<string, Record<string, unknown>> {
  let rich = withFilled(answers, families);
  // Conditions read other answers of the same rule, so drop until nothing more is dropped.
  for (let changed = true; changed;) {
    changed = false;
    const facts = { ...(isObject(answers) ? answers : {}), rich };
    const next: Record<string, Record<string, unknown>> = {};
    for (const [family, own] of Object.entries(rich) as [RuleFamily, Record<string, unknown>][]) {
      const kept: Record<string, unknown> = {};
      const keys = new Set(RULE_QUESTIONS[family].map((question) => question.key));
      if (family === "businessName") keys.add("namingAssessment").add("partners");
      for (const [key, value] of Object.entries(own)) if (!keys.has(key)) kept[key] = value;
      for (const question of RULE_QUESTIONS[family])
        if (Object.hasOwn(own, question.key) && (!question.askedWhen || holds(question.askedWhen, facts)))
          kept[question.key] = own[question.key];
      if (family === "businessName") {
        const naming = own.namingAssessment;
        if (isObject(naming)) {
          const askedNaming = Object.fromEntries(
            NAMING_QUESTIONS.filter(
              (question) =>
                Object.hasOwn(naming, question.key) &&
                (!question.askedWhen || holds(question.askedWhen, facts)),
            ).map((question) => [question.key, naming[question.key]]),
          );
          if (Object.keys(askedNaming).length) kept.namingAssessment = askedNaming;
        }
        const partnersAsked = PARTNER_QUESTIONS[0]?.askedWhen;
        if (own.partners !== undefined && (!partnersAsked || holds(partnersAsked, facts)))
          kept.partners = own.partners;
      }
      if (
        Object.keys(kept).length !== Object.keys(own).length ||
        JSON.stringify(kept) !== JSON.stringify(own)
      )
        changed = true;
      if (Object.keys(kept).length) next[family] = kept;
    }
    rich = next;
  }
  return rich;
}

/**
 * A saved check's answers, as the page holds them when it is loaded again. A saved check stores the
 * answers it sent, filled ones included; a rule's answer equal to what an earlier answer fills is
 * read as filled, so it is dropped from the visitor's own answers and keeps following that earlier
 * answer (the design's section 3).
 */
export function withoutFilledAnswers<T>(answers: T): T {
  if (!isObject(answers) || !isObject(answers.rich)) return answers;
  const rich: Record<string, unknown> = { ...answers.rich };
  for (const feed of RULE_FEEDS) {
    const [, family, key] = feed.fills.split(".") as [string, string, string];
    const own = rich[family];
    if (!isObject(own) || own[key] !== feed.value || !holds(feed.when, answers)) continue;
    const kept = { ...own };
    delete kept[key];
    if (Object.keys(kept).length) rich[family] = kept;
    else delete rich[family];
  }
  const out: Record<string, unknown> = { ...answers };
  if (Object.keys(rich).length) out.rich = rich;
  else delete out.rich;
  return out as T;
}

/** What the page calls the business-name rule's partners, asked as one list. */
export const PARTNERS_LABEL = "Partners, if relevant";

/** A question the check asks now, where the page shows it. */
export interface AskedQuestion {
  /**
   * The answer it fills, by its full path: `legalForm`, `rich.tax.legalForm`,
   * `rich.businessName.namingAssessment.otherBrandAddition`, or `rich.businessName.partners` for the
   * partners, asked as one list.
   */
  readonly path: string;
  /** The step that asks it. */
  readonly step: number;
  readonly label: string;
  /** The kind of rule whose question it is; none for the check's own. */
  readonly family?: RuleFamily;
  /** A rule's question's answers, by which a chosen one is named. */
  readonly choices?: readonly Choice[];
  /** An optional figure, never counted against the visitor. */
  readonly optional?: true;
  /** The earlier answer that fills it, while one does. */
  readonly filledBy?: Feed;
}

/**
 * The questions the check asks now, in the order the page shows them: each step's own questions,
 * then the questions of the rules in use asked in that step, a rule's question filled by an earlier
 * answer included. `sent` is what the check sends, on which the page reads the conditions;
 * `families` are the kinds of rule whose questions this visitor is asked.
 */
export function questionsAsked(sent: unknown, families: ReadonlySet<RuleFamily>): AskedQuestion[] {
  const asked: AskedQuestion[] = [];
  CHECKER_QUESTIONNAIRE.forEach((step, index) => {
    for (const question of step.questions)
      if (isAsked(sent, question.answer))
        asked.push({
          path: question.answer,
          step: index,
          label: question.label,
          ...(question.optional ? { optional: true as const } : {}),
        });
    for (const family of RULE_FAMILIES) {
      if (RULE_STEPS[family] !== index || !families.has(family)) continue;
      const add = (path: string, question: Pick<RuleQuestion, "label" | "choices" | "askedWhen">) => {
        if (question.askedWhen && !holds(question.askedWhen, sent)) return;
        const filledBy = feedFor(sent, path);
        asked.push({
          path,
          step: index,
          label: question.label,
          family,
          ...(question.choices ? { choices: question.choices } : {}),
          ...(filledBy ? { filledBy } : {}),
        });
      };
      for (const question of RULE_QUESTIONS[family]) add(`rich.${family}.${question.key}`, question);
      if (family !== "businessName") continue;
      const partners = PARTNER_QUESTIONS[0]?.askedWhen;
      add("rich.businessName.partners", {
        label: PARTNERS_LABEL,
        ...(partners ? { askedWhen: partners } : {}),
      });
      for (const question of NAMING_QUESTIONS)
        add(`rich.businessName.namingAssessment.${question.key}`, question);
    }
  });
  return asked;
}

/** Each rule's questions, in order. The business-name rule's questions on how the name is composed
 * (`NAMING_QUESTIONS`, under `namingAssessment`) and about each partner (`PARTNER_QUESTIONS`, under
 * `partners`) are asked with it. */
export const RULE_QUESTIONS: Readonly<Record<RuleFamily, readonly RuleQuestion[]>> = {
  businessName: businessNameQuestions,
  tax: taxQuestions,
  privacy: privacyQuestions,
  product: productQuestions,
};
