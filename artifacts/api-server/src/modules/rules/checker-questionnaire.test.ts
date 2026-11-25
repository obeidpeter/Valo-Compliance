import assert from "node:assert/strict";
import { test } from "node:test";
import { PreviewAssessmentBody } from "@workspace/api-zod";
import {
  checkerFactsSchema,
  factNames,
  missingQuestions,
  richBusinessNameSchema,
  richPrivacySchema,
  richProductSchema,
  richTaxSchema,
} from "@workspace/valo-core";
import {
  CHECKER_QUESTIONNAIRE,
  CHECKER_QUESTIONS,
  NAMING_QUESTIONS,
  NOT_ANSWERED,
  PARTNER_QUESTIONS,
  RULE_FAMILIES,
  RULE_QUESTIONS,
  STATES,
  type RuleQuestion,
  answerAt,
  holds,
  isAsked,
  stepOfQuestion,
} from "@workspace/valo-core/checker-questionnaire";

/** The schema of each of the check's answers, as a request is read. */
const answerSchemas = PreviewAssessmentBody.shape.facts.shape as Record<
  string,
  { safeParse: (value: unknown) => { success: boolean } }
>;

/** A schema's fixed answers, when it is a list of them, under any optional or default around it. */
function fixedAnswers(schema: unknown): readonly string[] | undefined {
  let inner = schema as { options?: readonly unknown[]; unwrap?: () => unknown };
  while (inner && !inner.options && typeof inner.unwrap === "function")
    inner = inner.unwrap() as typeof inner;
  const options = inner?.options;
  return Array.isArray(options) && options.every((option) => typeof option === "string")
    ? (options as string[])
    : undefined;
}

test("the questionnaire asks each of the check's nineteen answers once, in the steps the page shows", () => {
  assert.deepEqual(
    CHECKER_QUESTIONNAIRE.map((step) => step.name),
    [
      "Your business",
      "What it does",
      "Where it is",
      "Size and turnover",
      "Personal data",
      "Review your answers",
    ],
  );
  assert.deepEqual(CHECKER_QUESTIONNAIRE.at(-1)!.questions, []);
  const answers = CHECKER_QUESTIONS.map((question) => question.answer);
  assert.equal(answers.length, 19);
  assert.deepEqual([...answers].sort(), [...factNames].sort());
  for (const [index, step] of CHECKER_QUESTIONNAIRE.entries())
    for (const question of step.questions)
      assert.equal(stepOfQuestion(question.answer), index, question.answer);
});

test("each question offers only answers the check's schema takes, and a choice offers every answer it takes", () => {
  const checkedChoices: string[] = [];
  for (const question of CHECKER_QUESTIONS) {
    const schema = answerSchemas[question.answer];
    assert.ok(schema, `${question.answer} is one of the check's answers`);
    const asGiven = (value: string) => (question.kind === "list" ? [value] : value);
    for (const choice of question.choices ?? [])
      assert.ok(schema.safeParse(asGiven(choice.value)).success, `${question.answer}: ${choice.value}`);
    for (const marker of question.notAnswered)
      assert.ok(schema.safeParse(marker).success, `${question.answer}: ${marker}`);
    const fixed = fixedAnswers(schema);
    if (fixed) checkedChoices.push(question.answer);
    if (fixed)
      assert.deepEqual(
        (question.choices ?? []).map((choice) => choice.value),
        fixed.filter((value) => !(NOT_ANSWERED as readonly string[]).includes(value)),
        `${question.answer} offers every answer its schema takes, in order`,
      );
  }
  // The schemas with fixed answers were read as such.
  assert.deepEqual(checkedChoices, [
    "manufacturing",
    "importing",
    "premises",
    "state",
    "turnoverBand",
    "turnoverPeriod",
    "turnoverMetric",
    "turnoverCurrency",
    "personalData",
  ]);
  assert.deepEqual(
    CHECKER_QUESTIONS.find((question) => question.answer === "state")!.choices!.map((choice) => choice.value),
    [...STATES],
  );
});

test("a group's questions are shown together, and are asked when the same answers hold", () => {
  for (const step of CHECKER_QUESTIONNAIRE) {
    const groups = step.questions.map((question) => question.group);
    for (const group of new Set(groups.filter(Boolean))) {
      const first = groups.indexOf(group),
        last = groups.lastIndexOf(group);
      assert.ok(
        groups.slice(first, last + 1).every((each) => each === group),
        `${group}'s questions are next to each other`,
      );
      const members = step.questions.slice(first, last + 1);
      for (const member of members)
        assert.deepEqual(member.askedWhen, members[0]!.askedWhen, `${member.answer} is asked with its group`);
    }
  }
});

