import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { EditorialRecord } from "@workspace/api-client-react";
import { EditorialRecordView } from "./editorial-record";

const record: EditorialRecord = {
  kind: "content",
  id: "11111111-1111-4111-8111-111111111111",
  key: "SYNTHETIC-RECORD",
  version: 2,
  status: "held",
  reviewBy: "2027-01-15T00:00:00.000Z",
  publishedAt: null,
  withdrawnReason: "Synthetic hold: the challenge review held it.",
  candidateHash: "a".repeat(64),
  manifestStatus: "review",
  check: {
    checkedAt: "2026-11-18T09:00:00.000Z",
    decision: "hold",
    reasons: ["review_hold:challenge", "manifest_not_eligible"],
  },
  draftRun: { runId: "synthetic-draft-run", model: "synthetic-model", promptVersion: "draft-v1" },
  reviews: [
    {
      role: "factual",
      runId: "synthetic-factual-run",
      model: "synthetic-model",
      promptVersion: "review-v1",
      verdict: "pass",
      findings: [],
      receivedOtherVerdict: false,
    },
    {
      role: "challenge",
      runId: "synthetic-challenge-run",
      model: "synthetic-model",
      promptVersion: "review-v1",
      verdict: "hold",
      findings: ["Synthetic finding: the filing deadline has no supporting passage."],
      receivedOtherVerdict: true,
    },
  ],
  mechanicalChecks: { passed: 5, failed: 1, notRun: 0 },
  enhancedChecks: { passed: 0, failed: 0, notRun: 2 },
  audit: [
    {
      action: "held",
      actor: "bounded_development_publisher",
      reason: "review_hold:challenge",
      at: "2026-11-17T10:00:00.000Z",
    },
  ],
  safetyHolds: [
    {
      action: "hold",
      reason: "Synthetic source change awaiting review.",
      phase: "complete",
      createdAt: "2026-11-17T11:00:00.000Z",
      completedAt: "2026-11-17T11:05:00.000Z",
    },
  ],
  notice: "Synthetic notice: this record approves, publishes and holds nothing.",
};

test("a version's publication record shows why it is held, its runs and findings, checks, holds and audit (ADM-002)", () => {
  const html = renderToStaticMarkup(React.createElement(EditorialRecordView, { record }));
  for (const text of [
    "Held by the bundle check",
    '<code class="break-all">review_hold:challenge</code>',
    '<code class="break-all">manifest_not_eligible</code>',
    "synthetic-draft-run",
    "synthetic-factual-run",
    "synthetic-challenge-run",
    "Synthetic finding: the filing deadline has no supporting passage.",
    "This review saw the other review&#x27;s verdict.",
    "Mechanical: 5 passed, 1 failed, 0 not run",
    "Enhanced: 0 passed, 0 failed, 2 not run",
    "Synthetic source change awaiting review.",
    "held by bounded_development_publisher",
    "Synthetic hold: the challenge review held it.",
    record.candidateHash!,
    record.notice,
  ])
    assert.ok(html.includes(text), `${text}\n${html}`);
  // The record only reads: it offers no action of its own.
  assert.equal(/<(button|form|input|textarea|select)\b/.test(html), false, html);

  const eligible = renderToStaticMarkup(
    React.createElement(EditorialRecordView, {
      record: {
        ...record,
        check: { ...record.check, decision: "eligible", reasons: [] },
        reviews: [],
        draftRun: null,
        candidateHash: null,
      },
    }),
  );
  for (const text of [
    "Passes the bundle check",
    "No drafting run is recorded.",
    "No review runs are recorded.",
    "Bundle is not in the current schema",
  ])
    assert.ok(eligible.includes(text), `${text}\n${eligible}`);
  assert.equal(eligible.includes("list-hold-reasons"), false);

  // The staff content area opens this record for each version it lists.
  const controls = readFileSync(new URL("./source-safety-controls.tsx", import.meta.url), "utf8");
  assert.match(controls, /<EditorialRecordPanel kind=\{v\.kind\} id=\{v\.id\} \/>/);
});
