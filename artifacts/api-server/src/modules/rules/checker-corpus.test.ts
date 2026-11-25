import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ownerConfirmedChecks } from "@workspace/valo-core";
import { corpusDifferences, mapCorpusCase, runCorpusCase, type CorpusCase } from "./checker-corpus";

// RUL-008 (docs/architecture/checker-scenarios.md): the frozen corpus of 80 scenarios, put to the live
// requirements check with the four rules prepared in the repository, as the owner's sign-off would
// release them (decision 0020), from copies of their official texts that hold their passages. Nothing
// is released, stored or reviewed, no model is called, and the corpus is not changed.
process.env.DATABASE_URL ??= "postgresql://unused@localhost/unused";
const signoff = await import("../editorial/owner-rule-signoff");
const { capturedGuidePassages, guideAmendmentRecords, guidancePolicy } = await import("../publication");
const { ownerRuleTextCopies } = await import("../../test-support/owner-rule-texts");

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const corpusBytes = readFileSync(`${root}docs/evaluation-candidates/checker.json`);
const corpus = JSON.parse(corpusBytes.toString("utf8")) as {
  prioritySectors: string[];
  cases: (CorpusCase & { facts: { geography: { stateOrFCT: unknown } } })[];
};
const { now, captures } = await ownerRuleTextCopies(signoff.ownerRuleCandidates[0]!.scenarios[0]!.asOfDate);
const { policy } = await guidancePolicy();
const rules = signoff.ownerRuleCandidates.map((candidate) => {
  const prepared = signoff.prepareOwnerRule(candidate, {
    version: 1,
    captures,
    passages: capturedGuidePassages(captures),
    records: guideAmendmentRecords,
    policy,
    confirmed: ownerConfirmedChecks,
    now,
  });
  assert.deepEqual(prepared.holds, [], candidate.rule.id);
  return prepared.rule;
});
const trusted = new Set(rules.map((r) => r.manifestHash));
const runs = corpus.cases.map((c) => runCorpusCase(c, rules, { now, trusted }));
const count = (values: unknown[]) =>
  Object.fromEntries(
    [...new Set(values.map((v) => JSON.stringify(v)))].map((v) => [
      v,
      values.filter((x) => JSON.stringify(x) === v).length,
    ]),
  );

test("the frozen corpus is unchanged and holds RUL-008's 80 scenarios across six sectors, the three checked places, other states, unknowns and date boundaries", () => {
  // The checksum the corpus was frozen with, which its challenge record and runner also pin.
  const challenge = JSON.parse(readFileSync(`${root}docs/valo/source-checker-challenges-v1.json`, "utf8"));
  assert.equal(createHash("sha256").update(corpusBytes).digest("hex"), challenge.originalCorpusSha256);
  assert.equal(corpus.cases.length, 80);
  assert.equal(new Set(corpus.cases.map((c) => c.caseID)).size, 80);
  assert.deepEqual(new Set(corpus.cases.map((c) => c.facts.sector)), new Set(corpus.prioritySectors));
  assert.equal(corpus.prioritySectors.length, 6);
  const places = count(corpus.cases.map((c) => c.facts.geography.stateOrFCT));
  assert.deepEqual([places['"Lagos"'], places['"FCT"'], places['"Bayelsa"']], [21, 21, 19]);
  const tagged = (tag: string) => corpus.cases.filter((c) => c.coverageTags.includes(tag)).length;
  assert.equal(tagged("other_state_gap"), 17);
  assert.equal(tagged("unknown") + tagged("unanswered"), 15);
  // Four dates other than the corpus's own: before each of three Acts took effect, and a future one.
  assert.deepEqual(
    corpus.cases
      .map((c) => c.assessmentDate)
      .filter((d) => d !== "2026-11-13")
      .sort(),
    ["2019-12-31", "2022-12-31", "2025-12-31", "2030-01-01"],
  );
  assert.equal(
    corpus.cases.filter((c) => c.executionPreconditions.intentionalEligibilityFailureScenario).length,
    6,
  );
});

