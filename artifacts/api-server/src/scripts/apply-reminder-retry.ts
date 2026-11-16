/** Explicit reviewed DEVELOPMENT-only addition. No fabricated baseline journal,
 * automatic startup schema push, production mutation or retention approval. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import { sha256 } from "@workspace/valo-core";
import { publicationWorkspaceRoot, developmentPublicationOnly } from "../editorial/operational-policy";
async function main() {
  developmentPublicationOnly();
  if (process.env.VALO_APPLY_REMINDER_RETRY !== "reviewed-additive-development-only")
    throw Error("EXPLICIT_MIGRATION_FLAG_REQUIRED");
  const root = publicationWorkspaceRoot(),
    path = "lib/db/drizzle/0013_reminder_delivery_retry.sql";
  const source = await readFile(resolve(root, path), "utf8");
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(747106)`);
    const before = await tx.execute(
      sql`select count(*)::int as total,sum(attempts) as attempts from valo_reminder_outbox`,
    );
    const exists = await tx.execute(sql`select column_name from information_schema.columns
      where table_schema='public' and table_name='valo_reminder_outbox' and column_name='lease_token'`);
    if (exists.rows.length) throw Error("REMINDER_RETRY_ALREADY_APPLIED");
    await tx.execute(sql.raw(source));
    const after = await tx.execute(
      sql`select count(*)::int as total,sum(attempts) as attempts from valo_reminder_outbox`,
    );
    if (JSON.stringify(before.rows) !== JSON.stringify(after.rows)) throw Error("REMINDER_HISTORY_CHANGED");
    return { before: before.rows, after: after.rows };
  });
  const directory = resolve(root, "generated-artifacts/valo-completion");
  await mkdir(directory, { recursive: true });
  await writeFile(
    resolve(directory, "reminder-retry-development-migration.json"),
    JSON.stringify(
      {
        executedAt: new Date().toISOString(),
        path,
        sqlHash: sha256(source),
        ...result,
        productionApplied: false,
        existingBaselineAdopted: false,
        oldMigrationHistoryInvented: false,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({ developmentAdditiveMigrationApplied: true, existingRowsAndAttemptsPreserved: true }),
  );
}
main()
  .catch(() => {
    console.error("REMINDER_RETRY_MIGRATION_FAILED");
    process.exitCode = 1;
  })
  .finally(() => pool.end());