test("a condition reads an answer, a list of answers, a rule's way of not answering and a missing answer", () => {
  const answers = {
    manufacturing: "yes",
    activities: ["retail/wholesale", "In my own words"],
    rich: { privacy: { processesPersonalData: true, operatesInNigeria: { status: "unknown", value: null } } },
  };
  assert.equal(answerAt(answers, "manufacturing"), "yes");
  assert.equal(answerAt(answers, "rich.privacy.processesPersonalData"), true);
  assert.equal(answerAt(answers, "rich.privacy.operatesInNigeria"), "unknown");
  assert.equal(answerAt(answers, "rich.privacy.controllerRole"), undefined);
  assert.equal(answerAt(answers, "rich.tax.legalForm"), undefined);
  assert.equal(holds({ answer: "manufacturing", is: ["yes"] }, answers), true);
  assert.equal(holds({ answer: "manufacturing", isNot: ["yes"] }, answers), false);
  assert.equal(holds({ answer: "activities", is: ["retail/wholesale"] }, answers), true);
  assert.equal(holds({ answer: "activities", isNot: ["retail/wholesale"] }, answers), false);
  assert.equal(holds({ answer: "rich.privacy.operatesInNigeria", is: ["unknown"] }, answers), true);
  // No answer is none of the values, and is not one of them.
  assert.equal(holds({ answer: "importing", isNot: ["no"] }, answers), true);
  assert.equal(holds({ answer: "importing", is: ["no"] }, answers), false);
  assert.equal(
    holds(
      {
        all: [
          { answer: "manufacturing", is: ["yes"] },
          {
            any: [
              { answer: "importing", is: ["yes"] },
              { answer: "rich.privacy.processesPersonalData", is: [true] },
            ],
          },
        ],
      },
      answers,
    ),
    true,
  );
  // A question the questionnaire does not name is asked.
  assert.equal(isAsked(answers, "rich.privacy.controllerRole"), true);
  // "Has an answer": a value, not a way of not answering, an empty text or an empty list.
  const answered = (value: unknown) => holds({ answer: "x", answered: true }, { x: value });
  assert.equal(answered("Synthetic Ventures"), true);
  assert.equal(answered(["Ade"]), true);
  assert.equal(answered(false), true);
  for (const missing of [undefined, null, "", "  ", [], "unknown", "unanswered", "not_applicable"])
    assert.equal(answered(missing), false, JSON.stringify(missing));
  assert.equal(answered({ status: "unknown", value: null }), false);
});

/** Every answer given, so that a test changes only what it names. */
const answeredFacts = {
  legalForm: "limited_company",
  registrationStatus: "registered",
  activities: ["Selling fabric wholesale"],
  productTypes: "not_applicable",
  state: "Lagos",
  lga: "Ikeja",
  employees: "4",
  turnoverBand: "under_5m",
  turnoverYear: "2025",
  turnoverMetric: "gross_revenue",
  turnoverCurrency: "NGN",
  turnoverPeriod: "annual",
  turnoverAmountKobo: null,
  turnoverPeriodStart: "2025-01-01",
  turnoverPeriodEnd: "2025-12-31",
  premises: "yes",
  manufacturing: "no",
  importing: "no",
  personalData: "yes",
};
const stillUnanswered = (changes: Record<string, unknown>) =>
  missingQuestions(checkerFactsSchema.parse({ ...answeredFacts, ...changes }));

// RUL-001: "irrelevant questions are skipped". A result lists as unanswered only what the page asked.
test("a result lists as still unanswered the questions the check asks and has no answer for, by the page's own conditions", () => {
  assert.deepEqual(stillUnanswered({}), [], "every question answered, the optional exact figure included");

  // Not knowing whether the business makes goods asks for its products, and lists them until given.
  assert.deepEqual(stillUnanswered({ manufacturing: "unknown", productTypes: "unanswered" }), [
    "productTypes",
    "manufacturing",
  ]);
  assert.deepEqual(stillUnanswered({ manufacturing: "unknown", productTypes: ["Packaged snacks"] }), [
    "manufacturing",
  ]);
  // A skipped question does not ask for its products, so they are not listed with it.
  assert.deepEqual(stillUnanswered({ importing: "unanswered", productTypes: "unanswered" }), ["importing"]);

  // "Not applicable" is an answer: it is not listed, and turnover not applying skips its details.
  assert.deepEqual(
    stillUnanswered({
      employees: "not_applicable",
      turnoverBand: "not_applicable",
      turnoverYear: "unanswered",
      turnoverPeriodStart: "unanswered",
    }),
    [],
  );
  assert.deepEqual(stillUnanswered({ employees: "unknown", turnoverBand: "unknown" }), [
    "employees",
    "turnoverBand",
  ]);

  // The area is asked once a state is chosen, premises or not, and is listed until it is given.
  assert.deepEqual(stillUnanswered({ premises: "no", lga: "unanswered" }), ["lga"]);
  assert.deepEqual(stillUnanswered({ state: "unknown", lga: "unknown" }), ["state"]);
});

