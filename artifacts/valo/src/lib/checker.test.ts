import { test } from "node:test";
import assert from "node:assert/strict";
import type { CheckerFacts } from "@workspace/api-client-react";
import { CHECKER_QUESTIONS } from "@workspace/valo-core/checker-questionnaire";
import {
  CHECKER_STEPS,
  EMPTY_FACTS,
  FACT_ORDER,
  answered,
  asked,
  displayFact,
  finaliseFacts,
  stepDone,
  stepOf,
  valueLabel,
} from "./checker";

const none: ReadonlySet<string> = new Set();
const facts = (changes: Partial<CheckerFacts>): CheckerFacts => ({ ...EMPTY_FACTS, ...changes });

test("every answer the checker records is asked on exactly one step, and the last step only reviews", () => {
  const asks = CHECKER_STEPS.flatMap((step) => [...step.questions]);
  assert.deepEqual([...asks].sort(), [...FACT_ORDER].sort());
  assert.equal(new Set(asks).size, asks.length, "no question is asked twice");
  assert.deepEqual(CHECKER_STEPS.at(-1)!.questions, []);
  for (const [index, step] of CHECKER_STEPS.entries())
    for (const question of step.questions) assert.equal(stepOf(question), index, question);
});

test("each choice a question offers is named as the review and the results name that answer", () => {
  for (const question of CHECKER_QUESTIONS)
    for (const choice of question.choices ?? [])
      assert.equal(choice.label, valueLabel(choice.value), `${question.answer}: ${choice.value}`);
});

// RUL-001: "irrelevant questions are skipped".
test("a question that depends on another answer is asked only when that answer makes it relevant", () => {
  assert.equal(asked(EMPTY_FACTS, "productTypes"), false);
  assert.equal(asked(facts({ manufacturing: "yes" }), "productTypes"), true);
  assert.equal(asked(facts({ importing: "yes" }), "productTypes"), true);
  assert.equal(asked(facts({ manufacturing: "no", importing: "unknown" }), "productTypes"), false);

  assert.equal(asked(EMPTY_FACTS, "lga"), true);
  assert.equal(asked(facts({ premises: "unknown" }), "lga"), true);
  assert.equal(asked(facts({ premises: "no" }), "lga"), false);

  const details = [
    "turnoverAmountKobo",
    "turnoverYear",
    "turnoverPeriod",
    "turnoverPeriodStart",
    "turnoverPeriodEnd",
    "turnoverMetric",
    "turnoverCurrency",
  ];
  for (const question of details) {
    assert.equal(asked(EMPTY_FACTS, question), true, question);
    // Not knowing the turnover is not the same as turnover not applying: the details are still asked.
    assert.equal(asked(facts({ turnoverBand: "unknown" }), question), true, question);
    assert.equal(asked(facts({ turnoverBand: "not_applicable" }), question), false, question);
  }
  assert.equal(asked(facts({ turnoverBand: "not_applicable" }), "employees"), true);
});

// RUL-002: "Represent unknown, unanswered and not-applicable separately from false/zero."
test("a question nobody has touched is not dealt with; an answer, 'I do not know', 'Not applicable' and a chosen skip each are, and none of them is a 'No' or a zero", () => {
  for (const question of FACT_ORDER) assert.equal(answered(EMPTY_FACTS, none, question), false, question);

  assert.equal(answered(facts({ premises: "no" }), none, "premises"), true);
  assert.equal(answered(facts({ premises: "unknown" }), none, "premises"), true);
  assert.equal(answered(facts({ employees: "not_applicable" }), none, "employees"), true);
  assert.equal(answered(facts({ employees: "0" }), none, "employees"), true);
  // A chosen skip holds the same "unanswered" as an untouched question; only the choice tells them apart.
  assert.equal(answered(EMPTY_FACTS, new Set(["premises"]), "premises"), true);
  assert.equal(answered(EMPTY_FACTS, new Set(["premises"]), "importing"), false);
  assert.equal(EMPTY_FACTS.premises, "unanswered");
  assert.equal(EMPTY_FACTS.employees, "unanswered");

  // A list counts once it has an entry; blank rows are not an answer.
  assert.equal(answered(facts({ activities: [""] }), none, "activities"), false);
  assert.equal(answered(facts({ activities: ["", "Selling fabric"] }), none, "activities"), true);
  assert.equal(answered(facts({ activities: "unknown" }), none, "activities"), true);
  // An emptied text answer goes back to not dealt with.
  assert.equal(answered(facts({ lga: "" }), none, "lga"), false);
  assert.equal(answered(facts({ lga: "Ikeja" }), none, "lga"), true);
});

