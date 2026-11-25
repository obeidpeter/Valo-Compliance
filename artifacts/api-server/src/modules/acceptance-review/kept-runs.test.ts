import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { digest, ownerConfirmedChecks } from "@workspace/valo-core";
import { corpusDifferences, runCorpusCase, type CorpusCase } from "../rules/checker-corpus";
import { corpusCases } from "./acceptance-cases";
import { checkerKeptCases, customerKeptCases, editorialKeptCases, hashedKeptCase } from "./kept-runs";

// EDP-010, RUL-008 and AI-008 (decision 0016, docs/architecture/reviewer-record.md, slice 2): a suite's
// run is kept for a reviewer with every case's status, and for each case the suite cannot score itself,
// what the reviewer reads. The live check below is the real one, with the four rules prepared in the
// repository as the owner's sign-off would release them; nothing is released, stored or reviewed.
process.env.DATABASE_URL ??= "postgresql://unused@localhost/unused";
const signoff = await import("../editorial/owner-rule-signoff");
const { capturedGuidePassages, guideAmendmentRecords, guidancePolicy } = await import("../publication");
const { ownerRuleTextCopies } = await import("../../test-support/owner-rule-texts");

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");

test("the live check leaves each scenario whose result differs for a reviewer, with both results, why they differ and how the answers were put", async () => {
  const corpus = JSON.parse(read("docs/evaluation-candidates/checker.json")) as { cases: CorpusCase[] };
  const { now, captures } = await ownerRuleTextCopies(signoff.ownerRuleCandidates[0]!.scenarios[0]!.asOfDate);
  const { policy } = await guidancePolicy();
  const rules = signoff.ownerRuleCandidates.map(
    (candidate) =>
      signoff.prepareOwnerRule(candidate, {
        version: 1,
        captures,
        passages: capturedGuidePassages(captures),
        records: guideAmendmentRecords,
        policy,
        confirmed: ownerConfirmedChecks,
        now,
      }).rule,
  );
  const trusted = new Set(rules.map((r) => r.manifestHash));
  const runs = corpus.cases.map((c) => runCorpusCase(c, rules, { now, trusted }));
  const hashes = new Map(corpusCases("checker", read).map((c) => [c.id, c.hash]));
  const kept = checkerKeptCases(runs, hashes, corpusDifferences);
  assert.equal(kept.length, 80);
  assert.deepEqual(
    kept.map((k) => [k.caseId, k.caseHash]),
    corpusCases("checker", read).map((c) => [c.id, c.hash]),
  );
  const left = kept.filter((k) => k.review);
  // The nine differences the live check records, and no other case.
  assert.deepEqual(left.map((k) => k.caseId).sort(), Object.keys(corpusDifferences).sort());
  assert.ok(left.every((k) => k.status === "differs"));
  assert.ok(kept.filter((k) => !k.review).every((k) => k.status === "matches_expected" && k.reason === null));
  const ndpa = left.find((k) => k.caseId === "CHK-CAND-NDPA-009")!;
  const headings = ndpa.review!.sections.map((s) => s.heading);
  assert.deepEqual(headings.slice(0, 3), ["The scenario", "Expected", "The live check"]);
  assert.ok(headings.includes("The difference as recorded"));
  const live = ndpa.review!.sections.find((s) => s.heading === "The live check")!.lines;
  assert.ok(live.includes("result: More information needed"));
  assert.ok(live.some((l) => l.startsWith("reason: ")));
  const recorded = ndpa.review!.sections.find((s) => s.heading === "The difference as recorded")!.lines;
  assert.equal(recorded[0], "whose result: the check's own");
  assert.equal(recorded[1], corpusDifferences["CHK-CAND-NDPA-009"]!.why);
  assert.equal(ndpa.reason, corpusDifferences["CHK-CAND-NDPA-009"]!.why);
  const note = left.find((k) => k.caseId === "CHK-CAND-NAFDAC-005")!;
  assert.equal(
    note.review!.sections.find((s) => s.heading === "The difference as recorded")!.lines[0],
    "whose result: the research note's, which the check repeats",
  );
  // A scenario with no released rule ran nothing, so it leaves nothing to judge.
  const unreleased = checkerKeptCases(
    [{ caseId: "CHK-CAND-CAMA-001", ruleId: "CAMA-814", notReleased: true }],
    hashes,
    corpusDifferences,
  );
  assert.deepEqual(unreleased[0]!.review, null);
  assert.equal(unreleased[0]!.status, "not_released");
  // Every line is plain text a reviewer reads, never an object's name.
  for (const k of left)
    for (const s of k.review!.sections)
      for (const l of s.lines) assert.ok(l.trim() && !l.includes("[object Object]"), `${k.caseId}: ${l}`);
});

