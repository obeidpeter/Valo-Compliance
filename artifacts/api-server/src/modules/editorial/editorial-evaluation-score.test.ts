import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  candidateDigest,
  digest,
  disclosure,
  mandatoryMechanicalChecks,
  sha256,
  type PublicationBundle,
} from "@workspace/valo-core";
import { scoreEditorialEvaluation } from "./editorial-evaluation-score";
import { templateCaseOutcome, type SavedTemplateVersion } from "./editorial-template-cases";
import { FalseEligibilityError, publicationHoldTransition } from "./editorial-evaluation-evidence";

// EDP-010: zero critical false publications and at least 95% of the 60 editorial cases. Every
// bundle here is synthetic; no result below is a provider run or an accepted case.
const root = resolve(import.meta.dirname, "../../../../..");
const corpusIds = async () =>
  (
    JSON.parse(await readFile(resolve(root, "docs/evaluation-candidates/editorial.json"), "utf8")) as {
      cases: { id: string }[];
    }
  ).cases.map((c) => c.id);

test("the score holds every case to EDP-010's bar and never accepts it", async () => {
  const ids = await corpusIds();
  assert.equal(ids.length, 60);
  const all = (status: string) => ids.map((caseID) => ({ caseID, status }));
  const full = scoreEditorialEvaluation(ids, all("control_pass"));
  assert.deepEqual(
    { passed: full.passed, required: full.requiredToPass, meets: full.meetsEdp010Bar },
    { passed: 60, required: 57, meets: true },
  );
  assert.equal(full.accepted, false);
  assert.equal(full.legalAccuracyClaimed, false);
  // 57 of 60 is 95%; a blocked, unselected or unrun case has not passed.
  const results = all("case_pass");
  for (const i of [0, 1, 2]) results[i]!.status = ["blocked", "not_selected", "needs_evaluator_decision"][i]!;
  assert.equal(scoreEditorialEvaluation(ids, results).meetsEdp010Bar, true);
  results[3]!.status = "fail";
  const short = scoreEditorialEvaluation(ids, results);
  assert.deepEqual([short.passed, short.failed, short.meetsEdp010Bar], [56, 1, false]);
  // One critical false publication fails the bar however many cases pass.
  const critical = all("control_pass");
  critical[5] = { caseID: critical[5]!.caseID, status: "fail", criticalFalsePublication: true } as never;
  const flagged = scoreEditorialEvaluation(ids, critical);
  assert.deepEqual(
    [flagged.passed, flagged.criticalFalsePublications, flagged.meetsEdp010Bar],
    [59, 1, false],
  );
  // Results must name each corpus case exactly once.
  assert.throws(() => scoreEditorialEvaluation(ids, all("control_pass").slice(1)), /DO_NOT_MATCH_CORPUS/);
  assert.throws(
    () =>
      scoreEditorialEvaluation(ids, [...all("control_pass"), { caseID: ids[0]!, status: "control_pass" }]),
    /DO_NOT_MATCH_CORPUS/,
  );
  assert.throws(
    () =>
      scoreEditorialEvaluation(ids, [
        ...all("control_pass").slice(1),
        { caseID: "EVAL-EDP-C999", status: "case_pass" },
      ]),
    /DO_NOT_MATCH_CORPUS/,
  );
});

test("the last retained run of the 60 cases is far from EDP-010's bar", async () => {
  // The retained 14 November run against the development database: controls passed or blocked.
  const retained = JSON.parse(
    await readFile(resolve(root, "docs/valo/evidence/editorial-source60-current-boundaries.json"), "utf8"),
  ) as { results: { caseID: string; status: string }[] };
  const score = scoreEditorialEvaluation(await corpusIds(), retained.results);
  assert.deepEqual(
    [score.passed, score.notPassedOrNotRun, score.criticalFalsePublications, score.meetsEdp010Bar],
    [14, 46, 0, false],
  );
});

