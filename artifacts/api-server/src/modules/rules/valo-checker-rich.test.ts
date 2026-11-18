import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  assess,
  checkerFactsSchema,
  ruleSchema,
  type CheckerFacts,
  type ReleasedRule,
} from "@workspace/valo-core";
import {
  changedCheckerFactPaths,
  sourceFamilyAlgorithmHashes,
  type RichCheckerFacts,
} from "@workspace/valo-core";
import { digest } from "@workspace/valo-core";
import { PreviewAssessmentBody, PreviewAssessmentResponse, GetAssessmentResponse } from "@workspace/api-zod";

const now = new Date("2026-11-14T12:00:00Z");
const asOfDate = "2026-11-14";
const legacy = checkerFactsSchema.parse({
  legalForm: "company",
  registrationStatus: "registered",
  activities: ["retail"],
  state: "Lagos",
  lga: "unknown",
  employees: "unknown",
  turnoverBand: "unknown",
  turnoverYear: "unknown",
  turnoverMetric: "gross_revenue",
  turnoverCurrency: "NGN",
  premises: "unknown",
  manufacturing: "no",
  importing: "no",
  personalData: "unknown",
});
const marker = (status: "unknown" | "unanswered" | "not_applicable") => ({ status, value: null });
const facts = (rich: RichCheckerFacts): CheckerFacts =>
  checkerFactsSchema.parse({ ...legacy, factsVersion: "checker-facts-v2", rich });

/** In-memory engine fixture only: no manifest, content or rule is written to a
 * registry. Production assess rejects this provenance unless fixtureMode is an
 * explicit internal test option; the HTTP service never supplies that option. */
function fixture(family: keyof typeof sourceFamilyAlgorithmHashes): ReleasedRule {
  return ruleSchema.parse({
    id: `synthetic-rich-${family}`,
    version: 1,
    requirementVersionId: "synthetic-controlled-only",
    title: "Controlled source-family adapter test; not released guidance",
    jurisdiction: { level: "federal" },
    validFrom: "2026-01-01",
    validTo: null,
    sourceCheckedAt: "2026-11-01T00:00:00Z",
    reviewBy: "2026-12-01T00:00:00Z",
    status: "published",
    provenance: "synthetic_fixture",
    manifestHash: "a".repeat(64),
    sources: [
      {
        id: "synthetic-source",
        url: "https://example.test/controlled",
        title: "Controlled source binding",
        locator: "test only",
        quote: "Not publication evidence",
        snapshotHash: "b".repeat(64),
      },
    ],
    evaluator: { family, version: "source-family-v1", algorithmHash: sourceFamilyAlgorithmHashes[family] },
    reason: "Controlled adapter check",
    nextStep: "No external action",
    relatedTemplateIds: [],
  });
}
function evaluate(family: keyof typeof sourceFamilyAlgorithmHashes, rich: RichCheckerFacts) {
  return assess(facts(rich), [fixture(family)], asOfDate, now, { fixtureMode: true });
}
const nameBase = {
  legalForm: "individual",
  hasPlaceOfBusinessInNigeria: true,
  carryingOnBusiness: true,
  businessName: "Example Studio",
  trueSurname: "Example",
  trueForenames: ["Ada"],
  operatorRole: "proprietor",
  namingAssessment: {
    onlyAddedWordsIndicateSuccession: false,
    onlyAdditionIsPluralS: false,
    otherBrandAddition: true,
  },
} as const;

test("old v1 result/hash and generated saved response remain unchanged", () => {
  const result = assess(legacy, [], asOfDate, now);
  // Captured by executing the unchanged base-head v1 engine with these inputs.
  assert.equal(result.resultHash, "4d106813d86b2e328264d113807beea64666854d9692d44bae553af03802ea04");
  const saved = {
    id: "controlled-snapshot",
    profileRevision: null,
    facts: legacy,
    result,
    createdAt: now.toISOString(),
  };
  assert.deepEqual(GetAssessmentResponse.parse(saved), saved);
  assert.equal(Object.hasOwn(saved.facts, "rich"), false);
  assert.equal(Object.hasOwn(saved.facts, "factsVersion"), false);
});

