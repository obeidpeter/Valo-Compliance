/** Explicit additive DEVELOPMENT command; never adopts old migration history. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import { sha256 } from "@workspace/valo-core";
import { publicationWorkspaceRoot, developmentPublicationOnly } from "../modules/publication";
try {
  developmentPublicationOnly();
  if (process.env.VALO_APPLY_REMINDER_WINDOW !== "reviewed-additive-development-only")
    throw Error("EXPLICIT_DEVELOPMENT_FLAG_REQUIRED");
  const root = publicationWorkspaceRoot(),
    source = await readFile(resolve(root, "lib/db/drizzle/0014_reminder_replay_window.sql"), "utf8");
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(747108)`);
    const before = await tx.execute(
      sql`select count(*)::int as rows,coalesce(sum(attempts),0)::int as attempts from valo_reminder_outbox`,
    );
    const exists = await tx.execute(sql`select 1 from information_schema.columns where table_schema='public'
      and table_name='valo_reminder_outbox' and column_name='first_attempt_at'`);
    if (!exists.rows.length) await tx.execute(sql.raw(source));
    const after = await tx.execute(
      sql`select count(*)::int as rows,coalesce(sum(attempts),0)::int as attempts from valo_reminder_outbox`,
    );
    if (JSON.stringify(before.rows) !== JSON.stringify(after.rows)) throw Error("REMINDER_HISTORY_CHANGED");
    return { applied: !exists.rows.length, before: before.rows[0], after: after.rows[0] };
  });
  const dir = resolve(root, "generated-artifacts/valo-completion");
  await mkdir(dir, { recursive: true });
  await writeFile(
    resolve(dir, "reminder-window-development-migration.json"),
    JSON.stringify(
      {
        observedAt: new Date().toISOString(),
        sqlHash: sha256(source),
        ...result,
        historicalFirstAttemptsBackfilled: false,
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
