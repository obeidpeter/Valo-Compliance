import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluateReleasedSourceFamily,
  richBusinessNameSchema,
  richPrivacySchema,
  richProductSchema,
  richTaxSchema,
  sourceFamilyAlgorithmHashes,
  type RichCheckerFacts,
} from "@workspace/valo-core";
import {
  NAMING_QUESTIONS,
  NOT_ANSWERED,
  PARTNER_QUESTIONS,
  RULE_FAMILIES,
  RULE_QUESTIONS,
  holds,
  ruleAnswersToSend,
  type RuleFamily,
  type RuleQuestion,
  type When,
} from "@workspace/valo-core/checker-questionnaire";
import { ownerRuleCandidates } from "../editorial/owner-rule-candidates";

/**
 * RUL-001: "irrelevant questions are skipped". Each rule's questions are asked by conditions written
 * to follow its calculation (`askedWhen` in checker-questionnaire.ts). This walks the questions, as a
 * visitor would answer them, and checks at every state that:
 * - everything the calculation says it still needs is a question asked now, so a visitor can always
 *   answer what a result asks for;
 * - changing a question that is not asked, to any of its answers, changes nothing the rule says, so
 *   skipping it, or keeping an answer it was given before, cannot change a result;
 * - what the check sends (`ruleAnswersToSend`), which leaves out the answers of the questions not
 *   asked, makes the rule say exactly what all the answers make it say, and everything it still needs
 *   is asked of what is sent, since the page asks by what it sends.
 * The calculations are pinned by their files' checksums, so the walk runs on the released ones.
 */

/** One question of a rule: where its answer is kept within the rule's answers, and its answers. */
type Asked = { path: string; askedWhen: When | undefined; answers: readonly unknown[] };

const ABSENT = Symbol("no answer");
const markers = NOT_ANSWERED.map((status) => ({ status, value: null }));

/** Answers in a visitor's own words, chosen to reach the calculations' comparisons of names. */
const TYPED: Record<string, readonly unknown[]> = {
  businessName: [
    "Bello",
    "Ade Bello",
    "A Bello",
    "Bello Ventures",
    "Sunrise Bakery",
    "Bello Successors to Okafor",
    "Bellos",
  ],
  trueSurname: ["Bello", "Okafor"],
  corporateName: ["Sunrise Bakery", "Bello Ventures"],
  trueForenames: [["Ade"], ["Ade", "Tunde"], []],
  recognizedAbbreviations: [["A"], []],
  exceptionSupportingFacts: ["Synthetic circumstances"],
};
const partner = (surname: string, forenames: unknown) => ({ type: "individual", surname, forenames });
const PARTNERS: readonly unknown[] = [
  [],
  [partner("Bello", ["Ade"])],
  [partner("Bello", ["Ade"]), partner("Bello", ["Tunde"])],
  [partner("Bello", ["Ade"]), partner("Okafor", ["Chi"])],
  [partner("Bello", ["Ade"]), { type: "corporation", corporateName: "Synthetic Partner Limited" }],
  [partner("Bello", ["Ade"]), partner("Okafor", { status: "unknown", value: null })],
  ...markers,
];

function answersOf(question: RuleQuestion): readonly unknown[] {
  const typed = TYPED[question.key];
  const choices = (question.choices ?? []).map((choice) => choice.value);
  switch (question.kind) {
    case "flag":
      return [true, false, ...markers];
    case "choice":
      return [...choices, ...markers];
    case "date":
      return ["2025-06-01", "2025-12-31", "2026-03-31", ...markers];
    case "list":
      return [
        ...(typed ??
          (choices.length ? [[choices[0]], [choices.at(-1)], choices.slice(0, 2), []] : [["Synthetic"]])),
        ...markers,
      ];
    default:
      return [...(typed ?? ["Synthetic answer"]), ...markers];
  }
}

/**
 * The answers a rule's schema takes that no question asks, with answers to try. The page cannot give
 * them, but a saved check can hold them. The walk treats each as a question never asked, so it proves
 * that no calculation reads them.
 */
const UNASKED: Readonly<Record<RuleFamily, Readonly<Record<string, readonly unknown[]>>>> = {
  businessName: {},
  tax: {
    onlyNigeriaIncome: ["yes", "no", "Synthetic answer", ...markers],
    finalTaxTreatment: ["final", "Synthetic answer", ...markers],
  },
  privacy: {},
  product: {},
};
const NEVER: When = { any: [] };

