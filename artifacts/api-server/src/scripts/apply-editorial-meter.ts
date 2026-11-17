/** Explicit additive DEVELOPMENT change for the pre-journalled database.
 * Never backfills a fabricated Drizzle baseline. Clean CI uses journal 0012.
 * No startup/schema-push/deployment invocation is installed by this script. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import { sha256 } from "@workspace/valo-core";
import { publicationWorkspaceRoot, developmentPublicationOnly } from "../editorial/operational-policy";
async function main() {
  developmentPublicationOnly();
  if (process.env.VALO_APPLY_EDITORIAL_METER !== "reviewed-additive-development-only")
    throw Error("EXPLICIT_MIGRATION_FLAG_REQUIRED");
  const root = publicationWorkspaceRoot(),
    path = "lib/db/drizzle/0012_editorial_usage_meter.sql";
  const source = await readFile(resolve(root, path), "utf8");
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(747106)`);
    const before = await tx.execute(
      sql`select count(*)::int as reservations from valo_publication_ai_attempts`,
    );
    const existing = await tx.execute(sql`select column_name from information_schema.columns
      where table_schema='public' and table_name='valo_publication_ai_attempts' and column_name='request_hash'`);
    if (existing.rows.length) throw Error("METER_ALREADY_PRESENT_NO_REAPPLICATION");
    await tx.execute(sql.raw(source));
    const columns =
      await tx.execute(sql`select column_name,data_type,is_nullable from information_schema.columns
      where table_schema='public' and table_name='valo_publication_ai_attempts' order by ordinal_position`);
    const after =
      await tx.execute(sql`select count(*)::int as reservations,count(*) filter(where outcome='legacy_unmetered')::int as legacy,
      count(*) filter(where input_tokens is not null or output_tokens is not null)::int as measured from valo_publication_ai_attempts`);
    if (
      Number(before.rows[0].reservations) !== Number(after.rows[0].reservations) ||
      Number(after.rows[0].measured) !== 0
    )
      throw Error("MIGRATION_CHANGED_HISTORIC_USAGE");
    return { before: before.rows[0], after: after.rows[0], columns: columns.rows };
  });
  const directory = resolve(root, "generated-artifacts/valo-completion");
  await mkdir(directory, { recursive: true });
  await writeFile(
    resolve(directory, "editorial-meter-development-migration.json"),
    JSON.stringify(
      {
        executedAt: new Date().toISOString(),
        path,
        sqlHash: sha256(source),
        ...result,
        existingBaselineAdopted: false,
        oldMigrationHistoryInvented: false,
        productionApplied: false,
        limitation:
          "Existing development schema predates the Drizzle journal; full baseline adoption remains separate measured work.",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      developmentAdditiveMigrationApplied: true,
      reservationsPreserved: true,
      historicUsageRemainsUnknown: true,
    }),
  );
}
try {
  await main();
} catch {
  console.error("EDITORIAL_METER_MIGRATION_FAILED");
  process.exitCode = 1;
} finally {
  await pool.end();
}
