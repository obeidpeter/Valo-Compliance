import assert from "node:assert/strict";
import test from "node:test";
import { digest, sha256, type PublicationBundle } from "@workspace/valo-core";

// A rule's two review requests on the reviewed route (docs/architecture/reviewed-route.md, part 3). The
// rule is the repository's business-name rule, built as the reviewed route builds it. What stands in is
// said where it is made: today's capture of its official source is the retained passage of the Act, under
// the checksum its amendment record describes; the rights record for this route is a synthetic one, since
// the owner has chosen none; and the files' inspection and the server's artifact checksums have the real
// ones' shape. Nothing is read from a database, stored, rendered or sent.
process.env.DATABASE_URL ??= "postgresql://unused@localhost/unused";
const { ownerRuleCandidates } = await import("./owner-rule-candidates");
const { buildReviewedRule, reviewedRuleBundle, ruleScenarioResults } = await import("./reviewed-rule");
const { repositoryRuleProvenance } = await import("./reviewed-rule-preparation");
const {
  executeRuleReviewPlan,
  RULE_REVIEW_LANE,
  RULE_REVIEW_PREPARER,
  ruleReviewPromptVersion,
  ruleReviewRequests,
} = await import("./reviewed-rule-review");
const { reviewResponseFormat } = await import("./operational-review");
const {
  capturedGuidePassages,
  GUIDE_REVIEW_INPUT_CEILING,
  guideAmendmentRecords,
  guidancePolicy,
  retainedGuidePassages,
} = await import("../publication");

const now = new Date("2026-11-28T12:00:00Z");
const reviewAsOf = "2026-11-28T12:30:00.000Z";
const kept = sha256("a checksum stands here");
const evidence = "Synthetic rights record for a test of the reviewed route; not the owner's choice.";
const businessName = ownerRuleCandidates.find((c) => c.rule.id === "cac-business-name-814")!;
const prepared = {
  ...businessName,
  reviewedRouteRights: {
    status: "cleared" as const,
    evidence,
    evidenceHash: sha256(evidence),
    commercialUse: true,
  },
};
const passage = retainedGuidePassages()("CAMA-814")!;
const record = guideAmendmentRecords.find((r) => r.instrument === passage.instrument.id)!;
const text = `Front matter.\n\f\n${passage.text}\n\f\nMore of the Act.`;
const captures = [
  {
    leadId: "SV-010",
    url: passage.instrument.url,
    snapshotId: "00000000-0000-4000-8000-000000000001",
    checkedAt: "2026-11-28T08:00:00.000Z",
    rawChecksum: record.rawSha256,
    textChecksum: sha256(text),
    text,
  },
];
const { policy } = await guidancePolicy();
const built = buildReviewedRule(prepared, {
  version: 1,
  captures,
  passages: capturedGuidePassages(captures),
  records: guideAmendmentRecords,
  policy,
  now,
});
// The inspection of two files that held the whole sheet (a stand-in: nothing is rendered here).
const facts = {
  parsed: true,
  completeContent: true,
  disclosureIncluded: true,
  scopeIncluded: true,
  limitationsIncluded: true,
  sourceDateIncluded: true,
  missingTextHashes: [],
};
const exportReport = { formats: { docx: facts, pdf: facts }, hashes: { docx: kept, pdf: kept } };
const { bundle } = reviewedRuleBundle(built, exportReport);
const candidate = bundle.candidate;
const serverEvidence = {
  candidateHash: candidate.hash,
  policyHash: policy.hash,
  sourceCheckedAt: candidate.sourceCheckDate,
  ruleId: prepared.rule.id,
  version: 1,
  sourceSnapshots: built.snapshotIds,
  provenanceArtifactHash: kept,
  exportReportArtifactHash: kept,
  authoringRoute: "repository-rule" as const,
  sourceAttribution: "Written in the repository; no independently recorded drafting model or run",
  performedChecks: bundle.mechanicalChecks.map((c) => c.name),
};
const inputs = {
  rights: bundle.rights,
  provenance: repositoryRuleProvenance(prepared),
  exports: exportReport.formats,
  scenarios: ruleScenarioResults(prepared, built.rule, now),
};
const sent = (request: { messages: { content: string }[] }) =>
  JSON.parse(request.messages[1]!.content) as Record<string, unknown>;