test("v2 preserves known false, absence and all three marker states through request/save schemas", () => {
  const f = facts({
    privacy: {
      processesPersonalData: false,
      operatesInNigeria: marker("unknown"),
      processingOccursInNigeria: marker("unanswered"),
      dataSubjectsInNigeria: marker("not_applicable"),
    },
    tax: { accountingPeriodStart: "2026-01-01", accountingPeriodEnd: "2026-11-01" },
  });
  const request = PreviewAssessmentBody.parse({ facts: f, asOfDate });
  assert.deepEqual(request.facts, f);
  const result = assess(f, [], asOfDate, now);
  const saved = GetAssessmentResponse.parse({
    id: "v2",
    profileRevision: null,
    facts: f,
    result,
    createdAt: now.toISOString(),
  });
  assert.equal(typeof saved.facts.rich?.tax?.accountingPeriodStart, "string");
  assert.equal(digest(saved.facts), digest(f));
  assert.equal(saved.result.resultHash, result.resultHash);
  assert.equal(Object.hasOwn(saved.facts.rich!.privacy!, "controllerRole"), false);
  assert.equal(result.items.length, 0);
  assert.equal(result.schemaVersion, "checker-v2");
});

test("version and client evidence injection are rejected without source policy coercion", () => {
  assert.equal(checkerFactsSchema.safeParse({ ...legacy, rich: { privacy: {} } }).success, false);
  for (const injected of [
    { rich: { privacy: { sourceContext: { mode: "approved" } } } },
    { rich: { privacy: { eligibleForCustomerUse: true } } },
    { rich: { manifestHash: "a".repeat(64) } },
    { sourceContext: { mode: "approved" }, rich: {} },
  ])
    assert.equal(
      checkerFactsSchema.safeParse({ ...legacy, factsVersion: "checker-facts-v2", ...injected }).success,
      false,
    );
  assert.equal(
    checkerFactsSchema.safeParse({
      ...legacy,
      factsVersion: "checker-facts-v2",
      rich: { tax: { accountingPeriodStart: "2026-02-01", accountingPeriodEnd: "2026-01-01" } },
    }).success,
    false,
  );
  assert.equal(
    checkerFactsSchema.safeParse({
      ...legacy,
      factsVersion: "checker-facts-v2",
      rich: { tax: { accountingPeriodStart: "2026-02-30" } },
    }).success,
    false,
  );
  assert.equal(
    checkerFactsSchema.safeParse({
      ...legacy,
      factsVersion: "checker-facts-v2",
      rich: {
        businessName: {
          partners: Array.from({ length: 30 }, () => ({
            surname: "Example",
            forenames: Array.from({ length: 20 }, () => "x".repeat(150)),
          })),
        },
      },
    }).success,
    false,
  );
});

test("four outcomes traverse the real engine and generated response contract in private fixture mode", () => {
  const cases: [keyof typeof sourceFamilyAlgorithmHashes, RichCheckerFacts, string][] = [
    ["businessName", { businessName: { ...nameBase, trueForenames: ["Ada"] } }, "Likely relevant"],
    [
      "businessName",
      { businessName: { ...nameBase, trueForenames: ["Ada"], businessName: "Ada Example" } },
      "Not indicated by these answers",
    ],
    [
      "businessName",
      {
        businessName: {
          legalForm: "company",
          hasPlaceOfBusinessInNigeria: true,
          carryingOnBusiness: true,
          businessName: "Example Shop",
          corporateName: "Example Limited",
          operatorRole: "receiver",
          appointmentAuthority: marker("unknown"),
        },
      },
      "More information needed",
    ],
    [
      "privacy",
      {
        privacy: {
          processesPersonalData: true,
          controllerRole: "controller",
          collectionMethod: "indirect",
          operatesInNigeria: true,
          dataSubjectAlreadyInformed: "claimed_not_verified",
          section3Exception: "none",
        },
      },
      "May apply",
    ],
  ];
  for (const [family, input, label] of cases) {
    const first = evaluate(family, input),
      again = evaluate(family, input);
    assert.equal(first.items[0]!.label, label);
    assert.equal(first.resultHash, again.resultHash);
    assert.deepEqual(PreviewAssessmentResponse.parse(first), first);
    assert.ok(first.items[0]!.assessedProposition);
    assert.match(first.items[0]!.factsNotice!, /not been independently verified/);
    if (label !== "Likely relevant") assert.equal(first.items[0]!.sourceLinkedTaskEligible, false);
  }
});

test("all partners matter; unknown appointment and unknown exception facts do not become a negative", () => {
  const input: RichCheckerFacts = {
    businessName: {
      ...nameBase,
      trueForenames: ["Ada"],
      legalForm: "firm",
      businessName: "Example Second",
      partners: [
        { type: "individual", surname: "Example", forenames: ["Ada"] },
        { type: "individual", surname: "Second", forenames: ["Bola"] },
      ],
    },
  };
  assert.equal(evaluate("businessName", input).items[0]!.label, "Not indicated by these answers");
  input.businessName!.businessName = "Ada Example";
  assert.equal(evaluate("businessName", input).items[0]!.label, "Likely relevant");
  delete input.businessName!.namingAssessment;
  assert.equal(evaluate("businessName", input).items[0]!.label, "More information needed");
});

