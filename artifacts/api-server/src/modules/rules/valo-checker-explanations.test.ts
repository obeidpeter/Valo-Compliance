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

// docs/architecture/results.md, slice 2. CMP-006: a fee, deadline, rate or threshold is shown only from
// the rule's own source. CMP-007 and EDP-012: a held rule still sends the business to its route.
test("a rule's route and figures are carried to its requirement, and the result's official sources are the routes of the requirements that may apply and of the released rules held from it", () => {
  const registry = { authority: "Synthetic registry", url: "https://example.test/registry" };
  const taxOffice = { authority: "Synthetic tax office", url: "https://example.test/tax" };
  const dataOffice = { authority: "Synthetic data office", url: "https://example.test/data" };
  // In the words of the passage its source quotes: "Synthetic provision for a controlled test."
  const fee = {
    kind: "fee",
    words: "Synthetic provision",
    sourceId: "synthetic-source",
  };
  const routed = (base: ReleasedRule, officialRoute: object, figures?: object[]) =>
    ruleSchema.parse({ ...base, officialRoute, ...(figures && { figures }) });
  const rules = [
    routed(rule("synthetic-company", "legalForm", "company"), registry, [fee]),
    routed(rule("synthetic-premises", "premises", "yes"), taxOffice),
    routed(rule("synthetic-manufacturing", "manufacturing", "yes"), dataOffice),
  ];
  const result = assess(facts, rules, asOfDate, now, { fixtureMode: true });
  const item = (id: string) => result.items.find((i) => i.ruleId === id)!;
  assert.equal(item("synthetic-company").label, "Likely relevant");
  assert.deepEqual(item("synthetic-company").officialRoute, registry);
  assert.deepEqual(item("synthetic-company").figures, [fee]);
  assert.equal(item("synthetic-premises").label, "More information needed");
  assert.deepEqual(item("synthetic-premises").officialRoute, taxOffice);
  assert.equal(Object.hasOwn(item("synthetic-premises"), "figures"), false);
  // The result lists the routes of the requirements that may apply, each once, and not the route of
  // one these answers do not indicate.
  assert.equal(item("synthetic-manufacturing").label, "Not indicated by these answers");
  assert.deepEqual(result.officialRoutes, [
    { title: registry.authority, url: registry.url },
    { title: taxOffice.authority, url: taxOffice.url },
  ]);
  const twice = assess(
    facts,
    [rules[0]!, routed(rule("synthetic-other", "legalForm", "company"), registry)],
    asOfDate,
    now,
    {
      fixtureMode: true,
    },
  );
  assert.deepEqual(twice.officialRoutes, [{ title: registry.authority, url: registry.url }]);

  // A released rule held for stale evidence gives no result, but its route is listed.
  const stale = routed(
    { ...rule("synthetic-stale", "legalForm", "company"), reviewBy: "2026-11-10T00:00:00Z" },
    dataOffice,
  );
  const held = assess(facts, [stale], asOfDate, now, { fixtureMode: true });
  assert.deepEqual(held.items, []);
  assert.deepEqual(held.officialRoutes, [{ title: dataOffice.authority, url: dataOffice.url }]);
  // One that is withdrawn, or not yet in force, sends nobody to its route.
  for (const notInForce of [
    routed({ ...rule("synthetic-withdrawn", "legalForm", "company"), status: "withdrawn" }, dataOffice),
    routed({ ...rule("synthetic-later", "legalForm", "company"), validFrom: "2027-01-01" }, dataOffice),
  ])
    assert.equal(
      assess(facts, [notInForce], asOfDate, now, { fixtureMode: true }).officialRoutes[0]!.url,
      "https://icrp.cac.gov.ng/",
    );

  // A result from rules that record no route keeps the Commission's service page, and its
  // requirements carry nothing new, so its reference is what it was.
  const plain = assess(facts, [rule("synthetic-company", "legalForm", "company")], asOfDate, now, {
    fixtureMode: true,
  });
  assert.deepEqual(plain.officialRoutes, [
    { title: "Corporate Affairs Commission service discovery", url: "https://icrp.cac.gov.ng/" },
  ]);
  assert.equal(Object.hasOwn(plain.items[0]!, "officialRoute"), false);
  assert.equal(Object.hasOwn(plain.items[0]!, "figures"), false);

  // A figure is in the words its own source quotes; a route is an https page; an empty list of figures
  // is written as none.
  const base = rule("synthetic-company", "legalForm", "company");
  assert.throws(() => ruleSchema.parse({ ...base, figures: [{ ...fee, sourceId: "another-source" }] }));
  assert.throws(() =>
    ruleSchema.parse({ ...base, figures: [{ ...fee, words: "Synthetic fee of N10,000" }] }),
  );
  assert.throws(() => ruleSchema.parse({ ...base, figures: [{ ...fee, kind: "price" }] }));
  assert.throws(() => ruleSchema.parse({ ...base, figures: [] }));
  assert.throws(() =>
    ruleSchema.parse({ ...base, officialRoute: { authority: "Synthetic", url: "http://example.test/" } }),
  );
});