function questionsOf(family: RuleFamily): Asked[] {
  const own = [
    ...RULE_QUESTIONS[family].map((question) => ({
      path: question.key,
      askedWhen: question.askedWhen,
      answers: answersOf(question),
    })),
    ...Object.entries(UNASKED[family]).map(([path, answers]) => ({ path, askedWhen: NEVER, answers })),
  ];
  if (family !== "businessName") return own;
  return [
    ...own,
    ...NAMING_QUESTIONS.map((question) => ({
      path: `namingAssessment.${question.key}`,
      askedWhen: question.askedWhen,
      answers: answersOf(question),
    })),
    // The partners are asked as one list, with the same condition as each partner's questions.
    { path: "partners", askedWhen: PARTNER_QUESTIONS[0]!.askedWhen, answers: PARTNERS },
  ];
}

type Answers = Record<string, unknown>;
function read(answers: Answers, path: string): unknown {
  const [head, tail] = path.split(".") as [string, string?];
  const value = answers[head];
  return tail === undefined ? value : (value as Answers | undefined)?.[tail];
}
function withAnswer(answers: Answers, path: string, value: unknown): Answers {
  const [head, tail] = path.split(".") as [string, string?];
  const next = { ...answers };
  if (tail === undefined) {
    if (value === ABSENT) delete next[head];
    else next[head] = value;
    return next;
  }
  const group = { ...(next[head] as Answers | undefined) };
  if (value === ABSENT) delete group[tail];
  else group[tail] = value;
  if (Object.keys(group).length) next[head] = group;
  else delete next[head];
  return next;
}

const context = {
  manifestHash: "a".repeat(64),
  version: 1,
  sources: [{ id: "synthetic-source", snapshotHash: "b".repeat(64) }],
  asOfDate: "2026-11-25",
};
function evaluate(family: RuleFamily, answers: Answers) {
  return evaluateReleasedSourceFamily(
    { family, version: "source-family-v1", algorithmHash: sourceFamilyAlgorithmHashes[family] },
    { [family]: answers } as RichCheckerFacts,
    context,
  );
}
/** Everything the rule says that a visitor reads, remembered for answers seen before. */
const saidBefore = new Map<string, string>();
function said(family: RuleFamily, answers: Answers): string {
  const key = family + JSON.stringify(answers);
  const known = saidBefore.get(key);
  if (known !== undefined) return known;
  const result = evaluate(family, answers);
  const text = JSON.stringify([
    result.label,
    result.reason,
    result.missingAnswerStates,
    result.sourceReviewHold ?? null,
    result.nextStep,
    result.sourceLinkedTaskEligible,
  ]);
  saidBefore.set(key, text);
  return text;
}
const isAsked = (family: RuleFamily, question: Asked, answers: Answers) =>
  !question.askedWhen || holds(question.askedWhen, { rich: { [family]: answers } });
/** What the check sends of these answers, for this rule alone. */
const sentOf = (family: RuleFamily, answers: Answers): Answers =>
  ruleAnswersToSend({ rich: { [family]: answers } }, new Set([family]))[family] ?? {};

/** The fields the rule still needs that no question asked of these answers asks. */
function unasked(family: RuleFamily, questions: readonly Asked[], answers: Answers): string[] {
  const asked = questions.filter((question) => isAsked(family, question, answers));
  return evaluate(family, answers)
    .missingAnswerStates.map(({ field }) => field.replace(`rich.${family}.`, ""))
    .filter(
      (path) =>
        !asked.some(
          (question) =>
            question.path === path ||
            (path.startsWith("partners") && question.path === "partners") ||
            (path === "namingAssessment" && question.path.startsWith("namingAssessment.")),
        ),
    );
}

/** The problems with one state of a rule's answers. */
function problems(family: RuleFamily, questions: readonly Asked[], answers: Answers): string[] {
  const found: string[] = [];
  const asked = questions.filter((question) => isAsked(family, question, answers));
  for (const path of unasked(family, questions, answers))
    found.push(`${path} is still needed, but not asked: ${JSON.stringify(answers)}`);
  const sent = sentOf(family, answers);
  if (said(family, sent) !== said(family, answers))
    found.push(`what is sent changes what the rule says: ${JSON.stringify(answers)}`);
  for (const path of unasked(family, questions, sent))
    found.push(`${path} is still needed, but not asked of what is sent: ${JSON.stringify(sent)}`);
  for (const question of questions) {
    if (asked.includes(question)) continue;
    const without = said(family, withAnswer(answers, question.path, ABSENT));
    for (const value of question.answers)
      if (said(family, withAnswer(answers, question.path, value)) !== without)
        found.push(
          `${question.path} = ${JSON.stringify(value)} changes the result, but is not asked: ${JSON.stringify(answers)}`,
        );
  }
  return found;
}

