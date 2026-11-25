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
