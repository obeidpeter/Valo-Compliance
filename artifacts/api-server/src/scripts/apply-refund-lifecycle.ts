/** Explicit development-only additive migration; never fabricates baseline history. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import { sha256 } from "@workspace/valo-core";
import { publicationWorkspaceRoot, developmentPublicationOnly } from "../modules/publication";
try {
  developmentPublicationOnly();
  if (process.env.VALO_APPLY_REFUNDS !== "reviewed-additive-development-only")
    throw Error("EXPLICIT_DEVELOPMENT_FLAG_REQUIRED");
  const root = publicationWorkspaceRoot(),
    tag = process.env.VALO_REFUND_MIGRATION_TAG ?? "0015_refund_lifecycle";
  if (!["0015_refund_lifecycle", "0016_refund_audit_integrity", "0017_privacy_cases"].includes(tag))
    throw Error("UNKNOWN_REVIEWED_MIGRATION");
  const source = await readFile(resolve(root, `lib/db/drizzle/${tag}.sql`), "utf8");
  const receipt = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(747109)`);
    const before = await tx.execute(sql`select count(*)::int as refunds from valo_refund_requests`);
    const exists =
      tag === "0017_privacy_cases"
        ? await tx.execute(
            sql`select 1 from information_schema.tables where table_schema='public' and table_name='valo_privacy_cases'`,
          )
        : tag === "0015_refund_lifecycle"
          ? await tx.execute(sql`select 1 from information_schema.columns where table_schema='public'
      and table_name='valo_refund_requests' and column_name='amount_kobo'`)
          : await tx.execute(
              sql`select 1 from pg_trigger where tgname='valo_refund_transition_immutable' and not tgisinternal`,
            );
    if (tag === "0017_privacy_cases" && exists.rows.length)
      throw Error("PRIVACY_OBJECTS_ALREADY_EXIST_REVIEW_PRIOR_RECEIPT");
    if (!exists.rows.length) await tx.execute(sql.raw(source));
    const after = await tx.execute(sql`select count(*)::int as refunds from valo_refund_requests`);
    if (JSON.stringify(before.rows) !== JSON.stringify(after.rows)) throw Error("REFUND_HISTORY_CHANGED");
    return { applied: !exists.rows.length, before: before.rows, after: after.rows };
  });
  const dir = resolve(root, "generated-artifacts/valo-completion");
  await mkdir(dir, { recursive: true });
  await writeFile(
    resolve(dir, `${tag}-development-migration.json`),
    JSON.stringify(
      {
        observedAt: new Date().toISOString(),
        tag,
        sqlHash: sha256(source),
        ...receipt,
        legacyAmountsInferred: false,
        baselineAdopted: false,
        productionApplied: false,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await pool.end();
}