function eligibleBundle(): PublicationBundle {
  const sourceText = "Synthetic provision: record the supplied date.";
  const sources: PublicationBundle["sources"] = [
    {
      id: "synthetic-source",
      url: "https://official.example.test/instrument",
      title: "Synthetic instrument",
      issuingBody: "Synthetic test authority",
      text: sourceText,
      hash: sha256(sourceText),
      jurisdiction: "NG",
      retrievedAt: "2026-11-18T00:00:00Z",
      // Fresh far into the future, so the gate finds this fixture eligible whenever the test runs.
      freshUntil: "2099-01-01T00:00:00Z",
      effectiveFrom: "2026-01-01T00:00:00Z",
      effectiveTo: null,
      status: "approved",
      operativeTextConfirmed: true,
      amendmentsResolved: true,
    },
  ];
  const evidenceHash = digest(sources);
  const policy = {
    version: "synthetic-policy",
    ownerApproved: true,
    allowedClasses: ["general_template", "sourced_guidance"],
    jurisdictions: ["NG"],
    risks: ["general"],
    officialHosts: ["official.example.test"],
    blockedActivities: ["bespoke legal opinions", "certification"],
  };
  const raw: Omit<PublicationBundle["candidate"], "hash"> = {
    id: "TPL-07",
    version: 1,
    body: "Synthetic inventory register body",
    contentClass: "general_template",
    jurisdiction: "NG",
    risk: "general",
    scope: "Synthetic template-case testing only",
    limitations: "Not content for publication",
    assumptions: [],
    unresolvedMaterialIssues: [],
    missingEvidence: [],
    sourceCheckDate: "2026-11-18T00:00:00Z",
    disclosure,
    legalScopeStatus: "verified",
    claims: [
      {
        text: "Record the supplied date",
        kind: "source_statement",
        sourceId: "synthetic-source",
        quote: "record the supplied date",
        locator: "synthetic provision",
        numbers: [],
      },
    ],
  };
  const candidate = { ...raw, hash: candidateDigest(raw) };
  const run = (runId: string) => ({
    runId,
    model: "synthetic-test-not-an-actual-provider",
    promptVersion: "fixture-only",
    candidateHash: candidate.hash,
    evidenceHash,
  });
  const b: PublicationBundle = {
    candidate,
    sources,
    policy: { ...policy, hash: digest(policy) },
    rights: {
      status: "cleared",
      evidence: "Synthetic rights fixture",
      evidenceHash: sha256("fixture"),
      commercialUse: true,
    },
    draftRun: run("draft"),
    reviews: (["factual", "challenge"] as const).map((role) => ({
      ...run(role),
      role,
      verdict: "pass",
      findings: [],
      receivedOtherVerdict: false,
    })),
    enhancedChecks: [],
    mechanicalChecks: mandatoryMechanicalChecks.map((name) => ({
      name,
      candidateHash: candidate.hash,
      result: "pass",
      evidenceHash: sha256("synthetic-check"),
    })),
    exports: (["docx", "pdf"] as const).map((format) => ({
      format,
      candidateHash: candidate.hash,
      fileHash: sha256("synthetic-not-a-rendered-file"),
      rendered: true,
      disclosureIncluded: true,
      scopeIncluded: true,
      limitationsIncluded: true,
      sourceDateIncluded: true,
    })),
    manifest: {
      candidateHash: candidate.hash,
      evidenceHash,
      rightsHash: "",
      policyHash: "",
      reviewHash: "",
      checksHash: "",
      exportsHash: "",
      status: "eligible",
    },
  };
  return rebind(b);
}
function rebind(b: PublicationBundle) {
  b.candidate.hash = candidateDigest(b.candidate);
  for (const r of [b.draftRun, ...b.reviews]) r.candidateHash = b.candidate.hash;
  for (const c of [...b.mechanicalChecks, ...b.enhancedChecks]) c.candidateHash = b.candidate.hash;
  for (const e of b.exports) e.candidateHash = b.candidate.hash;
  Object.assign(b.manifest, {
    candidateHash: b.candidate.hash,
    evidenceHash: digest(b.sources),
    rightsHash: digest(b.rights),
    policyHash: b.policy.hash,
    reviewHash: digest({ draft: b.draftRun, reviews: b.reviews }),
    checksHash: digest({ mechanical: b.mechanicalChecks, enhanced: b.enhancedChecks }),
    exportsHash: digest(b.exports),
  });
  return b;
}
const publishedAt = new Date("2026-11-19T12:00:00Z");
function saved(change: Partial<SavedTemplateVersion> = {}, bundle = eligibleBundle()): SavedTemplateVersion {
  return {
    id: "77777777-7777-4777-8777-777777777777",
    templateId: "TPL-07",
    version: 1,
    status: "published",
    bundle,
    attestations: { reviews: [{ id: "review-a" }, { id: "review-b" }] },
    publishedAt,
    ...change,
  };
}

