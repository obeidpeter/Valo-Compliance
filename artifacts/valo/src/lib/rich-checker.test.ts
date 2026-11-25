import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NAMING_QUESTIONS,
  PARTNER_QUESTIONS,
  RULE_QUESTIONS,
} from "@workspace/valo-core/checker-questionnaire";
import { EMPTY_FACTS, displayFact, finaliseFacts, reviewFacts } from "./checker";
import {
  ANSWER_STATES,
  MISSING_ANSWER_STATE_LABELS,
  canCreateSourceTask,
  factAtPath,
  RESULT_LABELS,
  richQuestionTarget,
  updateRichAnswer,
  type RichCheckerFacts,
} from "./rich-checker";

test("rich review preserves known false, omitted answers and all three explicit states", () => {
  const facts: RichCheckerFacts = {
    ...EMPTY_FACTS,
    factsVersion: "checker-facts-v2",
    rich: {
      privacy: {
        processesPersonalData: false,
        commercialUse: { status: "unknown", value: null },
        newCollectionEvent: { status: "unanswered", value: null },
        ownPurposeReuse: { status: "not_applicable", value: null },
      },
    },
  };
  const rows = new Map(reviewFacts(facts));
  assert.equal(rows.has("rich.privacy.controllerRole"), false);
  assert.equal(
    displayFact("rich.privacy.processesPersonalData", rows.get("rich.privacy.processesPersonalData")),
    "No",
  );
  assert.equal(displayFact("x", undefined), "Not supplied");
  assert.equal(displayFact("x", rows.get("rich.privacy.commercialUse")), "I do not know");
  assert.equal(displayFact("x", rows.get("rich.privacy.newCollectionEvent")), "Skipped for now");
  assert.equal(displayFact("x", rows.get("rich.privacy.ownPurposeReuse")), "Not applicable");
});

test("changing the operator preserves partner and name answers, and editing a field preserves other groups", () => {
  const facts: RichCheckerFacts = {
    ...EMPTY_FACTS,
    rich: {
      businessName: {
        legalForm: "firm",
        businessName: "Ada and Ola",
        partners: [{ type: "individual", surname: "Ada", forenames: ["A"] }],
      },
      product: { manufacturesInNigeria: false },
    },
  };
  const changed = updateRichAnswer(facts, "businessName", "legalForm", "company");
  assert.deepEqual(changed.rich?.businessName?.partners, facts.rich?.businessName?.partners);
  assert.deepEqual(changed.rich?.product, facts.rich?.product);
  assert.equal(changed.rich?.businessName?.businessName, "Ada and Ola");
  const cleared = updateRichAnswer(changed, "businessName", "legalForm", undefined);
  assert.equal(Object.hasOwn(cleared.rich!.businessName!, "legalForm"), false);
  assert.equal(facts.rich?.businessName?.legalForm, "firm");
});

test("review and comparisons address nested partners and removed rich facts without object text", () => {
  const facts: RichCheckerFacts = {
    ...EMPTY_FACTS,
    rich: {
      businessName: {
        partners: [
          { surname: "Okafor", forenames: ["Ada", "Nneka"] },
          { surname: { status: "unknown", value: null } },
        ],
        namingAssessment: { otherBrandAddition: false },
      },
    },
  };
  const rows = new Map(reviewFacts(facts));
  assert.equal(rows.get("rich.businessName.partners.0.surname"), "Okafor");
  assert.equal(
    displayFact("rich.businessName.partners.0.forenames", rows.get("rich.businessName.partners.0.forenames")),
    "Ada; Nneka",
  );
  assert.equal(displayFact("x", factAtPath(facts, "rich.businessName.partners.1.surname")), "I do not know");
  assert.equal(
    displayFact("x", factAtPath({ ...EMPTY_FACTS }, "rich.businessName.partners.1.surname")),
    "Not supplied",
  );
  assert.doesNotMatch(displayFact("rich", facts.rich), /\[object Object\]/);
});

test("submission removes unfinished blank name rows without inventing answers or clearing conditional details", () => {
  const facts: RichCheckerFacts = {
    ...EMPTY_FACTS,
    rich: {
      businessName: {
        legalForm: "company",
        trueForenames: ["Ada", ""],
        partners: [{ surname: "", forenames: ["Bola", ""] }],
      },
      privacy: { processesPersonalData: false, ownPurposeReuse: { status: "unanswered", value: null } },
    },
  };
  const sent = finaliseFacts(facts);
  assert.deepEqual(sent.rich?.businessName?.trueForenames, ["Ada"]);
  assert.deepEqual(sent.rich?.businessName?.partners, [{ forenames: ["Bola"] }]);
  assert.equal(sent.rich?.privacy?.processesPersonalData, false);
  assert.deepEqual(sent.rich?.privacy?.ownPurposeReuse, { status: "unanswered", value: null });
  assert.deepEqual(facts.rich?.businessName?.trueForenames, ["Ada", ""]);
});