test("over many sets of answers, the result lists exactly the questions the page asks that have no answer yet", () => {
  const options = (answer: string): readonly unknown[] => {
    const question = CHECKER_QUESTIONS.find((each) => each.answer === answer)!;
    const given: Record<string, readonly unknown[]> = {
      activities: [["Selling fabric"], []],
      productTypes: [["Packaged snacks"], []],
      lga: ["Ikeja", ""],
      employees: ["0", "12"],
      turnoverYear: ["2025"],
      turnoverPeriodStart: ["2025-01-01"],
      turnoverPeriodEnd: ["2025-12-31"],
      turnoverAmountKobo: [null, "150000"],
      legalForm: ["sole_proprietor", "limited_company"],
      registrationStatus: ["registered", "pending"],
    };
    return [
      ...(given[answer] ?? []),
      ...(question.choices ?? []).map((choice) => choice.value),
      ...(answer === "turnoverAmountKobo" ? [] : NOT_ANSWERED),
    ];
  };
  let seed = 20261125;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = <T>(list: readonly T[]) => list[Math.floor(next() * list.length)]!;
  for (let run = 0; run < 2000; run++) {
    const facts = checkerFactsSchema.parse(
      Object.fromEntries(
        CHECKER_QUESTIONS.map((question) => [question.answer, pick(options(question.answer))]),
      ),
    );
    const listed: readonly string[] = missingQuestions(facts);
    for (const answer of listed)
      assert.ok(isAsked(facts, answer), `${answer} is listed, so the page asks it`);
    for (const question of CHECKER_QUESTIONS) {
      const value = (facts as Record<string, unknown>)[question.answer];
      const toGive =
        value === "unknown" ||
        value === "unanswered" ||
        value === "" ||
        (Array.isArray(value) && value.length === 0);
      assert.equal(
        listed.includes(question.answer),
        !question.optional && isAsked(facts, question.answer) && toGive,
        `${question.answer} = ${JSON.stringify(value)}`,
      );
    }
  }
});

/** Each answer a rule's question can give, as its rule's answers hold it. */
function ruleAnswers(question: RuleQuestion): unknown[] {
  const markers = NOT_ANSWERED.map((status) => ({ status, value: null }));
  const values = (question.choices ?? []).map((choice) => choice.value);
  switch (question.kind) {
    case "flag":
      return [true, false, ...markers];
    case "choice":
      return [...values, ...markers];
    case "list":
      return [values.length ? values : ["Synthetic entry"], ...markers];
    case "date":
      return ["2026-01-01", ...markers];
    default:
      return ["Synthetic answer", ...markers];
  }
}

test("each rule's questions fill only answers its rule's schema takes, with every answer they offer", () => {
  const schemas = {
    businessName: richBusinessNameSchema,
    privacy: richPrivacySchema,
    tax: richTaxSchema,
    product: richProductSchema,
  };
  const asked: string[] = [];
  for (const family of RULE_FAMILIES)
    for (const question of RULE_QUESTIONS[family]) {
      assert.ok(
        Object.hasOwn(schemas[family].shape, question.key),
        `${family}.${question.key} is a ${family} answer`,
      );
      for (const value of ruleAnswers(question))
        assert.ok(
          schemas[family].safeParse({ [question.key]: value }).success,
          `${family}.${question.key} takes ${JSON.stringify(value)}`,
        );
      asked.push(`${family}.${question.key}`);
    }
  for (const question of NAMING_QUESTIONS)
    for (const value of ruleAnswers(question))
      assert.ok(
        richBusinessNameSchema.safeParse({ namingAssessment: { [question.key]: value } }).success,
        `namingAssessment.${question.key} takes ${JSON.stringify(value)}`,
      );
  for (const question of PARTNER_QUESTIONS)
    for (const value of ruleAnswers(question))
      assert.ok(
        richBusinessNameSchema.safeParse({ partners: [{ [question.key]: value }] }).success,
        `partners.${question.key} takes ${JSON.stringify(value)}`,
      );
  assert.equal(new Set(asked).size, asked.length, "no rule's question is asked twice");
  assert.deepEqual(
    RULE_FAMILIES.map((family) => RULE_QUESTIONS[family].length),
    [12, 8, 23, 15],
  );
});
