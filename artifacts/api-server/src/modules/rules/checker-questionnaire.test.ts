import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PreviewAssessmentBody } from "@workspace/api-zod";
import {
  checkerFactsSchema,
  coveragePlan,
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
  INDUSTRIES,
  NAMING_QUESTIONS,
  NOT_ANSWERED,
  PARTNER_QUESTIONS,
  PRODUCT_KINDS,
  RULE_FAMILIES,
  RULE_FEEDS,
  RULE_QUESTIONS,
  RULE_STEPS,
  STATES,
  type RuleFamily,
  type RuleQuestion,
  type When,
  answerAt,
  checkerQuestion,
  holds,
  isAsked,
  questionsAsked,
  ruleAnswersToSend,
  stepOfQuestion,
  withoutFilledAnswers,
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
  // "Only": the answer is that one value, or a list of that one entry.
  assert.equal(holds({ answer: "manufacturing", isOnly: "yes" }, answers), true);
  assert.equal(holds({ answer: "activities", isOnly: "retail/wholesale" }, answers), false);
  assert.equal(holds({ answer: "x", isOnly: "cosmetic" }, { x: ["cosmetic"] }), true);
  assert.equal(holds({ answer: "x", isOnly: "cosmetic" }, { x: ["cosmetic", "water"] }), false);
  assert.equal(holds({ answer: "x", isOnly: "cosmetic" }, { x: [] }), false);
  assert.equal(holds({ answer: "importing", isOnly: "no" }, answers), false);
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
      // A list's choice is given as a list of that one entry.
      ...(question.choices ?? []).map((choice) => (question.kind === "list" ? [choice.value] : choice.value)),
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
    [12, 9, 23, 15],
  );
});

/** The check's own answers a condition reads. */
function answersNamed(when: When): string[] {
  if ("all" in when) return when.all.flatMap(answersNamed);
  if ("any" in when) return when.any.flatMap(answersNamed);
  return [when.answer];
}

/** The rule answers the earlier answers fill, by their full path. */
const filledBy = (answers: Record<string, unknown>) =>
  Object.fromEntries(
    RULE_FEEDS.filter((feed) => holds(feed.when, answers)).map((feed) => [feed.fills, feed.value]),
  );

