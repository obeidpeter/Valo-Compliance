import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sha256 } from "@workspace/valo-core";
import {
  prepareCustomerEvaluationPlan,
  prepareCustomerEvaluationManifest,
  validateCustomerEvaluationWork,
} from "./inference-customer-evaluation";
import {
  prepareFiniteAllocationPackage,
  allocationPackageId,
  assertWorkPackageMembership,
} from "../ai/inference-allocation-package";
import { requestDigest } from "../ai/inference-budget";
import { buildBusinessDraft } from "@workspace/valo-core/customer-document";
const actor = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  anchorDraftId: "22222222-2222-4222-8222-222222222222",
  identityId: "valo-ai-eval-invoice-controlled",
};
const ref = (bytes: Buffer) => ({
  id: "33333333-3333-4333-8333-333333333333",
  hash: sha256(bytes),
  extension: "json" as const,
});
test("preparation preserves all original60 identities, full oracles and actual numeric checks without invented follow-ups", async () => {
  const plan = await prepareCustomerEvaluationPlan(null),
    corpus = JSON.parse(
      await readFile(
        new URL("../../../../../docs/evaluation-candidates/customer-ai.json", import.meta.url),
        "utf8",
      ),
    );
  assert.equal(plan.cases.length, 60);
  assert.deepEqual(
    plan.cases.map((c) => c.caseId),
    corpus.cases.map((c: any) => c.caseID),
  );
  for (const c of plan.cases) {
    const original = corpus.cases.find((r: any) => r.caseID === c.caseId);
    assert.equal(c.caseHash, requestDigest(original));
    assert.deepEqual(c.expectedChecks, original.expectedChecks);
    assert.deepEqual(c.criticalFailureConditions, original.criticalFailureConditions);
    assert.deepEqual(c.followupValues, {});
    assert.equal(c.providerQualityAccepted, false);
    assert.equal(c.targetBoundaryProved, false);
  }
  assert.deepEqual(
    plan.cases.filter((c) => c.classification === "provider_ready").map((c) => c.caseId),
    ["CAI-CAND-INV-01", "CAI-CAND-REM-01", "CAI-CAND-REM-03", "CAI-CAND-REM-06"],
  );
  assert.equal(plan.cases.flatMap((c) => c.numericChecks).length, 45);
  assert.ok(plan.cases.flatMap((c) => c.numericChecks).every((n) => n.pass));
  assert.equal(plan.cases.filter((c) => c.classification === "controlled_fault_hold").length, 6);
  assert.equal(plan.cases.filter((c) => c.classification === "native_boundary_hold").length, 3);
  assert.equal(plan.providerCalls, 0);
  assert.equal(plan.approvalRowsWritten, 0);
  assert.equal(plan.formalAcceptance, false);
  const bytes = Buffer.from(JSON.stringify(plan));
  assert.throws(
    () =>
      prepareCustomerEvaluationManifest(
        plan,
        ref(bytes),
        "CAI-CAND-INV-01",
        "finite-package:" + "a".repeat(64),
      ),
    /PREPARATION_HELD/,
  );
});
test("declared clarification preserves original missing-data observation and cannot replace supplied facts", async () => {
  const plan = await prepareCustomerEvaluationPlan(actor, new Date(), {
    "CAI-CAND-QUO-01": { issueDate: "2026-11-13" },
  });
  const c = plan.cases.find((c) => c.caseId === "CAI-CAND-QUO-01")!;
  assert.ok(c.asWritten.missing.includes("issueDate"));
  assert.deepEqual(c.missing, []);
  assert.equal(c.classification, "provider_ready");
  assert.deepEqual(c.followupValues, { issueDate: "2026-11-13" });
  assert.notEqual(c.inputHash, c.asWritten.inputHash);
  assert.equal(c.providerQualityAccepted, false);
  await assert.rejects(
    () =>
      prepareCustomerEvaluationPlan(actor, new Date(), { "CAI-CAND-INV-01": { issueDate: "2026-12-01" } }),
    /REPLACE_SUPPLIED/,
  );
  await assert.rejects(
    () => prepareCustomerEvaluationPlan(actor, new Date(), { "CAI-CAND-QUO-01": { issuerName: "Invented" } }),
    /REPLACE_SUPPLIED/,
  );
  await assert.rejects(
    () =>
      prepareCustomerEvaluationPlan(actor, new Date(), { "CAI-NOT-ORIGINAL": { issueDate: "2026-11-13" } }),
    /MAP_INVALID/,
  );
});
test("genuine customer submanifest binds current input, code, source, case and explicit conditional retry", async () => {
  const plan = await prepareCustomerEvaluationPlan(actor),
    bytes = Buffer.from(JSON.stringify(plan)),
    artifact = ref(bytes),
    pkg = await prepareFiniteAllocationPackage();
  const manifest = prepareCustomerEvaluationManifest(
    plan,
    artifact,
    "CAI-CAND-INV-01",
    allocationPackageId(pkg),
  );
  assert.equal(manifest.works.length, 2);
  assert.notEqual(manifest.works[0]!.key, manifest.works[1]!.key);
  assert.equal(manifest.works[1]!.retryOf, manifest.works[0]!.key);
  for (const w of manifest.works) {
    assertWorkPackageMembership(w, pkg, null);
    await validateCustomerEvaluationWork(w, async () => bytes);
  }
  const changed = structuredClone(manifest.works[0]!);
  changed.request.messages = [{ role: "user", content: "different request" }];
  await assert.rejects(() => validateCustomerEvaluationWork(changed, async () => bytes), /REQUEST_CHANGED/);
  for (const mutate of [
    (p: any) => {
      p.codeFiles[0].sha256 = "f".repeat(64);
    },
    (p: any) => {
      p.cases[0].expectedChecks = [];
    },
    (p: any) => {
      p.followups = { "CAI-CAND-QUO-01": { issueDate: "2026-11-13" } };
    },
    (p: any) => {
      p.corpus.sha256 = "f".repeat(64);
    },
  ]) {
    const forged = structuredClone(plan);
    mutate(forged);
    await assert.rejects(
      () =>
        validateCustomerEvaluationWork(manifest.works[0]!, async () => Buffer.from(JSON.stringify(forged))),
      /INPUT_CHANGED/,
    );
  }
  assert.throws(
    () => prepareCustomerEvaluationManifest(plan, artifact, "CAI-CAND-PRO-06", allocationPackageId(pkg)),
    /PREPARATION_HELD/,
  );
  const expired = { ...plan, expiresAt: new Date(0).toISOString() };
  await assert.rejects(
    () =>
      validateCustomerEvaluationWork(manifest.works[0]!, async () => Buffer.from(JSON.stringify(expired))),
    /EXPIRED/,
  );
});
test("original partial-payment and future-date reminders use deterministic wording and preserve supplied balances/dates", async () => {
  const plan = await prepareCustomerEvaluationPlan(null);
  for (const id of ["CAI-CAND-REM-01", "CAI-CAND-REM-06"]) {
    const entry = plan.cases.find((c) => c.caseId === id)!,
      input = entry.input!;
    for (const opening of ["none", "outstanding_record"] as const) {
      const draft = buildBusinessDraft(input, { opening, sections: [] });
      assert.deepEqual(draft.content.financialInput, input.financialInput);
      assert.equal(draft.content.fields.issueDate, input.issueDate);
      assert.equal(draft.content.fields.dueDate, input.dueDate);
      const text = draft.content.blocks.map((b) => b.text).join("\n");
      assert.match(text, /If you have already paid, please share the payment date, amount and reference/);
      if (id.endsWith("06")) {
        assert.match(draft.title, /Upcoming payment/);
        assert.match(text, /2026-11-20.*2026-11-13/);
        assert.doesNotMatch(text, /review the outstanding amount/);
        assert.match(text, /does not assert that payment is overdue/);
      } else assert.equal(input.financialInput.amountDueKobo, "7000000");
    }
  }
});
