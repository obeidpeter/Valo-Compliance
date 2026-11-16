import { test } from "node:test";
import assert from "node:assert/strict";
import { assertFiniteWorkShape } from "./inference-work-shape";
import { requestDigest } from "./inference-budget";
import type { FiniteWork } from "./inference-batch-dispatch";
const uuid = "8f50692a-cb57-4a0e-a363-e8be0a41bfb1";
function work(lane: FiniteWork["lane"]): FiniteWork {
  return {
    key: lane,
    lane,
    role: lane === "customer" ? "customer" : lane === "checker_challenge" ? "challenge" : "factual",
    pair: ["publication", "editorial_evaluation"].includes(lane) ? "pair" : null,
    candidateHash: requestDigest("candidate"),
    sourceHashes: [],
    caseHash: requestDigest("case"),
    bindings: {
      candidateVersionId: lane === "customer" ? null : uuid,
      corpus:
        lane === "customer"
          ? "customer-ai"
          : lane === "checker_challenge"
            ? "checker"
            : lane === "editorial_evaluation"
              ? "editorial"
              : null,
      caseId: lane === "publication" ? null : "exact-original-case",
      sourceFiles: [],
      ...(lane === "publication"
        ? { operationalPlan: { id: uuid, hash: requestDigest("plan"), extension: "json" } }
        : {}),
    },
    request: { model: "gpt-5.4-mini", max_completion_tokens: 8192, messages: [] },
  };
}
for (const lane of ["publication", "editorial_evaluation", "checker_challenge", "customer"] as const) {
  test(lane + " cannot be relabeled to another corpus", () => {
    const w = work(lane);
    assert.doesNotThrow(() => assertFiniteWorkShape(w));
    w.bindings.corpus = lane === "customer" ? "editorial" : "customer-ai";
    assert.throws(() => assertFiniteWorkShape(w), /LANE_CORPUS_MISMATCH/);
  });
}
test("customer context cannot carry a hidden publication plan or private candidate", () => {
  const w = work("customer");
  w.bindings.candidateVersionId = uuid;
  assert.throws(() => assertFiniteWorkShape(w), /SCOPE_INVALID/);
});
test("checker challenge is not an independent factual review or review pair", () => {
  const w = work("checker_challenge");
  w.role = "factual";
  assert.throws(() => assertFiniteWorkShape(w), /SCOPE_INVALID/);
});
