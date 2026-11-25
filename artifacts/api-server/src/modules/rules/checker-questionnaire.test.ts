import assert from "node:assert/strict";
import { test } from "node:test";
import { PreviewAssessmentBody } from "@workspace/api-zod";
import { factNames } from "@workspace/valo-core";
import {
  CHECKER_QUESTIONNAIRE,
  CHECKER_QUESTIONS,
  NOT_ANSWERED,
  STATES,
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
});