// docs/architecture/results.md, slice 3. CMP-003: "Represent federal, state/FCT and LGA requirements
// separately", accepted when "an unknown LGA never receives invented local obligations". RUL-006:
// "coverage gaps and excluded high-risk sectors are visible".
test("a result names the local government area and each of the specification's industries the answers name that no released rule covers, keeps the excluded sectors, and adds nothing for answers that name neither", () => {
  const named = checkerFactsSchema.parse({
    ...facts,
    lga: "Ikeja",
    activities: ["retail/wholesale", "healthcare", "selling synthetic widgets", "other"],
  });
  const gaps = assess(named, [], asOfDate, now, { fixtureMode: true }).gaps;
  assert.deepEqual(gaps.slice(1), [
    "State/FCT and LGA coverage is not comprehensive. Confirm location-specific requirements for Lagos.",
    "No released rule covers local requirements for Ikeja.",
    "No released rule covers requirements specific to retail/wholesale.",
    "No released rule covers requirements specific to healthcare.",
    // The excluded sectors stay named on every result.
    "High-impact healthcare, financial services and energy activities require activity-specific released evidence.",
  ]);
  // The visitor's own words and "other" name no industry, so nothing is said about them.
  assert.ok(!gaps.some((gap) => /widgets|specific to other/.test(gap)));

  // A released rule scoped to the area, or testing for an industry, covers it: nothing is said.
  const local = ruleSchema.parse({
    ...rule("synthetic-ikeja", "legalForm", "company"),
    jurisdiction: { level: "lga", state: "Lagos", lga: "Ikeja" },
  });
  const retail = ruleSchema.parse({
    ...rule("synthetic-retail", "legalForm", "company"),
    condition: { mode: "all", predicates: [{ field: "activities", op: "in", value: ["retail/wholesale"] }] },
  });
  const covered = assess(named, [local, retail], asOfDate, now, { fixtureMode: true }).gaps;
  assert.ok(!covered.includes("No released rule covers local requirements for Ikeja."));
  assert.ok(!covered.includes("No released rule covers requirements specific to retail/wholesale."));
  assert.ok(covered.includes("No released rule covers requirements specific to healthcare."));
  // A rule held from the result covers nothing.
  const held = assess(named, [{ ...local, reviewBy: "2026-11-10T00:00:00Z" }], asOfDate, now, {
    fixtureMode: true,
  }).gaps;
  assert.ok(held.includes("No released rule covers local requirements for Ikeja."));

  // An area not given, and activities in the visitor's own words, add nothing: the result's gaps are
  // the two sentences they always were.
  for (const lga of ["unknown", "unanswered", ""] as const) {
    const plain = assess(
      checkerFactsSchema.parse({ ...facts, lga, activities: ["retail"] }),
      [],
      asOfDate,
      now,
      { fixtureMode: true },
    ).gaps;
    assert.deepEqual(
      plain.slice(1),
      [
        "State/FCT and LGA coverage is not comprehensive. Confirm location-specific requirements for Lagos.",
        "High-impact healthcare, financial services and energy activities require activity-specific released evidence.",
      ],
      lga,
    );
  }
});