test("all four result labels are represented and server task restrictions override likely relevance", () => {
  assert.deepEqual(RESULT_LABELS, [
    "Likely relevant",
    "May apply",
    "More information needed",
    "Not indicated by these answers",
  ]);
  assert.equal(canCreateSourceTask({ label: "May apply", sourceLinkedTaskEligible: true }), false);
  assert.equal(canCreateSourceTask({ label: "Likely relevant", sourceLinkedTaskEligible: false }), false);
  assert.equal(canCreateSourceTask({ label: "Likely relevant", sourceLinkedTaskEligible: true }), true);
  assert.equal(canCreateSourceTask({ label: "Likely relevant" }), true);
});

test("exact names stay literal across review and grouped comparison", () => {
  assert.equal(displayFact("rich.businessName.businessName", "aCME_Services"), "aCME_Services");
  assert.equal(displayFact("rich.businessName.trueForenames", ["ada", "a_b"]), "ada; a_b");
  assert.equal(displayFact("rich.businessName.legalForm", "individual"), "Individual");
  assert.equal(
    displayFact("rich.privacy.dataCategories", ["employee_name", "bank_account"]),
    "Employee name; Bank account",
  );
  assert.match(displayFact("rich.businessName", { businessName: "aCME_Services" }), /aCME_Services/);
});

test("rich question targets cover every declared customer control, including support facts", () => {
  // The controls are the rules' questions in the questionnaire, which the panels draw.
  const groups = [
    [RULE_QUESTIONS.businessName, "businessName", "rich-businessName", 0],
    [RULE_QUESTIONS.privacy, "privacy", "rich-privacy", 4],
    [RULE_QUESTIONS.tax, "tax", "rich-tax", 0],
    [RULE_QUESTIONS.product, "product", "rich-product", 1],
    [NAMING_QUESTIONS, "businessName.namingAssessment", "rich-naming", 0],
    [PARTNER_QUESTIONS, "businessName.partners.0", "rich-partner-0", 0],
  ] as const;
  for (const [questions, path, prefix, step] of groups) {
    const keys = questions.map((question) => question.key);
    assert.ok(keys.length > 0);
    for (const key of keys) {
      const target = richQuestionTarget(`rich.${path}.${key}`);
      assert.equal(target?.id, `${prefix}-${key}-state`, `${path}.${key}`);
      assert.equal(target?.step, step);
    }
  }
  assert.equal(
    richQuestionTarget("rich.privacy.exceptionSupportingFacts")?.id,
    "rich-privacy-exceptionSupportingFacts-state",
  );
});

test("group and indexed question targets have real fallbacks while review aliases have no target", () => {
  for (const section of ["businessName", "privacy", "tax", "product"])
    assert.equal(richQuestionTarget(`rich.${section}`)?.id, `rich-${section}-summary`);
  assert.equal(richQuestionTarget("rich.businessName.partners")?.id, "rich-partners-add");
  assert.deepEqual(richQuestionTarget("rich.businessName.partners.29"), {
    section: "businessName",
    step: 0,
    id: "rich-partner-29-type-state",
    fallbackId: "rich-partners-add",
  });
  assert.equal(
    richQuestionTarget("rich.businessName.namingAssessment")?.id,
    "rich-naming-onlyAddedWordsIndicateSuccession-state",
  );
  assert.equal(
    richQuestionTarget("rich.businessName.partners.0.forenames.1")?.id,
    "rich-partner-0-forenames-state",
  );
  assert.equal(richQuestionTarget("rich.privacy.dataCategories.0")?.id, "rich-privacy-dataCategories-state");
  for (const path of [
    "rich.businessName.section814Exception",
    "rich.businessName.individual.surname",
    "rich.businessName.namingAssessment.successionNameComposition",
    "rich.privacy.verifiedIndirectCollectionException",
    "rich.tax.classificationUnderNtaaSection147",
    "rich.product.samplePermitAuthorityAndScope",
    "rich.product.manufacturesInNigeria/activity",
    "rich.businessName.partners.30.surname",
    "rich.businessName.partners.01.surname",
    "rich.privacy.dataCategories.20",
    "rich.privacy.commercialUse.0",
    "rich.privacy.sourceContext",
    "rich.missing.fact",
  ])
    assert.equal(richQuestionTarget(path), undefined, path);
  assert.deepEqual(ANSWER_STATES, ["unknown", "unanswered", "not_applicable"]);
  assert.equal(MISSING_ANSWER_STATE_LABELS.review, "Review this answer");
});