test("a rule's two review requests carry the rule, its scenarios, its records and its sources, and each runs the enhanced checks", () => {
  assert.deepEqual(built.holds, []);
  const requests = ruleReviewRequests(candidate, inputs, serverEvidence, reviewAsOf, bundle.sources);
  assert.deepEqual(
    requests.map((r) => [r.role, r.promptVersion, r.reviewAsOf]),
    [
      ["factual", "rule-factual-1", reviewAsOf],
      ["challenge", "rule-challenge-1", reviewAsOf],
    ],
  );
  assert.equal(ruleReviewPromptVersion("challenge"), "rule-challenge-1");
  for (const r of requests) {
    assert.equal(r.request.model, "gpt-5.4-mini");
    assert.equal(r.request.max_completion_tokens, 8192);
    // The answer has the review's shape, with one entry for each enhanced check (the rule is classed as
    // governance content, not general).
    assert.equal(candidate.risk, "governance");
    assert.deepEqual(r.request.response_format, reviewResponseFormat(candidate));
    assert.equal(r.request.response_format.json_schema.name, "operational_enhanced_review");
    const system = r.request.messages[0]!.content;
    assert.equal(r.promptHash, digest(system));
    assert.match(system, /^You are the (factual|challenge) reviewer of a requirements-check rule /);
    assert.ok(system.includes(`The trusted server review clock is ${reviewAsOf};`));
    assert.ok(system.includes(JSON.stringify(serverEvidence)));
    assert.match(system, /Run each of these enhanced checks and return exactly one enhancedChecks entry/);
    assert.match(system, /never legal, tax or regulatory review/);
    // What the reviewer is given: the rule's candidate, its scenarios with what the check gives for each,
    // its rights record, how it was written, its files' inspection and its sources whole.
    assert.deepEqual(sent(r.request), {
      candidate,
      scenarios: inputs.scenarios,
      rights: inputs.rights,
      provenance: inputs.provenance,
      exports: inputs.exports,
      sources: bundle.sources,
    });
    assert.ok(r.meter.withinInputCeiling, String(r.meter.conservativeInputTokenBound));
    assert.equal(r.meter.inputCeiling, GUIDE_REVIEW_INPUT_CEILING);
  }
  // The two reviewers have different tasks: a factual check, and a challenge.
  const [factual, challenge] = requests.map((r) => r.request.messages[0]!.content);
  assert.match(factual!, /Check that the rule's reason, next step, figures and official route say only/);
  assert.doesNotMatch(challenge!, /Check that the rule's reason/);
  assert.match(challenge!, /Independently challenge the rule/);
  // Each scenario the rule must get right is sent with the result the requirements check gives for it.
  assert.equal(inputs.scenarios.length, prepared.scenarios.length);
  assert.ok(inputs.scenarios.every((s) => s.passed));
});

test("a general rule's requests leave the enhanced checks out", () => {
  const general = { ...candidate, risk: "general" as const };
  for (const r of ruleReviewRequests(general, inputs, serverEvidence, reviewAsOf, bundle.sources)) {
    assert.doesNotMatch(r.request.messages[0]!.content, /enhanced checks/);
    assert.equal(r.request.response_format.json_schema.name, "operational_review");
  }
});

test("neither review is given another review's verdict, and the requests name this candidate and its source check", () => {
  for (const changed of [
    { ...inputs, rights: { ...inputs.rights, verdict: "pass" } },
    { ...inputs, scenarios: [{ ...inputs.scenarios[0], reviews: [] }] },
    { ...inputs, provenance: { ...inputs.provenance, factualReview: {} } },
  ])
    assert.throws(
      () => ruleReviewRequests(candidate, changed, serverEvidence, reviewAsOf, bundle.sources),
      /REVIEW_INPUT_CONTAINS_OTHER_VERDICT/,
    );
  assert.throws(
    () =>
      ruleReviewRequests(candidate, inputs, serverEvidence, reviewAsOf, [
        { ...bundle.sources[0]!, challengeReview: "hold" } as PublicationBundle["sources"][number],
      ]),
    /REVIEW_INPUT_CONTAINS_OTHER_VERDICT/,
  );
  for (const evidence of [
    { ...serverEvidence, candidateHash: sha256("another candidate") },
    { ...serverEvidence, sourceCheckedAt: "2026-11-27T08:00:00.000Z" },
    { ...serverEvidence, policyHash: "not a checksum" },
    { ...serverEvidence, provenanceArtifactHash: "" },
    { ...serverEvidence, exportReportArtifactHash: "a".repeat(63) },
  ])
    assert.throws(
      () => ruleReviewRequests(candidate, inputs, evidence, reviewAsOf, bundle.sources),
      /REVIEW_SERVER_BINDING_INVALID/,
    );
  // A rule's review always reads its sources.
  assert.throws(
    () => ruleReviewRequests(candidate, inputs, serverEvidence, reviewAsOf, []),
    /REVIEW_SERVER_BINDING_INVALID/,
  );
});

test("only a rule's own plan is run as a rule's review", async () => {
  assert.equal(RULE_REVIEW_PREPARER, "rule-review-pair-v1");
  const entries = ruleReviewRequests(candidate, inputs, serverEvidence, reviewAsOf, bundle.sources);
  const plan = (lane: string) => ({
    manifest: {
      lane,
      candidateHash: candidate.hash,
      serverEvidence,
      preparedAt: reviewAsOf,
      expiresAt: "2026-11-28T13:30:00.000Z",
      status: "mechanically_planned_not_reserved",
    },
    entries,
    artifact: { id: "55555555-5555-4555-8555-555555555555", hash: kept, extension: "json" as const },
  });
  // A template's or a guide's plan is refused before anything is read or reserved.
  for (const lane of ["operational_publication_review", "editorial_evaluation", ""])
    await assert.rejects(
      () => executeRuleReviewPlan(plan(lane), candidate, serverEvidence),
      /REVIEW_PLAN_INVALID_OR_STALE/,
    );
  assert.notEqual(RULE_REVIEW_LANE, "operational_publication_review");
});
