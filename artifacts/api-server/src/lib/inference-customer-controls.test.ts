import test from "node:test";
import assert from "node:assert/strict";
import { prepareCustomerEvaluationPlan } from "./inference-customer-evaluation";
import { runCustomerFaultControls } from "./inference-customer-controls";

test("all six original fault cases execute the real organizer with declared synthetic clarification and zero network", async (t) => {
  const old = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  const fetch = globalThis.fetch;
  let network = 0;
  globalThis.fetch = async () => {
    network++;
    throw Error("NETWORK_FORBIDDEN");
  };
  t.after(() => {
    globalThis.fetch = fetch;
    if (old === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = old;
  });
  const original = await prepareCustomerEvaluationPlan(null),
    followups: Record<string, Record<string, string>> = {};
  for (const c of original.cases.filter((c) => c.classification === "controlled_fault_hold")) {
    // Explicit controlled fixture metadata, separate from the authored case.
    followups[c.caseId] = { issueDate: "2026-11-13" };
    if (!c.input?.documentNumber) followups[c.caseId]!.documentNumber = `SYNTHETIC-CONTROL-${c.caseId}`;
    if (c.input?.task === "payment_reminder" && !c.input.dueDate) followups[c.caseId]!.dueDate = "2026-11-01";
  }
  const held = await runCustomerFaultControls(original);
  assert.ok(held.records.every((r) => r.status === "control_input_held"));
  const plan = await prepareCustomerEvaluationPlan(null, new Date(), followups),
    report = await runCustomerFaultControls(plan);
  assert.equal(report.records.length, 6);
  assert.ok(report.records.every((r) => r.status === "controlled_orchestration_pass"));
  assert.deepEqual(
    report.records.map((r) => ("injectedResponsesOrErrors" in r ? r.injectedResponsesOrErrors : 0)),
    [2, 1, 2, 1, 2, 1],
  );
  assert.ok(report.records.every((r) => r.providerQualityAccepted === false && r.actualProviderCalls === 0));
  assert.ok(report.records.every((r) => r.providerReceipts.length === 0));
  assert.equal(network, 0);
  assert.equal(report.formalAcceptance, false);
  assert.equal(report.approvalRowsWritten, 0);
  const recovery = report.records.find((r) => r.caseId === "CAI-CAND-PRO-14")!;
  assert.equal("previewStatus" in recovery && recovery.previewStatus, "ready");
  assert.equal("autoAccepted" in recovery && recovery.autoAccepted, false);
  assert.equal(
    plan.cases.find((c) => c.caseId === "CAI-CAND-PRO-15")!.input!.financialInput.lines[0]!.unitPriceKobo,
    "100000",
  );
});
