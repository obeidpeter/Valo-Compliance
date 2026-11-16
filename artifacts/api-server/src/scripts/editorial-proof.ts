import { writeFile } from "node:fs/promises";
import { pool } from "@workspace/db";
import { runDevelopmentEditorialProof } from "../editorial/pipeline";
import { editorialCallsCompleted } from "../editorial/pipeline-contract";
import { logger } from "../lib/logger";
try {
  const result = await runDevelopmentEditorialProof();
  await writeFile(
    new URL("../../../../docs/valo/evidence/p0-editorial-provider-proof.json", import.meta.url),
    JSON.stringify({ executedAt: new Date().toISOString(), ...result }, null, 2) + "\n",
  );
  logger.info({
    event: "editorial.proof_finished",
    pipelineId: result.pipelineId,
    publication: result.publication,
    completedRuns: result.runs.filter((r) => r.status === "succeeded").length,
  });
  if (!editorialCallsCompleted(result.runs)) process.exitCode = 1;
} catch (error) {
  const code =
    error instanceof Error && /^(EDITORIAL|SOURCE_STORAGE)_[A-Z_]{1,80}$/.test(error.message)
      ? error.message
      : "EDITORIAL_PROOF_FAILED";
  logger.error({ event: "editorial.proof_failed", code });
  process.exitCode = 1;
} finally {
  await pool.end();
}
