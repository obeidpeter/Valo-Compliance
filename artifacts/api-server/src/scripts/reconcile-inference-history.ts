import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pool } from "@workspace/db";
import { assertDevelopmentRuntime } from "../platform/valo-development-runtime";
import {
  InferenceBudgetStore,
  inferenceProposal,
  requestDigest,
  budgetUsed,
  type BudgetState,
  classifyHistoricalInference,
  applyHistoricalClassifications,
} from "../modules/ai";
import { loadInferenceHistory } from "../modules/ai-lanes";

async function main() {
  assertDevelopmentRuntime();
  if (process.env.VALO_RECONCILE_INFERENCE_HISTORY !== "verified-metadata-disabled-only")
    throw Error("EXPLICIT_RECONCILIATION_REQUIRED");
  const apply = process.argv.includes("--apply-verified-history");
  if (process.argv.slice(2).some((s) => s !== "--apply-verified-history"))
    throw Error("INVALID_RECONCILIATION_ARGUMENT");
  const store = new InferenceBudgetStore(pool);
  const current = (
    await pool.query("SELECT policy_hash,state FROM valo_inference_budgets WHERE id=$1", [
      inferenceProposal.id,
    ])
  ).rows[0];
  if (!current) throw Error("EXISTING_HISTORY_REQUIRED");
  const enabled = Number(
    (await pool.query("SELECT count(*)::int n FROM valo_inference_batches WHERE enabled")).rows[0].n,
  );
  if (enabled) throw Error("RECONCILIATION_REQUIRES_DISABLED_BATCHES");
  let policyAdoption = null;
  if (apply && current.policy_hash !== requestDigest(inferenceProposal))
    policyAdoption = await store.adoptPolicy(
      current.policy_hash,
      "source-bound-budget-history-and-official-price-evidence-2026-11-15",
    );
  const compute = async (state: BudgetState, c: import("pg").PoolClient) => {
    const evidence = await loadInferenceHistory(c);
    const report = classifyHistoricalInference(state, evidence),
      next = apply ? applyHistoricalClassifications(state, report) : state;
    return {
      state: next,
      value: {
        report,
        beforeHash: requestDigest(state),
        afterHash: requestDigest(next),
        entries: next.entries.length,
        reportedUsageEntries: next.entries.filter((e) => e.status === "settled").length,
        noOutboundEntries: next.entries.filter((e) => e.status === "cancelled").length,
        unknownEntries: next.entries.filter((e) => e.status === "unknown").length,
        unboundedLiabilities: next.unboundedPrior.length,
        reportedNanoUsd: budgetUsed(next).toString(),
        originalEntriesPreserved: !apply || next.historyResolutions?.every((r) => r.before.legacy),
        ledgerClassifications: next.historyResolutions?.length ?? 0,
      },
    };
  };
  let result;
  if (apply) result = await store.mutate("verified-historical-receipt-reconciliation", compute);
  else {
    const c = await pool.connect();
    try {
      await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const r = (
        await c.query("SELECT state FROM valo_inference_budgets WHERE id=$1", [inferenceProposal.id])
      ).rows[0];
      result = (await compute(r.state, c)).value;
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  const output = {
    executedAt: new Date().toISOString(),
    applied: apply,
    policyAdoption,
    ...result,
    ownerApproval: false,
    enabledBatches: enabled,
    newInferenceCalls: 0,
    billingCertified: false,
    historicalScope: "separate historical exposure register",
    newBatchStart:
      "only after durable owner approval of exact finite work; no retrospective approval requested",
    priorGlobalProjectBudgetExists: false,
    sourceRowsModified: 0,
    existingQuotasChanged: false,
  };
  const dir = resolve(
    import.meta.dirname,
    "../../../../generated-artifacts/valo-completion/inference-budget",
  );
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = resolve(dir, `verified-history-${randomUUID()}.json`);
  await writeFile(path, JSON.stringify(output, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(
    JSON.stringify({
      applied: apply,
      entries: result.entries,
      reported: result.reportedUsageEntries,
      noOutbound: result.noOutboundEntries,
      unknown: result.unknownEntries,
      unbounded: result.unboundedLiabilities,
      classifications: result.ledgerClassifications,
      ownerApproval: false,
      newInferenceCalls: 0,
      path,
    }),
  );
}
try {
  await main();
} catch (e) {
  console.error(
    e instanceof Error && /^[A-Z_]{3,100}$/.test(e.message) ? e.message : "HISTORY_RECONCILIATION_FAILED",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
