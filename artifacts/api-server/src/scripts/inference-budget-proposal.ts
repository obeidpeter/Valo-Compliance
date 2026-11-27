import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pool } from "@workspace/db";
import {
  inferenceProposal,
  proposalTotals,
  importPilotUsage,
  budgetUsed,
  requestDigest,
  type PilotUsage,
  InferenceBudgetStore,
  verifiedPilotImports,
} from "../modules/ai";
import { loadInferenceHistory } from "../modules/ai-lanes";
async function main() {
  if (process.env.NODE_ENV !== "development" || process.env.REPLIT_DEPLOYMENT)
    throw Error("DEVELOPMENT_ONLY");
  const root = resolve(import.meta.dirname, "../../../..");
  let developmentDeltaApplied = false;
  if (process.argv.includes("--apply-reviewed-development-delta")) {
    // Existing development tables predate a populated Drizzle ledger. Apply
    // only this reviewed additive delta; NEVER fabricate the earlier history.
    // Clean-install migration proof is a separate retained local-cluster run.
    const exists = await pool.query("select to_regclass('public.valo_inference_budgets') as name");
    if (exists.rows[0].name) throw Error("DELTA_ALREADY_EXISTS_USE_READ_ONLY_IMPORT");
    const ddl = await readFile(resolve(root, "lib/db/drizzle/0018_inference_budget.sql"), "utf8");
    await pool.query(ddl.replaceAll("--> statement-breakpoint", ""));
    developmentDeltaApplied = true;
  }
  const c = await pool.connect();
  const evidence = await (async () => {
    try {
      await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const e = await loadInferenceHistory(c);
      await c.query("COMMIT");
      return e;
    } catch (error) {
      await c.query("ROLLBACK");
      throw error;
    } finally {
      c.release();
    }
  })();
  const rows: PilotUsage[] = verifiedPilotImports(evidence);
  const sourceCounts = {
    publicationAttempts: evidence.publicationAttempts.length,
    editorialRuns: evidence.rows.filter((r) => r.lane === "editorial_evaluation").length,
    customerAttempts: evidence.rows.filter((r) => r.lane === "customer").length,
    excludedNoOutboundCustomerRuns: evidence.excludedNoOutboundCustomerRuns,
    verifiedImportRows: rows.length,
  };
  const store = new InferenceBudgetStore(pool);
  const imported = await store.mutate("import_pilot_metadata_disabled", (s) => {
    const r = importPilotUsage(s, rows);
    return {
      state: r.state,
      value: {
        imported: r.imported,
        duplicates: r.duplicates,
        entries: r.state.entries.length,
        unbounded: r.state.unboundedPrior.length,
        knownUsageEstimateNanoUsd: budgetUsed(r.state).toString(),
        priorUseReconciled: r.state.priorUseReconciled,
      },
    };
  });
  const dir = resolve(root, "generated-artifacts/valo-completion/inference-budget");
  await mkdir(dir, { recursive: true });
  const bindings = [
    "artifacts/api-server/src/modules/ai/inference-budget.ts",
    "artifacts/api-server/src/modules/ai/managed-inference.ts",
    "artifacts/api-server/src/modules/ai/inference-budget-store.ts",
  ];
  const codeHashes = Object.fromEntries(
    await Promise.all(
      bindings.map(async (p) => [p, requestDigest(await readFile(resolve(root, p), "utf8"))]),
    ),
  );
  const report = {
    recordedAt: new Date().toISOString(),
    proposal: inferenceProposal,
    totals: proposalTotals(),
    sourceCounts,
    imported,
    developmentDeltaApplied,
    existingDevelopmentHistoryAdopted: false,
    productionMigrationApplied: false,
    codeHashes,
    providerCalls: 0,
    quotasChanged: false,
    identitiesCreated: 0,
    activationAvailable: false,
    actualBillingVerified: false,
    tokenCounterIntegrationVerified: false,
    wholeContextFallbackAvailable: true,
    holds: ["OWNER_SPEND_APPROVAL_ABSENT"],
    historicalLiabilities:
      "Unresolved historical exposure is separate from any explicitly additional, future owner-approved allocation; no global project budget was approved.",
    notice:
      "Reported tokens give a provisional uncached-price estimate, not a billing receipt. Unknown/time-out/unmetered prior attempts are held without assuming zero. No finite remaining guarantee until reconciliation. This is application inference only, excluding tax, hosting, Agent usage and other projects.",
  };
  await writeFile(resolve(dir, "proposal.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify({
      disabled: true,
      providerCalls: 0,
      sourceCounts,
      imported,
      base: report.totals.baseNanoUsd,
      uplift: report.totals.upliftNanoUsd,
    }),
  );
}
try {
  await main();
} catch {
  console.error("Budget preparation held; no activation or billing reconciliation inferred.");
  process.exitCode = 1;
} finally {
  await pool.end();
}