test("household context never fills an omitted purpose or upgrades uncertainty into exemption", () => {
  const base = {
    processesPersonalData: true,
    operatesInNigeria: true,
    controllerRole: "controller" as const,
    collectionMethod: "direct" as const,
    section3Exception: "personal_household" as const,
    commercialUse: false,
    privacyRightsViolationIndicated: false,
  };
  for (const purpose of [undefined, marker("unknown"), marker("unanswered"), marker("not_applicable")]) {
    const input = facts({
      privacy: { ...base, ...(purpose === undefined ? {} : { processingPurpose: purpose }) },
    });
    const before = digest(input);
    const result = assess(input, [fixture("privacy")], asOfDate, now, { fixtureMode: true });
    assert.equal(result.items[0]!.label, "More information needed");
    assert.equal(digest(input), before);
    assert.equal(result.items[0]!.missingAnswerStates![0]!.state, purpose?.status ?? "unanswered");
  }
  assert.equal(
    evaluate("privacy", { privacy: { ...base, processingPurpose: "solely_personal_household" } }).items[0]!
      .label,
    "Not indicated by these answers",
  );
});

test("unknown operator and derived exception questions map back to actual supplied answers", () => {
  const unknownRole: RichCheckerFacts = {
    businessName: { ...nameBase, trueForenames: ["Ada"], operatorRole: marker("unknown") },
  };
  const item = evaluate("businessName", unknownRole).items[0];
  assert.ok(item);
  assert.equal(item.label, "More information needed");
  assert.equal(item.sourceLinkedTaskEligible, false);
  assert.deepEqual(item.missingAnswerStates, [{ field: "rich.businessName.operatorRole", state: "unknown" }]);
  const missingName = evaluate("businessName", {
    businessName: { ...nameBase, trueForenames: marker("not_applicable"), trueSurname: marker("unknown") },
  }).items[0];
  assert.ok(missingName);
  assert.deepEqual(missingName.missingAnswerStates, [
    { field: "rich.businessName.trueSurname", state: "unknown" },
    { field: "rich.businessName.trueForenames", state: "not_applicable" },
  ]);
  const unknownComposition = evaluate("businessName", {
    businessName: {
      ...nameBase,
      trueForenames: ["Ada"],
      namingAssessment: {
        onlyAddedWordsIndicateSuccession: marker("unknown"),
        onlyAdditionIsPluralS: marker("not_applicable"),
      },
    },
  }).items[0];
  assert.ok(unknownComposition);
  assert.equal(
    unknownComposition.missingFacts.some((f) => f.endsWith("section814Exception")),
    false,
  );
  assert.deepEqual(unknownComposition.missingAnswerStates, [
    { field: "rich.businessName.namingAssessment.onlyAddedWordsIndicateSuccession", state: "unknown" },
    { field: "rich.businessName.namingAssessment.onlyAdditionIsPluralS", state: "not_applicable" },
  ]);
});

test("period and product questions retain their narrow scope without an automatic date or duplicate application", () => {
  const tax = evaluate("tax", {
    tax: {
      legalForm: "company",
      incorporatedInNigeria: true,
      accountingPeriodStart: "2025-07-01",
      accountingPeriodEnd: "2026-06-30",
    },
  });
  assert.equal(tax.items[0]!.label, "May apply");
  const product = evaluate("product", {
    product: {
      productCategory: "processed_food",
      manufacturesInNigeria: true,
      commercialSupplyInNigeria: true,
      productRegistration: "current_for_product_and_manufacturer",
      registrationCoversExactProductAndManufacturer: true,
    },
  });
  assert.equal(product.items[0]!.label, "Likely relevant");
  assert.equal(product.items[0]!.sourceLinkedTaskEligible, false);
  assert.match(product.items[0]!.nextStep, /do not create a duplicate/);
  assert.equal(Object.hasOwn(product.items[0]!, "dueDate"), false);
});

