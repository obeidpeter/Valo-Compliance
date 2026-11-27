import { organizeCustomerDraft, type CustomerTransport } from "./valo-customer-ai-model";
import { customerPreview, hashAI } from "./valo-customer-ai-domain";
import { requestDigest } from "../ai";
import { assertDevelopmentRuntime } from "../../platform/valo-development-runtime";
import type { CustomerEvaluationPlan, CustomerCasePreparation } from "./inference-customer-evaluation";

/** Only a controlled response generator, never a provider transport. The callback
 * that records outbound transmission is deliberately never invoked. These
 * observations must not be imported into an inference ledger as receipts. */
export function controlledCustomerFault(entry: CustomerCasePreparation) {
  let invocations = 0;
  const invoke: CustomerTransport = async () => {
    invocations++;
    if (entry.category === "provider_timeout")
      throw Object.assign(Error("Synthetic timeout signal"), { name: "TimeoutError" });
    if (entry.category === "provider_rate_limit")
      throw Object.assign(Error("Synthetic rate limit"), { status: 429 });
    if (entry.category === "provider_outage_preserves_work")
      throw Object.assign(Error("Synthetic provider outage"), { status: 503 });
    let content = "{}";
    if (entry.category === "unsafe_provider_markup")
      content = JSON.stringify({
        opening: "none",
        sections: [],
        remoteImage: "https://example.invalid/not-fetched",
        script: "<script>throw new Error('not-executed')</script>",
      });
    if (entry.category === "invalid_schema_then_recovery" && invocations === 2) {
      const indexes = entry.input!.contextLines.map((_, i) => i);
      const sections = Array.from({ length: Math.ceil(indexes.length / 6) }, (_, i) => ({
        heading: "notes",
        lineIndexes: indexes.slice(i * 6, i * 6 + 6),
      }));
      content = JSON.stringify({ opening: "none", sections });
    }
    return {
      id: `controlled-no-provider-${invocations}`,
      model: "controlled-no-provider",
      choices: [{ message: { content } }],
    };
  };
  return { invoke, count: () => invocations };
}

export async function runCustomerFaultControls(plan: CustomerEvaluationPlan) {
  assertDevelopmentRuntime();
  const records = [];
  for (const entry of plan.cases.filter((c) => c.classification === "controlled_fault_hold")) {
    const base = {
      caseId: entry.caseId,
      caseHash: entry.caseHash,
      expectedChecks: entry.expectedChecks,
      criticalFailureConditions: entry.criticalFailureConditions,
      harnessConditions: entry.harnessConditions,
      asWrittenPreflight: entry.asWritten,
      declaredFollowup: entry.followupValues,
      evidenceKind: "controlled-organizer-fault",
      actualProviderCalls: 0,
      providerReceipts: [],
      providerQualityAccepted: false,
      formalAcceptance: false,
    };
    if (
      !entry.input ||
      entry.issues.length ||
      entry.unmappedFacts.length ||
      entry.missing.length ||
      entry.unsupported
    ) {
      records.push({
        ...base,
        status: "control_input_held",
        targetBoundaryProved: false,
        issues: entry.issues,
        missing: entry.missing,
        unmappedFacts: entry.unmappedFacts,
      });
      continue;
    }
    const fault = controlledCustomerFault(entry),
      result = await organizeCustomerDraft(entry.input, fault.invoke);
    const { idempotencyKey, ...facts } = entry.input;
    const preview = customerPreview(
      idempotencyKey,
      entry.input,
      result.plan ? "ready" : "manual_fallback",
      result.plan,
      hashAI(facts),
      0,
      null,
    );
    const expectedCalls = [
      "invalid_schema_twice",
      "unsafe_provider_markup",
      "invalid_schema_then_recovery",
    ].includes(entry.category)
      ? 2
      : 1;
    const recovery = entry.category === "invalid_schema_then_recovery";
    const factsPreserved =
      requestDigest(preview.content.financialInput) === requestDigest(entry.input.financialInput) &&
      (["issuerName", "recipientName", "documentNumber", "issueDate", "dueDate"] as const).every(
        (k) => preview.content.fields[k] === entry.input![k],
      );
    const passed =
      fault.count() === expectedCalls &&
      !!result.plan === recovery &&
      factsPreserved &&
      result.runs.every((r) => !r.outboundAttempted) &&
      !JSON.stringify(preview.content).includes("example.invalid/not-fetched");
    records.push({
      ...base,
      status: passed ? "controlled_orchestration_pass" : "controlled_orchestration_fail",
      targetBoundaryProved: passed,
      injectedResponsesOrErrors: fault.count(),
      boundedAttempts: expectedCalls,
      outcomes: result.runs.map((r) => r.outcome),
      failureCode: result.failureCode,
      previewStatus: preview.status,
      factsPreserved,
      autoAccepted: false,
      metadataContainsRawInput: false,
      // A TimeoutError signal proves fallback routing, not passage of an actual
      // 18-second SDK timeout. Native editor/download/log boundaries are separate.
      runtimeTimeoutEnforcementVerified: false,
      nativeJourneysVerified: false,
      fullRubricAssessed: false,
    });
  }
  return {
    kind: "original-customer60-controlled-fault-observations",
    originalCases: 60,
    corpus: plan.corpus,
    codeFiles: plan.codeFiles,
    preparedAt: plan.preparedAt,
    records,
    actualProviderCalls: 0,
    approvalRowsWritten: 0,
    providerQualityAccepted: false,
    formalAcceptance: false,
  };
}