test("a step is done only when every question it asks has been dealt with; the optional exact figure and the skipped questions do not hold it back", () => {
  for (const index of CHECKER_STEPS.keys()) assert.equal(stepDone(EMPTY_FACTS, none, index), false);

  const business = facts({ legalForm: "limited_company" });
  assert.equal(stepDone(business, none, 0), false);
  assert.equal(stepDone(business, new Set(["registrationStatus"]), 0), true);

  // What it does: the product question joins the step only once it is asked.
  const does = facts({ activities: ["Selling fabric"], manufacturing: "no", importing: "no" });
  assert.equal(stepDone(does, none, 1), true);
  assert.equal(stepDone({ ...does, importing: "yes" }, none, 1), false);
  assert.equal(stepDone({ ...does, importing: "yes", productTypes: ["Fabric"] }, none, 1), true);

  // Where it is: no premises, so no local government area.
  const where = facts({ premises: "no", state: "Lagos" });
  assert.equal(stepDone(where, none, 2), true);
  assert.equal(stepDone({ ...where, premises: "yes" }, none, 2), false);

  // Size and turnover: when turnover does not apply, only the number of people is left.
  const size = facts({ employees: "4", turnoverBand: "not_applicable" });
  assert.equal(stepDone(size, none, 3), true);
  const withTurnover = facts({
    employees: "4",
    turnoverBand: "under_5m",
    turnoverYear: "2025",
    turnoverPeriod: "annual",
    turnoverPeriodStart: "2025-01-01",
    turnoverPeriodEnd: "2025-12-31",
    turnoverMetric: "gross_revenue",
  });
  assert.equal(stepDone(withTurnover, none, 3), false, "the currency is still open");
  assert.equal(stepDone({ ...withTurnover, turnoverCurrency: "NGN" }, none, 3), true);
  assert.equal(withTurnover.turnoverAmountKobo, null, "without the optional exact figure");

  // The review step asks nothing, so it is never ticked.
  assert.equal(stepDone(facts({}), new Set(FACT_ORDER), CHECKER_STEPS.length - 1), false);
});

test("what is sent marks the questions the checker skipped as not applicable, and invents no other answer", () => {
  const untouched = finaliseFacts(EMPTY_FACTS);
  assert.equal(untouched.turnoverYear, "unanswered");
  assert.equal(untouched.employees, "unanswered");
  assert.equal(untouched.lga, "unanswered");

  const sent = finaliseFacts(
    facts({
      premises: "no",
      lga: "Ikeja",
      manufacturing: "no",
      importing: "no",
      turnoverBand: "not_applicable",
      turnoverYear: "2025",
      turnoverPeriod: "annual",
      turnoverPeriodStart: "2025-01-01",
      turnoverPeriodEnd: "2025-12-31",
      turnoverMetric: "gross_revenue",
      turnoverCurrency: "NGN",
      turnoverAmountKobo: "150000",
    }),
  );
  assert.equal(sent.lga, "not_applicable");
  assert.equal(sent.productTypes, "not_applicable");
  for (const question of [
    "turnoverYear",
    "turnoverPeriod",
    "turnoverPeriodStart",
    "turnoverPeriodEnd",
    "turnoverMetric",
    "turnoverCurrency",
  ] as const)
    assert.equal(sent[question], "not_applicable", question);
  assert.equal(sent.turnoverAmountKobo, null);
  assert.equal(sent.turnoverBand, "not_applicable");

  // Not knowing the turnover leaves the answers about the figure as they were given.
  const unknown = finaliseFacts(facts({ turnoverBand: "unknown", turnoverYear: "2025" }));
  assert.equal(unknown.turnoverYear, "2025");
  assert.equal(unknown.turnoverCurrency, "unanswered");
});

test("answers read back in the words the visitor chose, with turnover in naira", () => {
  assert.equal(displayFact("legalForm", "unknown"), "I do not know");
  assert.equal(displayFact("legalForm", "unanswered"), "Not answered");
  assert.equal(displayFact("employees", "not_applicable"), "Not applicable");
  assert.equal(displayFact("turnoverBand", "under_5m"), "Under ₦5 million");
  assert.equal(displayFact("turnoverBand", "5m_to_25m"), "₦5 million to ₦25 million");
  assert.equal(displayFact("turnoverBand", "25m_to_100m"), "₦25 million to ₦100 million");
  assert.equal(displayFact("turnoverBand", "over_100m"), "Over ₦100 million");
  assert.equal(displayFact("turnoverAmountKobo", "150000"), "₦1,500.00");
  assert.equal(displayFact("turnoverAmountKobo", null), "Not answered");
});
