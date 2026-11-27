import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assess,
  checkerFactsSchema,
  explainAssessmentChanges,
  planRuleRelease,
  restoredRuleVersion,
  ruleSchema,
  type ReleasedRule,
  type RuleScenario,
} from "@workspace/valo-core";

const now = new Date("2026-11-14T12:00:00Z");
const asOfDate = "2026-11-14";
const facts = (changes: Record<string, unknown> = {}) =>
  checkerFactsSchema.parse({
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
    ...changes,
  });

/** In-memory engine fixtures only: nothing is written to a registry, and the engine runs a
 * synthetic_fixture rule only in fixtureMode, which the HTTP service never supplies. */
const rule = (version: number, field: string, value: string): ReleasedRule =>
  ruleSchema.parse({
    id: "synthetic-release-rule",
    version,
    requirementVersionId: "synthetic-controlled-only",
    title: "Synthetic release rule; not released guidance",
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
        title: "Synthetic source",
        locator: "section 1",
        quote: "Synthetic provision for a controlled test.",
        snapshotHash: "b".repeat(64),
      },
    ],
    condition: { mode: "all", predicates: [{ field, op: "eq", value }] },
    reason: "Synthetic reason.",
    nextStep: "Synthetic next step.",
    relatedTemplateIds: [],
  });

const run = { now, asOfDate, fixtureMode: true };
const first = rule(1, "premises", "yes");
const second = rule(2, "legalForm", "company");
const critical: RuleScenario = {
  id: "company-matches",
  facts: facts(),
  asOfDate,
  expectedLabel: "Likely relevant",
  critical: true,
};

// ADM-004: "Validate condition schemas, preview affected profiles and run regression scenarios
// before publishing a new ruleset", accepted when "failed critical tests block release".
test("a rule version is ready only with a valid condition, the next version and passing critical scenarios", () => {
  const profiles = [facts(), facts({ legalForm: "individual" })];
  const plan = planRuleRelease({
    candidate: second,
    current: [first],
    scenarios: [critical],
    profiles,
    ...run,
  });
  assert.equal(plan.decision, "ready");
  assert.deepEqual(plan.reasons, []);
  // Each scenario also says what the customer would be told: the rule's own reason and next step
  // when it applies, as the requirements check gives them.
  assert.deepEqual(plan.scenarios, [
    {
      id: "company-matches",
      critical: true,
      expectedLabel: "Likely relevant",
      actualLabel: "Likely relevant",
      actualReason: "Synthetic reason.",
      actualNextStep: "Synthetic next step.",
      passed: true,
    },
  ]);
  // The preview shows whose result would change: the company's, from needing an answer to likely.
  assert.equal(plan.affected.profiles, 2);
  assert.deepEqual(
    plan.affected.changes.map(({ profile, change }) => [
      profile,
      change.previousLabel,
      change.currentLabel,
      change.currentVersion,
    ]),
    [
      [0, "More information needed", "Likely relevant", 2],
      [1, "More information needed", "Not indicated by these answers", 2],
    ],
  );

  const blocked = (candidate: unknown, scenarios = [critical]) =>
    planRuleRelease({ candidate, current: [first], scenarios, profiles, ...run });
  // A condition the schema refuses: a numeric comparison on a text fact.
  const invalid = {
    ...second,
    condition: { mode: "all", predicates: [{ field: "legalForm", op: "lt", value: 3 }] },
  };
  assert.equal(blocked(invalid).decision, "blocked");
  assert.ok(
    blocked(invalid).reasons.every((r) => r.startsWith("condition_schema_invalid")),
    blocked(invalid).reasons.join(),
  );
  // A skipped or repeated version.
  assert.deepEqual(blocked(rule(3, "legalForm", "company")).reasons, ["version_not_next"]);
  assert.deepEqual(blocked(rule(1, "legalForm", "company")).reasons, ["version_not_next"]);
  // A failed critical scenario blocks; a failed other one is only reported.
  const wrong = {
    ...critical,
    id: "company-must-not-match",
    expectedLabel: "Not indicated by these answers",
  };
  assert.deepEqual(blocked(second, [wrong]).reasons, ["critical_scenario_failed:company-must-not-match"]);
  const report = blocked(second, [critical, { ...wrong, critical: false }]);
  assert.equal(report.decision, "ready");
  assert.deepEqual(
    report.scenarios.map((s) => s.passed),
    [true, false],
  );
  // Without a critical scenario nothing is ready.
  assert.deepEqual(blocked(second, [{ ...critical, critical: false }]).reasons, ["no_critical_scenario"]);
});

// ADM-004: accepted when "prior versions can be restored without losing assessment history".
test("restoring a prior rule version releases it again as the next version and changes no saved result", () => {
  const history = [first, second];
  const savedBefore = assess(facts(), [first], asOfDate, now, { fixtureMode: true });
  const restored = restoredRuleVersion(history, first.id, 1);
  assert.equal(restored.version, 3);
  assert.deepEqual(restored.condition, first.condition);
  // The history is unchanged, and a result saved under version 1 still reproduces exactly.
  assert.deepEqual(history, [first, second]);
  assert.equal(
    assess(facts(), [first], asOfDate, now, { fixtureMode: true }).resultHash,
    savedBefore.resultHash,
  );
  // The restored version goes through the same plan, and the comparison says what changed back.
  const plan = planRuleRelease({
    candidate: restored,
    current: history.filter((r) => r.version === 2),
    scenarios: [{ ...critical, expectedLabel: "More information needed" }],
    profiles: [facts()],
    ...run,
  });
  assert.equal(plan.decision, "ready");
  const [change] = explainAssessmentChanges(
    assess(facts(), [second], asOfDate, now, { fixtureMode: true }).items,
    assess(facts(), [restored], asOfDate, now, { fixtureMode: true }).items,
    [],
  );
  assert.deepEqual(
    [change?.previousVersion, change?.currentVersion, change?.currentLabel],
    [2, 3, "More information needed"],
  );
  assert.throws(() => restoredRuleVersion(history, first.id, 2), /RULE_VERSION_ALREADY_CURRENT/);
  assert.throws(() => restoredRuleVersion(history, first.id, 7), /RULE_VERSION_UNKNOWN/);
});
