import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { resolve } from "node:path";
import { pool } from "@workspace/db";
import { assertDevelopmentRuntime } from "../platform/valo-development-runtime";
import {
  inferenceProposal,
  additionalInferenceAllocation,
  requestDigest,
  budgetUsed,
  type BudgetState,
  proposeHistoricalReceiptResolutions,
  projectHistoricalExposure,
  type HistoricalArtifactInput,
  type HistoricalPublicationAttempt,
} from "../modules/ai";
import { getPublicationArtifact, type ArtifactRef } from "../modules/publication";
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Read-only history preparation. This command never creates migrations,
 * adopts a policy, modifies accounting rows, enables a batch or calls an AI. */
async function main() {
  assertDevelopmentRuntime();
  const root = resolve(import.meta.dirname, "../../../..");
  if (process.env.VALO_PREPARE_FINITE_INFERENCE !== "reviewed-disabled-development-only")
    throw Error("EXPLICIT_PREPARATION_REQUIRED");
  const c = await pool.connect();
  let history: { policy_hash: string; state: BudgetState },
    attempts: HistoricalPublicationAttempt[],
    approved: number;
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const selected = await c.query("SELECT policy_hash,state FROM valo_inference_budgets WHERE id=$1", [
      inferenceProposal.id,
    ]);
    if (!selected.rows[0]) throw Error("EXISTING_USAGE_LEDGER_REQUIRED");
    history = selected.rows[0];
    const rows = await c.query(`SELECT id::text,candidate_hash,role,
      to_jsonb(a)->>'request_hash' AS request_hash,provider_response_id,input_tokens,output_tokens
      FROM valo_publication_ai_attempts a`);
    attempts = rows.rows.map((r) => ({
      id: r.id,
      candidateHash: r.candidate_hash,
      role: r.role,
      requestHash: r.request_hash ?? null,
      responseId: r.provider_response_id ?? null,
      inputTokens: r.input_tokens ?? null,
      outputTokens: r.output_tokens ?? null,
    }));
    approved = Number(
      (await c.query("SELECT count(*)::int n FROM valo_inference_batches WHERE enabled")).rows[0].n,
    );
    await c.query("COMMIT");
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  } finally {
    c.release();
  }
  const artifacts: HistoricalArtifactInput[] = [],
    sourceNotes: Record<string, unknown>[] = [];
  for (const version of [1, 2, 3, 4, 5, 6, 8]) {
    const path = `docs/valo/evidence/operational-publication-v${version}.json`;
    let report: { candidateHash?: string; attestations?: { reviews?: ArtifactRef[] } }, bytes: Buffer;
    try {
      bytes = await readFile(resolve(root, path));
      report = JSON.parse(bytes.toString("utf8"));
    } catch {
      sourceNotes.push({ version, path, unavailable: true });
      continue;
    }
    const refs = report?.attestations?.reviews ?? [];
    if (
      !report ||
      typeof report !== "object" ||
      !Array.isArray(refs) ||
      typeof report.candidateHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(report.candidateHash)
    ) {
      sourceNotes.push({
        version,
        path,
        sourceReportSha256: sha256(bytes),
        reason: "HISTORY_REPORT_REFERENCE_INVALID",
      });
      continue;
    }
    let verifiedDownloads = 0;
    for (const ref of refs) {
      try {
        if (!ref || ref.extension !== "json") throw Error("HISTORY_RESPONSE_ARTIFACT_REQUIRED");
        // Actual private bytes, never model/usage copied from the public summary.
        const actual = await getPublicationArtifact(ref);
        artifacts.push({
          ref: { ...ref, extension: "json" },
          bytes: actual,
          reportCandidateHash: report.candidateHash,
          sourceReportSha256: sha256(bytes),
        });
        verifiedDownloads++;
      } catch (error) {
        sourceNotes.push({
          version,
          path,
          artifactId: ref?.id ?? "unknown",
          reason:
            error instanceof Error && /^[A-Z_]{3,100}$/.test(error.message)
              ? error.message
              : "HISTORY_ARTIFACT_UNAVAILABLE",
        });
      }
    }
    sourceNotes.push({
      version,
      path,
      sourceReportSha256: sha256(bytes),
      retainedReferences: refs.length,
      verifiedDownloads,
    });
  }
  const reconciliation = proposeHistoricalReceiptResolutions(history!.state, attempts!, artifacts);
  const readback = (
    await pool.query("SELECT state FROM valo_inference_budgets WHERE id=$1", [inferenceProposal.id])
  ).rows[0]?.state;
  const state = history!.state;
  const report = {
    executedAt: new Date().toISOString(),
    historyHash: requestDigest(state),
    historyPolicyHash: history!.policy_hash,
    snapshotStillCurrent: readback !== undefined && requestDigest(readback) === requestDigest(state),
    potentialChargeRecords: state.entries.length,
    reportedUsageRecords: state.entries.filter((e) => e.status === "settled").length,
    unknownRecords: state.entries.filter((e) => e.status === "unknown").length,
    unboundedLiabilities: state.unboundedPrior.length,
    provisionalReportedCostNanoUsd: budgetUsed(state).toString(),
    sourceNotes,
    reconciliation,
    projectedExposure: projectHistoricalExposure(state, reconciliation),
    historyModified: false,
    databaseWrites: 0,
    providerCalls: 0,
    ownerApproval: false,
    approvedEnabledBatches: approved!,
    additionalAllocation: additionalInferenceAllocation,
    newAllocationEnabledByThisReport: false,
    separation:
      "Historical unknowns remain recorded and undisclosed billing is not treated as free. An explicitly approved additional allocation covers only newly authorized work; it does not cap total account charges.",
    missingCoverage:
      "This operational review reconciliation does not resolve unsupported drafting, editorial or customer receipts.",
    availableBalance: null,
    productionMigration: false,
  };
  const directory = resolve(root, "generated-artifacts/valo-completion/inference-budget");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = resolve(directory, `history-reconciliation-proposal-${randomUUID()}.json`);
  await writeFile(path, JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(
    JSON.stringify({
      potentialCharges: state.entries.length,
      unknown: report.unknownRecords,
      verifiedRetainedArtifacts: reconciliation.verifiedRetainedArtifacts,
      proposedResolutions: reconciliation.proposed.length,
      unresolvedPublicationAttempts: reconciliation.unresolved.length,
      snapshotStillCurrent: report.snapshotStillCurrent,
      databaseWrites: 0,
      providerCalls: 0,
      ownerApproval: false,
      report: path,
    }),
  );
}
try {
  await main();
} catch (error) {
  console.error(
    error instanceof Error && /^[A-Z_]{3,100}$/.test(error.message)
      ? error.message
      : "FINITE_HISTORY_PREPARATION_FAILED",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
