import { pool } from "@workspace/db";
import { publishReviewedOperationalCandidate } from "../modules/ai-lanes";
import { getPublicationArtifact } from "../modules/publication";
import { assertDevelopmentRuntime } from "../platform/valo-development-runtime";

/**
 * Operator command, development only (decision 0014). After `finite-inference-run.ts --execute`
 * has run a prepared candidate's two reviews, this saves the candidate as a version with those
 * reviews and hands it to the publisher, or records the hold:
 *
 *   NODE_ENV=development pnpm --filter @workspace/api-server exec tsx src/scripts/publish-reviewed-pair.ts \
 *     <batch id> <result artifact id> <result artifact sha256>
 *
 * The result artifact is the report --execute printed. Each review must be the one the approved
 * batch settled; the publisher rechecks every gate. It calls no model. A guide that passes every gate
 * is saved and released only on the development owner's check of its exact candidate's sources from
 * within the last day (decision 0018): without one, it stops with OWNER_SOURCE_CHECK_REQUIRED and saves
 * nothing, and runs again once the owner has checked.
 */
async function main() {
  assertDevelopmentRuntime();
  const [batchId, id, hash, ...extra] = process.argv.slice(2);
  if (
    extra.length ||
    !batchId ||
    !/^[-a-zA-Z0-9_:]{1,160}$/.test(batchId) ||
    !id ||
    !/^[a-f0-9-]{36}$/.test(id) ||
    !hash ||
    !/^[a-f0-9]{64}$/.test(hash)
  )
    throw Error("PUBLISH_REVIEWED_PAIR_ARGUMENTS_INVALID");
  const report = JSON.parse((await getPublicationArtifact({ id, hash, extension: "json" })).toString()) as {
    batchId?: string;
    complete?: boolean;
    reviews?: { artifact: { id: string; hash: string; extension: "json" } }[];
  };
  if (report.batchId !== batchId || report.complete !== true || report.reviews?.length !== 2)
    throw Error("REVIEWED_PAIR_REPORT_INCOMPLETE");
  const result = await publishReviewedOperationalCandidate({
    batchId,
    reviews: report.reviews.map((r) => r.artifact),
  });
  console.log(JSON.stringify({ ...result, providerCalls: 0 }));
}
try {
  await main();
} catch (error) {
  console.error(
    error instanceof Error && /^[A-Z_:,]{3,200}$/.test(error.message)
      ? error.message
      : "PUBLISH_REVIEWED_PAIR_FAILED",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