test("source-family implementation, publication, period and freshness gates fail closed", () => {
  const f = facts({ privacy: { processesPersonalData: true } }),
    r = fixture("privacy");
  assert.equal(assess(f, [r], asOfDate, now).items.length, 0);
  assert.equal(assess(f, [{ ...r, provenance: "editorial_release" }], asOfDate, now).items.length, 0);
  for (const altered of [
    { ...r, status: "withdrawn" as const },
    { ...r, reviewBy: "2026-11-13T00:00:00Z" },
    { ...r, validFrom: "2026-11-15" },
    { ...r, evaluator: { ...r.evaluator!, algorithmHash: "c".repeat(64) } },
  ])
    assert.equal(assess(f, [altered], asOfDate, now, { fixtureMode: true }).items.length, 0);
  assert.equal(
    ruleSchema.safeParse({
      ...r,
      condition: { mode: "all", predicates: [{ field: "legalForm", op: "eq", value: "company" }] },
    }).success,
    false,
  );
  assert.equal(
    ruleSchema.safeParse({ ...r, jurisdiction: { level: "state", state: "Lagos" } }).success,
    false,
  );
});

test("comparison identifies removed and changed nested answers without flattening marker states", () => {
  const before = {
    rich: {
      businessName: { partners: [{ surname: "One" }, { surname: "Two" }] },
      privacy: { operatesInNigeria: marker("unknown"), profiling: false },
    },
  };
  const after = {
    rich: {
      businessName: { partners: [{ surname: "One" }] },
      privacy: { operatesInNigeria: marker("not_applicable") },
    },
  };
  assert.deepEqual(changedCheckerFactPaths(before, after), [
    "rich.businessName.partners.1",
    "rich.privacy.operatesInNigeria",
    "rich.privacy.profiling",
  ]);
  assert.deepEqual(changedCheckerFactPaths(before, before), []);
  assert.deepEqual(changedCheckerFactPaths({ rich: { privacy: { profiling: false } } }, {}), ["rich"]);
});

test("original source candidate bytes remain bound and unchanged", () => {
  for (const [file, key] of [
    ["checker-business-name.ts", "businessName"],
    ["checker-source-candidates.ts", "privacy"],
  ] as const) {
    const hash = createHash("sha256")
      .update(readFileSync(new URL(`../../../../../lib/valo-core/src/${file}`, import.meta.url)))
      .digest("hex");
    assert.equal(hash, sourceFamilyAlgorithmHashes[key]);
  }
});

test("composite privacy questions preserve each original marker and target actual facts", () => {
  const result = evaluate("privacy", {
    privacy: {
      processesPersonalData: true,
      operatesInNigeria: true,
      processingPurpose: "solely_personal_household",
      section3Exception: "personal_household",
      commercialUse: marker("unknown"),
      privacyRightsViolationIndicated: marker("not_applicable"),
    },
  });
  assert.deepEqual(result.items[0]!.missingAnswerStates, [
    { field: "rich.privacy.commercialUse", state: "unknown" },
    { field: "rich.privacy.privacyRightsViolationIndicated", state: "not_applicable" },
  ]);
  const one = evaluate("privacy", {
    privacy: {
      processesPersonalData: true,
      operatesInNigeria: true,
      processingPurpose: "solely_personal_household",
      section3Exception: "personal_household",
      commercialUse: false,
      privacyRightsViolationIndicated: marker("unknown"),
    },
  });
  assert.deepEqual(one.items[0]!.missingFacts, ["rich.privacy.privacyRightsViolationIndicated"]);
});

test("contradictory formation and personal-data facts ask for review without changing known answers", () => {
  const input = facts({ tax: { legalForm: "foreign_company", incorporatedInNigeria: true } });
  const result = assess(input, [fixture("tax")], asOfDate, now, { fixtureMode: true });
  assert.deepEqual(result.items[0]!.missingAnswerStates, [
    { field: "rich.tax.legalForm", state: "review" },
    { field: "rich.tax.incorporatedInNigeria", state: "review" },
  ]);
  assert.equal(input.rich!.tax!.incorporatedInNigeria, true);
  const data = evaluate("privacy", {
    privacy: { processesPersonalData: false, dataCategories: ["employee_name"], profiling: true },
  });
  assert.deepEqual(data.items[0]!.missingFacts, [
    "rich.privacy.processesPersonalData",
    "rich.privacy.dataCategories",
    "rich.privacy.profiling",
  ]);
  assert.ok(data.items[0]!.missingAnswerStates?.every((m) => m.state === "review"));
  assert.deepEqual(PreviewAssessmentResponse.parse(result), result);
});

test("authority-only classifications are explicit source holds without invented customer questions", () => {
  for (const result of [
    evaluate("tax", { tax: { legalForm: "ordinary_unincorporated_partnership" } }),
    evaluate("privacy", {
      privacy: {
        processesPersonalData: true,
        operatesInNigeria: true,
        controllerRole: "controller",
        collectionMethod: "indirect",
      },
    }),
  ]) {
    const item = result.items[0];
    assert.ok(item);
    assert.deepEqual(item.missingFacts, []);
    assert.deepEqual(item.missingAnswerStates, []);
    assert.match(item.sourceReviewHold!, /Valo needs source review/);
    assert.equal(item.sourceLinkedTaskEligible, false);
    assert.deepEqual(PreviewAssessmentResponse.parse(result), result);
  }
});

