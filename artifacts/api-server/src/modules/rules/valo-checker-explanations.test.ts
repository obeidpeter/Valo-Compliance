import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assess,
  checkerFactsSchema,
  comparableItemDigest,
  explainAssessmentChanges,
  factNames,
  ruleSchema,
  type ReleasedRule,
} from "@workspace/valo-core";

const now = new Date("2026-11-14T12:00:00Z");
const asOfDate = "2026-11-14";
const facts = checkerFactsSchema.parse({
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

/** In-memory engine fixture only: nothing is written to a registry. The engine runs a
 * synthetic_fixture rule only in fixtureMode, which the HTTP service never supplies. */
const rule = (id: string, field: "legalForm" | "premises" | "manufacturing", value: string): ReleasedRule =>
  ruleSchema.parse({
    id,
    version: 1,
    requirementVersionId: "synthetic-controlled-only",
    title: `Synthetic ${id} rule; not released guidance`,
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
    reason: `Synthetic reason why ${id} may matter.`,
    nextStep: `Synthetic next step for ${id}.`,
    relatedTemplateIds: [],
  });

// CMP-009: "Explain the practical next step, why it may matter and what information is missing in
// plain English", accepted when "the source and basic guidance remain readable without purchase and
// are not disguised professional endorsements".
test("each checker result says why it may matter, what to do next and what is missing, with its source", async () => {
  const rules = [
    rule("synthetic-company", "legalForm", "company"),
    rule("synthetic-premises", "premises", "yes"),
    rule("synthetic-manufacturing", "manufacturing", "yes"),
  ];
  const result = assess(facts, rules, asOfDate, now, { fixtureMode: true });
  const item = (id: string) => result.items.find((i) => i.ruleId === id)!;

  // Likely relevant: the rule's own reason and next step, with the source passage to read.
  const likely = item("synthetic-company");
  assert.equal(likely.label, "Likely relevant");
  assert.equal(likely.reason, rules[0]!.reason);
  assert.equal(likely.nextStep, rules[0]!.nextStep);
  assert.deepEqual(likely.sources, rules[0]!.sources);
  assert.deepEqual(likely.missingFacts, []);
  // More information needed: what is missing, and what to do about it.
  const unknown = item("synthetic-premises");
  assert.equal(unknown.label, "More information needed");
  assert.deepEqual(unknown.missingFacts, ["premises"]);
  assert.equal(unknown.nextStep, "Answer the missing questions or confirm with the named authority.");
  assert.ok(result.unanswered.includes("premises"));
  // Not indicated: said plainly, never as an exemption.
  const no = item("synthetic-manufacturing");
  assert.equal(no.label, "Not indicated by these answers");
  assert.equal(no.reason, "These answers did not indicate this scoped rule. This is not a legal exemption.");
  // Guidance, not an endorsement.
  assert.match(result.notice, /not legal certification/);

  // The engine's own words are whole sentences with no internal names in them.
  for (const text of [unknown.nextStep, no.reason, result.notice, ...result.gaps]) {
    assert.match(text, /^[A-Z][^]*\.$/, text);
    assert.doesNotMatch(text, /\b[a-z]+[A-Z]\w*\b|\b[a-z]+_[a-z_]+\b/, text);
  }
  // The result page shows every fact the engine can report missing as words, not as its name.
  const web = (await import(new URL("../../../../valo/src/lib/checker.ts", import.meta.url).href)) as {
    factLabel: (name: string) => string;
  };
  for (const name of factNames) {
    const label = web.factLabel(name);
    assert.ok(label && label !== name && /^[A-Z][a-z]/.test(label), `${name}: ${label}`);
  }
});

// CMP-005: "running the same profile under two rule versions remains reproducible and explains
// changed recommendations".
test("the same profile under two rule versions is reproducible and the comparison explains what changed", () => {
  const first = rule("synthetic-premises", "premises", "yes");
  const second = ruleSchema.parse({
    ...first,
    version: 2,
    condition: { mode: "all", predicates: [{ field: "legalForm", op: "eq", value: "company" }] },
  });
  const run = (rules: ReleasedRule[], answers = facts) =>
    assess(answers, rules, asOfDate, now, { fixtureMode: true });
  // Each version gives the same result every time it runs.
  assert.equal(run([first]).resultHash, run([first]).resultHash);
  assert.equal(run([second]).resultHash, run([second]).resultHash);
  const before = run([first]),
    after = run([second]);
  assert.notEqual(before.rulesetVersion, after.rulesetVersion);

  // Same answers, new rule version: the comparison names the version and the result that changed.
  assert.deepEqual(explainAssessmentChanges(before.items, after.items, []), [
    {
      ruleId: "synthetic-premises",
      title: first.title,
      change: "changed",
      previousVersion: 1,
      currentVersion: 2,
      previousLabel: "More information needed",
      currentLabel: "Likely relevant",
      changedFacts: [],
    },
  ]);
  // Same rule, a changed answer it uses: the comparison names that answer.
  const answered = run([first], checkerFactsSchema.parse({ ...facts, premises: "yes" }));
  assert.deepEqual(
    explainAssessmentChanges(before.items, answered.items, ["premises", "employees"]).map((c) => [
      c.change,
      c.previousLabel,
      c.currentLabel,
      c.changedFacts,
    ]),
    [["changed", "More information needed", "Likely relevant", ["premises"]]],
  );
  // Nothing is reported for an unchanged result; rules that appear or disappear are.
  assert.deepEqual(explainAssessmentChanges(before.items, run([first]).items, []), []);
  const other = run([rule("synthetic-company", "legalForm", "company")]);
  assert.deepEqual(
    explainAssessmentChanges(before.items, other.items, []).map((c) => [c.ruleId, c.change]),
    [
      ["synthetic-company", "added"],
      ["synthetic-premises", "removed"],
    ],
  );
});

// CMP-005 with EDP-008: a result saved before release notices were recorded compares as unchanged
// with the same rule version's result now, which carries one. A new version is still a change.
test("a release notice alone is no change between two saved results, and a new rule version still is", () => {
  const first = rule("synthetic-premises", "premises", "yes");
  const saved = assess(facts, [first], asOfDate, now, { fixtureMode: true }).items;
  const notice = "Synthetic release notice.";
  const withNotice = saved.map((item) => ({ ...item, releaseNotice: notice }));
  assert.equal(comparableItemDigest(saved[0]!), comparableItemDigest(withNotice[0]!));
  assert.deepEqual(explainAssessmentChanges(saved, withNotice, []), []);
  // Anything else that differs is still compared.
  assert.notEqual(
    comparableItemDigest(saved[0]!),
    comparableItemDigest({ ...withNotice[0]!, nextStep: "Another next step." }),
  );
  const second = ruleSchema.parse({ ...first, version: 2 });
  const later = assess(facts, [second], asOfDate, now, { fixtureMode: true }).items.map((item) => ({
    ...item,
    releaseNotice: notice,
  }));
  assert.deepEqual(
    explainAssessmentChanges(saved, later, []).map((c) => [c.change, c.previousVersion, c.currentVersion]),
    [["changed", 1, 2]],
  );
});