test("earlier answers fill a rule's answers exactly as the design's table lists, each with an answer the rule's question offers", () => {
  // docs/architecture/requirements-questions.md, section 3, row by row.
  assert.deepEqual(filledBy({ legalForm: "sole_proprietor" }), {
    "rich.businessName.legalForm": "individual",
    "rich.tax.incorporatedAsCompany": false,
  });
  assert.deepEqual(filledBy({ legalForm: "partnership" }), {
    "rich.businessName.legalForm": "firm",
    "rich.tax.incorporatedAsCompany": false,
  });
  assert.deepEqual(filledBy({ legalForm: "limited_company" }), {
    "rich.businessName.legalForm": "company",
    "rich.tax.legalForm": "company",
    "rich.tax.incorporatedAsCompany": true,
  });
  assert.deepEqual(filledBy({ legalForm: "company_limited_by_guarantee" }), {
    "rich.businessName.legalForm": "company",
    "rich.tax.legalForm": "company_limited_by_guarantee",
    "rich.tax.incorporatedAsCompany": true,
  });
  assert.deepEqual(filledBy({ legalForm: "incorporated_trustees" }), {
    "rich.tax.legalForm": "incorporated_trustees",
    "rich.tax.incorporatedAsCompany": false,
  });
  for (const legalForm of ["limited_company", "company_limited_by_guarantee"])
    assert.equal(
      filledBy({ legalForm, registrationStatus: "registered" })["rich.tax.incorporatedInNigeria"],
      true,
    );
  for (const [legalForm, registrationStatus] of [
    ["sole_proprietor", "registered"],
    ["partnership", "registered"],
    ["incorporated_trustees", "registered"],
    ["limited_company", "pending"],
    ["limited_company", "unregistered"],
    ["limited_company", "unknown"],
  ])
    assert.equal(
      Object.hasOwn(filledBy({ legalForm, registrationStatus }), "rich.tax.incorporatedInNigeria"),
      false,
      `${legalForm}, ${registrationStatus}`,
    );
  for (const state of STATES)
    assert.deepEqual(filledBy({ state }), { "rich.privacy.operatesInNigeria": true });
  assert.deepEqual(filledBy({ personalData: "yes" }), { "rich.privacy.processesPersonalData": true });
  // "No" to the personal-data question fills nothing: it asks about customers and staff only.
  assert.deepEqual(filledBy({ personalData: "no" }), {});
  // Exactly one of the Act's kinds of product, and nothing else, is the particular product.
  for (const kind of PRODUCT_KINDS)
    assert.deepEqual(filledBy({ productTypes: [kind.value] }), {
      "rich.product.productCategory": kind.value,
    });
  for (const productTypes of [["cosmetic", "water"], ["cosmetic", "Hair oil"], ["Hair oil"], []])
    assert.deepEqual(filledBy({ productTypes }), {}, JSON.stringify(productTypes));
  // Not knowing, skipping or not applying settles nothing, so it fills nothing.
  for (const marker of NOT_ANSWERED)
    assert.deepEqual(
      filledBy({ legalForm: marker, registrationStatus: marker, state: marker, personalData: marker }),
      {},
    );

  for (const feed of RULE_FEEDS) {
    const [, family, key] = feed.fills.split(".") as [string, RuleFamily, string];
    const question = RULE_QUESTIONS[family].find((each) => each.key === key);
    assert.ok(question, `${feed.fills} is a rule's question`);
    if (question.kind === "flag") assert.equal(typeof feed.value, "boolean", feed.fills);
    else
      assert.ok(
        question.choices?.some((choice) => choice.value === feed.value),
        feed.fills,
      );
    // A filled answer comes from the check's own questions, named as the answers it reads, and each
    // is asked in the same step as the rule's question or before it.
    assert.deepEqual([...new Set(answersNamed(feed.when))].sort(), [...feed.from].sort(), feed.fills);
    for (const answer of feed.from) {
      assert.ok(checkerQuestion(answer), `${answer} is one of the check's questions`);
      assert.ok(stepOfQuestion(answer) <= RULE_STEPS[family], `${answer} is asked before ${feed.fills}`);
    }
  }
});

const ALL_RULES: ReadonlySet<RuleFamily> = new Set(RULE_FAMILIES);

test("a check sends the answers of the rules in use only, filled ones in place of the visitor's own while they hold, and none of a question not asked", () => {
  const own = {
    rich: {
      businessName: {
        hasPlaceOfBusinessInNigeria: true,
        carryingOnBusiness: true,
        legalForm: "firm",
        trueSurname: "Okafor",
        partners: [{ type: "individual", surname: "Okafor" }],
      },
      // An answer no question asks, which a saved check can hold, is sent as it is.
      tax: { legalForm: "other", finalTaxTreatment: "synthetic treatment" },
      product: {
        commercialSupplyOfRegulatedProducts: false,
        manufacturesInNigeria: false,
        activity: "manufacture",
      },
    },
  };
  // No rule in use: nothing of theirs is sent.
  assert.deepEqual(ruleAnswersToSend({ ...own, legalForm: "sole_proprietor" }, new Set()), {});
  assert.deepEqual(Object.keys(ruleAnswersToSend(own, new Set(["tax"]))), ["tax"]);

  // A sole proprietor fills the operator in place of the visitor's own answer. The partners are then
  // not asked, and not sent; the operator's surname is.
  const sole = ruleAnswersToSend({ ...own, legalForm: "sole_proprietor" }, ALL_RULES);
  assert.deepEqual(sole.businessName, {
    hasPlaceOfBusinessInNigeria: true,
    carryingOnBusiness: true,
    legalForm: "individual",
    trueSurname: "Okafor",
  });
  assert.deepEqual(sole.tax, {
    legalForm: "other",
    finalTaxTreatment: "synthetic treatment",
    incorporatedAsCompany: false,
  });
  // Neither regulated supply nor manufacture in Nigeria settles the product rule: the activity is
  // not asked, and not sent.
  assert.deepEqual(sole.product, {
    commercialSupplyOfRegulatedProducts: false,
    manufacturesInNigeria: false,
  });

  // When the earlier answer no longer settles it, the visitor's own answer is sent again.
  const unknown = ruleAnswersToSend({ ...own, legalForm: "unknown" }, ALL_RULES);
  assert.deepEqual(unknown.businessName, {
    hasPlaceOfBusinessInNigeria: true,
    carryingOnBusiness: true,
    legalForm: "firm",
    partners: [{ type: "individual", surname: "Okafor" }],
  });
  assert.deepEqual(unknown.tax, { legalForm: "other", finalTaxTreatment: "synthetic treatment" });

  // A filled answer whose question the filled answers settle is not sent either: once the records
  // describe a company, whether it was incorporated as one is not asked.
  const company = ruleAnswersToSend(
    { legalForm: "limited_company", registrationStatus: "registered" },
    ALL_RULES,
  );
  assert.deepEqual(company, { tax: { legalForm: "company", incorporatedInNigeria: true } });

  // The rule's own answers filled from where the business is and what it keeps.
  assert.deepEqual(ruleAnswersToSend({ state: "Kano", personalData: "yes" }, ALL_RULES), {
    privacy: { processesPersonalData: true, operatesInNigeria: true },
  });
  // A connection to Nigeria that holds already means the next ones are not asked.
  assert.deepEqual(
    ruleAnswersToSend(
      { state: "Kano", personalData: "yes", rich: { privacy: { dataSubjectsInNigeria: false } } },
      ALL_RULES,
    ).privacy,
    { processesPersonalData: true, operatesInNigeria: true },
  );
});