test("indirect supporting circumstances remain answerable but cannot certify an exception", () => {
  const base = {
    processesPersonalData: true,
    operatesInNigeria: true,
    controllerRole: "controller",
    collectionMethod: "indirect",
    indirectNoticeException: "disproportionate_effort_claim",
  } as const;
  const missing = evaluate("privacy", { privacy: { ...base, exceptionSupportingFacts: marker("unknown") } })
    .items[0];
  assert.ok(missing);
  assert.deepEqual(missing.missingAnswerStates, [
    { field: "rich.privacy.exceptionSupportingFacts", state: "unknown" },
  ]);
  const supplied = evaluate("privacy", {
    privacy: { ...base, exceptionSupportingFacts: "An old supplier record has no current contact route." },
  }).items[0];
  assert.ok(supplied);
  assert.deepEqual(supplied.missingFacts, []);
  assert.match(supplied.sourceReviewHold!, /supplied indirect-collection circumstances/);
  assert.equal(supplied.sourceLinkedTaskEligible, false);
});

test("product composite questions retain markers and separate permit authority review", () => {
  const result = evaluate("product", {
    product: {
      productCategory: "cosmetic",
      activity: "sample_for_registration_only",
      specialSamplePermit: marker("unknown"),
      permitScopeMatchesActivity: marker("not_applicable"),
      permitConditionsSatisfied: marker("unanswered"),
    },
  }).items[0];
  assert.ok(result);
  assert.deepEqual(result.missingAnswerStates, [
    { field: "rich.product.specialSamplePermit", state: "unknown" },
    { field: "rich.product.permitScopeMatchesActivity", state: "not_applicable" },
    { field: "rich.product.permitConditionsSatisfied", state: "unanswered" },
  ]);
  assert.match(result.sourceReviewHold!, /permit's authority/);
  assert.equal(result.sourceLinkedTaskEligible, false);
  const activity = evaluate("product", {
    product: {
      productCategory: "cosmetic",
      manufacturesInNigeria: marker("unknown"),
      activity: marker("not_applicable"),
      commercialSupplyInNigeria: false,
    },
  }).items[0];
  assert.ok(activity);
  assert.deepEqual(activity.missingAnswerStates, [
    { field: "rich.product.manufacturesInNigeria", state: "unknown" },
    { field: "rich.product.activity", state: "not_applicable" },
  ]);
});

test("unsupported succession composition points to real name facts and a source-review hold", () => {
  const item = evaluate("businessName", {
    businessName: {
      ...nameBase,
      trueForenames: ["Ada"],
      namingAssessment: { onlyAddedWordsIndicateSuccession: true, otherBrandAddition: false },
    },
  }).items[0];
  assert.ok(item);
  assert.deepEqual(item.missingFacts, [
    "rich.businessName.businessName",
    "rich.businessName.namingAssessment.onlyAddedWordsIndicateSuccession",
    "rich.businessName.namingAssessment.otherBrandAddition",
  ]);
  assert.match(item.sourceReviewHold!, /succession-name composition/);
  assert.equal(item.sourceLinkedTaskEligible, false);
});

test("known unsupported classifications cannot be fixed by asserting a legal conclusion", () => {
  const tax = evaluate("tax", {
    tax: {
      legalForm: "foreign_company",
      incorporatedInNigeria: false,
      effectiveManagementCountry: "outside_Nigeria",
    },
  }).items[0];
  assert.ok(tax);
  assert.deepEqual(tax.missingFacts, []);
  assert.match(tax.sourceReviewHold!, /does not establish tax residence/);
  const names = evaluate("businessName", {
    businessName: {
      legalForm: "firm",
      hasPlaceOfBusinessInNigeria: true,
      carryingOnBusiness: true,
      businessName: "Example Partnership",
      operatorRole: "proprietor",
      partners: [
        { type: "corporation", corporateName: "Example Limited" },
        { type: "individual", surname: "Example", forenames: ["Ada"] },
      ],
    },
  }).items[0];
  assert.ok(names);
  assert.deepEqual(names.missingFacts, []);
  assert.match(names.sourceReviewHold!, /corporate-partner firms/);
  assert.equal(names.sourceLinkedTaskEligible, false);
});
