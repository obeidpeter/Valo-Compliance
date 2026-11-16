/** Reviewed additive development delta, not a fabricated baseline adoption. */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import { assertDevelopmentRuntime } from "../lib/valo-development-runtime";
try {
  assertDevelopmentRuntime();
  if (process.env.VALO_APPLY_ERASURE !== "reviewed-additive-development-only")
    throw Error("EXPLICIT_DEVELOPMENT_DELTA_REQUIRED");
  const source = await readFile(
    new URL("../../../../lib/db/drizzle/0019_privacy_erasure_objects.sql", import.meta.url),
    "utf8",
  );
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(747109)`);
    const exists = await tx.execute(sql`select to_regclass('public.valo_privacy_erasure_objects') as object`);
    if (exists.rows[0]?.object) throw Error("ERASURE_OBJECTS_EXIST_REVIEW_PRIOR_RECEIPT");
    await tx.execute(sql.raw(source));
  });
  process.stdout.write(
    JSON.stringify({
      migration: "0019_privacy_erasure_objects",
      applied: true,
      sha256: createHash("sha256").update(source).digest("hex"),
      baselineAdopted: false,
      productionApplied: false,
    }) + "\n",
  );
} finally {
  await pool.end();
}
