import { writeFile } from "node:fs/promises";
import { db, pool } from "@workspace/db";
import { finalSourceContext } from "@workspace/valo-core";
import { captureReference } from "../modules/sources";
import { logger } from "../lib/logger";
void db;
if (
  process.env.NODE_ENV !== "development" ||
  process.env.VALO_RUN_SOURCE_RETRIEVAL !== "official-development-only"
)
  throw Error("Explicit development source-retrieval acknowledgement required");
const startedAt = new Date().toISOString();
const pending = [...finalSourceContext.references];
const records: Awaited<ReturnType<typeof captureReference>>[] = [];
try {
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (pending.length) {
        const lead = pending.shift();
        if (!lead) break;
        const record = await captureReference(lead.id);
        records.push(record);
        logger.info({
          event: "editorial.source_attempt",
          sourceId: record.sourceId,
          status: record.status,
          code: record.failureCode,
        });
      }
    }),
  );
  records.sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  await writeFile(
    new URL("../../../../docs/valo/evidence/part6-source-retrieval.json", import.meta.url),
    JSON.stringify(
      {
        startedAt,
        completedAt: new Date().toISOString(),
        records,
        count: records.length,
        retrievedUnreviewed: records.filter((r) => r.status === "retrieved_unreviewed").length,
        published: 0,
        aiReviewed: 0,
        rightsCleared: 0,
        note: "Actual direct-origin attempts, not publication, legal freshness or EDP approval. Original baseline retrieval notes are separate. Failed and incomplete text stays held.",
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await pool.end();
}