test("the editorial suite leaves a held template with why and its two reviews, and a case-bound pair with its two reviews; a case with nothing kept leaves nothing to judge", () => {
  const editorial = corpusCases("editorial", read);
  const base = (i: number, rest: Record<string, unknown>) => ({
    caseID: editorial[i]!.id,
    caseHash: editorial[i]!.hash,
    ...rest,
  });
  const review = (role: string, verdict: string) => ({
    role,
    model: "synthetic-model",
    verdict,
    findings: [`The ${role} review found the misquoted citation.`],
  });
  const kept = editorialKeptCases([
    base(0, {
      status: "needs_evaluator_decision",
      templateId: "TPL-07",
      version: 3,
      savedStatus: "held",
      decision: "held",
      reasons: ["review_not_clear:challenge"],
      reviews: [review("factual", "pass"), review("challenge", "hold")],
    }),
    base(1, {
      status: "needs_evaluator_decision",
      reason: "An independent reviewer decides whether each review found the case's defect.",
      batchId: "finite-submanifest:abc",
      candidateHash: "c".repeat(64),
      reviews: [
        { ...review("factual", "hold"), missingEvidence: ["The cited section's text."] },
        review("challenge", "hold"),
      ],
      prerequisite: { caseId: "EVAL-EDP-C018", batchId: "finite-submanifest:def" },
    }),
    base(2, {
      status: "needs_evaluator_decision",
      reason:
        "The controlled provider failure runs in CI; an independent reviewer decides from that run's retained result.",
    }),
    base(3, { status: "control_pass" }),
    base(4, { status: "blocked", reason: "no_admitted_review_pair" }),
  ]);
  const [held, pair, nothing, passed, blocked] = kept;
  assert.deepEqual(
    held!.review!.sections.map((s) => s.heading),
    [
      "What was held",
      "Why it was held",
      "The factual review (synthetic-model)",
      "The challenge review (synthetic-model)",
    ],
  );
  assert.deepEqual(held!.review!.sections[1]!.lines, ["review_not_clear:challenge"]);
  assert.deepEqual(held!.review!.sections[3]!.lines, [
    "verdict: hold",
    "finding: The challenge review found the misquoted citation.",
  ]);
  assert.deepEqual(
    pair!.review!.sections.map((s) => s.heading),
    [
      "The review pair",
      "The case it follows",
      "The factual review (synthetic-model)",
      "The challenge review (synthetic-model)",
    ],
  );
  assert.ok(pair!.review!.sections[2]!.lines.includes("missing evidence: The cited section's text."));
  assert.equal(nothing!.review, null);
  assert.match(nothing!.reason!, /controlled provider failure/);
  assert.deepEqual([passed!.review, passed!.reason, blocked!.review], [null, null, null]);
});

test("the customer AI suite leaves each answer the provider wrote, as the customer saw it, with its limitations and the suite's numeric checks", () => {
  const customer = corpusCases("customer_ai", read);
  const answer = {
    title: "Invoice for synthetic supplies",
    content: {
      fields: { issuerName: "Synthetic Supplier", recipientName: "Synthetic Buyer", notes: "" },
      blocks: [
        { type: "paragraph", text: "Thank you for your order.", rows: [] },
        {
          type: "table",
          text: "",
          rows: [
            ["Item", "Amount"],
            ["Synthetic item", "₦27,000.00"],
          ],
        },
      ],
    },
    limitations: ["This is your private business draft."],
  };
  const kept = customerKeptCases(
    [
      {
        caseID: customer[0]!.id,
        caseHash: customer[0]!.hash,
        status: "partial_provider_evidence",
        reason: "provider_generation_and_numbers_observed_full_rubric_and_log_review_pending",
        previewId: "preview-1",
        previewStatus: "ready",
        numericChecks: [{ key: "subtotal", expected: "₦27,000.00", actualKobo: "2700000", pass: true }],
      },
      {
        caseID: customer[1]!.id,
        caseHash: customer[1]!.hash,
        status: "blocked",
        previewId: "preview-2",
        previewStatus: "manual_fallback",
      },
      { caseID: customer[2]!.id, caseHash: customer[2]!.hash, status: "control_pass" },
    ],
    new Map([
      ["preview-1", answer],
      ["preview-2", answer],
    ]),
  );
  assert.deepEqual(
    kept[0]!.review!.sections.map((s) => s.heading),
    ["The answer", "Its limitations", "The suite's numeric checks"],
  );
  assert.deepEqual(kept[0]!.review!.sections[0]!.lines, [
    "Invoice for synthetic supplies",
    "issuerName: Synthetic Supplier",
    "recipientName: Synthetic Buyer",
    "Thank you for your order.",
    "Item | Amount",
    "Synthetic item | ₦27,000.00",
  ]);
  assert.deepEqual(kept[0]!.review!.sections[2]!.lines, [
    "subtotal: expected ₦27,000.00, got 2700000 kobo, matches",
  ]);
  // A draft that is not ready is no answer to judge.
  assert.deepEqual([kept[1]!.review, kept[2]!.review], [null, null]);
});

test("a kept case's hash is of the case as kept, so any change to what a reviewer reads changes it", () => {
  const editorial = corpusCases("editorial", read);
  const kept = {
    caseId: editorial[0]!.id,
    caseHash: editorial[0]!.hash,
    status: "needs_evaluator_decision",
    reason: null,
    review: { sections: [{ heading: "Why it was held", lines: ["review_not_clear:challenge"] }] },
  };
  const hashed = hashedKeptCase(kept);
  assert.equal(hashed.resultHash, digest(kept));
  assert.notEqual(
    hashedKeptCase({
      ...kept,
      review: { sections: [{ heading: "Why it was held", lines: ["another reason"] }] },
    }).resultHash,
    hashed.resultHash,
  );
  assert.notEqual(hashedKeptCase({ ...kept, status: "blocked" }).resultHash, hashed.resultHash);
});