/** A seeded walk through one rule's questions, as a visitor answers, changes and skips them. */
function walk(family: RuleFamily, runs: number, steps: number) {
  const questions = questionsOf(family);
  let seed = 20261125 + family.length;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = <T>(list: readonly T[]) => list[Math.floor(next() * list.length)]!;
  const isMarker = (value: unknown) => typeof value === "object" && value !== null && "status" in value;
  const found = new Set<string>();
  const reached = new Map<string, number>();
  let states = 0;
  // Half the walks start from one of the rule's prepared scenarios, which reach deep into it.
  const starts = ownerRuleCandidates
    .filter((candidate) => candidate.rule.evaluator?.family === family)
    .flatMap((candidate) => candidate.scenarios.map((each) => (each.facts.rich?.[family] ?? {}) as Answers));
  for (let run = 0; run < runs; run++) {
    let answers: Answers = run % 2 && starts.length ? pick(starts) : {};
    for (let step = 0; step < steps; step++) {
      const asked = questions.filter((question) => isAsked(family, question, answers));
      const open = asked.filter((question) => read(answers, question.path) === undefined);
      const given = questions.filter((question) => read(answers, question.path) !== undefined);
      const roll = next();
      // Mostly the next unanswered question; sometimes a change to one already answered, which can
      // leave later answers hidden.
      const question =
        open.length && roll < 0.8 ? pick(open) : given.length && roll > 0.93 ? pick(given) : pick(asked);
      // Mostly an answer, so that the walk reaches the later questions; sometimes a way of not
      // answering, or none.
      const real = question.answers.filter((value) => !isMarker(value));
      const value =
        real.length && next() < 0.75 ? pick(real) : pick([...question.answers.filter(isMarker), ABSENT]);
      answers = withAnswer(answers, question.path, value);
      for (const problem of problems(family, questions, answers)) found.add(problem);
      for (const each of questions)
        if (isAsked(family, each, answers)) reached.set(each.path, (reached.get(each.path) ?? 0) + 1);
      states++;
    }
  }
  return { states, found: [...found], reached, questions };
}

/** The questions no rule's calculation reads, which are never asked, and the answers no question asks. */
const NEVER_ASKED = {
  businessName: [],
  tax: ["onlyNigeriaIncome", "finalTaxTreatment"],
  privacy: ["dataSubjectAlreadyInformed"],
  product: ["registrationCoversExactProductAndManufacturer", "registrationConditionsChanged"],
} as const satisfies Record<RuleFamily, readonly string[]>;

test("every answer a rule's schema takes is one of its questions, or one the walk tries as never asked", () => {
  const schemas = {
    businessName: richBusinessNameSchema,
    tax: richTaxSchema,
    privacy: richPrivacySchema,
    product: richProductSchema,
  };
  for (const family of RULE_FAMILIES) {
    const asked = new Set([
      ...RULE_QUESTIONS[family].map((question) => question.key),
      "namingAssessment",
      "partners",
    ]);
    assert.deepEqual(
      Object.keys(schemas[family].shape).filter((key) => !asked.has(key)),
      Object.keys(UNASKED[family]),
      family,
    );
  }
});

for (const family of RULE_FAMILIES)
  test(`the ${family} rule's questions are asked whenever their answer can change what the rule says`, () => {
    const { states, found, reached, questions } = walk(family, family === "businessName" ? 160 : 160, 24);
    assert.ok(states >= 3800, `${states} states were checked`);
    const kinds = [
      ...new Set(
        found.map((problem) =>
          problem
            .replace(/ = .* changes the result.*/, " changes")
            .replace(/ is still needed.*/, " is needed")
            .replace(/ changes what the rule says.*/, " changes what the rule says"),
        ),
      ),
    ];
    assert.deepEqual(kinds, [], `${found.length} problems, the first: ${found[0]}`);
    // The walk reached every question a visitor can be asked, often.
    assert.deepEqual(
      questions.filter((question) => (reached.get(question.path) ?? 0) < 20).map((question) => question.path),
      NEVER_ASKED[family],
    );
  });

test("each prepared rule's scenarios are asked by the same conditions", () => {
  let checked = 0;
  for (const candidate of ownerRuleCandidates) {
    const family = candidate.rule.evaluator!.family;
    const questions = questionsOf(family);
    for (const scenario of candidate.scenarios) {
      const answers = (scenario.facts.rich?.[family] ?? {}) as Answers;
      assert.deepEqual(problems(family, questions, answers), [], `${family}: ${scenario.id}`);
      checked++;
    }
  }
  assert.ok(checked >= 40, `${checked} scenarios were checked`);
});
