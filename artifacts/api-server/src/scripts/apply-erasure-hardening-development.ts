import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import { assertDevelopmentRuntime } from "../lib/valo-development-runtime";
try {
  assertDevelopmentRuntime();
  if (process.env.VALO_APPLY_ERASURE_HARDENING !== "reviewed-additive-development-only")
    throw Error("EXPLICIT_DEVELOPMENT_REVIEW_REQUIRED");
  const source = await readFile(
    new URL("../../../../lib/db/drizzle/0022_privacy_erasure_hardening.sql", import.meta.url),
    "utf8",
  );
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(747113)`);
    const r = await tx.execute(sql`SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='valo_privacy_tombstones' AND column_name='erasure_seal'`);
    if (r.rows.length) throw Error("ERASURE_HARDENING_ALREADY_PRESENT_REVIEW_PRIOR_RECEIPT");
    await tx.execute(sql.raw(source.replaceAll("--> statement-breakpoint", "")));
  });
  console.log(
    JSON.stringify({
      migration: "0022_privacy_erasure_hardening",
      sha256: createHash("sha256").update(source).digest("hex"),
      developmentApplied: true,
      productionApplied: false,
      baselineAdopted: false,
    }),
  );
} finally {
  await pool.end();
}
