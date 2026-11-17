import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { db, pool, valoAIDrafts } from "@workspace/db";
import { batchProcess } from "@workspace/integrations-openai-ai-server/batch";
import { customerAICases } from "../lib/valo-customer-ai-fixtures";
import { customerProviderPayload, hashAI } from "../lib/valo-customer-ai-domain";
import { organizeCustomerDraft, type CustomerTransport } from "../lib/valo-customer-ai-model";
import { createCustomerAIDraft } from "../lib/valo-customer-ai";
import { resolveWorkspace } from "../lib/valo-store";
import { logger } from "../lib/logger";
async function main() {
  assert.equal(process.env.NODE_ENV, "development");
  assert.ok(!process.env.REPLIT_DEPLOYMENT);
  assert.equal(process.env.VALO_RUN_CUSTOMER_AI_EVAL, "synthetic-development-only");
  assert.equal(customerAICases.length, 60);
  const actors = new Map<string, Awaited<ReturnType<typeof resolveWorkspace>>>();
  for (const task of new Set(customerAICases.map((c) => c.task)))
    actors.set(task, await resolveWorkspace(`valo-ai-eval-${task}-${randomUUID()}`));
  const startedAt = new Date().toISOString();
  const results = await batchProcess(
    customerAICases,
    async (f) => {
      let simulatedTransportInvocations = 0,
        previewId: string | null = null,
        actualProviderAttempts = 0,
        criticalStage = true;
      let runs: {
        outboundAttempted: boolean;
        responseId: string | null;
        model: string | null;
        usage: unknown;
        outcome: string;
      }[] = [];
      try {
        const actor = actors.get(f.task)!;
        const transport: CustomerTransport = async () => {
          simulatedTransportInvocations++;
          if (f.fault === "timeout") {
            const e = new Error("Controlled synthetic timeout");
            e.name = "TimeoutError";
            throw e;
          }
          if (f.fault === "unavailable") throw Error("Controlled synthetic provider outage");
          return {
            id: "synthetic-fault-no-provider-response",
            model: "synthetic-fault-no-model",
            choices: [{ message: { content: "{invalid-schema" } }],
          };
        };
        const preview = await createCustomerAIDraft(
          actor,
          f.input,
          f.mode === "injected_fault" ? (i) => organizeCustomerDraft(i, transport) : undefined,
        );
        previewId = preview.id;
        assert.deepEqual(preview.content.fields.issuerName, f.input.issuerName);
        assert.deepEqual(preview.content.fields.recipientName, f.input.recipientName);
        assert.deepEqual(preview.content.fields.documentNumber, f.input.documentNumber);
        assert.deepEqual(preview.content.financialInput, f.input.financialInput);
        const [row] = await db
          .select()
          .from(valoAIDrafts)
          .where(and(eq(valoAIDrafts.id, preview.id), eq(valoAIDrafts.workspaceId, actor.workspaceId)));
        assert.ok(row);
        runs = row.providerRuns as typeof runs;
        actualProviderAttempts = runs.filter((r) => r.outboundAttempted).length;
        const payload = customerProviderPayload(f.input),
          serialized = JSON.stringify(payload);
        assert.deepEqual(Object.keys(payload).sort(), ["notes", "task", "tone"]);
        for (const identifier of [f.input.issuerName, f.input.recipientName, f.input.documentNumber].filter(
          Boolean,
        ))
          assert.ok(
            !serialized.toLowerCase().includes(identifier.toLowerCase()),
            "Direct business identifier reached model payload",
          );
        if (f.mode === "real_provider") {
          const paragraphs = preview.content.blocks
            .filter((b) => b.type === "paragraph")
            .map((b) => b.text)
            .join("\n");
          for (const line of f.input.contextLines)
            assert.ok(paragraphs.includes(line), "A supplied material note was omitted");
          const summary = preview.content.blocks.find((b) => b.id === "financial-summary-v1");
          assert.equal(
            summary?.rows.at(-1)?.at(-1),
            f.expectedAmount,
            "Independent hand-computed amount mismatch",
          );
          criticalStage = false;
          assert.ok(actualProviderAttempts >= 1 && actualProviderAttempts <= 2);
          assert.ok(preview.modelUsed && runs.some((r) => r.outboundAttempted && r.responseId && r.usage));
        } else {
          assert.equal(actualProviderAttempts, 0);
          assert.equal(preview.providerCalls, 0);
          if (f.mode === "missing_information") assert.ok(preview.missingFields.length > 0);
          if (f.mode === "injected_fault")
            assert.equal(simulatedTransportInvocations, f.fault === "schema" ? 2 : 1);
        }
        assert.equal(preview.status, f.expectedStatus);
        return {
          id: f.id,
          name: f.name,
          mode: f.mode,
          status: "pass",
          previewId,
          actualProviderAttempts,
          simulatedTransportInvocations,
          providerInputHash: row.providerInputHash,
          runs,
          criticalFailure: false,
          rubric:
            "TRD AI-001/002/003/005/006/009: exact facts, independent arithmetic, bounded structure, selected-context privacy, no tools and safe failure",
        };
      } catch {
        return {
          id: f.id,
          name: f.name,
          mode: f.mode,
          status: "fail",
          previewId,
          simulatedTransportInvocations,
          actualProviderAttempts,
          runs,
          criticalFailure: criticalStage,
          error:
            "Observed result failed its retained exact-fixture rubric; inspect the private development run.",
        };
      }
    },
    { concurrency: 2, retries: 0 },
  );
  const failed = results.filter((r) => r.status !== "pass").length;
  const report = {
    suite: "60-customer-AI-evaluation",
    startedAt,
    finishedAt: new Date().toISOString(),
    fixtureSetHash: hashAI(customerAICases),
    fixtureProvenance:
      "Handcrafted synthetic business facts and exact TRD-based rubrics; not Nigerian legal-content eligibility",
    executed: results.length,
    passed: results.length - failed,
    failed,
    realProviderCases: results.filter((r) => r.mode === "real_provider").length,
    actualProviderAttempts: results.reduce(
      (sum, r) => sum + ("actualProviderAttempts" in r ? (r.actualProviderAttempts ?? 0) : 0),
      0,
    ),
    preflightCases: results.filter((r) => ["missing_information", "adversarial"].includes(r.mode)).length,
    injectedFaultCases: results.filter((r) => r.mode === "injected_fault").length,
    criticalFailures: results.filter((r) => r.criticalFailure).length,
    observedQualityThresholdMet:
      (results.length - failed) / results.length >= 0.95 &&
      results.every((r) => !r.criticalFailure) &&
      results.length === 60,
    independentLegalAccuracyMeasured: false,
    managedIdentityEvaluated: false,
    AI008Accepted: false,
    R1Accepted: false,
    syntheticWorkspacesAndQuotaRecordsRetained: true,
    limits:
      "This is the real server drafting service below HTTP identity/rate middleware. Twenty cases request the real provider, 28 exercise missing/adversarial preflight, and 12 inject negative transport faults. These are not 60 real-provider calls, legal certification, beta acceptance or export/identity proof.",
    results,
  };
  await writeFile(
    fileURLToPath(new URL("../../../../docs/valo/evidence/customer-ai-60-evaluation.json", import.meta.url)),
    JSON.stringify(report, null, 2) + "\n",
  );
  logger.info({
    event: "customer_ai.evaluation_finished",
    executed: report.executed,
    passed: report.passed,
    failed: report.failed,
    actualProviderAttempts: report.actualProviderAttempts,
  });
  if (failed) process.exitCode = 1;
}
try {
  await main();
} catch {
  logger.error({ event: "customer_ai.evaluation_failed_before_report" });
  process.exitCode = 1;
} finally {
  await pool.end();
}