test("a template case counts only a reviewed version, and a published one must still pass its gate", () => {
  // Not run: no version, another template's version, or a version saved without its two reviews.
  assert.deepEqual(templateCaseOutcome("EVAL-EDP-C001", []), {
    templateId: "TPL-07",
    status: "blocked",
    reason: "reviewed_pair_not_run:TPL-07",
  });
  assert.equal(templateCaseOutcome("EVAL-EDP-C002", [saved()]).status, "blocked");
  const unreviewed = eligibleBundle();
  unreviewed.reviews = [];
  assert.equal(
    templateCaseOutcome("EVAL-EDP-C001", [
      saved({ status: "held", attestations: { reviews: [] } }, unreviewed),
    ]).status,
    "blocked",
  );
  // Published and still eligible at its publication time.
  const passed = templateCaseOutcome("EVAL-EDP-C001", [saved()]);
  assert.deepEqual([passed.status, passed.decision], ["case_pass", "published"]);
  // Published although its gate holds: a critical false publication.
  const forged = eligibleBundle();
  forged.reviews[1]!.verdict = "hold";
  const falsePublication = templateCaseOutcome("EVAL-EDP-C001", [saved({}, rebind(forged))]);
  assert.equal(falsePublication.status, "fail");
  assert.equal(falsePublication.criticalFalsePublication, true);
  assert.ok(falsePublication.reasons?.includes("review_not_clear:challenge"));
  // A published row with no publication time fails, without a false-publication claim.
  const untimed = templateCaseOutcome("EVAL-EDP-C001", [saved({ publishedAt: null })]);
  assert.deepEqual([untimed.status, untimed.criticalFalsePublication], ["fail", undefined]);
  // Held: whether the hold is a real unmet gate needs an evaluator, so it has not passed.
  const held = templateCaseOutcome("EVAL-EDP-C001", [saved({ status: "held" }, rebind(forged))]);
  assert.equal(held.status, "needs_evaluator_decision");
  assert.ok(held.reasons?.includes("review_not_clear:challenge"));
  // The reviewer reads what each of the two reviews said.
  assert.deepEqual(
    held.reviews?.map((r) => r.role),
    ["factual", "challenge"],
  );
  assert.ok(held.reviews?.every((r) => typeof r.verdict === "string" && Array.isArray(r.findings)));
  // Saved but stopped before its outcome; and the latest reviewed version is the one read.
  assert.equal(
    templateCaseOutcome("EVAL-EDP-C001", [saved({ status: "candidate" })]).reason,
    "reviewed_pair_outcome_pending",
  );
  const latest = templateCaseOutcome("EVAL-EDP-C001", [
    saved({ status: "held" }, rebind(forged)),
    saved({ id: "88888888-8888-4888-8888-888888888888", version: 2 }),
  ]);
  assert.deepEqual([latest.status, latest.version], ["case_pass", 2]);
});

test("an adverse change the gate still finds eligible is a critical false publication", () => {
  const baseline = eligibleBundle();
  assert.throws(
    () =>
      publicationHoldTransition(
        baseline,
        (b) => {
          b.candidate.scope = "A changed scope the gate cannot see as a failure";
          rebind(b);
        },
        /scope/,
      ),
    FalseEligibilityError,
  );
});