test("a saved check's filled answers are read as filled when it is loaded again, and its other answers as the visitor's own", () => {
  const saved = {
    legalForm: "limited_company",
    registrationStatus: "registered",
    state: "Lagos",
    personalData: "no",
    rich: {
      tax: { legalForm: "company", incorporatedInNigeria: true, companyStatus: "active" },
      privacy: { processesPersonalData: true, operatesInNigeria: true },
      businessName: { legalForm: "individual" },
    },
  };
  const loaded = withoutFilledAnswers(saved);
  assert.deepEqual(loaded.rich, {
    // The records and the incorporation follow the earlier answers again.
    tax: { companyStatus: "active" },
    // "No" fills nothing, so the saved "yes" is the visitor's own; the state fills the operation.
    privacy: { processesPersonalData: true },
    // Not what the earlier answer fills: the visitor's own, kept.
    businessName: { legalForm: "individual" },
  });
  // Sent again, the loaded check sends what the saved one sent.
  assert.deepEqual(ruleAnswersToSend(loaded, ALL_RULES), ruleAnswersToSend(saved, ALL_RULES));
  // Nothing of the saved answers is changed.
  assert.equal(saved.rich.tax.legalForm, "company");
  // A check whose rule answers were all filled keeps none of its own.
  assert.equal(
    Object.hasOwn(
      withoutFilledAnswers({ state: "Lagos", rich: { privacy: { operatesInNigeria: true } } }),
      "rich",
    ),
    false,
  );
  const plain = { legalForm: "partnership" };
  assert.equal(withoutFilledAnswers(plain), plain);
});

test("what the business does is chosen from the specification's twenty industries, and its products from the Act's six kinds, each held as its source writes it", () => {
  // VALO-TRD-001, "Industry taxonomy and depth": the categories, verbatim and in order.
  const trd = readFileSync(
    new URL("../../../../../docs/specification/VALO-TRD-001-v1.1.txt", import.meta.url),
    "utf8",
  );
  const line = trd.split("\n").find((each) => each.startsWith("Categories: "));
  assert.ok(line, "the TRD lists the industry categories");
  assert.deepEqual(
    [...INDUSTRIES],
    line
      .replace(/^Categories: /, "")
      .replace(/\.$/, "")
      .split("; "),
  );
  // The site's industries are the same list, named on a page with a capital first letter.
  assert.deepEqual(
    coveragePlan().industries.map((industry) => industry.title),
    [...INDUSTRIES],
  );
  const activities = CHECKER_QUESTIONS.find((question) => question.answer === "activities")!;
  assert.deepEqual(
    activities.choices,
    INDUSTRIES.map((industry) => ({
      value: industry,
      label: industry.charAt(0).toUpperCase() + industry.slice(1),
    })),
  );
  // Section 1(1) of the Act, in the copy its rule was prepared from, names the six kinds in order.
  const act = readFileSync(
    new URL("../../../../../docs/content-candidates/source-evidence/nafdac_cap_f33.txt", import.meta.url),
    "utf8",
  );
  assert.match(act, /No processed food, drug, drug product, cosmetic, medical device or water/);
  assert.deepEqual(
    PRODUCT_KINDS.map((kind) => kind.label.toLowerCase()),
    ["processed food", "drug", "drug product", "cosmetic", "medical device", "water"],
  );
  assert.deepEqual(
    CHECKER_QUESTIONS.find((question) => question.answer === "productTypes")!.choices,
    PRODUCT_KINDS,
  );
  // Each kind is held as the product rule's own value, which its question on the particular product
  // offers.
  const category = RULE_QUESTIONS.product.find((question) => question.key === "productCategory")!;
  for (const kind of PRODUCT_KINDS) {
    assert.ok(richProductSchema.safeParse({ productCategory: kind.value }).success, kind.value);
    assert.ok(
      category.choices?.some((choice) => choice.value === kind.value && choice.label === kind.label),
      kind.value,
    );
  }
});

