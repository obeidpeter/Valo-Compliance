import { readFile, writeFile } from "node:fs/promises";
import { pool } from "@workspace/db";
import { captureReference } from "../editorial/source-capture";
import { logger } from "../lib/logger";
if (
  process.env.NODE_ENV !== "development" ||
  process.env.VALO_RUN_SOURCE_RETRIEVAL !== "official-development-only"
)
  throw Error("Explicit development source acknowledgement required");
const startedAt = new Date().toISOString();
const reportPath = new URL(
  "../../../../docs/valo/evidence/coordinating-instrument-retrieval.json",
  import.meta.url,
);
let priorRuns: unknown[] = [];
try {
  const previous = JSON.parse(await readFile(reportPath, "utf8"));
  priorRuns = [
    ...(previous.priorRuns ?? []),
    { startedAt: previous.startedAt, completedAt: previous.completedAt, records: previous.records },
  ];
} catch (error) {
  if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
}
try {
  const records = [];
  for (const id of ["S02", "SV-010"]) {
    const result = await captureReference(id);
    records.push(result);
    logger.info({
      event: "editorial.instrument_attempt",
      sourceId: id,
      status: result.status,
      bytes: result.bytes,
      code: result.failureCode,
    });
  }
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        startedAt,
        completedAt: new Date().toISOString(),
        records,
        priorRuns,
        note: "Actual authoritative-byte retrieval and text/title checks only. No amendments, current effectivity, claim maps, rights, AI review or publication accepted.",
        published: 0,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await pool.end();
}