test("each of the 80 scenarios is put to the live check as a business would answer it, and every result keeps the corpus's conditions: national only, no deadline or reminder, no certification, unknowns never an exemption, and holds kept", () => {
  assert.equal(runs.length, 80);
  for (const run of runs) assert.deepEqual(run.checks, allTrue, run.caseId);
  // The one answer a case implies without stating it: who carries on the business.
  assert.deepEqual(
    new Set(runs.flatMap((r) => r.mapping.assumed.map((a) => `${a.answer}=${String(a.value)}`))),
    new Set(["operatorRole=proprietor"]),
  );
  // A mapped case's answers are the check's own: they parse, and say only what the case says.
  for (const c of corpus.cases) {
    const { facts, notAsked, translated } = mapCorpusCase(c);
    const said = Object.keys(c.facts).filter((f) => !["sector", "geography", "sourceContext"].includes(f));
    const answered = new Set(Object.keys(Object.values(facts.rich ?? {})[0] ?? {}));
    for (const fact of said)
      assert.ok(
        answered.has(fact) || notAsked.includes(fact) || translated.some((t) => t.fact === fact),
        `${c.caseID}: ${fact}`,
      );
  }
  // A case that tests a hold meets it: its rule gives no result, or the check refuses the date.
  assert.deepEqual(
    Object.fromEntries(
      runs
        .filter((r) => r.expected.applicability === "held")
        .map((r) => [
          r.caseId,
          r.live.outcome === "held"
            ? r.live.hold
            : `refused: ${r.live.outcome === "refused" ? r.live.reason : ""}`,
        ]),
    ),
    {
      "CHK-CAND-CAMA-019": "cac-business-name-814: Outside effective period",
      "CHK-CAND-NDPA-019": "ndpa-27-collection-information: Outside effective period",
      "CHK-CAND-NDPA-020": "ndpa-27-collection-information: Evidence is stale or not yet checked",
      "CHK-CAND-NTAA-017": "ntaa-11-company-return: Outside effective period",
      "CHK-CAND-NTAA-020": "refused: Future assessments are not supported",
      "CHK-CAND-NAFDAC-020": "nafdac-f33-product-registration: No trusted eligible publication manifest",
    },
  );
});
const allTrue = {
  sameResultTwice: true,
  nationalOnly: true,
  noDeadlineOrReminder: true,
  noCertification: true,
  unknownsNotExemptions: true,
  heldWhenExpected: true,
  reviewHoldOffersNoTask: true,
};

test("the live check gives the corpus's expected result for 71 of the 80, and for each of the other 9 exactly the result recorded with its reason", () => {
  const differing = runs.filter((r) => !r.matchesExpected);
  assert.equal(runs.length - differing.length, 71);
  assert.deepEqual(
    Object.fromEntries(
      differing.map((r) => [r.caseId, r.live.outcome === "result" ? r.live.label : r.live.outcome]),
    ),
    Object.fromEntries(Object.entries(corpusDifferences).map(([id, d]) => [id, d.live])),
  );
});

test("the mapping keeps each research note's own answer: on every case not held the check gives its note's label, but on the one case where the check's own calculation differs", () => {
  for (const run of runs) {
    if (run.live.outcome !== "result") continue;
    const own = corpusDifferences[run.caseId]?.source === "check";
    assert.equal(
      run.live.label === run.noteLabel,
      !own,
      `${run.caseId}: ${run.live.label} / ${run.noteLabel}`,
    );
  }
});

test("the run's report names, for each scenario, the live result, the research note's, the corpus's expected one, the checks and how its facts were put", () => {
  const report = {
    corpus: {
      path: "docs/evaluation-candidates/checker.json",
      sha256: createHash("sha256").update(corpusBytes).digest("hex"),
    },
    rules: rules.map((r) => ({
      id: r.id,
      version: r.version,
      manifestHash: r.manifestHash,
      evaluator: r.evaluator,
    })),
    evaluatedAt: now.toISOString(),
    summary: {
      cases: runs.length,
      matchingExpected: runs.filter((r) => r.matchesExpected).length,
      differing: Object.keys(corpusDifferences).length,
      checksKept: runs.filter((r) => Object.values(r.checks).every(Boolean)).length,
      accepted: 0,
    },
    notice:
      "A run of the frozen scenarios through the requirements check with rules prepared as the owner signs them. It accepts no requirement and no expected result, and no person or model reviewed it.",
    differences: corpusDifferences,
    runs,
  };
  assert.deepEqual(report.summary, {
    cases: 80,
    matchingExpected: 71,
    differing: 9,
    checksKept: 80,
    accepted: 0,
  });
  const path = process.env.VALO_CHECKER_CORPUS_RUN;
  if (path) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  }
});

test("against the rule versions a registry releases, each case whose rule is released is run as before, and each other case is reported as not released", async () => {
  const { runCorpusAgainstReleased } = await import("./checker-corpus");
  const label = (r: (typeof runs)[number]) => (r.live.outcome === "result" ? r.live.label : r.live.outcome);
  const all = runCorpusAgainstReleased(corpus.cases, rules, { now, trusted });
  assert.deepEqual(
    all.map((r) => ("notReleased" in r ? null : label(r))),
    runs.map(label),
  );
  const businessName = rules.filter((r) => r.id === "cac-business-name-814");
  const one = runCorpusAgainstReleased(corpus.cases, businessName, { now, trusted });
  const ran = one.flatMap((r) => ("notReleased" in r ? [] : [r]));
  assert.equal(ran.length, 20);
  assert.deepEqual(ran.map(label), runs.filter((r) => r.ruleId === "cac-business-name-814").map(label));
  assert.deepEqual(
    new Set(one.flatMap((r) => ("notReleased" in r ? [r.ruleId] : []))),
    new Set(["ndpa-27-collection-information", "ntaa-11-company-return", "nafdac-f33-product-registration"]),
  );
});