test("the questions asked now are listed in the order the page shows them, each rule's after the check's own in its step, with the filled ones marked and none the check skips", () => {
  const base = {
    legalForm: "limited_company",
    registrationStatus: "registered",
    activities: ["retail/wholesale"],
    manufacturing: "no",
    importing: "no",
    premises: "yes",
    state: "Lagos",
    lga: "Ikeja",
    employees: "4",
    turnoverBand: "not_applicable",
    personalData: "yes",
  };
  // The check's own questions only: neither the products nor the turnover details are asked here.
  assert.deepEqual(
    questionsAsked(base, new Set()).map((question) => question.path),
    [
      "legalForm",
      "registrationStatus",
      "activities",
      "manufacturing",
      "importing",
      "premises",
      "state",
      "lga",
      "employees",
      "turnoverBand",
      "personalData",
    ],
  );
  const sent = { ...base, rich: ruleAnswersToSend(base, ALL_RULES) };
  const asked = questionsAsked(sent, ALL_RULES);
  // Each in its step, the check's own first, then the rules' in the order the questionnaire holds them.
  for (const question of asked)
    assert.equal(
      question.step,
      question.family ? RULE_STEPS[question.family] : stepOfQuestion(question.path),
      question.path,
    );
  assert.deepEqual(
    asked.filter((question) => question.step === 0).map((question) => question.path),
    [
      "legalForm",
      "registrationStatus",
      "rich.businessName.hasPlaceOfBusinessInNigeria",
      "rich.businessName.carryingOnBusiness",
      "rich.businessName.businessNameRegistered",
      "rich.tax.legalForm",
      "rich.tax.incorporatedInNigeria",
      "rich.tax.companyStatus",
      "rich.tax.accountingPeriodStart",
      "rich.tax.accountingPeriodEnd",
    ],
  );
  // The filled answers say where they came from.
  assert.deepEqual(
    asked.filter((question) => question.filledBy).map((question) => [question.path, question.filledBy!.from]),
    [
      ["rich.tax.legalForm", ["legalForm"]],
      ["rich.tax.incorporatedInNigeria", ["legalForm", "registrationStatus"]],
      ["rich.privacy.processesPersonalData", ["personalData"]],
      ["rich.privacy.operatesInNigeria", ["state"]],
    ],
  );
  // A rule's question carries its answers, by which a chosen one is named.
  assert.deepEqual(
    asked.find((question) => question.path === "rich.tax.companyStatus")!.choices,
    RULE_QUESTIONS.tax.find((question) => question.key === "companyStatus")!.choices,
  );
  // The optional exact figure is marked as such.
  const figure = questionsAsked({ ...base, turnoverBand: "under_5m" }, new Set()).find(
    (question) => question.path === "turnoverAmountKobo",
  );
  assert.equal(figure?.optional, true);
  // Only the kinds of rule asked: no business-name question for a visitor who is not asked them.
  assert.equal(
    questionsAsked(sent, new Set(["tax", "privacy", "product"])).some(
      (question) => question.family === "businessName",
    ),
    false,
  );
});
